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
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { SUPABASE_CLIENT } from '../../core/supabase.client';
import { environment } from '../../../environments/environment';

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'redundancy' | 'whatif' | 'benchmark' | 'trending' | 'roi';

interface SupplierSpend {
  name: string;
  totalSpend: number;
  monthly: number[];
  active: boolean;
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

interface Redundancy {
  category: string;
  suppliers: string[];
  recommendation: string;
  potential_saving_eur: number;
}

interface HighCost {
  supplier: string;
  current_spend_eur: number;
  market_avg_eur: number;
  recommendation: string;
}

interface Consolidation {
  description: string;
  suppliers: string[];
  estimated_saving_eur: number;
}

interface AnalysisResult {
  redundancies: Redundancy[];
  high_cost: HighCost[];
  consolidations: Consolidation[];
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

// ─── Component ────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-insights',
  imports: [MatIconModule, MatButtonModule, MatSnackBarModule],
  templateUrl: './insights.html',
  styleUrl: './insights.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Insights implements OnInit {
  readonly #http = inject(HttpClient);
  readonly #snackBar = inject(MatSnackBar);
  readonly #supabase = inject(SUPABASE_CLIENT);

  // ── Tab state
  readonly selectedTab = signal<Tab>('redundancy');

  // ── Tab A — Redundancy analysis
  readonly analysisLoading = signal(false);
  readonly analysisResult = signal<AnalysisResult | null>(null);
  readonly analysisError = signal<string | null>(null);

  // ── Tab B — What-if simulator
  readonly supplierSpends = signal<SupplierSpend[]>([]);
  readonly whatifLoading = signal(false);
  readonly scenarios = signal<SavedScenario[]>([]);
  readonly scenarioName = signal('');

  readonly totalRevenue12m = signal(0);

  readonly enabledSuppliers = computed(() =>
    this.supplierSpends().filter(s => s.active)
  );

  readonly disabledSavings = computed(() => {
    const disabled = this.supplierSpends().filter(s => !s.active);
    return disabled.reduce((sum, s) => sum + s.totalSpend, 0);
  });

  readonly simulatedMonthlyResult = computed(() => {
    const rev = this.totalRevenue12m() / 12;
    const activeCosts = this.enabledSuppliers().reduce((sum, s) => sum + s.totalSpend / 12, 0);
    return rev - activeCosts;
  });

  readonly currentMonthlyResult = computed(() => {
    const rev = this.totalRevenue12m() / 12;
    const totalCosts = this.supplierSpends().reduce((sum, s) => sum + s.totalSpend / 12, 0);
    return rev - totalCosts;
  });

  readonly chartMonths = computed(() => {
    const months = MONTH_LABELS;
    return months.map((label, i) => {
      const currentCost = this.supplierSpends().reduce((sum, s) => sum + (s.monthly[i] ?? 0), 0);
      const simCost = this.enabledSuppliers().reduce((sum, s) => sum + (s.monthly[i] ?? 0), 0);
      const rev = this.totalRevenue12m() / 12;
      return { label, current: rev - currentCost, simulated: rev - simCost };
    });
  });

  readonly chartMax = computed(() => {
    const vals = this.chartMonths().flatMap(m => [Math.abs(m.current), Math.abs(m.simulated)]);
    return Math.max(...vals, 1);
  });

  // ── Tab C — Benchmark
  readonly benchmarks = signal<BenchmarkItem[]>(BENCHMARKS);
  readonly benchmarkMappings = signal<BenchmarkMapping>({});
  readonly benchmarkLoading = signal(false);

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

  // ── Tab D — Trending costs
  readonly trendingLoading = signal(false);
  readonly trendingSuppliers = signal<TrendingSupplier[]>([]);

  // ── Tab E — ROI per client
  readonly roiLoading = signal(false);
  readonly roiClients = signal<RoiClient[]>([]);
  readonly roiSummary = computed(() => {
    const clients = this.roiClients();
    if (clients.length === 0) return null;
    const best = [...clients].sort((a, b) => b.marginPct - a.marginPct)[0];
    const worst = [...clients].sort((a, b) => a.marginPct - b.marginPct)[0];
    return { best, worst };
  });

  // ── Exposed constants
  readonly monthLabels = MONTH_LABELS;
  readonly benchmarkCategories = BENCHMARKS.map(b => b.category);

  // ─────────────────────────────────────────────────────────────────────────────

  async ngOnInit(): Promise<void> {
    this.#loadScenarios();
    await Promise.all([
      this.#loadSupplierSpends(),
      this.#loadRevenueTotal(),
      this.#loadBenchmarkMappings(),
      this.#loadTrending(),
      this.#loadRoi(),
    ]);
  }

  // ── Tab selection
  selectTab(tab: Tab): void {
    this.selectedTab.set(tab);
  }

  // ── Tab A — Supplier analysis
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

  // ── Tab B — What-if
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
    const existing = this.scenarios();
    const updated = [...existing.filter(s => s.name !== name), scenario];
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

  // ── Tab C — Benchmark
  onBenchmarkMappingChange(supplierName: string, category: string): void {
    this.benchmarkMappings.update(m => ({ ...m, [supplierName]: category }));
    this.#saveBenchmarkMappings();
  }

  // ── Tab D — Trending: mailto action
  openRenegociate(supplierName: string): void {
    const subject = encodeURIComponent(`Revisão de condições contratuais — ${supplierName}`);
    window.open(`mailto:?subject=${subject}`, '_blank');
  }

  // ── Helpers
  formatCurrency(val: number): string {
    return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(val);
  }

  formatPct(val: number): string {
    return (val >= 0 ? '+' : '') + val.toFixed(1) + '%';
  }

  barHeightPct(val: number, max: number): number {
    return max > 0 ? Math.min(Math.abs(val) / max * 100, 100) : 0;
  }

  // ─── Private data loading ──────────────────────────────────────────────────

  async #loadSupplierSpends(): Promise<void> {
    this.whatifLoading.set(true);
    const now = new Date();
    const since = new Date(now.getFullYear(), now.getMonth() - 11, 1).toISOString().split('T')[0];

    const { data, error } = await this.#supabase
      .from('processing_queue')
      .select('supplier, value, doc_date')
      .eq('is_my_doc', false)
      .eq('status', 'done')
      .gte('doc_date', since);

    if (error) {
      this.whatifLoading.set(false);
      return;
    }

    const map = new Map<string, { total: number; monthly: number[] }>();
    (data ?? []).forEach((row: { supplier: string; value: number; doc_date: string }) => {
      const name = row.supplier ?? 'Desconhecido';
      if (!map.has(name)) map.set(name, { total: 0, monthly: new Array(12).fill(0) });
      const entry = map.get(name)!;
      entry.total += row.value ?? 0;
      const month = new Date(row.doc_date).getMonth();
      entry.monthly[month] += row.value ?? 0;
    });

    const spends: SupplierSpend[] = Array.from(map.entries())
      .map(([name, { total, monthly }]) => ({ name, totalSpend: total, monthly, active: true }))
      .sort((a, b) => b.totalSpend - a.totalSpend);

    this.supplierSpends.set(spends);
    this.whatifLoading.set(false);
  }

  async #loadRevenueTotal(): Promise<void> {
    const now = new Date();
    const since = new Date(now.getFullYear(), now.getMonth() - 11, 1).toISOString().split('T')[0];

    const { data } = await this.#supabase
      .from('processing_queue')
      .select('value')
      .eq('is_my_doc', true)
      .eq('status', 'done')
      .gte('doc_date', since);

    const total = (data ?? []).reduce((sum: number, r: { value: number }) => sum + (r.value ?? 0), 0);
    this.totalRevenue12m.set(total);
  }

  async #loadBenchmarkMappings(): Promise<void> {
    const { data } = await this.#supabase
      .from('app_config')
      .select('value')
      .eq('key', 'benchmark_mappings')
      .maybeSingle();

    if (data?.value) {
      try {
        this.benchmarkMappings.set(JSON.parse(data.value));
      } catch {
        // ignore parse errors
      }
    }
  }

  async #saveBenchmarkMappings(): Promise<void> {
    await this.#supabase.from('app_config').upsert({
      key: 'benchmark_mappings',
      value: JSON.stringify(this.benchmarkMappings()),
    });
  }

  async #loadTrending(): Promise<void> {
    this.trendingLoading.set(true);
    const now = new Date();
    const since = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString().split('T')[0];

    const { data } = await this.#supabase
      .from('processing_queue')
      .select('supplier, value, doc_date')
      .eq('is_my_doc', false)
      .eq('status', 'done')
      .gte('doc_date', since);

    const rows: Array<{ supplier: string; value: number; doc_date: string }> = data ?? [];
    const nowMonth = now.getMonth();
    const nowYear = now.getFullYear();

    // Build per-supplier buckets: prev3 vs recent3
    const map = new Map<string, { prev: number[]; recent: number[] }>();
    rows.forEach(row => {
      const d = new Date(row.doc_date);
      const diffMonths = (nowYear - d.getFullYear()) * 12 + (nowMonth - d.getMonth());
      if (diffMonths < 0 || diffMonths > 5) return;
      const name = row.supplier ?? 'Desconhecido';
      if (!map.has(name)) map.set(name, { prev: [], recent: [] });
      const entry = map.get(name)!;
      if (diffMonths <= 2) entry.recent.push(row.value ?? 0);
      else entry.prev.push(row.value ?? 0);
    });

    const avg = (arr: number[]) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;

    const trending: TrendingSupplier[] = Array.from(map.entries())
      .map(([name, { prev, recent }]) => {
        const avgPrev = avg(prev);
        const avgRecent = avg(recent);
        const changePct = avgPrev > 0 ? ((avgRecent - avgPrev) / avgPrev) * 100 : 0;
        return { name, avgPrev, avgRecent, changePct };
      })
      .filter(t => t.avgPrev > 0 && t.avgRecent > 0)
      .sort((a, b) => b.changePct - a.changePct);

    this.trendingSuppliers.set(trending);
    this.trendingLoading.set(false);
  }

  async #loadRoi(): Promise<void> {
    this.roiLoading.set(true);
    const currentYear = new Date().getFullYear();

    const [forecastRes, revenueRes, costsRes] = await Promise.all([
      this.#supabase
        .from('budget_forecasts')
        .select('category, owner, forecast_value')
        .eq('section', 'revenue')
        .eq('year', currentYear),
      this.#supabase
        .from('processing_queue')
        .select('supplier, value')
        .eq('is_my_doc', true)
        .eq('status', 'done'),
      this.#supabase
        .from('processing_queue')
        .select('value')
        .eq('is_my_doc', false)
        .eq('status', 'done'),
    ]);

    const forecasts: Array<{ category: string; owner: string; forecast_value: number }> = forecastRes.data ?? [];
    const revenues: Array<{ supplier: string; value: number }> = revenueRes.data ?? [];
    const costs: Array<{ value: number }> = costsRes.data ?? [];

    const totalCosts = costs.reduce((s, r) => s + (r.value ?? 0), 0);

    // Group forecasts by category+owner
    const clientMap = new Map<string, { owner: string; forecastRevenue: number }>();
    forecasts.forEach(f => {
      const key = f.category;
      if (!clientMap.has(key)) clientMap.set(key, { owner: f.owner ?? '', forecastRevenue: 0 });
      clientMap.get(key)!.forecastRevenue += f.forecast_value ?? 0;
    });

    // Actual revenue per client (match by supplier name includes category)
    const actualMap = new Map<string, number>();
    revenues.forEach(r => {
      const name = r.supplier ?? '';
      actualMap.set(name, (actualMap.get(name) ?? 0) + (r.value ?? 0));
    });

    const totalActualRevenue = revenues.reduce((s, r) => s + (r.value ?? 0), 0);

    const roiClients: RoiClient[] = Array.from(clientMap.entries()).map(([client, { owner, forecastRevenue }]) => {
      // Match actual revenue: find revenues whose supplier name loosely matches client
      const actualRevenue = Array.from(actualMap.entries())
        .filter(([name]) => name.toLowerCase().includes(client.toLowerCase()) || client.toLowerCase().includes(name.toLowerCase()))
        .reduce((s, [, v]) => s + v, 0);

      const allocatedCost = totalActualRevenue > 0
        ? totalCosts * (actualRevenue / totalActualRevenue)
        : 0;
      const grossMargin = actualRevenue - allocatedCost;
      const marginPct = actualRevenue > 0 ? (grossMargin / actualRevenue) * 100 : 0;

      return { client, owner, forecastRevenue, actualRevenue, allocatedCost, grossMargin, marginPct };
    });

    this.roiClients.set(roiClients);
    this.roiLoading.set(false);
  }

  #loadScenarios(): void {
    try {
      const raw = localStorage.getItem('staxio_whatif_scenarios');
      if (raw) this.scenarios.set(JSON.parse(raw));
    } catch {
      // ignore
    }
  }
}
