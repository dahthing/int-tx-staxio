import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { BankService } from '../../../services/bank.service';
import { StatsService } from '../../../services/stats.service';
import { QueueService } from '../../../services/queue.service';

@Component({
  selector: 'app-finance-widget',
  imports: [MatIconModule],
  templateUrl: './finance-widget.html',
  styleUrl: './finance-widget.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FinanceWidget {
  readonly #bank = inject(BankService);
  readonly #stats = inject(StatsService);
  readonly #queue = inject(QueueService);

  readonly lastBalance = this.#bank.lastBalance;
  readonly projectedBalance = this.#bank.projectedBalance;
  readonly ivaRecuperar = this.#stats.ivaEstimadoRecuperar;
  readonly unpaidInvoicesTotal = this.#bank.unpaidInvoicesTotal;
  readonly unreconciledDebits = this.#bank.unreconciledDebits;
  readonly duplicateSuspects = this.#stats.duplicateSuspects;

  readonly overdueUnpaid = computed(() => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const cutoff = thirtyDaysAgo.toISOString().slice(0, 10);
    return this.#queue.entries().filter(
      e => e.is_paid === false
        && e.status === 'done'
        && e.is_my_doc === false
        && e.doc_date != null
        && e.doc_date < cutoff
    );
  });

  readonly overdueTotal = computed(() =>
    this.overdueUnpaid().reduce((s, e) => s + (e.value ?? 0), 0)
  );

  readonly hasAlerts = computed(() =>
    this.duplicateSuspects().length > 0
    || this.overdueUnpaid().length > 0
    || this.unreconciledDebits().length > 0
  );

  readonly top5Debits = computed(() =>
    this.unreconciledDebits().slice(0, 5)
  );

  formatCurrency(value: number | null): string {
    if (value === null) return '—';
    return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(value);
  }
}
