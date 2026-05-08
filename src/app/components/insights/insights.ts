import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
  computed,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { SUPABASE_CLIENT } from '../../core/supabase.client';
import { environment } from '../../../environments/environment';

// ─── Types ────────────────────────────────────────────────────────────────────

type CITab = 'painel' | 'desvios' | 'fornecedores' | 'optimizer' | 'alertas';

interface ForecastRow {
  year: number;
  month: number;
  section: string;
  category: string;
  owner: string;
  forecast_value: number;
  status: string;
}

interface DocRow {
  supplier: string;
  value: number;
  doc_type: string;
  is_my_doc: boolean;
  doc_date: string;
  status: string;
}

interface SupplierRow {
  id: string;
  name: string;
  type: string;
  active: boolean;
}

interface SupplierSpend {
  name: string;
  totalSpend: number;
  monthly: number[];
  active: boolean;
  share?: number;
}

interface BenchmarkItem {
  category: string;
  min: number;
  max: number;
  unit: string;
  note: string;
}

interface BenchmarkMapping {
  [supplierName: string]: string;
}

interface TrendingSupplier {
  name: string;
  avgPrev: number;
  avgRecent: number;
  changePct: number;
}

interface RoiClient {
  client: string;
  owner: string;
  forecastRevenue: number;
  actualRevenue: number;
  allocatedCost: number;
  grossMargin: number;
  marginPct: number;
}

interface VarianceRow {
  category: string;
  section: string;
  budget: number;
  actual: number;
  deviationEur: number;
  deviationPct: number;
  rag: 'green' | 'amber' | 'red';
}

interface WaterfallItem {
  label: string;
  value: number;
  pct: number;
  color: string;
}

interface FixedVariableSplit {
  fixed: number;
  variable: number;
  fixedPct: number;
  variablePct: number;
  details: Array<{ category: string; type: 'fixed' | 'variable'; monthlyAvg: number }>;
}

interface BreakEven {
  contributionMarginRatio: number;
  breakEvenRevenue: number;
  safetyMargin: number;
  safetyMarginPct: number;
  monthlyBurnRate: number;
  coverageRatio: number;
}

interface Alert {
  severity: 'critical' | 'warning' | 'info';
  icon: string;
  title: string;
  description: string;
  value?: string;
}

interface AnalysisResult {
  redundancies: Array<{ category: string; suppliers: string[]; recommendation: string; potential_saving_eur: number }>;
  high_cost: Array<{ supplier: string; current_spend_eur: number; market_avg_eur: number; recommendation: string }>;
  consolidations: Array<{ description: string; suppliers: string[]; estimated_saving_eur: number }>;
  summary: string;
  _cachedAt?: string;
}

interface SavedScenario {
  name: string;
  disabledSuppliers: string[];
}

// ─── Benchmark data ───────────────────────────────────────────────────────────

const BENCHMARKS: BenchmarkItem[] = [
  { category: 'Contabilidade', min: 150, max: 350, unit: '€/mês', note: 'PME até 10 trabalhadores' },
  { category: 'Hosting / Servidores', min: 50, max: 300, unit: '€/mês', note: 'Inclui cloud + domínios' },
  { category: 'Software / SaaS', min: 100, max: 500, unit: '€/mês', note: 'Ferramentas de gestão' },
  { category: 'Telecomunicações', min: 30, max: 120, unit: '€/mês', note: 'Internet + telemóvel' },
  { category: 'Transporte / Viaturas', min: 300, max: 900, unit: '€/mês', note: 'Leasing + combustível' },
  { category: 'Marketing / Publicidade', min: 200, max: 800, unit: '€/mês', note: '2-5% da faturação' },
  { category: 'Recursos Humanos', min: 800, max: 2500, unit: '€/mês por pessoa', note: 'Subcontratados' },
];

const MONTH_LABELS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

const SECTIONS = ['Receitas', 'Custos', 'Pessoas', 'Impostos', 'Extras'];
const SECTION_COLORS: Record<string, string> = {
  Receitas: '#16a34a',
  Custos: '#2563eb',
  Pessoas: '#7c3aed',
  Impostos: '#d97706',
  Extras: '#64748b',
};

// ─── Component ────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-insights',
  imports: [MatIconModule, MatSnackBarModule],
  templateUrl: './insights.html',
  styleUrl: './insights.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Insights implements OnInit {
  readonly #http = inject(HttpClient);
  readonly #snackBar = inject(MatSnackBar);
  readonly #supabase = inject(SUPABASE_CLIENT);

  // ── Raw data
  readonly #forecasts = signal<ForecastRow[]>([]);
  readonly #docs = signal<DocRow[]>([]);
  readonly #suppliersDb = signal<SupplierRow[]>([]);

  // ── UI state
  readonly loading = signal(true);
  readonly selectedTab = signal<CITab>('painel');
  readonly selectedYear = signal(new Date().getFullYear());
  readonly deviationSection = signal<string>('Todos');

  // ── What-if / optimizer
  readonly supplierSpends = signal<SupplierSpend[]>([]);
  readonly scenarios = signal<SavedScenario[]>([]);
  readonly scenarioName = signal('');

  // ── AI Analysis
  readonly analysisLoading = signal(false);
  readonly analysisResult = signal<AnalysisResult | null>(null);
  readonly analysisError = signal<string | null>(null);

  // ── Benchmark
  readonly benchmarkMappings = signal<BenchmarkMapping>({});

  // ─────────────────────────────────────────────────────────────────────────────
  // Computed: year helpers
  // ─────────────────────────────────────────────────────────────────────────────

  readonly availableYears = computed(() => {
    const years = [...new Set(this.#forecasts().map(f => f.year))].sort();
    return years.length ? years : [new Date().getFullYear()];
  });

  // Forecasts for selected year
  readonly #yearForecasts = computed(() =>
    this.#forecasts().filter(f => f.year === this.selectedYear())
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Computed: budget aggregations
  // ─────────────────────────────────────────────────────────────────────────────

  readonly budgetBySection = computed((): Record<string, number> => {
    const map: Record<string, number> = {};
    this.#yearForecasts().forEach(f => {
      const sec = this.#normalizeSection(f.section);
      map[sec] = (map[sec] ?? 0) + (f.forecast_value ?? 0);
    });
    return map;
  });

  readonly budgetByCategory = computed((): Record<string, { section: string; total: number; owner: string }> => {
    const map: Record<string, { section: string; total: number; owner: string }> = {};
    this.#yearForecasts().forEach(f => {
      const key = `${f.section}::${f.category}`;
      if (!map[key]) map[key] = { section: this.#normalizeSection(f.section), total: 0, owner: f.owner ?? '' };
      map[key].total += f.forecast_value ?? 0;
    });
    return map;
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Computed: actual docs
  // ─────────────────────────────────────────────────────────────────────────────

  readonly #yearDocs = computed(() => {
    const year = this.selectedYear();
    return this.#docs().filter(d => new Date(d.doc_date).getFullYear() === year);
  });

  readonly actualRevenue = computed(() =>
    this.#yearDocs().filter(d => d.is_my_doc).reduce((s, d) => s + (d.value ?? 0), 0)
  );

  readonly totalActualCosts = computed(() =>
    this.#yearDocs().filter(d => !d.is_my_doc).reduce((s, d) => s + (d.value ?? 0), 0)
  );

  readonly actualBySupplier = computed((): Record<string, { total: number; count: number; monthly: number[]; lastDate: string }> => {
    const map: Record<string, { total: number; count: number; monthly: number[]; lastDate: string }> = {};
    this.#yearDocs().filter(d => !d.is_my_doc).forEach(d => {
      const name = d.supplier ?? 'Desconhecido';
      if (!map[name]) map[name] = { total: 0, count: 0, monthly: new Array(12).fill(0), lastDate: '' };
      map[name].total += d.value ?? 0;
      map[name].count++;
      map[name].monthly[new Date(d.doc_date).getMonth()] += d.value ?? 0;
      if (!map[name].lastDate || d.doc_date > map[name].lastDate) map[name].lastDate = d.doc_date;
    });
    return map;
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Computed: HHI concentration
  // ─────────────────────────────────────────────────────────────────────────────

  readonly supplierConcentration = computed(() => {
    const bySupplier = this.actualBySupplier();
    const total = this.totalActualCosts();
    if (total === 0) return { hhi: 0, level: 'low' as const, top: [] as SupplierSpend[] };

    const top: SupplierSpend[] = Object.entries(bySupplier)
      .map(([name, data]) => ({
        name,
        totalSpend: data.total,
        monthly: data.monthly,
        active: true,
        share: (data.total / total) * 100,
      }))
      .sort((a, b) => b.totalSpend - a.totalSpend);

    const hhi = top.reduce((sum, s) => sum + Math.pow((s.share ?? 0) / 100, 2), 0) * 10000;
    const level = hhi < 1000 ? 'low' : hhi < 2500 ? 'moderate' : 'high';
    return { hhi: Math.round(hhi), level, top };
  });

  readonly paretoSuppliers = computed(() => {
    const { top } = this.supplierConcentration();
    const total = this.totalActualCosts();
    if (total === 0) return [];
    let cumulative = 0;
    const result: SupplierSpend[] = [];
    for (const s of top) {
      result.push(s);
      cumulative += s.totalSpend;
      if (cumulative / total >= 0.8) break;
    }
    return result;
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Computed: variance (budget vs actual)
  // ─────────────────────────────────────────────────────────────────────────────

  readonly varianceRows = computed((): VarianceRow[] => {
    const byCategory = this.budgetByCategory();
    const bySupplier = this.actualBySupplier();
    const rows: VarianceRow[] = [];

    for (const [key, { section, total: budget, owner }] of Object.entries(byCategory)) {
      const category = key.split('::')[1];
      const catLower = category.toLowerCase();

      // Fuzzy match suppliers to this budget category
      const actual = Object.entries(bySupplier)
        .filter(([name]) => {
          const nameLower = name.toLowerCase();
          return nameLower.includes(catLower) || catLower.includes(nameLower);
        })
        .reduce((s, [, data]) => s + data.total, 0);

      if (budget === 0 && actual === 0) continue;

      const deviationEur = actual - budget;
      const deviationPct = budget > 0 ? (deviationEur / budget) * 100 : 0;

      let rag: 'green' | 'amber' | 'red' = 'green';
      if (section.toLowerCase() === 'receitas') {
        // For revenue: under budget = red
        if (deviationEur < 0 && deviationPct < -10) rag = 'red';
        else if (deviationEur < 0) rag = 'amber';
      } else {
        // For costs: over budget = red
        if (deviationPct > 10) rag = 'red';
        else if (deviationPct > 0) rag = 'amber';
      }

      rows.push({ category, section, budget, actual, deviationEur, deviationPct, rag });
    }

    return rows.sort((a, b) => {
      const order = { red: 0, amber: 1, green: 2 };
      return order[a.rag] - order[b.rag];
    });
  });

  readonly filteredVarianceRows = computed(() => {
    const sec = this.deviationSection();
    if (sec === 'Todos') return this.varianceRows();
    return this.varianceRows().filter(r => r.section.toLowerCase() === sec.toLowerCase());
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Computed: waterfall
  // ─────────────────────────────────────────────────────────────────────────────

  readonly waterfallData = computed((): WaterfallItem[] => {
    const bs = this.budgetBySection();
    const rev = this.actualRevenue();
    const items: WaterfallItem[] = [];

    const sectionKeys = ['Receitas', 'Custos', 'Pessoas', 'Impostos', 'Extras'];
    for (const sec of sectionKeys) {
      const budget = bs[sec] ?? 0;
      if (budget === 0) continue;
      items.push({
        label: sec,
        value: sec === 'Receitas' ? budget : -budget,
        pct: rev > 0 ? (budget / rev) * 100 : 0,
        color: SECTION_COLORS[sec] ?? '#64748b',
      });
    }

    const resultado = this.actualRevenue() - this.totalActualCosts();
    items.push({ label: 'Resultado', value: resultado, pct: rev > 0 ? (resultado / rev) * 100 : 0, color: resultado >= 0 ? '#16a34a' : '#dc2626' });
    return items;
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Computed: Fixed vs Variable (McKinsey ZBB)
  // ─────────────────────────────────────────────────────────────────────────────

  readonly fixedVariableSplit = computed((): FixedVariableSplit => {
    const bySupplier = this.actualBySupplier();
    const details: FixedVariableSplit['details'] = [];
    let fixed = 0;
    let variable = 0;

    for (const [category, data] of Object.entries(bySupplier)) {
      const activeMonths = data.monthly.filter(v => v > 0).length;
      const monthlyAvg = data.total / 12;
      const type: 'fixed' | 'variable' = activeMonths >= 9 ? 'fixed' : 'variable';
      details.push({ category, type, monthlyAvg });
      if (type === 'fixed') fixed += data.total;
      else variable += data.total;
    }

    const total = fixed + variable;
    return {
      fixed,
      variable,
      fixedPct: total > 0 ? (fixed / total) * 100 : 0,
      variablePct: total > 0 ? (variable / total) * 100 : 0,
      details: details.sort((a, b) => b.monthlyAvg - a.monthlyAvg),
    };
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Computed: Break-even
  // ─────────────────────────────────────────────────────────────────────────────

  readonly breakEven = computed((): BreakEven => {
    const rev = this.actualRevenue();
    const { fixed, variable } = this.fixedVariableSplit();
    const contributionMarginRatio = rev > 0 ? (rev - variable) / rev : 0;
    const breakEvenRevenue = contributionMarginRatio > 0 ? fixed / contributionMarginRatio : 0;
    const safetyMargin = rev - breakEvenRevenue;
    const safetyMarginPct = rev > 0 ? (safetyMargin / rev) * 100 : 0;
    const monthlyBurnRate = (fixed + variable) / 12;
    const coverageRatio = monthlyBurnRate > 0 ? (rev / 12) / monthlyBurnRate : 0;

    return { contributionMarginRatio, breakEvenRevenue, safetyMargin, safetyMarginPct, monthlyBurnRate, coverageRatio };
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Computed: ROI per client
  // ─────────────────────────────────────────────────────────────────────────────

  readonly roiClients = computed((): RoiClient[] => {
    const byCategory = this.budgetByCategory();
    const totalCosts = this.totalActualCosts();
    const totalActualRev = this.actualRevenue();
    const revenueDocs = this.#yearDocs().filter(d => d.is_my_doc);

    const actualMap = new Map<string, number>();
    revenueDocs.forEach(d => {
      const name = d.supplier ?? '';
      actualMap.set(name, (actualMap.get(name) ?? 0) + (d.value ?? 0));
    });

    const clients: RoiClient[] = [];
    for (const [key, { section, total: forecastRevenue, owner }] of Object.entries(byCategory)) {
      if (section.toLowerCase() !== 'receitas') continue;
      const client = key.split('::')[1];
      const clientLower = client.toLowerCase();

      const actualRevenue = Array.from(actualMap.entries())
        .filter(([name]) => {
          const nl = name.toLowerCase();
          return nl.includes(clientLower) || clientLower.includes(nl);
        })
        .reduce((s, [, v]) => s + v, 0);

      const allocatedCost = totalActualRev > 0 ? totalCosts * (actualRevenue / totalActualRev) : 0;
      const grossMargin = actualRevenue - allocatedCost;
      const marginPct = actualRevenue > 0 ? (grossMargin / actualRevenue) * 100 : 0;

      clients.push({ client, owner, forecastRevenue, actualRevenue, allocatedCost, grossMargin, marginPct });
    }

    return clients.sort((a, b) => b.marginPct - a.marginPct);
  });

  readonly roiSummary = computed(() => {
    const clients = this.roiClients();
    if (clients.length === 0) return null;
    return {
      best: clients[0],
      worst: clients[clients.length - 1],
    };
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Computed: Trending
  // ─────────────────────────────────────────────────────────────────────────────

  readonly trendingSuppliers = computed((): TrendingSupplier[] => {
    const now = new Date();
    const nowMonth = now.getMonth();
    const nowYear = now.getFullYear();

    const costDocs = this.#docs().filter(d => !d.is_my_doc && d.status === 'done');
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    const map = new Map<string, { prev: number[]; recent: number[] }>();
    costDocs.forEach(row => {
      const d = new Date(row.doc_date);
      if (d < sixMonthsAgo) return;
      const diffMonths = (nowYear - d.getFullYear()) * 12 + (nowMonth - d.getMonth());
      if (diffMonths < 0 || diffMonths > 5) return;
      const name = row.supplier ?? 'Desconhecido';
      if (!map.has(name)) map.set(name, { prev: [], recent: [] });
      const entry = map.get(name)!;
      if (diffMonths <= 2) entry.recent.push(row.value ?? 0);
      else entry.prev.push(row.value ?? 0);
    });

    const avg = (arr: number[]) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;

    return Array.from(map.entries())
      .map(([name, { prev, recent }]) => {
        const avgPrev = avg(prev);
        const avgRecent = avg(recent);
        const changePct = avgPrev > 0 ? ((avgRecent - avgPrev) / avgPrev) * 100 : 0;
        return { name, avgPrev, avgRecent, changePct };
      })
      .filter(t => t.avgPrev > 0 && t.avgRecent > 0)
      .sort((a, b) => b.changePct - a.changePct);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Computed: Benchmark
  // ─────────────────────────────────────────────────────────────────────────────

  readonly benchmarkRows = computed(() => {
    const mappings = this.benchmarkMappings();
    const spends = this.supplierSpends();

    return BENCHMARKS.map(b => {
      const matchedSuppliers = Object.entries(mappings)
        .filter(([, cat]) => cat === b.category)
        .map(([name]) => name);
      const monthlyActual = matchedSuppliers.reduce((sum, name) => {
        const s = spends.find(x => x.name === name);
        return sum + (s ? s.totalSpend / 12 : 0);
      }, 0);
      let status: 'ok' | 'warning' | 'danger' = 'ok';
      if (monthlyActual > b.max * 1.5) status = 'danger';
      else if (monthlyActual > b.max * 1.2) status = 'warning';
      const pct = b.max > 0 ? Math.min((monthlyActual / b.max) * 100, 200) : 0;
      return { ...b, monthlyActual, status, pct };
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Computed: What-if
  // ─────────────────────────────────────────────────────────────────────────────

  readonly enabledSuppliers = computed(() => this.supplierSpends().filter(s => s.active));

  readonly disabledSavings = computed(() =>
    this.supplierSpends().filter(s => !s.active).reduce((sum, s) => sum + s.totalSpend, 0)
  );

  readonly whatIfEnabled = computed(() =>
    this.supplierSpends().some(s => !s.active)
  );

  readonly whatIfSavings = computed(() => this.disabledSavings());

  readonly chartMonths = computed(() => {
    return MONTH_LABELS.map((label, i) => {
      const currentCost = this.supplierSpends().reduce((sum, s) => sum + (s.monthly[i] ?? 0), 0);
      const simCost = this.enabledSuppliers().reduce((sum, s) => sum + (s.monthly[i] ?? 0), 0);
      const rev = this.actualRevenue() / 12;
      return { label, current: rev - currentCost, simulated: rev - simCost };
    });
  });

  readonly chartMax = computed(() => {
    const vals = this.chartMonths().flatMap(m => [Math.abs(m.current), Math.abs(m.simulated)]);
    return Math.max(...vals, 1);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Computed: Alerts
  // ─────────────────────────────────────────────────────────────────────────────

  readonly alerts = computed((): Alert[] => {
    const list: Alert[] = [];
    const rev = this.actualRevenue();
    const bs = this.budgetBySection();
    const { hhi, level } = this.supplierConcentration();
    const { safetyMarginPct, breakEvenRevenue } = this.breakEven();
    const { fixedPct } = this.fixedVariableSplit();
    const totalCosts = this.totalActualCosts();
    const marginPct = rev > 0 ? ((rev - totalCosts) / rev) * 100 : 0;

    // 1. Revenue below forecast YTD
    const budgetRevenue = bs['Receitas'] ?? 0;
    const monthsElapsed = new Date().getMonth() + 1;
    const expectedYTD = budgetRevenue * (monthsElapsed / 12);
    if (rev < expectedYTD * 0.8 && expectedYTD > 0) {
      list.push({
        severity: 'critical',
        icon: 'trending_down',
        title: 'Receitas abaixo da previsão',
        description: `Receitas reais (${this.formatCurrency(rev)}) estão 20%+ abaixo do esperado YTD (${this.formatCurrency(expectedYTD)}).`,
        value: this.formatCurrency(rev - expectedYTD),
      });
    }

    // 2. Margin < 5%
    if (rev > 0 && marginPct < 5) {
      list.push({
        severity: 'critical',
        icon: 'warning',
        title: 'Margem crítica',
        description: `Margem operacional de ${marginPct.toFixed(1)}% está abaixo do mínimo aceitável (5%).`,
        value: `${marginPct.toFixed(1)}%`,
      });
    }

    // 3. HHI high concentration
    if (level === 'high') {
      list.push({
        severity: 'warning',
        icon: 'hub',
        title: 'Concentração de fornecedores elevada',
        description: `HHI de ${hhi} indica concentração elevada. Risco de dependência crítica.`,
        value: `HHI ${hhi}`,
      });
    } else if (level === 'moderate') {
      list.push({
        severity: 'info',
        icon: 'hub',
        title: 'Concentração de fornecedores moderada',
        description: `HHI de ${hhi} indica concentração moderada. Considere diversificar.`,
        value: `HHI ${hhi}`,
      });
    }

    // 4. Single supplier > 30%
    const { top } = this.supplierConcentration();
    const dominant = top.find(s => (s.share ?? 0) > 30);
    if (dominant) {
      list.push({
        severity: 'warning',
        icon: 'business',
        title: `Dependência de ${dominant.name}`,
        description: `${dominant.name} representa ${(dominant.share ?? 0).toFixed(1)}% dos custos totais.`,
        value: `${(dominant.share ?? 0).toFixed(1)}%`,
      });
    }

    // 5. Safety margin < 10%
    if (rev > 0 && safetyMarginPct < 10 && breakEvenRevenue > 0) {
      list.push({
        severity: 'warning',
        icon: 'shield',
        title: 'Margem de segurança baixa',
        description: `Margem de segurança de ${safetyMarginPct.toFixed(1)}%. Empresa está perto do ponto de break-even.`,
        value: `${safetyMarginPct.toFixed(1)}%`,
      });
    }

    // 6. Top 3 budget overruns
    const overruns = this.varianceRows().filter(r => r.rag === 'red' && r.section.toLowerCase() !== 'receitas').slice(0, 3);
    for (const row of overruns) {
      list.push({
        severity: 'warning',
        icon: 'receipt_long',
        title: `Desvio orçamental: ${row.category}`,
        description: `${row.section} — ${row.category} ultrapassa o orçamento em ${row.deviationPct.toFixed(1)}%.`,
        value: `+${this.formatCurrency(row.deviationEur)}`,
      });
    }

    // 7. Fixed cost ratio > 80%
    if (fixedPct > 80) {
      list.push({
        severity: 'info',
        icon: 'lock',
        title: 'Estrutura de custos rígida',
        description: `${fixedPct.toFixed(1)}% dos custos são fixos. Reduz flexibilidade em período de queda de receitas.`,
        value: `${fixedPct.toFixed(1)}% fixos`,
      });
    }

    return list.sort((a, b) => {
      const order = { critical: 0, warning: 1, info: 2 };
      return order[a.severity] - order[b.severity];
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Exposed constants
  // ─────────────────────────────────────────────────────────────────────────────

  readonly monthLabels = MONTH_LABELS;
  readonly benchmarkCategories = BENCHMARKS.map(b => b.category);
  readonly sectionFilters = ['Todos', ...SECTIONS];

  // ─────────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────────

  async ngOnInit(): Promise<void> {
    this.#loadScenarios();
    await Promise.all([
      this.#loadForecasts(),
      this.#loadDocs(),
      this.#loadBenchmarkMappings(),
    ]);
    this.#syncSupplierSpends();
    this.loading.set(false);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Public actions
  // ─────────────────────────────────────────────────────────────────────────────

  selectTab(tab: CITab): void {
    this.selectedTab.set(tab);
  }

  selectYear(year: number): void {
    this.selectedYear.set(year);
  }

  setDeviationSection(sec: string): void {
    this.deviationSection.set(sec);
  }

  toggleSupplier(name: string): void {
    this.supplierSpends.update(list =>
      list.map(s => s.name === name ? { ...s, active: !s.active } : s)
    );
  }

  saveScenario(): void {
    const name = this.scenarioName().trim();
    if (!name) {
      this.#snackBar.open('Dá um nome ao cenário', 'OK', { duration: 2000 });
      return;
    }
    const disabled = this.supplierSpends().filter(s => !s.active).map(s => s.name);
    const scenario: SavedScenario = { name, disabledSuppliers: disabled };
    const updated = [...this.scenarios().filter(s => s.name !== name), scenario];
    this.scenarios.set(updated);
    localStorage.setItem('staxio_whatif_scenarios', JSON.stringify(updated));
    this.scenarioName.set('');
    this.#snackBar.open('Cenário guardado', 'OK', { duration: 2000 });
  }

  loadScenario(scenario: SavedScenario): void {
    this.supplierSpends.update(list =>
      list.map(s => ({ ...s, active: !scenario.disabledSuppliers.includes(s.name) }))
    );
  }

  onScenarioNameInput(event: Event): void {
    this.scenarioName.set((event.target as HTMLInputElement).value);
  }

  onBenchmarkMappingChange(supplierName: string, category: string): void {
    this.benchmarkMappings.update(m => ({ ...m, [supplierName]: category }));
    this.#saveBenchmarkMappings();
  }

  openRenegociate(supplierName: string): void {
    const subject = encodeURIComponent(`Revisão de condições contratuais — ${supplierName}`);
    window.open(`mailto:?subject=${subject}`, '_blank');
  }

  async runAnalysis(): Promise<void> {
    this.analysisLoading.set(true);
    this.analysisError.set(null);
    try {
      const { data: session } = await this.#supabase.auth.getSession();
      const token = session.session?.access_token;
      const result = await this.#http.post<AnalysisResult>(
        `${environment.edgeFunctionsUrl}/supplier-analysis`,
        {},
        token ? { headers: { Authorization: `Bearer ${token}` } } : {}
      ).toPromise();
      this.analysisResult.set(result ?? null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido';
      this.analysisError.set(msg);
      this.#snackBar.open('Erro na análise: ' + msg, 'OK', { duration: 4000 });
    } finally {
      this.analysisLoading.set(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  formatCurrency(val: number): string {
    return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(val);
  }

  formatPct(val: number): string {
    return (val >= 0 ? '+' : '') + val.toFixed(1) + '%';
  }

  barHeightPct(val: number, max: number): number {
    return max > 0 ? Math.min(Math.abs(val) / max * 100, 100) : 0;
  }

  barWidthPct(val: number, max: number): number {
    return max > 0 ? Math.min(Math.abs(val) / max * 100, 100) : 0;
  }

  alertSeverityColor(severity: Alert['severity']): string {
    return severity === 'critical' ? '#dc2626' : severity === 'warning' ? '#d97706' : '#2563eb';
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private data loading
  // ─────────────────────────────────────────────────────────────────────────────

  async #loadForecasts(): Promise<void> {
    const { data } = await this.#supabase
      .from('budget_forecasts')
      .select('year, month, section, category, owner, forecast_value, status');
    this.#forecasts.set((data ?? []) as ForecastRow[]);
  }

  async #loadDocs(): Promise<void> {
    const now = new Date();
    const since = new Date(now.getFullYear(), now.getMonth() - 11, 1).toISOString().split('T')[0];
    const { data } = await this.#supabase
      .from('processing_queue')
      .select('supplier, value, doc_type, is_my_doc, doc_date, status')
      .eq('status', 'done')
      .gte('doc_date', since);
    this.#docs.set((data ?? []) as DocRow[]);
  }

  async #loadBenchmarkMappings(): Promise<void> {
    const { data } = await this.#supabase
      .from('app_config')
      .select('value')
      .eq('key', 'benchmark_mappings')
      .maybeSingle();
    if (data?.value) {
      try { this.benchmarkMappings.set(JSON.parse(data.value)); } catch { /* ignore */ }
    }
  }

  async #saveBenchmarkMappings(): Promise<void> {
    await this.#supabase.from('app_config').upsert({
      key: 'benchmark_mappings',
      value: JSON.stringify(this.benchmarkMappings()),
    });
  }

  #syncSupplierSpends(): void {
    const { top } = this.supplierConcentration();
    this.supplierSpends.set(top.map(s => ({ ...s, active: true })));
  }

  #loadScenarios(): void {
    try {
      const raw = localStorage.getItem('staxio_whatif_scenarios');
      if (raw) this.scenarios.set(JSON.parse(raw));
    } catch { /* ignore */ }
  }

  #normalizeSection(section: string): string {
    if (!section) return 'Extras';
    const s = section.toLowerCase();
    if (s.includes('receit') || s.includes('revenue')) return 'Receitas';
    if (s.includes('custo') || s.includes('cost')) return 'Custos';
    if (s.includes('pesso') || s.includes('rh') || s.includes('human')) return 'Pessoas';
    if (s.includes('impost') || s.includes('tax')) return 'Impostos';
    return section.charAt(0).toUpperCase() + section.slice(1);
  }
}
