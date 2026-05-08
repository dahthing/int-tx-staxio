import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { SUPABASE_CLIENT } from '../../core/supabase.client';

export interface BankTransaction {
  id: string;
  txn_date: string;
  description: string;
  amount: number;
  balance: number | null;
  reference: string | null;
  counterparty: string | null;
  is_reconciled: boolean;
  reconciled_queue_id: string | null;
  invoice?: InvoiceInfo | null;
}

interface InvoiceInfo {
  id: string;
  supplier: string | null;
  doc_date: string | null;
  value: number | null;
  doc_type: string | null;
}

@Component({
  selector: 'app-reconciliation',
  imports: [MatIconModule, MatButtonModule, MatSnackBarModule],
  templateUrl: './reconciliation.html',
  styleUrl: './reconciliation.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Reconciliation implements OnInit {
  readonly #supabase = inject(SUPABASE_CLIENT);
  readonly #snackBar = inject(MatSnackBar);

  readonly #txns = signal<BankTransaction[]>([]);
  readonly #loading = signal(true);
  readonly #running = signal(false);
  readonly #filter = signal<'all' | 'unreconciled' | 'reconciled'>('unreconciled');
  readonly #lastResult = signal<{ matched: number; unmatched: number } | null>(null);

  readonly loading = this.#loading.asReadonly();
  readonly running = this.#running.asReadonly();
  readonly filter = this.#filter.asReadonly();
  readonly lastResult = this.#lastResult.asReadonly();

  readonly filtered = computed(() => {
    const f = this.#filter();
    if (f === 'unreconciled') return this.#txns().filter(t => !t.is_reconciled);
    if (f === 'reconciled')   return this.#txns().filter(t => t.is_reconciled);
    return this.#txns();
  });

  readonly counts = computed(() => ({
    total:        this.#txns().length,
    reconciled:   this.#txns().filter(t => t.is_reconciled).length,
    unreconciled: this.#txns().filter(t => !t.is_reconciled).length,
    totalDebit:   this.#txns().filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0),
  }));

  async ngOnInit(): Promise<void> {
    await this.#load();
  }

  async #load(): Promise<void> {
    this.#loading.set(true);
    const { data, error } = await this.#supabase
      .from('bank_transactions')
      .select(`
        id, txn_date, description, amount, balance, reference, counterparty,
        is_reconciled, reconciled_queue_id,
        invoice:reconciled_queue_id (id, supplier, doc_date, value, doc_type)
      `)
      .order('txn_date', { ascending: false });
    this.#loading.set(false);
    if (error) { this.#toast(error.message, 'error'); return; }
    const rows = (data ?? []) as unknown as Array<Omit<BankTransaction, 'invoice'> & { invoice: InvoiceInfo[] | null }>;
    this.#txns.set(rows.map(r => ({ ...r, invoice: Array.isArray(r.invoice) ? r.invoice[0] ?? null : r.invoice })));
  }

  setFilter(f: 'all' | 'unreconciled' | 'reconciled'): void {
    this.#filter.set(f);
  }

  async runAuto(): Promise<void> {
    if (this.#running()) return;
    this.#running.set(true);
    this.#lastResult.set(null);
    const { data, error } = await this.#supabase.rpc('reconcile_transactions');
    this.#running.set(false);
    if (error) { this.#toast(error.message, 'error'); return; }
    const row = (data as { matched: number; unmatched: number }[])?.[0];
    if (row) {
      this.#lastResult.set(row);
      this.#toast(`Reconciliadas: ${row.matched} | Por reconciliar: ${row.unmatched}`, 'success');
    }
    await this.#load();
  }

  async unlink(txn: BankTransaction): Promise<void> {
    if (!confirm(`Remover reconciliação de "${txn.description}"?`)) return;
    const { error } = await this.#supabase
      .from('bank_transactions')
      .update({ is_reconciled: false, reconciled_queue_id: null })
      .eq('id', txn.id);
    if (error) { this.#toast(error.message, 'error'); return; }

    if (txn.reconciled_queue_id) {
      await this.#supabase
        .from('processing_queue')
        .update({ is_paid: false, payment_date: null, payment_ref: null })
        .eq('id', txn.reconciled_queue_id);
    }

    this.#txns.update(list =>
      list.map(t => t.id === txn.id ? { ...t, is_reconciled: false, reconciled_queue_id: null, invoice: null } : t)
    );
    this.#toast('Reconciliação removida', 'info');
  }

  formatAmount(v: number): string {
    return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(v);
  }

  #toast(msg: string, type: 'success' | 'error' | 'info' = 'info'): void {
    this.#snackBar.open(msg, '✕', {
      duration: 4000, panelClass: [`toast--${type}`],
      horizontalPosition: 'end', verticalPosition: 'bottom',
    });
  }
}
