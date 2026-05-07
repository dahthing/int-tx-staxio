import { Injectable, computed, inject } from '@angular/core';
import { QueueService } from './queue.service';

export interface MonthBucket {
  label: string; // 'Jan 25'
  count: number;
}

export interface MonthValueBucket {
  label: string;
  suppliers: number; // received + ecommerce + international + bank_statement + supplies
  sales: number;     // issued
}

export interface SupplierVolume {
  supplier: string;
  count: number;
  total: number;
}

@Injectable({ providedIn: 'root' })
export class StatsService {
  readonly #queue = inject(QueueService);

  readonly totalDone = computed(() =>
    this.#queue.entries().filter(e => e.status === 'done').length
  );

  readonly totalInternational = computed(() =>
    this.#queue.entries().filter(e => e.doc_type === 'international').length
  );

  readonly totalValue = computed(() =>
    this.#queue.entries().reduce((s, e) => s + (e.value ?? 0), 0)
  );

  readonly thisMonthDone = computed(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    return this.#queue.entries().filter(e => {
      if (e.status !== 'done' || !e.doc_date) return false;
      const [ey, em] = e.doc_date.split('-').map(Number);
      return ey === y && em === m;
    }).length;
  });

  /** Valor total das faturas de fornecedores este mês */
  readonly thisMonthSuppliersValue = computed(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const SUPPLIER_TYPES = ['received', 'ecommerce', 'international', 'bank_statement', 'supplies'];
    return this.#queue.entries()
      .filter(e => {
        if (!e.doc_date || !SUPPLIER_TYPES.includes(e.doc_type ?? '')) return false;
        const [ey, em] = e.doc_date.split('-').map(Number);
        return ey === y && em === m;
      })
      .reduce((s, e) => s + (e.value ?? 0), 0);
  });

  /** Valor total das faturas de venda este mês */
  readonly thisMonthSalesValue = computed(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    return this.#queue.entries()
      .filter(e => {
        if (e.doc_type !== 'issued' || !e.doc_date) return false;
        const [ey, em] = e.doc_date.split('-').map(Number);
        return ey === y && em === m;
      })
      .reduce((s, e) => s + (e.value ?? 0), 0);
  });

  /** Valor mensal separado por fornecedores vs vendas — últimos 12 meses */
  readonly valueByMonth = computed((): MonthValueBucket[] => {
    const now = new Date();
    const SUPPLIER_TYPES = new Set(['received', 'ecommerce', 'international', 'bank_statement', 'supplies']);
    const buckets = new Map<string, { suppliers: number; sales: number }>();

    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      buckets.set(key, { suppliers: 0, sales: 0 });
    }

    for (const entry of this.#queue.entries()) {
      if (!entry.doc_date || entry.value == null) continue;
      const key = entry.doc_date.slice(0, 7);
      if (!buckets.has(key)) continue;
      const b = buckets.get(key)!;
      if (entry.doc_type === 'issued') {
        b.sales += entry.value;
      } else if (SUPPLIER_TYPES.has(entry.doc_type ?? '')) {
        b.suppliers += entry.value;
      }
    }

    return [...buckets.entries()].map(([key, { suppliers, sales }]) => {
      const [y, m] = key.split('-').map(Number);
      const label = new Date(y, m - 1).toLocaleDateString('pt-PT', {
        month: 'short', year: '2-digit',
      });
      return { label, suppliers, sales };
    });
  });

  /** Documentos concluídos agrupados por mês — últimos 12 meses */
  readonly byMonth = computed((): MonthBucket[] => {
    const now = new Date();
    const buckets = new Map<string, number>();

    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      buckets.set(key, 0);
    }

    for (const entry of this.#queue.entries()) {
      if (entry.status !== 'done' || !entry.doc_date) continue;
      const key = entry.doc_date.slice(0, 7);
      if (buckets.has(key)) buckets.set(key, buckets.get(key)! + 1);
    }

    return [...buckets.entries()].map(([key, count]) => {
      const [y, m] = key.split('-').map(Number);
      const label = new Date(y, m - 1).toLocaleDateString('pt-PT', {
        month: 'short', year: '2-digit',
      });
      return { label, count };
    });
  });

  /** Top 10 fornecedores por nº de documentos */
  readonly topSuppliers = computed((): SupplierVolume[] => {
    const map = new Map<string, { count: number; total: number }>();

    for (const e of this.#queue.entries()) {
      const key = e.supplier ?? '(desconhecido)';
      const cur = map.get(key) ?? { count: 0, total: 0 };
      map.set(key, { count: cur.count + 1, total: cur.total + (e.value ?? 0) });
    }

    return [...map.entries()]
      .map(([supplier, { count, total }]) => ({ supplier, count, total }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  });
}
