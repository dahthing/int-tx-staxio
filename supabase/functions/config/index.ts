// supabase/functions/config/index.ts
// Edge Function: GET/PATCH /functions/v1/config
// Lê e escreve app_config com service_role (contorna RLS anon-only)

import { createClient } from 'npm:@supabase/supabase-js@2';
import { checkRateLimit, rateLimitExceeded } from '../_shared/rate-limit.ts';
import { z, validate, validationError } from '../_shared/validate.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ALLOWED_KEYS = [
  'drive_inbox_folder_id',
  'drive_root_folder_id',
  'drive_internacional_folder_id',
  'cron_enabled',
] as const;

// Schema PATCH: objecto com chaves permitidas, valores string
const ConfigPatchSchema = z
  .record(z.string(), z.string({ message: 'Valores devem ser strings' }))
  .refine(
    obj => Object.keys(obj).every(k => (ALLOWED_KEYS as readonly string[]).includes(k)),
    { message: `Só são permitidas as chaves: ${ALLOWED_KEYS.join(', ')}` }
  );

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  // Rate limiting: 60 req/min (GET frequente no settings init)
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown';
  if (!checkRateLimit(`config:${ip}`, 60, 60_000)) {
    return rateLimitExceeded(CORS);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // GET — devolve todos os valores permitidos
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('app_config')
      .select('key, value')
      .in('key', ALLOWED_KEYS);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const config = Object.fromEntries((data ?? []).map(r => [r.key, r.value]));
    return new Response(JSON.stringify(config), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // PATCH — actualiza chaves permitidas
  if (req.method === 'PATCH') {
    const rawBody = await req.json().catch(() => ({}));
    const validation = validate(ConfigPatchSchema, rawBody);
    if (!validation.ok) return validationError(validation.error, CORS);

    const entries = Object.entries(validation.data).filter(
      ([k]) => (ALLOWED_KEYS as readonly string[]).includes(k)
    );

    if (entries.length === 0) {
      return new Response(JSON.stringify({ error: 'Nenhuma chave válida no body' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const upserts = entries.map(([key, value]) => ({ key, value }));
    const { error } = await supabase.from('app_config').upsert(upserts);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ updated: entries.map(([k]) => k) }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  return new Response('Method Not Allowed', { status: 405 });
});
