// supabase/functions/classify/index.ts
// Edge Function: POST /functions/v1/classify
// Classifica ficheiros da inbox da Drive e insere na processing_queue

import { createClient } from 'npm:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@0.39.0';
import {
  buildQueuePayload,
  type Supplier,
  type FolderConfig,
  type ClaudeMeta,
} from './classify.utils.ts';
import { checkRateLimit, rateLimitExceeded } from '../_shared/rate-limit.ts';
import { z, validate, validationError } from '../_shared/validate.ts';

// Schema de validação do body
const ClassifyBodySchema = z.object({
  file_id: z.string().uuid('file_id deve ser um UUID válido').optional(),
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

  // Sign JWT with service account private key (base64url encoding required)
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
// DRIVE: lista ficheiros PDF na inbox
// ============================================================
async function listInboxFiles(token: string, folderId: string) {
  const q = encodeURIComponent(
    `'${folderId}' in parents and mimeType='application/pdf' and trashed=false`
  );
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,size,createdTime)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  return data.files ?? [];
}

// ============================================================
// DRIVE: download PDF como base64
// ============================================================
async function downloadFileBase64(token: string, fileId: string): Promise<string> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const buffer = await res.arrayBuffer();
  // Spread em chunks para evitar "Maximum call stack size exceeded" em PDFs grandes
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// ============================================================
// CLAUDE VISION: extrai metadados do PDF
// ============================================================
async function extractMetadata(
  client: Anthropic,
  pdfBase64: string,
  supabase: ReturnType<typeof createClient>,
) {
  const { data: examples } = await supabase
    .from('training_examples')
    .select('supplier, nif, doc_type, is_my_doc, my_doc_kind')
    .order('created_at', { ascending: false })
    .limit(8);

  let fewShotText = '';
  if (examples && examples.length > 0) {
    const lines = examples.map((ex: { supplier: string | null; nif: string | null; doc_type: string; is_my_doc: boolean; my_doc_kind: string | null }) => {
      const kind = ex.my_doc_kind ?? ex.doc_type;
      return `- Supplier "${ex.supplier ?? '?'}", NIF "${ex.nif ?? '?'}" → doc_type: ${kind}, is_my_doc: ${ex.is_my_doc}`;
    });
    fewShotText = `\nExemplos de classificações anteriores (aprende com estes):\n${lines.join('\n')}\n`;
  }

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: [
      {
        type: 'text',
        text: `És um sistema de classificação de documentos fiscais. Extrais metadados de documentos PDF em JSON.${fewShotText}`,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
        },
        {
          type: 'text',
          text: `Analisa este documento fiscal e extrai os metadados em JSON.
Responde APENAS com JSON válido, sem texto adicional, sem markdown.
Formato exacto:
{
  "doc_date": "YYYY-MM-DD ou null",
  "supplier": "nome da empresa emissora ou null",
  "issuerNif": "NIF/VAT do emitente (quem emite a fatura) ou null",
  "value": número total da fatura (sem símbolo) ou null,
  "nif": "NIF/VAT do emitente ou null",
  "country": "país do emitente em inglês ou null",
  "currency": "código ISO 4217 (EUR, USD, etc.) ou EUR se não indicado",
  "confidence": número entre 0 e 1 indicando a tua confiança na extracção,
  "is_my_doc": true se este documento foi EMITIDO pela nossa empresa (NIF 514084235 aparece como emitente), false caso contrário,
  "my_doc_kind": "invoice_issued" | "receipt_issued" | "quote_issued" | null (apenas quando is_my_doc=true)
}`,
        },
      ],
    }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '{}';

  try {
    return JSON.parse(text);
  } catch {
    return { doc_date: null, supplier: null, value: null, nif: null, country: null, currency: 'EUR', is_my_doc: false, my_doc_kind: null };
  }
}

// ============================================================
// HANDLER PRINCIPAL
// ============================================================
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  // Rate limiting: 30 req/min por IP (pg_cron + uso manual)
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown';
  if (!checkRateLimit(`classify:${ip}`, 30, 60_000)) {
    return rateLimitExceeded(CORS);
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const anthropic = new Anthropic({
      apiKey: Deno.env.get('ANTHROPIC_API_KEY')!
    });

    const rawBody = await req.json().catch(() => ({}));
    const validation = validate(ClassifyBodySchema, rawBody);
    if (!validation.ok) return validationError(validation.error, CORS);

    const specificFileId: string | null = validation.data.file_id ?? null;

    const inboxFolderId = Deno.env.get('DRIVE_INBOX_FOLDER_ID')!;
    const companyNif = Deno.env.get('COMPANY_NIF') ?? '514084235';
    const driveToken = await getDriveToken();

    // Carrega suppliers e folder_config do Supabase
    const [{ data: suppliersData }, { data: folderConfigData }] = await Promise.all([
      supabase.from('suppliers').select('name, nif, keywords, type'),
      supabase.from('folder_config').select('key, folder_id, folder_name, parent_key, auto_create'),
    ]);

    const suppliers: Supplier[] = suppliersData ?? [];
    const folderConfig: FolderConfig[] = folderConfigData ?? [];

    // Determina quais ficheiros processar
    const files = specificFileId
      ? [{ id: specificFileId, name: 'unknown.pdf' }]
      : await listInboxFiles(driveToken, inboxFolderId);

    if (files.length === 0) {
      return new Response(
        JSON.stringify({ queued: 0, message: 'Inbox vazia' }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    let queued = 0;

    for (const file of files) {
      // Ignora se já está na fila (excepto se for status=error, que pode ser re-processado)
      const { data: existing } = await supabase
        .from('processing_queue')
        .select('id, status')
        .eq('file_id', file.id)
        .single();

      if (existing && existing.status !== 'error') continue;

      try {
        // Download e extracção
        const pdfBase64 = await downloadFileBase64(driveToken, file.id);
        const rawMeta = await extractMetadata(anthropic, pdfBase64, supabase);

        const meta: ClaudeMeta = {
          doc_date: rawMeta.doc_date ?? null,
          supplier: rawMeta.supplier ?? null,
          issuerNif: rawMeta.issuerNif ?? null,
          value: rawMeta.value ?? null,
          nif: rawMeta.nif ?? null,
          country: rawMeta.country ?? null,
          currency: rawMeta.currency ?? 'EUR',
          confidence: typeof rawMeta.confidence === 'number' ? rawMeta.confidence : 0.8,
          is_my_doc: rawMeta.is_my_doc === true,
          my_doc_kind: rawMeta.my_doc_kind ?? null,
        };

        const payload = buildQueuePayload(file, inboxFolderId, meta, suppliers, folderConfig, companyNif);

        // Persiste fornecedor auto-detectado se não estiver na lista conhecida
        if (meta.supplier && payload.doc_type !== 'unknown') {
          const supplierLower = meta.supplier.toLowerCase();
          const alreadyKnown = suppliers.some(s =>
            s.keywords.some(kw => supplierLower.includes(kw)) ||
            (s.nif && meta.nif && s.nif === meta.nif)
          );
          if (!alreadyKnown) {
            await supabase.from('suppliers').upsert(
              {
                name: meta.supplier,
                nif: meta.nif ?? null,
                keywords: [supplierLower],
                type: payload.doc_type === 'ecommerce' ? 'ecommerce'
                    : payload.doc_type === 'bank_statement' ? 'bank'
                    : payload.doc_type === 'supplies' ? 'supplies'
                    : 'normal',
                auto_detected: true,
                active: true,
              },
              { onConflict: 'name', ignoreDuplicates: false }
            );
          }
        }

        // Insere ou actualiza na fila (update se era error, insert se novo)
        if (existing?.status === 'error') {
          await supabase.from('processing_queue')
            .update({ ...payload, error_message: null })
            .eq('id', existing.id)
            .throwOnError();
        } else {
          await supabase.from('processing_queue').insert(payload).throwOnError();
        }

        // Log de sucesso
        await supabase.from('processing_logs').insert({
          file_id: file.id,
          file_name: file.name,
          action: 'classify',
          status: 'success',
          metadata: { ...meta, doc_type: payload.doc_type },
        });

        queued++;

      } catch (err) {
        // Log de erro + fila com status error
        await supabase.from('processing_queue').upsert({
          file_id: file.id,
          file_name: file.name,
          inbox_folder_id: inboxFolderId,
          status: 'error',
          error_message: err instanceof Error ? err.message : 'Erro desconhecido',
        });

        await supabase.from('processing_logs').insert({
          file_id: file.id,
          file_name: file.name,
          action: 'error',
          status: 'error',
          error_message: err instanceof Error ? err.message : 'Erro desconhecido',
        });
      }
    }

    // --------------------------------------------------------
    // Auto-move: dispara /move após classify para processar
    // todos os items pending (novos + anteriores não processados).
    // Usa Promise.race com timeout para não bloquear a resposta
    // mas garantir que o runtime não corta a fetch prematuramente.
    // --------------------------------------------------------
    const moveUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/move`;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const movePromise = fetch(moveUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: '{}',
    }).catch(() => { /* ignora erros de rede */ });

    // Aguarda até 8s para dar tempo ao /move arrancar; não bloqueia
    // para além disso (edge function tem limite de 150s total)
    await Promise.race([
      movePromise,
      new Promise(resolve => setTimeout(resolve, 8_000)),
    ]);

    return new Response(
      JSON.stringify({ queued }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Erro interno' }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }
});
