import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
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
        <mat-icon class="stats-card__icon stats-card__icon--primary">today</mat-icon>
        <span class="stats-card__value">{{ stats.thisMonthDone() }}</span>
        <span class="stats-card__label">Este mês</span>
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
      </div>
      <div class="stats-card stats-card--wide">
        <mat-icon class="stats-card__icon stats-card__icon--primary">sell</mat-icon>
        <span class="stats-card__value">{{ stats.thisMonthSalesValue() | number:'1.2-2' }} €</span>
        <span class="stats-card__label">Vendas este mês</span>
      </div>
    </div>
  `,
  styles: [`
    .stats-cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: 1rem;
    }
    .stats-card {
      background: var(--stx-surface);
      border: 1px solid var(--stx-border);
      border-radius: var(--stx-radius);
      padding: 1.25rem 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      &--wide { grid-column: span 2; }
      &__icon {
        font-size: 24px; width: 24px; height: 24px;
        margin-bottom: 0.25rem;
        &--done    { color: var(--stx-success); }
        &--primary { color: var(--stx-primary); }
        &--error   { color: var(--stx-error); }
        &--warning { color: var(--stx-warning); }
      }
      &__value {
        font-size: 1.75rem; font-weight: 700; line-height: 1;
        font-variant-numeric: tabular-nums;
      }
      &__label {
        font-size: 0.75rem; color: var(--stx-text-muted);
        text-transform: uppercase; letter-spacing: 0.05em;
      }
    }
  `],
})
export class StatsCards {
  readonly stats = inject(StatsService);
  readonly queue = inject(QueueService);
}
