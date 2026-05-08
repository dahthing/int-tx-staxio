// supabase/functions/move-existing/index.ts
// Edge Function: POST /functions/v1/move-existing
// Move um ficheiro já processado (status=done) para uma nova pasta no Drive

import { createClient } from 'npm:@supabase/supabase-js@2';
import { checkRateLimit, rateLimitExceeded } from '../_shared/rate-limit.ts';
import { z, validate, validationError } from '../_shared/validate.ts';

const MoveExistingBodySchema = z.object({
  queue_id: z.string().uuid('queue_id deve ser um UUID válido'),
  new_folder_id: z.string().min(1, 'new_folder_id é obrigatório'),
  new_folder_path: z.string().min(1, 'new_folder_path é obrigatório'),
}).strict();

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  const ip = req.headers.get('x-forwarded-for') ?? 'unknown';
  if (!checkRateLimit(`move-existing:${ip}`, 30, 60_000)) {
    return rateLimitExceeded(CORS);
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const rawBody = await req.json().catch(() => ({}));
    const validation = validate(MoveExistingBodySchema, rawBody);
    if (!validation.ok) return validationError(validation.error, CORS);

    const { queue_id, new_folder_id, new_folder_path } = validation.data;

    const { data: entry, error: fetchError } = await supabase
      .from('processing_queue')
      .select('id, file_id, file_name, dest_root_folder_id, dest_path, inbox_folder_id, status')
      .eq('id', queue_id)
      .single();

    if (fetchError || !entry) {
      return new Response(
        JSON.stringify({ error: 'Entrada não encontrada' }),
        { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    const driveToken = await getDriveToken();

    // Fetch current parents so we remove them correctly regardless of how nested the file is
    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${entry.file_id}?fields=parents&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${driveToken}` } }
    );
    const metaData = await metaRes.json();
    const currentParents: string[] = metaData.parents ?? [];

    const patchUrl = `https://www.googleapis.com/drive/v3/files/${entry.file_id}` +
      `?addParents=${new_folder_id}` +
      (currentParents.length > 0 ? `&removeParents=${currentParents.join(',')}` : '') +
      `&fields=id&supportsAllDrives=true`;

    const patchRes = await fetch(patchUrl, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${driveToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    if (!patchRes.ok) {
      const err = await patchRes.json();
      throw new Error(`Drive PATCH falhou: ${JSON.stringify(err)}`);
    }

    await supabase
      .from('processing_queue')
      .update({
        dest_root_folder_id: new_folder_id,
        dest_path: new_folder_path,
        updated_at: new Date().toISOString(),
      })
      .eq('id', queue_id)
      .throwOnError();

    await supabase.from('processing_logs').insert({
      queue_id: entry.id,
      file_id: entry.file_id,
      file_name: entry.file_name,
      action: 'move_manual',
      status: 'success',
      dest_path: new_folder_path,
      metadata: { new_folder_id },
    });

    return new Response(
      JSON.stringify({ moved: 1 }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Erro interno' }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }
});
