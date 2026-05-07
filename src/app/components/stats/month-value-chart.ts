import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  inject,
} from '@angular/core';
import {
  Chart,
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
} from 'chart.js';
import { StatsService } from '../../services/stats.service';

Chart.register(
  BarController, BarElement,
  LineController, LineElement, PointElement,
  CategoryScale, LinearScale,
  Tooltip, Legend,
);

@Component({
  selector: 'app-month-value-chart',
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mv-chart">
      <h3 class="mv-chart__title">Volume financeiro por mês</h3>
      <div class="mv-chart__wrap">
        <canvas #canvas role="img" aria-label="Gráfico de volume financeiro mensal por tipo de fatura"></canvas>
      </div>
    </div>
  `,
  styles: [`
    .mv-chart {
      background: var(--stx-surface);
      border: 1px solid var(--stx-border);
      border-radius: var(--stx-radius);
      padding: 1.25rem 1rem;

      &__title {
        font-size: 0.875rem;
        font-weight: 600;
        margin: 0 0 1rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--stx-text-muted);
      }

      &__wrap {
        position: relative;
        height: 220px;
      }
    }
  `],
})
export class MonthValueChart implements AfterViewInit, OnDestroy {
  @ViewChild('canvas') private canvasRef!: ElementRef<HTMLCanvasElement>;

  readonly #stats = inject(StatsService);
  #chart: Chart | null = null;

  readonly #data = computed(() => this.#stats.valueByMonth());

  readonly #syncEffect = effect(() => {
    const buckets = this.#data();
    if (!this.#chart) return;
    this.#chart.data.labels = buckets.map(b => b.label);
    this.#chart.data.datasets[0].data = buckets.map(b => b.suppliers);
    this.#chart.data.datasets[1].data = buckets.map(b => b.sales);
    this.#chart.update('active');
  });

  ngAfterViewInit(): void {
    const buckets = this.#data();
    this.#chart = new Chart(this.canvasRef.nativeElement, {
      type: 'bar',
      data: {
        labels: buckets.map(b => b.label),
        datasets: [
          {
            label: 'Fornecedores',
            data: buckets.map(b => b.suppliers),
            backgroundColor: 'rgba(124, 77, 255, 0.7)',
            borderColor: 'rgba(124, 77, 255, 1)',
            borderWidth: 1,
            borderRadius: 4,
          },
          {
            label: 'Vendas',
            data: buckets.map(b => b.sales),
            backgroundColor: 'rgba(0, 200, 150, 0.7)',
            borderColor: 'rgba(0, 200, 150, 1)',
            borderWidth: 1,
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            labels: { boxWidth: 12, font: { size: 11 } },
          },
          tooltip: {
            callbacks: {
              label: ctx => ` ${ctx.dataset.label}: ${(ctx.parsed.y as number).toLocaleString('pt-PT', { minimumFractionDigits: 2 })} €`,
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 11 } } },
          y: {
            beginAtZero: true,
            ticks: {
              font: { size: 11 },
              callback: v => `${(v as number).toLocaleString('pt-PT')} €`,
            },
          },
        },
      },
    });
  }

  ngOnDestroy(): void {
    this.#chart?.destroy();
    this.#chart = null;
  }
}
