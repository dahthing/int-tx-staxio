import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  TemplateRef,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { LayoutService } from '../../services/layout.service';
import { QueueService } from '../../services/queue.service';
import { InboxList } from '../inbox-list/inbox-list';
import { LogViewer } from '../log-viewer/log-viewer';
import { MetadataForm } from '../metadata-form/metadata-form';
import { QueueEntry, ProcessingStatus } from '../../models/queue-entry.model';
import { StatsCards } from '../stats/stats-cards';
import { MonthChart } from '../stats/month-chart';
import { MonthValueChart } from '../stats/month-value-chart';
import { TopSuppliers } from '../stats/top-suppliers';
import { BankService } from '../../services/bank.service';
import { FinanceWidget } from './finance-widget/finance-widget';

@Component({
  selector: 'app-dashboard',
  imports: [
    InboxList,
    LogViewer,
    MetadataForm,
    StatsCards,
    MonthChart,
    MonthValueChart,
    TopSuppliers,
    FinanceWidget,
    MatIconModule,
    MatButtonModule,
    MatSnackBarModule,
  ],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dashboard implements AfterViewInit, OnDestroy {
  @ViewChild('dashboardHeader') private headerTpl!: TemplateRef<unknown>;
  readonly #layout = inject(LayoutService);
  readonly #queue = inject(QueueService);
  readonly #bank = inject(BankService);
  readonly #snackBar = inject(MatSnackBar);

  readonly isMobile = this.#layout.isMobile;

  readonly entries = this.#queue.entries;
  readonly logs = this.#queue.logs;
  readonly loading = this.#queue.loading;
  readonly error = this.#queue.error;
  readonly pendingCount = this.#queue.pendingCount;
  readonly errorCount = this.#queue.errorCount;
  readonly doneCount = this.#queue.doneCount;

  ngAfterViewInit(): void {
    this.#layout.headerTemplate.set(this.headerTpl);
    void this.#bank.loadAll();
  }

  ngOnDestroy(): void {
    this.#layout.headerTemplate.set(null);
  }

  readonly #actionBusy = signal(false);
  readonly actionBusy = this.#actionBusy.asReadonly();

  readonly #logDrawerOpen = signal(false);
  readonly logDrawerOpen = this.#logDrawerOpen.asReadonly();
  toggleLogDrawer(): void { this.#logDrawerOpen.update(v => !v); }

  readonly #editDrawerOpen = signal(false);
  readonly editDrawerOpen = this.#editDrawerOpen.asReadonly();

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

  onReprocess(queueId: string): void {
    if (!confirm('Reprocessar este documento com IA?')) return;
    this.#actionBusy.set(true);
    this.#queue.reprocess(queueId).subscribe({
      next: r => {
        this.#actionBusy.set(false);
        this.#toast(`Reprocessado → ${r.doc_type} / ${r.dest_path}`, 'success');
      },
      error: (err: Error) => {
        this.#actionBusy.set(false);
        this.#toast(err.message ?? 'Erro ao reprocessar', 'error');
      },
    });
  }

  onEdit(entry: QueueEntry): void {
    this.#editingEntry.set(entry);
    this.#editDrawerOpen.set(true);
  }

  onEditSaved(): void {
    this.#editDrawerOpen.set(false);
    setTimeout(() => this.#editingEntry.set(null), 300);
    void this.#queue.loadAll();
    this.#toast('Metadados guardados', 'success');
  }

  onEditCancelled(): void {
    this.#editDrawerOpen.set(false);
    setTimeout(() => this.#editingEntry.set(null), 300);
  }

  exportMonthCSV(): void {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;

    const rows = this.entries()
      .filter(e => {
        if (!e.doc_date) return false;
        const [ey, em] = e.doc_date.split('-').map(Number);
        return ey === y && em === m;
      })
      .sort((a, b) => (a.doc_date ?? '').localeCompare(b.doc_date ?? ''));

    const headers = ['Data','Fornecedor','NIF','Tipo','Valor','IVA','Taxa IVA','Pago','Data Pagamento','Ficheiro'];
    const csvRows = rows.map(e => [
      e.doc_date ?? '',
      e.supplier ?? '',
      e.nif ?? '',
      e.doc_type ?? '',
      e.value?.toFixed(2) ?? '',
      e.vat_amount?.toFixed(2) ?? '',
      e.vat_rate ? `${e.vat_rate}%` : '',
      e.is_paid ? 'Sim' : 'Não',
      e.payment_date ?? '',
      e.file_name,
    ]);

    const csv = [headers, ...csvRows]
      .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';'))
      .join('\n');

    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `staxio_${y}-${String(m).padStart(2, '0')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
