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
import {
  extractQrTextFromPdf,
  extractQrTextFromThumbnail,
  parseAtQrString,
  isQrMetaSufficient,
} from './qr.utils.ts';
import { checkRateLimit, rateLimitExceeded } from '../_shared/rate-limit.ts';
import { z, validate, validationError } from '../_shared/validate.ts';

// Schema de validação do body
const ClassifyBodySchema = z.object({
  file_id: z.string().uuid('file_id deve ser um UUID válido').optional(),
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
// DRIVE: helpers para re-arquivo (Parte D)
// ============================================================
async function getDriveFileParent(token: string, fileId: string): Promise<string> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=parents&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  return (data.parents ?? [])[0] ?? '';
}

async function trashDriveFile(token: string, fileId: string): Promise<void> {
  await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    }
  );
}

async function findExistingDoneRow(
  supabase: ReturnType<typeof createClient>,
  criteria: { atcud: string | null; supplier: string | null; value: number | null; doc_date: string | null }
): Promise<{ id: string; file_id: string; file_name: string; inbox_folder_id: string; source: string } | null> {
  // Prioridade 1: ATCUD exacto
  if (criteria.atcud) {
    const { data } = await supabase
      .from('processing_queue')
      .select('id, file_id, file_name, inbox_folder_id, source')
      .eq('status', 'done')
      .eq('atcud', criteria.atcud)
      .limit(1)
      .single();
    if (data) return data;
  }

  // Prioridade 2: supplier + value + doc_date (mesmo dia)
  if (criteria.supplier && criteria.value !== null && criteria.doc_date) {
    const { data } = await supabase
      .from('processing_queue')
      .select('id, file_id, file_name, inbox_folder_id, source')
      .eq('status', 'done')
      .eq('supplier', criteria.supplier)
      .gte('value', criteria.value - 0.01)
      .lte('value', criteria.value + 0.01)
      .eq('doc_date', criteria.doc_date)
      .limit(1)
      .single();
    if (data) return data;
  }

  return null;
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
  "value": número total da fatura COM IVA incluído (sem símbolo) ou null,
  "vat_amount": valor do IVA em euros ou null,
  "vat_rate": taxa de IVA em percentagem (ex: 23, 13, 6) ou null,
  "nif": "NIF/VAT do emitente ou null",
  "country": "país do emitente em inglês ou null",
  "currency": "código ISO 4217 (EUR, USD, etc.) ou EUR se não indicado",
  "atcud": "código ATCUD no formato XXXXXXXX-NNNNN (geralmente no rodapé do documento, após 'ATCUD:') ou null se ausente",
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

    const body = validation.data as { file_id?: string; queue_id?: string };
    const specificFileId: string | null = body.file_id ?? null;
    const reprocessQueueId: string | null = body.queue_id ?? null;

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

    // ---- Modo reprocessamento (queue_id) ----
    if (reprocessQueueId) {
      const { data: queueRow, error: queueErr } = await supabase
        .from('processing_queue')
        .select('*')
        .eq('id', reprocessQueueId)
        .single();

      if (queueErr || !queueRow) {
        return new Response(
          JSON.stringify({ error: 'Registo não encontrado' }),
          { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } }
        );
      }

      const prevDocType = queueRow.doc_type;
      const prevDestPath = queueRow.dest_path;
      const source: 'current' | 'archive' = queueRow.source === 'archive' ? 'archive' : 'current';

      // Resolve pasta actual do ficheiro no Drive (já foi movido do inbox)
      const currentParent = await getDriveFileParent(driveToken, queueRow.file_id);

      // Download do PDF
      const pdfRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${queueRow.file_id}?alt=media&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${driveToken}` } }
      );
      if (!pdfRes.ok) throw new Error(`Drive download falhou: ${pdfRes.status}`);

      const pdfBytes = new Uint8Array(await pdfRes.arrayBuffer());
      let binary2 = '';
      for (let i = 0; i < pdfBytes.length; i += 8192) {
        binary2 += String.fromCharCode(...pdfBytes.subarray(i, i + 8192));
      }
      const pdfBase64 = btoa(binary2);

      // Reprocesso usa sempre Claude Vision para máxima fiabilidade
      const rawReprocessMeta = await extractMetadata(anthropic, pdfBase64, supabase);

      const reprocessMeta: ClaudeMeta = {
        doc_date: rawReprocessMeta.doc_date ?? null,
        supplier: rawReprocessMeta.supplier ?? null,
        issuerNif: rawReprocessMeta.issuerNif ?? null,
        value: rawReprocessMeta.value ?? null,
        nif: rawReprocessMeta.nif ?? null,
        country: rawReprocessMeta.country ?? null,
        currency: rawReprocessMeta.currency ?? 'EUR',
        atcud: rawReprocessMeta.atcud ?? null,
        confidence: typeof rawReprocessMeta.confidence === 'number' ? rawReprocessMeta.confidence : 0.8,
        is_my_doc: rawReprocessMeta.is_my_doc === true,
        my_doc_kind: rawReprocessMeta.my_doc_kind ?? null,
        vat_amount: typeof rawReprocessMeta.vat_amount === 'number' ? rawReprocessMeta.vat_amount : null,
        vat_rate: typeof rawReprocessMeta.vat_rate === 'number' ? rawReprocessMeta.vat_rate : null,
      };

      const newPayload = buildQueuePayload(
        { id: queueRow.file_id, name: queueRow.file_name },
        currentParent,
        reprocessMeta, suppliers, folderConfig, companyNif, source,
      );

      await supabase.from('processing_queue').update({
        ...newPayload,
        status: 'pending',
        inbox_folder_id: currentParent,
        error_message: null,
      }).eq('id', reprocessQueueId);

      await supabase.from('processing_logs').insert({
        queue_id: reprocessQueueId,
        file_id: queueRow.file_id,
        file_name: queueRow.file_name,
        action: 'reprocess',
        status: 'success',
        metadata: {
          previous_doc_type: prevDocType,
          previous_dest_path: prevDestPath,
          new_doc_type: newPayload.doc_type,
          new_dest_path: newPayload.dest_path,
          atcud: reprocessMeta.atcud,
        },
      });

      // Auto-move
      const moveUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/move`;
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
      await Promise.race([
        fetch(moveUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
          body: JSON.stringify({ queue_id: reprocessQueueId }),
        }).catch(() => {}),
        new Promise(resolve => setTimeout(resolve, 8_000)),
      ]);

      return new Response(
        JSON.stringify({ reprocessed: 1, doc_type: newPayload.doc_type, dest_path: newPayload.dest_path }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    // Inboxes a processar: corrente + arquivo (se configurado)
    type InboxEntry = { folderId: string; source: 'current' | 'archive' };
    const archiveFolderId = folderConfig.find(f => f.key === 'inbox_archive')?.folder_id ?? null;

    // Quando um file_id específico é pedido, determinar a que inbox pertence
    // para garantir que source='archive' se o ficheiro veio de inbox_archive.
    const resolveSourceForFile = async (fileId: string): Promise<InboxEntry> => {
      if (archiveFolderId) {
        const q = encodeURIComponent(`'${archiveFolderId}' in parents and trashed=false`);
        const res = await fetch(
          `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
          { headers: { Authorization: `Bearer ${driveToken}` } }
        );
        const { files: archiveFiles } = await res.json();
        if ((archiveFiles ?? []).some((f: { id: string }) => f.id === fileId)) {
          return { folderId: archiveFolderId, source: 'archive' };
        }
      }
      return { folderId: inboxFolderId, source: 'current' };
    };

    const inboxesToProcess: InboxEntry[] = specificFileId
      ? [await resolveSourceForFile(specificFileId)]
      : [
          { folderId: inboxFolderId, source: 'current' },
          ...(archiveFolderId ? [{ folderId: archiveFolderId, source: 'archive' as const }] : []),
        ];

    let queued = 0;

    for (const { folderId: currentInboxId, source } of inboxesToProcess) {
      const files = specificFileId
        ? [{ id: specificFileId, name: 'unknown.pdf' }]
        : await listInboxFiles(driveToken, currentInboxId);

      if (files.length === 0) continue;

      for (const file of files) {
        // Ignora se já está na fila (excepto se for status=error, que pode ser re-processado)
        const { data: existing } = await supabase
          .from('processing_queue')
          .select('id, status')
          .eq('file_id', file.id)
          .single();

        if (existing && existing.status !== 'error') continue;

        try {
          // ---- Tier 1/2: tentar ler QR AT antes de chamar Claude ----
          const pdfBytes = await (async () => {
            const res = await fetch(
              `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&supportsAllDrives=true`,
              { headers: { Authorization: `Bearer ${driveToken}` } }
            );
            return new Uint8Array(await res.arrayBuffer());
          })();

          // Converte para base64 (reutilizado depois se precisarmos do Claude)
          let pdfBase64 = '';
          const bytes = pdfBytes;
          const chunkSize = 8192;
          let binary = '';
          for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
          }
          pdfBase64 = btoa(binary);

          let classifyTier: 'qr_text' | 'qr_image' | 'claude' = 'claude';
          let qrSupplierName: string | null = null;
          let partialMeta: Partial<ClaudeMeta> | null = null;

          // Tier 1: texto do PDF
          const qrText1 = await extractQrTextFromPdf(pdfBytes);
          if (qrText1) {
            const parsed = parseAtQrString(qrText1);
            if (parsed && isQrMetaSufficient(parsed.partial)) {
              classifyTier = 'qr_text';
              partialMeta = parsed.partial;
              // Resolve issuerNif/direction via campos QR
              partialMeta.issuerNif = parsed.issuerNifFromQr || null;
              // Lookup supplier name por NIF
              if (parsed.issuerNifFromQr) {
                const found = suppliers.find(s => s.nif === parsed.issuerNifFromQr);
                qrSupplierName = found?.name ?? null;
              }
            }
          }

          // Tier 2: thumbnail Drive + jsQR (só se tier 1 falhou)
          if (!partialMeta) {
            const qrText2 = await extractQrTextFromThumbnail(file.id, driveToken);
            if (qrText2) {
              const parsed = parseAtQrString(qrText2);
              if (parsed && isQrMetaSufficient(parsed.partial)) {
                classifyTier = 'qr_image';
                partialMeta = parsed.partial;
                partialMeta.issuerNif = parsed.issuerNifFromQr || null;
                if (parsed.issuerNifFromQr) {
                  const found = suppliers.find(s => s.nif === parsed.issuerNifFromQr);
                  qrSupplierName = found?.name ?? null;
                }
              }
            }
          }

          let rawMeta: Record<string, unknown>;
          if (partialMeta) {
            // Metadados suficientes do QR — sem chamada Claude
            rawMeta = {
              ...partialMeta,
              supplier: qrSupplierName,
              is_my_doc: false,
              my_doc_kind: null,
              vat_amount: null,
              vat_rate: null,
            };
          } else {
            // Tier 3: Claude Vision (fallback)
            classifyTier = 'claude';
            rawMeta = await extractMetadata(anthropic, pdfBase64, supabase);
          }

          const meta: ClaudeMeta = {
            doc_date: rawMeta.doc_date as string ?? null,
            supplier: rawMeta.supplier as string ?? null,
            issuerNif: rawMeta.issuerNif as string ?? null,
            value: rawMeta.value as number ?? null,
            nif: rawMeta.nif as string ?? null,
            country: rawMeta.country as string ?? null,
            currency: rawMeta.currency as string ?? 'EUR',
            atcud: rawMeta.atcud as string ?? null,
            confidence: typeof rawMeta.confidence === 'number' ? rawMeta.confidence as number : 0.8,
            is_my_doc: rawMeta.is_my_doc === true,
            my_doc_kind: rawMeta.my_doc_kind as string ?? null,
            vat_amount: typeof rawMeta.vat_amount === 'number' ? rawMeta.vat_amount as number : null,
            vat_rate: typeof rawMeta.vat_rate === 'number' ? rawMeta.vat_rate as number : null,
          };

          // ---- Re-arquivo (Parte D): só para source=archive ----
          // Se o documento já foi importado via inbox corrente (status=done, source=current),
          // move o registo original para archive e descarta a cópia do inbox_archive.
          if (source === 'archive') {
            const existingDone = await findExistingDoneRow(supabase, {
              atcud: meta.atcud,
              supplier: meta.supplier,
              value: meta.value,
              doc_date: meta.doc_date,
            });

            if (existingDone) {
              if (existingDone.source === 'current') {
                // Recalcula destino na árvore archive
                const archivePayload = buildQueuePayload(
                  { id: existingDone.file_id, name: existingDone.file_name },
                  existingDone.inbox_folder_id,
                  meta, suppliers, folderConfig, companyNif, 'archive',
                );
                // Resolve pasta actual do ficheiro no Drive (já foi movido do inbox original)
                const currentParent = await getDriveFileParent(driveToken, existingDone.file_id);

                await supabase.from('processing_queue').update({
                  source: 'archive',
                  status: 'pending',
                  dest_path: archivePayload.dest_path,
                  dest_root_folder_id: archivePayload.dest_root_folder_id,
                  inbox_folder_id: currentParent,
                  error_message: null,
                }).eq('id', existingDone.id);

                await trashDriveFile(driveToken, file.id);

                await supabase.from('processing_logs').insert({
                  queue_id: existingDone.id,
                  file_id: existingDone.file_id,
                  file_name: existingDone.file_name,
                  action: 'rearchive',
                  status: 'success',
                  metadata: {
                    duplicate_file_id: file.id,
                    match_key: meta.atcud ? 'atcud' : 'fuzzy',
                    new_dest_path: archivePayload.dest_path,
                  },
                });
              } else {
                // Já arquivado — descarta cópia redundante
                await trashDriveFile(driveToken, file.id);
              }
              queued++;
              continue;
            }
          }

          // Detecção de duplicado: mesmo fornecedor + valor ±1€ + data no mesmo mês
          let isDuplicateSuspect = false;
          if (meta.supplier && meta.value && meta.doc_date) {
            const [dy, dm] = meta.doc_date.split('-').map(Number);
            const { data: similar } = await supabase
              .from('processing_queue')
              .select('id')
              .eq('supplier', meta.supplier)
              .gte('value', meta.value - 1)
              .lte('value', meta.value + 1)
              .gte('doc_date', `${dy}-${String(dm).padStart(2,'0')}-01`)
              .lte('doc_date', `${dy}-${String(dm).padStart(2,'0')}-31`)
              .neq('file_id', file.id)
              .limit(1);
            isDuplicateSuspect = (similar?.length ?? 0) > 0;
          }

          const payload = buildQueuePayload(file, currentInboxId, meta, suppliers, folderConfig, companyNif, source);

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
              .update({ ...payload, is_duplicate_suspect: isDuplicateSuspect, error_message: null })
              .eq('id', existing.id)
              .throwOnError();
          } else {
            await supabase.from('processing_queue')
              .insert({ ...payload, is_duplicate_suspect: isDuplicateSuspect })
              .throwOnError();
          }

          // Log de sucesso
          await supabase.from('processing_logs').insert({
            file_id: file.id,
            file_name: file.name,
            action: 'classify',
            status: 'success',
            metadata: { ...meta, doc_type: payload.doc_type, is_duplicate_suspect: isDuplicateSuspect, source, classify_tier: classifyTier },
          });

          // Extracção de transacções para extratos bancários
          if (payload.doc_type === 'bank_statement') {
            const insertedEntry = existing?.status === 'error'
              ? existing
              : (await supabase.from('processing_queue').select('id').eq('file_id', file.id).single()).data;
            if (insertedEntry?.id) {
              fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/extract-transactions`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
                },
                body: JSON.stringify({ queue_id: insertedEntry.id }),
              }).catch(() => { /* fire and forget */ });
            }
          }

          queued++;

        } catch (err) {
          // Log de erro + fila com status error
          await supabase.from('processing_queue').upsert({
            file_id: file.id,
            file_name: file.name,
            inbox_folder_id: currentInboxId,
            source,
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
    }

    if (queued === 0) {
      return new Response(
        JSON.stringify({ queued: 0, message: 'Inboxes vazias' }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
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
