// supabase/functions/move/index.ts
// Edge Function: POST /functions/v1/move
// Lê processing_queue status=pending, cria pastas Drive, move e renomeia ficheiro, actualiza Supabase

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  splitDestPath,
  resolveDestFileName,
  validateQueueEntry,
  hasExceededMaxAttempts,
  buildDriveFilesUrl,
  buildDriveFileUrl,
  type QueueEntry,
} from './move.utils.ts';
import { checkRateLimit, rateLimitExceeded } from '../_shared/rate-limit.ts';
import { z, validate, validationError } from '../_shared/validate.ts';

// Schema de validação do body
const MoveBodySchema = z.object({
  queue_id: z.string().uuid('queue_id deve ser um UUID válido').optional(),
}).strict();

// ============================================================
// CORS
// ============================================================
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================
// GOOGLE DRIVE AUTH
// ============================================================
async function getDriveToken(): Promise<string> {
  const sa = JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')!);

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const toBase64Url = (str: string) =>
    btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const header = toBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = toBase64Url(JSON.stringify(payload));
  const unsigned = `${header}.${body}`;

  const keyData = sa.private_key
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\n/g, '');

  const binaryKey = Uint8Array.from(atob(keyData), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(unsigned)
  );

  const sigBase64Url = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const jwt = `${unsigned}.${sigBase64Url}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const { access_token } = await res.json();
  return access_token;
}

// ============================================================
// DRIVE: encontra ou cria pasta
// ============================================================
async function findOrCreateFolder(
  token: string,
  name: string,
  parentId: string,
): Promise<string> {
  const q = encodeURIComponent(
    `'${parentId}' in parents and name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const listRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const listData = await listRes.json();

  if (listData.files?.length > 0) {
    return listData.files[0].id as string;
  }

  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    }),
  });

  const created = await createRes.json();
  return created.id as string;
}

// ============================================================
// DRIVE: resolve caminho completo de pastas
// ============================================================
async function resolveFolderPath(
  token: string,
  segments: string[],
  rootFolderId: string,
): Promise<string> {
  let currentId = rootFolderId;
  for (const segment of segments) {
    currentId = await findOrCreateFolder(token, segment, currentId);
  }
  return currentId;
}

// ============================================================
// DRIVE: move e renomeia ficheiro
// ============================================================
async function moveAndRenameFile(
  token: string,
  fileId: string,
  fromFolderId: string,
  toFolderId: string,
  newName: string,
): Promise<void> {
  const url = `${buildDriveFileUrl(fileId)}?addParents=${toFolderId}&removeParents=${fromFolderId}&fields=id&supportsAllDrives=true`;

  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: newName }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Drive PATCH falhou: ${JSON.stringify(err)}`);
  }
}

// ============================================================
// HANDLER PRINCIPAL
// ============================================================
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  // Rate limiting: 30 req/min por IP
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown';
  if (!checkRateLimit(`move:${ip}`, 30, 60_000)) {
    return rateLimitExceeded(CORS);
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const rawBody = await req.json().catch(() => ({}));
    const validation = validate(MoveBodySchema, rawBody);
    if (!validation.ok) return validationError(validation.error, CORS);

    const specificId: string | null = validation.data.queue_id ?? null;

    // Carrega folder_config do Supabase para rootFolderId dinâmico
    const { data: folderConfigData } = await supabase
      .from('folder_config')
      .select('key, folder_id');
    const folderConfigMap: Record<string, string | null> = {};
    for (const fc of (folderConfigData ?? [])) {
      folderConfigMap[fc.key] = fc.folder_id ?? null;
    }
    const defaultRootFolderId = folderConfigMap['root'] ?? Deno.env.get('DRIVE_ROOT_FOLDER_ID') ?? '';

    // Busca entradas pending
    let query = supabase
      .from('processing_queue')
      .select('*')
      .eq('status', 'pending');

    if (specificId) {
      query = query.eq('id', specificId);
    }

    const { data: entries, error: fetchError } = await query;

    if (fetchError) throw new Error(fetchError.message);
    if (!entries || entries.length === 0) {
      return new Response(
        JSON.stringify({ moved: 0, message: 'Sem entradas pending' }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    const driveToken = await getDriveToken();
    let moved = 0;
    const errors: Array<{ id: string; reason: string }> = [];

    for (const raw of entries) {
      const entry = raw as QueueEntry;

      // Validação
      const validation = validateQueueEntry(entry);
      if (!validation.valid) {
        await supabase.from('processing_queue').update({
          status: 'manual_review',
          error_message: validation.reason,
        }).eq('id', entry.id);

        await supabase.from('processing_logs').insert({
          queue_id: entry.id,
          file_id: entry.file_id,
          file_name: entry.file_name,
          action: 'error',
          status: 'error',
          error_message: validation.reason,
        });

        errors.push({ id: entry.id, reason: validation.reason! });
        continue;
      }

      // Tentativas esgotadas
      if (hasExceededMaxAttempts(entry.attempts)) {
        await supabase.from('processing_queue').update({
          status: 'manual_review',
          error_message: 'Número máximo de tentativas atingido',
        }).eq('id', entry.id);
        errors.push({ id: entry.id, reason: 'max attempts' });
        continue;
      }

      // Marca como processing
      await supabase.from('processing_queue').update({
        status: 'processing',
        attempts: entry.attempts + 1,
      }).eq('id', entry.id);

      try {
        const baseFolderId = entry.dest_root_folder_id ?? defaultRootFolderId;
        const segments = splitDestPath(entry.dest_path!);
        const destFolderId = await resolveFolderPath(driveToken, segments, baseFolderId);
        const finalFileName = resolveDestFileName(entry);

        await moveAndRenameFile(
          driveToken,
          entry.file_id,
          entry.inbox_folder_id,
          destFolderId,
          finalFileName,
        );

        // Sucesso: actualiza queue e regista log
        await supabase.from('processing_queue').update({
          status: 'done',
          error_message: null,
        }).eq('id', entry.id);

        // Para received/ecommerce guarda o folder_id trimestral em folder_config
        if ((entry.doc_type === 'received' || entry.doc_type === 'ecommerce') && entry.dest_quarter) {
          const quarterKey = `taloes_${entry.dest_quarter}t`;
          const pathSegs = splitDestPath(entry.dest_path!);
          if (pathSegs.length >= 2) {
            const yearFolderId = await findOrCreateFolder(driveToken, pathSegs[0], baseFolderId);
            const talosFolderId = await findOrCreateFolder(driveToken, pathSegs[1], yearFolderId);
            await supabase.from('folder_config').upsert(
              { key: quarterKey, folder_id: talosFolderId, folder_name: pathSegs[1], updated_at: new Date().toISOString() },
              { onConflict: 'key' }
            );
          }
        }

        await supabase.from('processing_logs').insert({
          queue_id: entry.id,
          file_id: entry.file_id,
          file_name: entry.file_name,
          action: 'move',
          origin_path: entry.inbox_folder_id,
          dest_path: entry.dest_path,
          status: 'success',
          metadata: { dest_file_name: finalFileName, dest_folder_id: destFolderId },
        });

        moved++;

      } catch (err) {
        const message = err instanceof Error ? err.message : 'Erro desconhecido';

        await supabase.from('processing_queue').update({
          status: 'error',
          error_message: message,
        }).eq('id', entry.id);

        await supabase.from('processing_logs').insert({
          queue_id: entry.id,
          file_id: entry.file_id,
          file_name: entry.file_name,
          action: 'error',
          status: 'error',
          error_message: message,
        });

        errors.push({ id: entry.id, reason: message });
      }
    }

    return new Response(
      JSON.stringify({ moved, errors }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Erro interno' }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }
});
