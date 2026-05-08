// supabase/functions/cost-intelligence/index.ts
// Edge Function: POST /functions/v1/cost-intelligence
// AI-powered comprehensive cost analysis for cosmosdesignio lda / targx

import { createClient } from 'npm:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@0.36.3';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CACHE_KEY = 'cost_intelligence_cache';
const CACHE_TS_KEY = 'cost_intelligence_cached_at';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface Opportunity {
  title: string;
  description: string;
  category: 'cost_reduction' | 'revenue' | 'efficiency' | 'risk';
  potential_saving_eur: number;
  effort: 'low' | 'medium' | 'high';
  priority: number;
}

interface Risk {
  title: string;
  description: string;
  severity: 'critical' | 'warning' | 'info';
}

interface CostIntelligenceResult {
  executive_summary: string;
  opportunities: Opportunity[];
  risks: Risk[];
  cost_structure_comment: string;
  _cachedAt?: string;
}

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

  const cacheMap = Object.fromEntries(
    (cacheRows ?? []).map((r: { key: string; value: string }) => [r.key, r.value])
  );
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
      } catch { /* fall through */ }
    }
  }

  // ── Load data
  const currentYear = new Date().getFullYear();
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const since = sixMonthsAgo.toISOString().split('T')[0];

  const [forecastRes, docsRes, suppliersRes] = await Promise.all([
    supabase
      .from('budget_forecasts')
      .select('year, month, section, category, owner, forecast_value')
      .eq('year', currentYear),
    supabase
      .from('processing_queue')
      .select('supplier, value, doc_type, is_my_doc, doc_date')
      .eq('status', 'done')
      .gte('doc_date', since),
    supabase
      .from('suppliers')
      .select('name, type, active'),
  ]);

  const forecasts = forecastRes.data ?? [];
  const docs = docsRes.data ?? [];
  const suppliers = suppliersRes.data ?? [];

  // ── Summarise data for prompt
  const totalRevenue = docs
    .filter((d: { is_my_doc: boolean }) => d.is_my_doc)
    .reduce((s: number, d: { value: number }) => s + (d.value ?? 0), 0);

  const totalCosts = docs
    .filter((d: { is_my_doc: boolean }) => !d.is_my_doc)
    .reduce((s: number, d: { value: number }) => s + (d.value ?? 0), 0);

  const supplierTotals: Record<string, number> = {};
  docs.filter((d: { is_my_doc: boolean }) => !d.is_my_doc).forEach((d: { supplier: string; value: number }) => {
    const name = d.supplier ?? 'Desconhecido';
    supplierTotals[name] = (supplierTotals[name] ?? 0) + (d.value ?? 0);
  });

  const topSuppliers = Object.entries(supplierTotals)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 15)
    .map(([name, total]) => ({ name, total, pct: totalCosts > 0 ? ((total / totalCosts) * 100).toFixed(1) : '0' }));

  const budgetBySection: Record<string, number> = {};
  forecasts.forEach((f: { section: string; forecast_value: number }) => {
    budgetBySection[f.section] = (budgetBySection[f.section] ?? 0) + (f.forecast_value ?? 0);
  });

  const context = `
## Dados Financeiros — cosmosdesignio lda / targx (NIF 514084235) — ${currentYear}

### Resumo (últimos 6 meses)
- Receitas: €${totalRevenue.toFixed(0)}
- Custos: €${totalCosts.toFixed(0)}
- Resultado: €${(totalRevenue - totalCosts).toFixed(0)}
- Margem: ${totalRevenue > 0 ? ((totalRevenue - totalCosts) / totalRevenue * 100).toFixed(1) : 0}%

### Orçamento anual por secção
${Object.entries(budgetBySection).map(([k, v]) => `- ${k}: €${v.toFixed(0)}`).join('\n')}

### Top fornecedores (por volume)
${topSuppliers.map(s => `- ${s.name}: €${s.total.toFixed(0)} (${s.pct}% dos custos)`).join('\n')}

### Fornecedores registados: ${suppliers.length}
`;

  // ── Call Claude
  const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });

  const systemPrompt = `You are a CFO advisor for cosmosdesignio lda / targx (NIF 514084235), a Portuguese technology company.
Analyze the financial data and respond ONLY with valid JSON matching the exact structure requested.
Be specific, actionable, and use Portuguese business context (€, PT market benchmarks, Portuguese labor law).
Focus on practical opportunities and real risks based on the data provided.`;

  const userPrompt = `${context}

Analyze this data and respond with valid JSON only (no markdown, no explanation):
{
  "executive_summary": "2-3 sentence executive summary in Portuguese",
  "opportunities": [
    {
      "title": "short title",
      "description": "actionable description in Portuguese",
      "category": "cost_reduction|revenue|efficiency|risk",
      "potential_saving_eur": 0,
      "effort": "low|medium|high",
      "priority": 1-5
    }
  ],
  "risks": [
    {
      "title": "short title",
      "description": "description in Portuguese",
      "severity": "critical|warning|info"
    }
  ],
  "cost_structure_comment": "comment on cost structure in Portuguese"
}

Provide 3-6 opportunities and 2-4 risks. Sort opportunities by priority descending.`;

  let result: CostIntelligenceResult;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 2000,
      messages: [{ role: 'user', content: userPrompt }],
      system: systemPrompt,
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    result = JSON.parse(text) as CostIntelligenceResult;
  } catch (err) {
    return new Response(JSON.stringify({ error: 'AI analysis failed', detail: String(err) }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // ── Cache result
  const now = new Date().toISOString();
  await supabase.from('app_config').upsert([
    { key: CACHE_KEY, value: JSON.stringify(result) },
    { key: CACHE_TS_KEY, value: now },
  ]);

  result._cachedAt = new Date(now).toLocaleString('pt-PT');

  return new Response(JSON.stringify(result), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});
