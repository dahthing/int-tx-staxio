import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { QueueEntry, ProcessingStatus } from '../../models/queue-entry.model';

@Component({
  selector: 'app-inbox-list',
  imports: [DatePipe, DecimalPipe],
  templateUrl: './inbox-list.html',
  styleUrl: './inbox-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InboxList {
  readonly entries = input.required<QueueEntry[]>();
  readonly move = output<string>();
  readonly statusChange = output<{ id: string; status: ProcessingStatus }>();
  readonly edit = output<QueueEntry>();

  readonly statusLabel: Record<ProcessingStatus, string> = {
    pending: 'Pendente',
    processing: 'A processar',
    done: 'Concluído',
    error: 'Erro',
    manual_review: 'Revisão manual',
  };
}
