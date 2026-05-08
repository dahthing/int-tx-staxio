import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
  computed,
} from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { DatePipe, DecimalPipe, SlicePipe } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { QueueService } from '../../services/queue.service';
import { QueueEntry, ProcessingStatus } from '../../models/queue-entry.model';
import { SUPABASE_CLIENT } from '../../core/supabase.client';
import { DriveFolderPicker } from '../drive-folder-picker/drive-folder-picker';

@Component({
  selector: 'app-manual-review',
  imports: [
    ReactiveFormsModule,
    DatePipe,
    DecimalPipe,
    SlicePipe,
    MatIconModule,
    MatButtonModule,
    MatSnackBarModule,
    DriveFolderPicker,
  ],
  templateUrl: './manual-review.html',
  styleUrl: './manual-review.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ManualReview implements OnInit {
  readonly #queue = inject(QueueService);
  readonly #supabase = inject(SUPABASE_CLIENT);
  readonly #fb = inject(FormBuilder);
  readonly #snackBar = inject(MatSnackBar);
  readonly #sanitizer = inject(DomSanitizer);

  readonly #actionBusy = signal(false);
  readonly actionBusy = this.#actionBusy.asReadonly();

  readonly #expandedId = signal<string | null>(null);
  readonly expandedId = this.#expandedId.asReadonly();

  readonly #pickerOpen = signal(false);
  readonly pickerOpen = this.#pickerOpen.asReadonly();

  readonly #rootFolderId = signal('');

  readonly previewUrl = computed<SafeResourceUrl | null>(() => {
    const id = this.#expandedId();
    if (!id) return null;
    const entry = this.#queue.entries().find(e => e.id === id);
    if (!entry) return null;
    return this.#sanitizer.bypassSecurityTrustResourceUrl(
      `https://drive.google.com/file/d/${entry.file_id}/preview`
    );
  });

  readonly items = computed(() =>
    this.#queue.entries().filter(
      e => e.status === 'error' || e.status === 'manual_review' ||
           (e.status === 'pending' && e.doc_type === 'unknown')
    )
  );

  readonly rootFolderId = this.#rootFolderId.asReadonly();

  readonly form = this.#fb.nonNullable.group({
    supplier:           ['' as string | null],
    doc_date:           ['' as string | null],
    value:              [null as number | null],
    nif:                ['' as string | null],
    country:            ['' as string | null],
    dest_path:          ['' as string | null, Validators.required],
    dest_file_name:     ['' as string | null, Validators.required],
    dest_root_folder_id:['' as string | null],
    is_my_doc:          [false],
    my_doc_kind:        ['' as string],
  });

  readonly statusLabel: Record<ProcessingStatus, string> = {
    pending:       'Pendente',
    processing:    'A processar',
    done:          'Concluído',
    error:         'Erro',
    manual_review: 'Revisão manual',
  };

  async ngOnInit(): Promise<void> {
    if (this.#queue.entries().length === 0) {
      await this.#queue.loadAll();
    }
    const { data } = await this.#supabase
      .from('app_config')
      .select('value')
      .eq('key', 'drive_root_folder_id')
      .single();
    if (data?.value) this.#rootFolderId.set(data.value);
  }

  toggleExpand(entry: QueueEntry): void {
    if (this.#expandedId() === entry.id) {
      this.#expandedId.set(null);
      return;
    }
    this.#expandedId.set(entry.id);
    const myDocTypes = ['invoice_issued', 'receipt_issued', 'quote_issued'];
    this.form.setValue({
      supplier:           entry.supplier ?? '',
      doc_date:           entry.doc_date ?? '',
      value:              entry.value,
      nif:                entry.nif ?? '',
      country:            entry.country ?? '',
      dest_path:          entry.dest_path ?? '',
      dest_file_name:     entry.dest_file_name ?? '',
      dest_root_folder_id:entry.dest_root_folder_id ?? '',
      is_my_doc:          entry.is_my_doc ?? false,
      my_doc_kind:        entry.doc_type && myDocTypes.includes(entry.doc_type) ? entry.doc_type : '',
    });
  }

  async onApprove(entry: QueueEntry): Promise<void> {
    if (this.form.invalid) return;
    this.#actionBusy.set(true);

    const raw = this.form.getRawValue();
    const isMyDoc = raw.is_my_doc === true;
    const myDocKind = raw.my_doc_kind || null;
    const docType = isMyDoc && myDocKind ? myDocKind : undefined;

    const patch: Record<string, unknown> = {
      supplier:           raw.supplier || null,
      doc_date:           raw.doc_date || null,
      value:              raw.value,
      nif:                raw.nif || null,
      country:            raw.country || null,
      dest_path:          raw.dest_path || null,
      dest_file_name:     raw.dest_file_name || null,
      dest_root_folder_id:raw.dest_root_folder_id || null,
      status:             'pending' as ProcessingStatus,
      error_message:      null,
      is_my_doc:          isMyDoc,
    };
    if (docType) patch['doc_type'] = docType;

    const { error } = await this.#supabase
      .from('processing_queue')
      .update(patch)
      .eq('id', entry.id);

    if (error) {
      this.#toast(error.message, 'error');
      this.#actionBusy.set(false);
      return;
    }

    await this.#supabase.from('processing_logs').insert({
      queue_id: entry.id, file_id: entry.file_id, file_name: entry.file_name,
      action: 'manual_edit', status: 'success', metadata: patch,
    });

    if (isMyDoc) {
      await this.#supabase.from('training_examples').insert({
        file_id:     entry.file_id,
        file_name:   entry.file_name,
        doc_type:    docType ?? entry.doc_type ?? 'invoice_issued',
        is_my_doc:   true,
        my_doc_kind: myDocKind,
        supplier:    raw.supplier || null,
        nif:         raw.nif || null,
      });
    }

    // Chama /move para este item específico
    this.#queue.triggerMove(entry.id).subscribe({
      next: r => {
        this.#actionBusy.set(false);
        this.#expandedId.set(null);
        void this.#queue.loadAll();
        this.#toast(r.moved > 0 ? 'Documento aprovado e movido' : 'Aprovado — movimento agendado', 'success');
      },
      error: (err: Error) => {
        this.#actionBusy.set(false);
        this.#toast(err.message, 'error');
      },
    });
  }

  async onIgnore(entry: QueueEntry): Promise<void> {
    this.#actionBusy.set(true);
    const { error } = await this.#supabase
      .from('processing_queue')
      .update({ status: 'done', error_message: null })
      .eq('id', entry.id);

    if (error) {
      this.#toast(error.message, 'error');
    } else {
      await this.#supabase.from('processing_logs').insert({
        queue_id: entry.id, file_id: entry.file_id, file_name: entry.file_name,
        action: 'manual_edit', status: 'success',
        metadata: { ignored: true },
      });
      this.#expandedId.set(null);
      void this.#queue.loadAll();
      this.#toast('Documento ignorado', 'info');
    }
    this.#actionBusy.set(false);
  }

  openPicker(): void {
    this.#pickerOpen.set(true);
  }

  onFolderSelected(event: { id: string; path: string }): void {
    this.form.patchValue({
      dest_path: event.path,
      dest_root_folder_id: event.id,
    });
    this.#pickerOpen.set(false);
  }

  closePicker(): void {
    this.#pickerOpen.set(false);
  }

  #toast(msg: string, type: 'success' | 'error' | 'info'): void {
    this.#snackBar.open(msg, '✕', {
      duration: 4000,
      panelClass: [`toast--${type}`],
      horizontalPosition: 'end',
      verticalPosition: 'bottom',
    });
  }

  async onDelete(entry: QueueEntry): Promise<void> {
    if (!confirm(`Apagar "${entry.file_name}" da fila? O ficheiro continua no Drive e pode ser reimportado.`)) return;
    this.#actionBusy.set(true);
    const { error } = await this.#supabase
      .from('processing_queue')
      .delete()
      .eq('id', entry.id);
    if (error) {
      this.#toast(error.message, 'error');
    } else {
      this.#expandedId.set(null);
      void this.#queue.loadAll();
      this.#toast('Registo apagado — o ficheiro pode ser reimportado', 'info');
    }
    this.#actionBusy.set(false);
  }
}
