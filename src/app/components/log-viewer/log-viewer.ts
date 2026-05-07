import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProcessingLog, LogAction } from '../../models/processing-log.model';

@Component({
  selector: 'app-log-viewer',
  imports: [DatePipe, FormsModule],
  templateUrl: './log-viewer.html',
  styleUrl: './log-viewer.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LogViewer {
  readonly logs = input.required<ProcessingLog[]>();

  readonly filterAction = signal<LogAction | ''>('');
  readonly filterDate = signal('');
  readonly filterSupplier = signal('');

  readonly actionLabel: Record<LogAction, string> = {
    classify: 'Classificar',
    move: 'Mover',
    manual_edit: 'Edição manual',
    error: 'Erro',
  };

  readonly filtered = computed(() => {
    let list = this.logs();
    const action = this.filterAction();
    const date = this.filterDate();
    const supplier = this.filterSupplier().toLowerCase().trim();

    if (action) list = list.filter(l => l.action === action);
    if (date) list = list.filter(l => l.created_at?.startsWith(date));
    if (supplier) list = list.filter(l => l.file_name?.toLowerCase().includes(supplier));

    return list;
  });

  readonly actions: { value: LogAction | ''; label: string }[] = [
    { value: '', label: 'Todas as ações' },
    { value: 'classify', label: 'Classificar' },
    { value: 'move', label: 'Mover' },
    { value: 'manual_edit', label: 'Edição manual' },
    { value: 'error', label: 'Erro' },
  ];

  exportCsv(): void {
    const rows = this.filtered();
    const header = 'data,ação,ficheiro,destino,erro';
    const lines = rows.map(l => [
      l.created_at ?? '',
      l.action,
      `"${(l.file_name ?? '').replace(/"/g, '""')}"`,
      `"${(l.dest_path ?? '').replace(/"/g, '""')}"`,
      `"${(l.error_message ?? '').replace(/"/g, '""')}"`,
    ].join(','));
    const csv = [header, ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `staxio-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  clearFilters(): void {
    this.filterAction.set('');
    this.filterDate.set('');
    this.filterSupplier.set('');
  }
}
