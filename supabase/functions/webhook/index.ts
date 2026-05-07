// supabase/functions/webhook/index.ts
// Edge Function: POST /functions/v1/webhook
// Receptor de notificações push da Google Drive API.
// Quando um ficheiro novo/alterado aparece na inbox, acciona /classify.
//
// Registo do canal (uma vez, via /webhook/register):
//   POST /functions/v1/webhook  { "action": "register" }
//
// Receptor de notificações (chamado pela Drive):
//   POST /functions/v1/webhook  (sem body, só headers Drive)

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  parseNotification,
  verifyToken,
  isActionable,
  buildWatchChannelBody,
  DEFAULT_TTL_SECONDS,
} from './webhook.utils.ts';

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

  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body   = btoa(JSON.stringify(payload));
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
    'RSASSA-PKCS1-v1_5', cryptoKey,
    new TextEncoder().encode(unsigned)
  );

  const jwt = `${unsigned}.${btoa(String.fromCharCode(...new Uint8Array(signature)))}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const { access_token } = await res.json();
  return access_token;
}

// ============================================================
// REGISTO DO CANAL DRIVE
// ============================================================
async function registerChannel(): Promise<Response> {
  const inboxFolderId = Deno.env.get('DRIVE_INBOX_FOLDER_ID')!;
  const webhookUrl    = Deno.env.get('WEBHOOK_URL')!;
  const webhookToken  = Deno.env.get('WEBHOOK_SECRET_TOKEN')!;

  const driveToken = await getDriveToken();
  const channelId  = crypto.randomUUID();

  const channelBody = buildWatchChannelBody({
    channelId,
    webhookUrl,
    token: webhookToken,
    ttlSeconds: DEFAULT_TTL_SECONDS,
  });

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${inboxFolderId}/watch`,
    {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${driveToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(channelBody),
    }
  );

  const data = await res.json();

  if (!res.ok) {
    return new Response(
      JSON.stringify({ error: 'Falha ao registar canal', detail: data }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }

  // Persiste o resourceId para poder parar o canal mais tarde
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  await supabase.from('app_config').upsert([
    { key: 'drive_watch_channel_id',   value: channelId },
    { key: 'drive_watch_resource_id',  value: data.resourceId ?? '' },
    { key: 'drive_watch_expiration',   value: String(data.expiration ?? '') },
  ]);

  return new Response(
    JSON.stringify({ registered: true, channelId, expiration: data.expiration }),
    { headers: { ...CORS, 'Content-Type': 'application/json' } }
  );
}

// ============================================================
// HANDLER PRINCIPAL
// ============================================================
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  // Acção de registo (chamada manual ou por cron)
  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}));

    if (body.action === 'register') {
      return registerChannel();
    }
  }

  // Notificação Drive — apenas POST sem body significativo
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // Parseia headers
  const headers: Record<string, string | null> = {
    'x-goog-channel-id':     req.headers.get('x-goog-channel-id'),
    'x-goog-resource-state': req.headers.get('x-goog-resource-state'),
    'x-goog-message-number': req.headers.get('x-goog-message-number'),
    'x-goog-changed':        req.headers.get('x-goog-changed'),
    'x-goog-channel-token':  req.headers.get('x-goog-channel-token'),
  };

  const parseResult = parseNotification(headers);

  if (!parseResult.valid) {
    return new Response(
      JSON.stringify({ ignored: true, reason: parseResult.reason }),
      { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }

  const notification = parseResult.notification!;

  // Verifica token secreto
  const expectedToken = Deno.env.get('WEBHOOK_SECRET_TOKEN') ?? '';
  if (!verifyToken(notification, expectedToken)) {
    return new Response('Unauthorized', { status: 401 });
  }

  // 'sync' e estados irrelevantes → 200 imediato (Drive exige resposta rápida)
  if (!isActionable(notification)) {
    return new Response(
      JSON.stringify({ ignored: true, resourceState: notification.resourceState }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }

  // Acciona /classify de forma assíncrona — não bloqueia a resposta à Drive
  const classifyUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/classify`;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  EdgeRuntime.waitUntil(
    fetch(classifyUrl, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({}),
    }).catch(() => {
      // Falhas são registadas pelo próprio /classify — não bloquear o webhook
    })
  );

  return new Response(
    JSON.stringify({ triggered: true, resourceState: notification.resourceState }),
    { headers: { ...CORS, 'Content-Type': 'application/json' } }
  );
});

// Deno Deploy / Supabase Edge Runtime global
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };
