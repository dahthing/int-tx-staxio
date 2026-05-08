import { inject, Injectable, OnDestroy, signal, computed } from '@angular/core';
import { SUPABASE_CLIENT } from '../core/supabase.client';
import { QueueService } from './queue.service';
import type { RealtimeChannel } from '@supabase/supabase-js';

export interface BankTransaction {
  id: string;
  queue_id: string;
  txn_date: string;
  description: string;
  amount: number;
  balance: number | null;
  counterparty: string | null;
  is_reconciled: boolean;
}

@Injectable({ providedIn: 'root' })
export class BankService implements OnDestroy {
  readonly #supabase = inject(SUPABASE_CLIENT);
  readonly #queue = inject(QueueService);

  readonly #unreconciledDebits = signal<BankTransaction[]>([]);
  readonly #lastBalance = signal<number | null>(null);

  readonly unreconciledDebits = this.#unreconciledDebits.asReadonly();
  readonly lastBalance = this.#lastBalance.asReadonly();

  readonly unreconciledTotal = computed(() =>
    this.#unreconciledDebits().reduce((s, t) => s + Math.abs(t.amount), 0)
  );

  readonly unpaidInvoicesTotal = computed(() =>
    this.#queue.entries()
      .filter(e => e.is_paid === false && e.status === 'done' && e.is_my_doc === false)
      .reduce((s, e) => s + (e.value ?? 0), 0)
  );

  readonly projectedBalance = computed(() => {
    const bal = this.#lastBalance();
    if (bal === null) return null;
    return bal - this.unpaidInvoicesTotal();
  });

  #channel: RealtimeChannel | null = null;

  async loadAll(): Promise<void> {
    const [debitsRes, balanceRes] = await Promise.all([
      this.#supabase
        .from('bank_transactions')
        .select('*')
        .lt('amount', 0)
        .eq('is_reconciled', false)
        .order('txn_date', { ascending: false }),
      this.#supabase
        .from('bank_transactions')
        .select('balance, txn_date')
        .not('balance', 'is', null)
        .order('txn_date', { ascending: false })
        .limit(1),
    ]);

    if (!debitsRes.error) {
      this.#unreconciledDebits.set(debitsRes.data as BankTransaction[]);
    }

    if (!balanceRes.error && balanceRes.data?.length) {
      this.#lastBalance.set(balanceRes.data[0].balance as number);
    }

    this.#subscribeRealtime();
  }

  #subscribeRealtime(): void {
    if (this.#channel) return;
    this.#channel = this.#supabase
      .channel('bank-transactions-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bank_transactions' },
        () => { void this.loadAll(); }
      )
      .subscribe();
  }

  ngOnDestroy(): void {
    if (this.#channel) {
      void this.#supabase.removeChannel(this.#channel);
      this.#channel = null;
    }
  }
}
