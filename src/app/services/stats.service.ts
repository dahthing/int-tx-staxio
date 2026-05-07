import { Injectable, computed, inject } from '@angular/core';
import { QueueService } from './queue.service';

export interface MonthBucket {
  label: string; // 'Jan 25'
  count: number;
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
