// supabase/functions/inbound-email/index.ts
// Recebe emails com PDFs em anexo e faz upload para a Drive inbox
// Suporta: Resend Inbound, SendGrid Inbound Parse
//
// Secrets necessários:
//   GOOGLE_SERVICE_ACCOUNT_JSON
// Lê inbound_provider, inbound_signing_secret, drive_inbox_folder_id de app_config

import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, svix-id, svix-timestamp, svix-signature',
};

// ============================================================
// GOOGLE DRIVE AUTH (igual ao classify)
// ============================================================
async function getDriveToken(): Promise<string> {
  const sa = JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')!);
  const now = Math.floor(Date.now() / 1000);

  const toBase64Url = (s: string) =>
    btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  const header = toBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body   = toBase64Url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }));

  const unsigned = `${header}.${body}`;
  const keyData  = Uint8Array.from(
    atob(sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\n/g, '')),
    c => c.charCodeAt(0)
  );
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', keyData, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(unsigned));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${unsigned}.${sigB64}`,
  });
  const { access_token } = await res.json();
  return access_token;
}

// ============================================================
// UPLOAD PARA DRIVE
// ============================================================
async function uploadToDrive(
  token: string,
  folderId: string,
  filename: string,
  content: Uint8Array,
  mimeType: string
): Promise<string> {
  const metadata = JSON.stringify({ name: filename, parents: [folderId] });
  const boundary = '-------staxio_boundary';

  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    metadata,
    `--${boundary}`,
    `Content-Type: ${mimeType}`,
    'Content-Transfer-Encoding: base64',
    '',
    btoa(String.fromCharCode(...content)),
    `--${boundary}--`,
  ].join('\r\n');

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );

  if (!res.ok) throw new Error(`Drive upload failed: ${await res.text()}`);
  const data = await res.json();
  return data.id;
}

// ============================================================
// PARSE — RESEND INBOUND
// Resend envia JSON com attachments como array de objetos base64
// Docs: https://resend.com/docs/api-reference/inbound
// ============================================================
interface ResendAttachment {
  filename: string;
  mimeType: string;
  content: string; // base64
}

interface ResendPayload {
  from: string;
  subject: string;
  attachments?: ResendAttachment[];
}

async function verifyResendSignature(req: Request, rawBody: string, secret: string): Promise<boolean> {
  if (!secret) return true; // sem secret configurado, aceita (dev mode)

  const timestamp = req.headers.get('svix-timestamp') ?? '';
  const signature = req.headers.get('svix-signature') ?? '';

  const toSign = `${timestamp}.${rawBody}`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const computed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(toSign));
  const computedB64 = btoa(String.fromCharCode(...new Uint8Array(computed)));

  return signature.split(' ').some(s => s.startsWith('v1,') && s.slice(3) === computedB64);
}

async function parseResend(req: Request, rawBody: string, secret: string): Promise<{ filename: string; bytes: Uint8Array }[]> {
  if (!(await verifyResendSignature(req, rawBody, secret))) {
    throw new Error('Assinatura Resend inválida');
  }

  const payload: ResendPayload = JSON.parse(rawBody);
  const attachments = payload.attachments ?? [];

  return attachments
    .filter(a => a.mimeType === 'application/pdf' || a.filename?.toLowerCase().endsWith('.pdf'))
    .map(a => ({
      filename: a.filename,
      bytes: Uint8Array.from(atob(a.content), c => c.charCodeAt(0)),
    }));
}

// ============================================================
// PARSE — SENDGRID INBOUND PARSE
// SendGrid envia multipart/form-data com campos "filename" e bytes
// Docs: https://docs.sendgrid.com/for-developers/parsing-email/setting-up-the-inbound-parse-webhook
// ============================================================
async function parseSendGrid(req: Request): Promise<{ filename: string; bytes: Uint8Array }[]> {
  const formData = await req.formData();
  const results: { filename: string; bytes: Uint8Array }[] = [];

  // SendGrid inclui attachments como "attachment1", "attachment2", ...
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('attachment') || !(value instanceof File)) continue;
    if (value.type !== 'application/pdf' && !value.name.toLowerCase().endsWith('.pdf')) continue;

    const buf = await value.arrayBuffer();
    results.push({ filename: value.name, bytes: new Uint8Array(buf) });
  }

  return results;
}

// ============================================================
// HANDLER PRINCIPAL
// ============================================================
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    const { data: cfgRows } = await supabase
      .from('app_config')
      .select('key, value')
      .in('key', ['inbound_provider', 'inbound_signing_secret', 'drive_inbox_folder_id']);
    const cfg = Object.fromEntries((cfgRows ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));

    const provider   = cfg['inbound_provider'] ?? Deno.env.get('INBOUND_PROVIDER') ?? 'resend';
    const sigSecret  = cfg['inbound_signing_secret'] ?? '';
    const folderId   = cfg['drive_inbox_folder_id'] ?? Deno.env.get('DRIVE_INBOX_FOLDER_ID')!;
    const driveToken = await getDriveToken();

    let attachments: { filename: string; bytes: Uint8Array }[];

    if (provider === 'sendgrid') {
      attachments = await parseSendGrid(req);
    } else {
      const rawBody = await req.text();
      attachments = await parseResend(req, rawBody, sigSecret);
    }

    if (attachments.length === 0) {
      return new Response(
        JSON.stringify({ uploaded: 0, message: 'Sem PDFs em anexo' }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    const uploaded: string[] = [];

    for (const { filename, bytes } of attachments) {
      // Garante nome único com timestamp se já existir
      const safeName = filename.replace(/[^\w.\-]/g, '_');
      const timestamped = `${Date.now()}_${safeName}`;

      const fileId = await uploadToDrive(driveToken, folderId, timestamped, bytes, 'application/pdf');
      uploaded.push(fileId);
    }

    return new Response(
      JSON.stringify({ uploaded: uploaded.length, fileIds: uploaded }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Erro interno' }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }
});
