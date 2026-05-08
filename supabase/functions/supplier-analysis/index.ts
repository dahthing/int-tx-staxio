// supabase/functions/supplier-analysis/index.ts
// Edge Function: POST /functions/v1/supplier-analysis
// Analyses supplier redundancies using Anthropic Claude

import { createClient } from 'npm:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@0.39.0';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CACHE_KEY = 'supplier_analysis_cache';
const CACHE_TS_KEY = 'supplier_analysis_cached_at';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // ── Check cache
  const { data: cacheRows } = await supabase
    .from('app_config')
    .select('key, value')
    .in('key', [CACHE_KEY, CACHE_TS_KEY]);

  const cacheMap = Object.fromEntries((cacheRows ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
  const cachedAt = cacheMap[CACHE_TS_KEY];
  const cachedData = cacheMap[CACHE_KEY];

  if (cachedAt && cachedData) {
    const age = Date.now() - new Date(cachedAt).getTime();
    if (age < CACHE_TTL_MS) {
      try {
        const parsed = JSON.parse(cachedData);
        parsed._cachedAt = new Date(cachedAt).toLocaleString('pt-PT');
        return new Response(JSON.stringify(parsed), {
          headers: { ...CORS, 'Content-Type': 'application/json' },
        });
      } catch {
        // fall through to re-fetch
      }
    }
  }

  // ── Load suppliers
  const { data: suppliers, error: suppErr } = await supabase
    .from('suppliers')
    .select('id, name, type, active')
    .eq('active', true);

  if (suppErr) {
    return new Response(JSON.stringify({ error: suppErr.message }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // ── Load spend per supplier (last 12 months)
  const since = new Date();
  since.setMonth(since.getMonth() - 12);

  const { data: spendRows, error: spendErr } = await supabase
    .from('processing_queue')
    .select('supplier, value')
    .eq('is_my_doc', false)
    .eq('status', 'done')
    .gte('doc_date', since.toISOString().split('T')[0]);

  if (spendErr) {
    return new Response(JSON.stringify({ error: spendErr.message }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // ── Build spend map
  const spendMap = new Map<string, number>();
  (spendRows ?? []).forEach((r: { supplier: string; value: number }) => {
    spendMap.set(r.supplier, (spendMap.get(r.supplier) ?? 0) + (r.value ?? 0));
  });

  // ── Build supplier list for prompt
  const supplierList = (suppliers ?? []).map((s: { name: string; type: string }) => ({
    name: s.name,
    type: s.type ?? 'unknown',
    annual_spend_eur: Math.round(spendMap.get(s.name) ?? 0),
  }));

  if (supplierList.length === 0) {
    return new Response(JSON.stringify({
      redundancies: [],
      high_cost: [],
      consolidations: [],
      summary: 'Sem fornecedores activos para analisar.',
    }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // ── Call Anthropic
  const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });

  const prompt = `You are a cost optimization advisor for a Portuguese SME.
Here is the list of active suppliers with their annual spend (EUR):

${JSON.stringify(supplierList, null, 2)}

Identify:
1. Redundant suppliers — same service category with multiple vendors (e.g. multiple hosting providers, multiple accounting services)
2. High-cost suppliers where alternatives are typically cheaper
3. Subscriptions that could be consolidated

Respond in JSON only, no markdown, no extra text:
{
  "redundancies": [{ "category": string, "suppliers": string[], "recommendation": string, "potential_saving_eur": number }],
  "high_cost": [{ "supplier": string, "current_spend_eur": number, "market_avg_eur": number, "recommendation": string }],
  "consolidations": [{ "description": string, "suppliers": string[], "estimated_saving_eur": number }],
  "summary": string
}`;

  let result: Record<string, unknown>;
  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = message.content[0];
    if (content.type !== 'text') throw new Error('Unexpected response type');

    result = JSON.parse(content.text);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: 'Anthropic API error: ' + msg }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // ── Store cache
  const now = new Date().toISOString();
  await supabase.from('app_config').upsert([
    { key: CACHE_KEY, value: JSON.stringify(result) },
    { key: CACHE_TS_KEY, value: now },
  ]);

  return new Response(JSON.stringify(result), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});
