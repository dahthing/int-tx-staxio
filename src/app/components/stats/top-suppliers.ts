import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { StatsService } from '../../services/stats.service';

@Component({
  selector: 'app-top-suppliers',
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="top-suppliers">
      <h3 class="top-suppliers__title">Top fornecedores</h3>
      @if (stats.topSuppliers().length === 0) {
        <p class="top-suppliers__empty">Sem dados.</p>
      } @else {
        <table class="top-suppliers__table" aria-label="Top 10 fornecedores por volume">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Fornecedor</th>
              <th scope="col" class="num">Docs</th>
              <th scope="col" class="num">Volume</th>
            </tr>
          </thead>
          <tbody>
            @for (row of stats.topSuppliers(); track row.supplier; let i = $index) {
              <tr>
                <td class="rank">{{ i + 1 }}</td>
                <td class="supplier">{{ row.supplier }}</td>
                <td class="num">{{ row.count }}</td>
                <td class="num">{{ row.total | number:'1.2-2' }} €</td>
              </tr>
            }
          </tbody>
        </table>
      }
    </div>
  `,
  styles: [`
    .top-suppliers {
      background: var(--stx-surface);
      border: 1px solid var(--stx-border);
      border-radius: var(--stx-radius);
      padding: 1.25rem 1rem;
      overflow: hidden;

      &__title {
        font-size: 0.875rem;
        font-weight: 600;
        margin: 0 0 1rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--stx-text-muted);
      }

      &__empty {
        color: var(--stx-text-muted);
        font-size: 0.875rem;
        margin: 0;
      }

      &__table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.8125rem;

        thead th {
          text-align: left;
          color: var(--stx-text-muted);
          font-weight: 500;
          padding: 0.25rem 0.5rem;
          border-bottom: 1px solid var(--stx-border);
          white-space: nowrap;
        }

        tbody tr:hover { background: var(--stx-surface-2); }

        td {
          padding: 0.4rem 0.5rem;
          border-bottom: 1px solid color-mix(in srgb, var(--stx-border) 50%, transparent);
        }

        .rank { color: var(--stx-text-muted); width: 1.5rem; }
        .supplier { max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .num { text-align: right; font-variant-numeric: tabular-nums; }
      }
    }
  `],
})
export class TopSuppliers {
  readonly stats = inject(StatsService);
}
