import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { QueueService } from '../../services/queue.service';
import { InboxList } from '../inbox-list/inbox-list';
import { LogViewer } from '../log-viewer/log-viewer';
import { MetadataForm } from '../metadata-form/metadata-form';
import { QueueEntry, ProcessingStatus } from '../../models/queue-entry.model';
import { StatsCards } from '../stats/stats-cards';
import { MonthChart } from '../stats/month-chart';
import { TopSuppliers } from '../stats/top-suppliers';

@Component({
  selector: 'app-dashboard',
  imports: [
    InboxList,
    LogViewer,
    MetadataForm,
    StatsCards,
    MonthChart,
    TopSuppliers,
    MatIconModule,
    MatButtonModule,
    MatSnackBarModule,
  ],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dashboard {
  readonly #queue = inject(QueueService);
  readonly #snackBar = inject(MatSnackBar);

  readonly entries = this.#queue.entries;
  readonly logs = this.#queue.logs;
  readonly loading = this.#queue.loading;
  readonly error = this.#queue.error;
  readonly pendingCount = this.#queue.pendingCount;
  readonly errorCount = this.#queue.errorCount;
  readonly doneCount = this.#queue.doneCount;

  readonly #actionBusy = signal(false);
  readonly actionBusy = this.#actionBusy.asReadonly();

  readonly #editingEntry = signal<QueueEntry | null>(null);
  readonly editingEntry = this.#editingEntry.asReadonly();

  #toast(msg: string, type: 'success' | 'error' | 'info' = 'info'): void {
    this.#snackBar.open(msg, '✕', {
      duration: 4000,
      panelClass: [`toast--${type}`],
      horizontalPosition: 'end',
      verticalPosition: 'bottom',
    });
  }

  onClassify(): void {
    this.#actionBusy.set(true);
    this.#queue.triggerClassify().subscribe({
      next: r => {
        this.#actionBusy.set(false);
        this.#toast(r.queued > 0 ? `${r.queued} documento(s) adicionado(s) à fila` : 'Inbox vazia', 'info');
      },
      error: (err: Error) => {
        this.#actionBusy.set(false);
        this.#toast(err.message, 'error');
      },
    });
  }

  onMoveAll(): void {
    this.#actionBusy.set(true);
    this.#queue.triggerMove().subscribe({
      next: r => {
        this.#actionBusy.set(false);
        this.#toast(`${r.moved} documento(s) movido(s)`, r.moved > 0 ? 'success' : 'info');
      },
      error: (err: Error) => {
        this.#actionBusy.set(false);
        this.#toast(err.message, 'error');
      },
    });
  }

  onMoveOne(queueId: string): void {
    this.#actionBusy.set(true);
    this.#queue.triggerMove(queueId).subscribe({
      next: () => {
        this.#actionBusy.set(false);
        this.#toast('Documento movido', 'success');
      },
      error: (err: Error) => {
        this.#actionBusy.set(false);
        this.#toast(err.message, 'error');
      },
    });
  }

  async onStatusChange(event: { id: string; status: ProcessingStatus }): Promise<void> {
    try {
      await this.#queue.updateStatus(event.id, event.status);
      this.#toast('Estado actualizado', 'success');
    } catch (err) {
      this.#toast(err instanceof Error ? err.message : 'Erro desconhecido', 'error');
    }
  }

  onEdit(entry: QueueEntry): void {
    this.#editingEntry.set(entry);
  }

  onEditSaved(): void {
    this.#editingEntry.set(null);
    void this.#queue.loadAll();
    this.#toast('Metadados guardados', 'success');
  }

  onEditCancelled(): void {
    this.#editingEntry.set(null);
  }
}
