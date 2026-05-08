import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { StatsService } from '../../services/stats.service';
import { QueueService } from '../../services/queue.service';

@Component({
  selector: 'app-stats-cards',
  imports: [DecimalPipe, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stats-cards" role="group" aria-label="Resumo estatístico">
      <div class="stats-card">
        <mat-icon class="stats-card__icon stats-card__icon--done">check_circle</mat-icon>
        <span class="stats-card__value">{{ stats.totalDone() }}</span>
        <span class="stats-card__label">Total processados</span>
      </div>
      <div class="stats-card">
        <mat-icon class="stats-card__icon stats-card__icon--error">warning</mat-icon>
        <span class="stats-card__value">{{ queue.errorCount() }}</span>
        <span class="stats-card__label">Com erro</span>
      </div>
      <div class="stats-card">
        <mat-icon class="stats-card__icon stats-card__icon--warning">language</mat-icon>
        <span class="stats-card__value">{{ stats.totalInternational() }}</span>
        <span class="stats-card__label">Internacionais</span>
      </div>
      <div class="stats-card stats-card--wide">
        <mat-icon class="stats-card__icon stats-card__icon--done">euro</mat-icon>
        <span class="stats-card__value">{{ stats.totalValue() | number:'1.2-2' }} €</span>
        <span class="stats-card__label">Volume total</span>
      </div>
      <div class="stats-card stats-card--wide">
        <mat-icon class="stats-card__icon stats-card__icon--error">receipt_long</mat-icon>
        <span class="stats-card__value">{{ stats.thisMonthSuppliersValue() | number:'1.2-2' }} €</span>
        <span class="stats-card__label">Fornecedores este mês</span>
        <span [class]="suppliersVariationClass()" aria-live="polite">{{ suppliersVariation() }}</span>
      </div>
      <div class="stats-card stats-card--wide">
        <mat-icon class="stats-card__icon stats-card__icon--primary">sell</mat-icon>
        <span class="stats-card__value">{{ stats.thisMonthSalesValue() | number:'1.2-2' }} €</span>
        <span class="stats-card__label">Vendas este mês</span>
        <span [class]="salesVariationClass()" aria-live="polite">{{ salesVariation() }}</span>
      </div>
      <div class="stats-card stats-card--wide">
        <mat-icon class="stats-card__icon stats-card__icon--done">receipt_long</mat-icon>
        <span class="stats-card__value">{{ stats.ivaEstimadoRecuperar() | number:'1.2-2' }} €</span>
        <span class="stats-card__label">IVA a recuperar</span>
      </div>
      <div [class]="saldoCardClass()">
        <mat-icon [class]="saldoIconClass()">{{ stats.saldoEstimado() >= 0 ? 'trending_up' : 'trending_down' }}</mat-icon>
        <span class="stats-card__value">{{ stats.saldoEstimado() | number:'1.2-2' }} €</span>
        <span class="stats-card__label">Saldo estimado</span>
      </div>
    </div>
  `,
  styles: [`
    .stats-cards {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 0.75rem;

      @media (min-width: 600px)  { grid-template-columns: repeat(4, 1fr); }
      @media (min-width: 900px)  { grid-template-columns: repeat(7, 1fr); }
    }
    .stats-card {
      background: var(--stx-surface);
      border: 1px solid var(--stx-border);
      border-radius: var(--stx-radius);
      padding: 0.875rem 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.125rem;

      &--wide {
        @media (max-width: 599px) { grid-column: span 2; }
      }

      &--saldo-positive { border-left: 2px solid var(--stx-success); }
      &--saldo-negative { border-left: 2px solid var(--stx-error); }

      &__icon {
        font-size: 18px; width: 18px; height: 18px;
        margin-bottom: 0.25rem;
        &--done    { color: var(--stx-success); }
        &--primary { color: var(--stx-primary); }
        &--error   { color: var(--stx-error); }
        &--warning { color: var(--stx-warning); }
        &--saldo-positive { color: var(--stx-success); }
        &--saldo-negative { color: var(--stx-error); }
      }
      &__value {
        font-size: 1.375rem; font-weight: 700; line-height: 1;
        font-variant-numeric: tabular-nums;
      }
      &__label {
        font-size: 0.6875rem; color: var(--stx-text-muted);
        text-transform: uppercase; letter-spacing: 0.05em;
        margin-top: 0.125rem;
      }
      &__variation {
        font-size: 0.6875rem;
        font-weight: 600;
        margin-top: 0.125rem;
        &--up { color: var(--stx-success); }
        &--down { color: var(--stx-error); }
        &--neutral { color: var(--stx-text-muted); }
      }
    }
  `],
})
export class StatsCards {
  readonly stats = inject(StatsService);
  readonly queue = inject(QueueService);

  readonly suppliersVariation = computed(() => {
    const prev = this.stats.prevMonthSuppliersValue();
    if (prev === 0) return '—';
    const pct = Math.round((this.stats.thisMonthSuppliersValue() - prev) / prev * 100);
    return pct >= 0 ? `+${pct}%` : `${pct}%`;
  });

  readonly suppliersVariationClass = computed(() => {
    const prev = this.stats.prevMonthSuppliersValue();
    if (prev === 0) return 'stats-card__variation stats-card__variation--neutral';
    const pct = this.stats.thisMonthSuppliersValue() - prev;
    return `stats-card__variation stats-card__variation--${pct >= 0 ? 'up' : 'down'}`;
  });

  readonly salesVariation = computed(() => {
    const prev = this.stats.prevMonthSalesValue();
    if (prev === 0) return '—';
    const pct = Math.round((this.stats.thisMonthSalesValue() - prev) / prev * 100);
    return pct >= 0 ? `+${pct}%` : `${pct}%`;
  });

  readonly salesVariationClass = computed(() => {
    const prev = this.stats.prevMonthSalesValue();
    if (prev === 0) return 'stats-card__variation stats-card__variation--neutral';
    const pct = this.stats.thisMonthSalesValue() - prev;
    return `stats-card__variation stats-card__variation--${pct >= 0 ? 'up' : 'down'}`;
  });

  readonly saldoCardClass = computed(() => {
    const base = 'stats-card stats-card--wide';
    return this.stats.saldoEstimado() >= 0
      ? `${base} stats-card--saldo-positive`
      : `${base} stats-card--saldo-negative`;
  });

  readonly saldoIconClass = computed(() => {
    const base = 'stats-card__icon';
    return this.stats.saldoEstimado() >= 0
      ? `${base} stats-card__icon--saldo-positive`
      : `${base} stats-card__icon--saldo-negative`;
  });
}
