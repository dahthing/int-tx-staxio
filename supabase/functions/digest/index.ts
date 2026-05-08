// supabase/functions/digest/index.ts
// Envia email de resumo semanal via Resend
// Cron: segunda-feira às 9h (migration 015_cron_digest.sql)

import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_KEY    = Deno.env.get('RESEND_API_KEY')!;
const TO_EMAIL      = Deno.env.get('DIGEST_TO_EMAIL') ?? 'rpgprogramacao@gmail.com';
const FROM_EMAIL    = Deno.env.get('DIGEST_FROM_EMAIL') ?? 'staxio@staxio.app';

// ============================================================
// QUERIES
// ============================================================
async function gatherStats(supabase: ReturnType<typeof createClient>) {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const weekAgoISO    = weekAgo.toISOString().slice(0, 10);
  const monthStartISO = monthStart.toISOString().slice(0, 10);
  const thirtyDaysISO = thirtyDaysAgo.toISOString().slice(0, 10);

  const [queueRes, bankRes] = await Promise.all([
    supabase.from('processing_queue').select('*'),
    supabase.from('bank_transactions').select('*').eq('is_reconciled', false).lt('amount', 0),
  ]);

  const entries: Record<string, unknown>[] = queueRes.data ?? [];

  const thisWeek     = entries.filter(e => (e.created_at as string) >= weekAgoISO);
  const processed    = thisWeek.filter(e => e.status === 'done');
  const errors       = entries.filter(e => e.status === 'error' || e.status === 'manual_review');
  const pending      = entries.filter(e => e.status === 'pending');
  const duplicates   = entries.filter(e => e.is_duplicate_suspect);

  const unpaidOld = entries.filter(e =>
    e.status === 'done' &&
    !e.is_paid &&
    !e.is_my_doc &&
    e.doc_date &&
    (e.doc_date as string) < thirtyDaysISO &&
    !['issued', 'invoice_issued', 'receipt_issued', 'quote_issued'].includes(e.doc_type as string)
  );

  const monthSupplierValue = entries
    .filter(e =>
      e.doc_date && (e.doc_date as string) >= monthStartISO &&
      !e.is_my_doc &&
      ['received', 'ecommerce', 'international', 'supplies'].includes(e.doc_type as string)
    )
    .reduce((s: number, e) => s + ((e.value as number) ?? 0), 0);

  const monthSalesValue = entries
    .filter(e =>
      e.doc_date && (e.doc_date as string) >= monthStartISO &&
      ['issued', 'invoice_issued'].includes(e.doc_type as string)
    )
    .reduce((s: number, e) => s + ((e.value as number) ?? 0), 0);

  // Top 3 fornecedores do mês
  const supplierMap = new Map<string, number>();
  for (const e of entries) {
    if (
      !e.is_my_doc &&
      e.doc_date && (e.doc_date as string) >= monthStartISO &&
      ['received', 'ecommerce', 'international', 'supplies'].includes(e.doc_type as string)
    ) {
      const key = (e.supplier as string) ?? '(desconhecido)';
      supplierMap.set(key, (supplierMap.get(key) ?? 0) + ((e.value as number) ?? 0));
    }
  }
  const topSuppliers = [...supplierMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  const unreconciledDebits: Record<string, unknown>[] = bankRes.data ?? [];
  const unreconciledTotal = unreconciledDebits.reduce((s, t) => s + Math.abs((t.amount as number)), 0);

  return {
    processedThisWeek: processed.length,
    pending: pending.length,
    errors: errors.length,
    duplicates: duplicates.length,
    unpaidOld,
    monthSupplierValue,
    monthSalesValue,
    topSuppliers,
    unreconciledDebits: unreconciledDebits.slice(0, 5),
    unreconciledTotal,
  };
}

// ============================================================
// EMAIL HTML
// ============================================================
function buildEmail(stats: Awaited<ReturnType<typeof gatherStats>>): string {
  const fmt = (v: number) => v.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const now = new Date();
  const month = now.toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' });

  const alertsHtml = [
    stats.errors > 0
      ? `<tr><td style="padding:8px 0;border-bottom:1px solid #f0f0f0;">🔴 <strong>${stats.errors}</strong> documento(s) com erro ou em revisão manual</td></tr>`
      : '',
    stats.duplicates > 0
      ? `<tr><td style="padding:8px 0;border-bottom:1px solid #f0f0f0;">🟡 <strong>${stats.duplicates}</strong> duplicado(s) suspeito(s) — verificar antes de arquivar</td></tr>`
      : '',
    stats.unpaidOld.length > 0
      ? `<tr><td style="padding:8px 0;border-bottom:1px solid #f0f0f0;">🟡 <strong>${stats.unpaidOld.length}</strong> fatura(s) por pagar há mais de 30 dias — total: <strong>${fmt(stats.unpaidOld.reduce((s, e) => s + ((e.value as number) ?? 0), 0))} €</strong></td></tr>`
      : '',
    stats.unreconciledDebits.length > 0
      ? `<tr><td style="padding:8px 0;border-bottom:1px solid #f0f0f0;">🟡 <strong>${stats.unreconciledDebits.length}</strong> débito(s) no extrato sem fatura correspondente — total: <strong>${fmt(stats.unreconciledTotal)} €</strong></td></tr>`
      : '',
  ].filter(Boolean).join('');

  const topSuppliersHtml = stats.topSuppliers.map(([name, value], i) =>
    `<tr>
      <td style="padding:6px 0;color:#666;">${i + 1}.</td>
      <td style="padding:6px 8px;">${name}</td>
      <td style="padding:6px 0;text-align:right;font-variant-numeric:tabular-nums;">${fmt(value)} €</td>
    </tr>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="pt">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#6366f1,#4338ca);padding:28px 32px;">
          <p style="margin:0;font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.03em;">Staxio</p>
          <p style="margin:4px 0 0;font-size:13px;color:rgba(255,255,255,0.75);">Resumo semanal · ${now.toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </td></tr>

        <!-- Stats row -->
        <tr><td style="padding:24px 32px 0;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td width="33%" style="text-align:center;padding:16px;background:#f8f8ff;border-radius:8px;">
                <p style="margin:0;font-size:28px;font-weight:800;color:#6366f1;">${stats.processedThisWeek}</p>
                <p style="margin:4px 0 0;font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.05em;">Processados<br>esta semana</p>
              </td>
              <td width="4%"></td>
              <td width="33%" style="text-align:center;padding:16px;background:#fff8f0;border-radius:8px;">
                <p style="margin:0;font-size:28px;font-weight:800;color:#f59e0b;">${stats.pending}</p>
                <p style="margin:4px 0 0;font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.05em;">Pendentes</p>
              </td>
              <td width="4%"></td>
              <td width="33%" style="text-align:center;padding:16px;background:#fff0f0;border-radius:8px;">
                <p style="margin:0;font-size:28px;font-weight:800;color:#ef4444;">${stats.errors}</p>
                <p style="margin:4px 0 0;font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.05em;">Erros /<br>Revisão</p>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Month financials -->
        <tr><td style="padding:24px 32px 0;">
          <p style="margin:0 0 12px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#999;">${month}</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:12px 16px;background:#f0fdf4;border-radius:8px 8px 0 0;border-bottom:1px solid #e0f2e9;">
                <span style="font-size:13px;color:#666;">Vendas emitidas</span>
                <span style="float:right;font-size:16px;font-weight:700;color:#16a34a;font-variant-numeric:tabular-nums;">${fmt(stats.monthSalesValue)} €</span>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 16px;background:#fef2f2;border-radius:0 0 8px 8px;">
                <span style="font-size:13px;color:#666;">Custos fornecedores</span>
                <span style="float:right;font-size:16px;font-weight:700;color:#dc2626;font-variant-numeric:tabular-nums;">${fmt(stats.monthSupplierValue)} €</span>
              </td>
            </tr>
          </table>
        </td></tr>

        ${stats.topSuppliers.length > 0 ? `
        <!-- Top suppliers -->
        <tr><td style="padding:20px 32px 0;">
          <p style="margin:0 0 8px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#999;">Top fornecedores este mês</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
            ${topSuppliersHtml}
          </table>
        </td></tr>` : ''}

        ${alertsHtml ? `
        <!-- Alerts -->
        <tr><td style="padding:20px 32px 0;">
          <p style="margin:0 0 8px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#999;">Requer atenção</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
            ${alertsHtml}
          </table>
        </td></tr>` : `
        <tr><td style="padding:20px 32px 0;">
          <p style="margin:0;font-size:13px;color:#16a34a;">✓ Sem alertas — tudo em ordem.</p>
        </td></tr>`}

        <!-- CTA -->
        <tr><td style="padding:24px 32px 32px;">
          <a href="https://staxio.app" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;">
            Abrir Staxio →
          </a>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:16px 32px;background:#fafafa;border-top:1px solid #f0f0f0;">
          <p style="margin:0;font-size:11px;color:#bbb;">Enviado automaticamente pelo Staxio · Para cancelar, remove o cron job no Supabase.</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ============================================================
// HANDLER
// ============================================================
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Ler configurações de digest do app_config (sobrepõe env vars)
    const { data: cfgRows } = await supabase
      .from('app_config')
      .select('key, value')
      .in('key', ['digest_enabled', 'digest_to_email']);
    const cfg = Object.fromEntries((cfgRows ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
    if (cfg['digest_enabled'] === 'false') {
      return new Response(JSON.stringify({ skipped: true, reason: 'digest_enabled=false' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
    const toEmail = cfg['digest_to_email'] || TO_EMAIL;

    const stats = await gatherStats(supabase);
    const html = buildEmail(stats);

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [toEmail],
        subject: `Staxio — ${stats.processedThisWeek} docs esta semana · ${stats.pending} pendentes`,
        html,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Resend error ${res.status}: ${err}`);
    }

    const data = await res.json();
    return new Response(JSON.stringify({ sent: true, id: data.id }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Erro interno' }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }
});
