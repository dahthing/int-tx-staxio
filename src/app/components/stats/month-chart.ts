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
import { Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip } from 'chart.js';
import { StatsService } from '../../services/stats.service';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

@Component({
  selector: 'app-month-chart',
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="month-chart">
      <h3 class="month-chart__title">Documentos por mês</h3>
      <div class="month-chart__wrap">
        <canvas #canvas role="img" aria-label="Gráfico de documentos processados por mês"></canvas>
      </div>
    </div>
  `,
  styles: [`
    .month-chart {
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
        height: 200px;
      }
    }
  `],
})
export class MonthChart implements AfterViewInit, OnDestroy {
  @ViewChild('canvas') private canvasRef!: ElementRef<HTMLCanvasElement>;

  readonly #stats = inject(StatsService);
  #chart: Chart | null = null;

  readonly #data = computed(() => this.#stats.byMonth());

  readonly #syncEffect = effect(() => {
    const buckets = this.#data();
    if (!this.#chart) return;
    this.#chart.data.labels = buckets.map(b => b.label);
    this.#chart.data.datasets[0].data = buckets.map(b => b.count);
    this.#chart.update('active');
  });

  ngAfterViewInit(): void {
    const buckets = this.#data();
    this.#chart = new Chart(this.canvasRef.nativeElement, {
      type: 'bar',
      data: {
        labels: buckets.map(b => b.label),
        datasets: [{
          label: 'Documentos',
          data: buckets.map(b => b.count),
          backgroundColor: 'rgba(124, 77, 255, 0.7)',
          borderColor: 'rgba(124, 77, 255, 1)',
          borderWidth: 1,
          borderRadius: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { mode: 'index' } },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { color: '#9ca3af', font: { size: 11 } } },
          y: { grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { color: '#9ca3af', precision: 0 } },
        },
      },
    });
  }

  ngOnDestroy(): void {
    this.#chart?.destroy();
  }
}
