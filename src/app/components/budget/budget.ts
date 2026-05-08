import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { SUPABASE_CLIENT } from '../../core/supabase.client';
import { environment } from '../../../environments/environment';

export interface BudgetForecast {
  id: string;
  year: number;
  month: number;
  section: string;
  category: string;
  owner: string | null;
  forecast_value: number;
  status: 'pending' | 'paid' | 'delayed';
  notes: string | null;
}

type SectionFilter = 'all' | 'revenue' | 'cost' | 'people';
type MapSection = 'revenue' | 'cost' | 'people' | 'tax' | 'extra';
type MainTab = 'map' | 'comparison';

interface MonthComparison {
  month: number;
  monthLabel: string;
  forecast: number;
  actual: number;
  deviation_pct: number;
}

interface CategoryBreakdown {
  category: string;
  owner: string | null;
  months: number[];
  totalForecast: number;
  totalActual: number;
  deviation_pct: number;
}

interface BudgetRow {
  category: string;
  owner: string | null;
  section: MapSection;
  months: { [month: number]: { value: number; status: 'pending' | 'paid' | 'delayed' } };
}

const MONTH_LABELS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

const MAP_SECTIONS: { key: MapSection; label: string; addLabel: string }[] = [
  { key: 'revenue', label: 'Receitas', addLabel: 'receita' },
  { key: 'cost',    label: 'Custos',   addLabel: 'custo' },
  { key: 'people',  label: 'Pessoas',  addLabel: 'pessoa' },
  { key: 'tax',     label: 'Impostos / Taxas', addLabel: 'imposto' },
  { key: 'extra',   label: 'Extras',   addLabel: 'extra' },
];

@Component({
  selector: 'app-budget',
  imports: [MatIconModule, MatButtonModule, MatSnackBarModule, DecimalPipe],
  templateUrl: './budget.html',
  styleUrl: './budget.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Budget implements OnInit {
  readonly #http = inject(HttpClient);
  readonly #snackBar = inject(MatSnackBar);
  readonly #supabase = inject(SUPABASE_CLIENT);

  // ── shared ──────────────────────────────────────────────────────────────
  readonly #forecasts = signal<BudgetForecast[]>([]);
  readonly #loading = signal(false);
  readonly #uploading = signal(false);
  readonly #selectedYear = signal(new Date().getFullYear());

  readonly forecasts = this.#forecasts.asReadonly();
  readonly loading = this.#loading.asReadonly();
  readonly uploading = this.#uploading.asReadonly();
  readonly selectedYear = this.#selectedYear.asReadonly();

  // ── comparison tab ───────────────────────────────────────────────────────
  readonly #selectedSection = signal<SectionFilter>('all');
  readonly selectedSection = this.#selectedSection.asReadonly();

  // ── main tabs ────────────────────────────────────────────────────────────
  readonly selectedTab = signal<MainTab>('map');

  // ── map tab signals ──────────────────────────────────────────────────────
  readonly #editingCell = signal<{ category: string; month: number } | null>(null);
  readonly #savingCell = signal<string | null>(null);
  readonly #addingRow = signal<{ section: MapSection; name: string; owner: string } | null>(null);

  readonly editingCell = this.#editingCell.asReadonly();
  readonly savingCell = this.#savingCell.asReadonly();
  readonly addingRow = this.#addingRow.asReadonly();

  // ── static data ──────────────────────────────────────────────────────────
  readonly months = MONTH_LABELS.map((label, i) => ({ n: i + 1, label }));
  readonly mapSections = MAP_SECTIONS;

  readonly availableYears = computed(() => {
    const years = [...new Set(this.#forecasts().map(f => f.year))].sort((a, b) => b - a);
    return years.length > 0 ? years : [new Date().getFullYear()];
  });

  readonly filteredForecasts = computed(() => {
    const year = this.#selectedYear();
    const section = this.#selectedSection();
    return this.#forecasts().filter(f =>
      f.year === year && (section === 'all' || f.section === section)
    );
  });

  readonly hasForecastsForYear = computed(() =>
    this.#forecasts().some(f => f.year === this.#selectedYear())
  );

  // ── comparison computed ───────────────────────────────────────────────────
  readonly monthlyComparison = computed((): MonthComparison[] => {
    const rows = this.filteredForecasts();
    return Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      const forecast = rows
        .filter(f => f.month === month)
        .reduce((s, f) => s + f.forecast_value, 0);
      const actual = 0;
      const deviation_pct = forecast > 0 ? ((actual - forecast) / forecast) * 100 : 0;
      return { month, monthLabel: MONTH_LABELS[i], forecast, actual, deviation_pct };
    });
  });

  readonly maxMonthValue = computed(() => {
    const vals = this.monthlyComparison().map(m => Math.max(m.forecast, m.actual));
    return Math.max(...vals, 1);
  });

  readonly categoryBreakdown = computed((): CategoryBreakdown[] => {
    const rows = this.filteredForecasts();
    const map = new Map<string, CategoryBreakdown>();

    for (const row of rows) {
      const key = `${row.section}::${row.category}`;
      if (!map.has(key)) {
        map.set(key, {
          category: row.category,
          owner: row.owner,
          months: Array(12).fill(0),
          totalForecast: 0,
          totalActual: 0,
          deviation_pct: 0,
        });
      }
      const entry = map.get(key)!;
      entry.months[row.month - 1] = row.forecast_value;
      entry.totalForecast += row.forecast_value;
    }

    return [...map.values()].sort((a, b) => b.totalForecast - a.totalForecast);
  });

  readonly summaryTotals = computed(() => {
    const rows = this.filteredForecasts();
    const totalForecast = rows.reduce((s, r) => s + r.forecast_value, 0);
    const totalActual = 0;
    const deviationEur = totalActual - totalForecast;
    const deviationPct = totalForecast > 0 ? (deviationEur / totalForecast) * 100 : 0;
    return { totalForecast, totalActual, deviationEur, deviationPct };
  });

  readonly sections: { value: SectionFilter; label: string }[] = [
    { value: 'all', label: 'Todos' },
    { value: 'revenue', label: 'Receitas' },
    { value: 'cost', label: 'Custos' },
    { value: 'people', label: 'Pessoas' },
  ];

  // ── map computed ──────────────────────────────────────────────────────────
  readonly mapRows = computed((): BudgetRow[] => {
    const year = this.#selectedYear();
    const forecasts = this.#forecasts().filter(f => f.year === year);
    const map = new Map<string, BudgetRow>();

    for (const f of forecasts) {
      const key = `${f.section}::${f.category}`;
      if (!map.has(key)) {
        map.set(key, {
          category: f.category,
          owner: f.owner,
          section: f.section as MapSection,
          months: {},
        });
      }
      const row = map.get(key)!;
      row.months[f.month] = {
        value: f.forecast_value,
        status: (f.status ?? 'pending') as 'pending' | 'paid' | 'delayed',
      };
    }

    return [...map.values()];
  });

  readonly rowsBySection = computed(() => {
    const result: Partial<Record<MapSection, BudgetRow[]>> = {};
    for (const row of this.mapRows()) {
      if (!result[row.section]) result[row.section] = [];
      result[row.section]!.push(row);
    }
    return result;
  });

  readonly subtotals = computed(() => {
    const result: Partial<Record<MapSection, Record<number, number>>> = {};
    for (const row of this.mapRows()) {
      if (!result[row.section]) result[row.section] = {};
      for (let m = 1; m <= 12; m++) {
        result[row.section]![m] = (result[row.section]![m] ?? 0) + (row.months[m]?.value ?? 0);
      }
    }
    return result;
  });

  readonly netByMonth = computed(() => {
    const subs = this.subtotals();
    const result: Record<number, number> = {};
    for (let m = 1; m <= 12; m++) {
      const rev   = subs['revenue']?.[m] ?? 0;
      const cost  = subs['cost']?.[m] ?? 0;
      const ppl   = subs['people']?.[m] ?? 0;
      const tax   = subs['tax']?.[m] ?? 0;
      const extra = subs['extra']?.[m] ?? 0;
      result[m] = rev - cost - ppl - tax - extra;
    }
    return result;
  });

  readonly netTotal = computed(() =>
    Object.values(this.netByMonth()).reduce((s, v) => s + v, 0)
  );

  // ── lifecycle ─────────────────────────────────────────────────────────────
  async ngOnInit(): Promise<void> {
    await this.#loadForecasts();
  }

  async #loadForecasts(): Promise<void> {
    this.#loading.set(true);
    try {
      const { data, error } = await this.#supabase
        .from('budget_forecasts')
        .select('*')
        .order('year', { ascending: false })
        .order('month', { ascending: true });

      if (error) throw error;
      this.#forecasts.set(data ?? []);

      const years = [...new Set((data ?? []).map((f: BudgetForecast) => f.year))].sort((a, b) => b - a);
      if (years.length > 0) {
        this.#selectedYear.set(years[0]);
      }
    } catch (err) {
      this.#snackBar.open('Erro ao carregar previsões', 'Fechar', { duration: 4000 });
      console.error(err);
    } finally {
      this.#loading.set(false);
    }
  }

  // ── comparison methods ────────────────────────────────────────────────────
  async onFileUpload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.#uploading.set(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const { data: { session } } = await this.#supabase.auth.getSession();
      const token = session?.access_token;

      const result = await this.#http.post<{ imported: number; years: number[] }>(
        `${environment.edgeFunctionsUrl}/budget-import`,
        formData,
        token ? { headers: { Authorization: `Bearer ${token}` } } : {}
      ).toPromise();

      this.#snackBar.open(
        `${result?.imported ?? 0} registos importados para ${result?.years?.join(', ')}`,
        'OK',
        { duration: 5000 }
      );

      await this.#loadForecasts();
    } catch (err) {
      this.#snackBar.open('Erro ao importar ficheiro', 'Fechar', { duration: 4000 });
      console.error(err);
    } finally {
      this.#uploading.set(false);
      input.value = '';
    }
  }

  selectYear(year: number): void {
    this.#selectedYear.set(year);
  }

  selectSection(section: SectionFilter): void {
    this.#selectedSection.set(section);
  }

  barHeight(value: number): number {
    const max = this.maxMonthValue();
    return max > 0 ? Math.round((value / max) * 100) : 0;
  }

  deviationClass(pct: number): string {
    const abs = Math.abs(pct);
    if (abs <= 0) return 'budget__deviation--neutral';
    if (abs <= 15) return 'budget__deviation--warning';
    return 'budget__deviation--danger';
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('pt-PT', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  }

  formatPct(value: number): string {
    const sign = value > 0 ? '+' : '';
    return `${sign}${value.toFixed(1)}%`;
  }

  readonly monthLabels = MONTH_LABELS;
  readonly Math = Math;

  // ── map methods ───────────────────────────────────────────────────────────
  rowTotal(row: BudgetRow): number {
    return Object.values(row.months).reduce((s, m) => s + m.value, 0);
  }

  sectionTotal(sectionKey: MapSection): number {
    const subs = this.subtotals()[sectionKey] ?? {};
    return Object.values(subs).reduce((s, v) => s + v, 0);
  }

  startEdit(category: string, month: number): void {
    this.#editingCell.set({ category, month });
  }

  async saveCell(row: BudgetRow, month: number, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const newValue = parseFloat(input.value);
    if (isNaN(newValue)) {
      this.#editingCell.set(null);
      return;
    }

    const cellKey = `${row.category}-${month}`;
    this.#editingCell.set(null);

    // Optimistic update
    this.#forecasts.update(prev => prev.map(f => {
      if (f.year === this.#selectedYear() && f.month === month &&
          f.section === row.section && f.category === row.category) {
        return { ...f, forecast_value: newValue };
      }
      return f;
    }));

    this.#savingCell.set(cellKey);
    try {
      const existing = this.#forecasts().find(f =>
        f.year === this.#selectedYear() && f.month === month &&
        f.section === row.section && f.category === row.category
      );

      const { error } = await this.#supabase
        .from('budget_forecasts')
        .upsert({
          year: this.#selectedYear(),
          month,
          section: row.section,
          category: row.category,
          owner: row.owner,
          forecast_value: newValue,
          status: existing?.status ?? 'pending',
        }, { onConflict: 'year,month,section,category' });

      if (error) throw error;
    } catch (err) {
      this.#snackBar.open('Erro ao guardar valor', 'Fechar', { duration: 3000 });
      console.error(err);
    } finally {
      this.#savingCell.set(null);
    }
  }

  async cycleStatus(row: BudgetRow, month: number, event: Event): Promise<void> {
    event.stopPropagation();
    const current = row.months[month]?.status ?? 'pending';
    const next = current === 'pending' ? 'paid' : current === 'paid' ? 'delayed' : 'pending';

    // Optimistic update
    this.#forecasts.update(prev => prev.map(f => {
      if (f.year === this.#selectedYear() && f.month === month &&
          f.section === row.section && f.category === row.category) {
        return { ...f, status: next };
      }
      return f;
    }));

    try {
      const { error } = await this.#supabase
        .from('budget_forecasts')
        .upsert({
          year: this.#selectedYear(),
          month,
          section: row.section,
          category: row.category,
          owner: row.owner,
          forecast_value: row.months[month]?.value ?? 0,
          status: next,
        }, { onConflict: 'year,month,section,category' });

      if (error) throw error;
    } catch (err) {
      this.#snackBar.open('Erro ao actualizar estado', 'Fechar', { duration: 3000 });
      console.error(err);
    }
  }

  async bulkStatus(row: BudgetRow, status: 'paid' | 'delayed', event: Event): Promise<void> {
    event.stopPropagation();

    // Optimistic update
    this.#forecasts.update(prev => prev.map(f => {
      if (f.year === this.#selectedYear() && f.section === row.section && f.category === row.category) {
        return { ...f, status };
      }
      return f;
    }));

    try {
      const { error } = await this.#supabase
        .from('budget_forecasts')
        .update({ status })
        .eq('year', this.#selectedYear())
        .eq('section', row.section)
        .eq('category', row.category);

      if (error) throw error;
    } catch (err) {
      this.#snackBar.open('Erro ao actualizar estados', 'Fechar', { duration: 3000 });
      console.error(err);
    }
  }

  startAddRow(section: MapSection): void {
    this.#addingRow.set({ section, name: '', owner: '' });
  }

  updateAddingRowName(name: string): void {
    const cur = this.#addingRow();
    if (cur) this.#addingRow.set({ ...cur, name });
  }

  updateAddingRowOwner(owner: string): void {
    const cur = this.#addingRow();
    if (cur) this.#addingRow.set({ ...cur, owner });
  }

  async confirmAddRow(): Promise<void> {
    const adding = this.#addingRow();
    if (!adding || !adding.name.trim()) {
      this.#addingRow.set(null);
      return;
    }

    const year = this.#selectedYear();
    const category = adding.name.trim();
    const owner = adding.owner.trim() || null;
    const section = adding.section;

    this.#addingRow.set(null);

    // Optimistic: add 12 empty rows locally
    const newRows: BudgetForecast[] = Array.from({ length: 12 }, (_, i) => ({
      id: `temp-${category}-${i}`,
      year,
      month: i + 1,
      section,
      category,
      owner,
      forecast_value: 0,
      status: 'pending' as const,
      notes: null,
    }));
    this.#forecasts.update(prev => [...prev, ...newRows]);

    try {
      const upsertRows = Array.from({ length: 12 }, (_, i) => ({
        year,
        month: i + 1,
        section,
        category,
        owner,
        forecast_value: 0,
        status: 'pending',
      }));

      const { error } = await this.#supabase
        .from('budget_forecasts')
        .upsert(upsertRows, { onConflict: 'year,month,section,category' });

      if (error) throw error;

      // Reload to get real IDs
      await this.#loadForecasts();
    } catch (err) {
      // Rollback
      this.#forecasts.update(prev =>
        prev.filter(f => !(f.year === year && f.section === section && f.category === category))
      );
      this.#snackBar.open('Erro ao adicionar linha', 'Fechar', { duration: 3000 });
      console.error(err);
    }
  }

  cancelAddRow(): void {
    this.#addingRow.set(null);
  }

  async deleteRow(row: BudgetRow): Promise<void> {
    const sectionLabel = MAP_SECTIONS.find(s => s.key === row.section)?.label ?? row.section;
    if (!confirm(`Apagar "${row.category}" de ${sectionLabel}? Remove todos os 12 meses.`)) return;

    const year = this.#selectedYear();

    // Optimistic
    this.#forecasts.update(prev =>
      prev.filter(f => !(f.year === year && f.section === row.section && f.category === row.category))
    );

    try {
      const { error } = await this.#supabase
        .from('budget_forecasts')
        .delete()
        .eq('year', year)
        .eq('section', row.section)
        .eq('category', row.category);

      if (error) throw error;
    } catch (err) {
      this.#snackBar.open('Erro ao apagar linha', 'Fechar', { duration: 3000 });
      console.error(err);
      await this.#loadForecasts();
    }
  }

  cellSaving(category: string, month: number): boolean {
    return this.#savingCell() === `${category}-${month}`;
  }
}
