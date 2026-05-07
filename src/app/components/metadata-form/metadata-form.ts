import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { SUPABASE_CLIENT } from '../../core/supabase.client';
import { QueueEntry } from '../../models/queue-entry.model';

export interface MetadataFormValue {
  supplier: string | null;
  doc_date: string | null;
  value: number | null;
  nif: string | null;
  dest_path: string | null;
  dest_file_name: string | null;
}

@Component({
  selector: 'app-metadata-form',
  imports: [ReactiveFormsModule],
  templateUrl: './metadata-form.html',
  styleUrl: './metadata-form.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MetadataForm implements OnInit {
  readonly entry = input.required<QueueEntry>();
  readonly saved = output<void>();
  readonly cancelled = output<void>();

  readonly #supabase = inject(SUPABASE_CLIENT);
  readonly #fb = inject(FormBuilder);

  readonly #saving = signal(false);
  readonly #error = signal<string | null>(null);
  readonly saving = this.#saving.asReadonly();
  readonly error = this.#error.asReadonly();

  readonly form = this.#fb.nonNullable.group({
    supplier:      ['' as string | null],
    doc_date:      ['' as string | null],
    value:         [null as number | null],
    nif:           ['' as string | null],
    dest_path:     ['' as string | null, Validators.required],
    dest_file_name:['' as string | null, Validators.required],
  });

  ngOnInit(): void {
    const e = this.entry();
    this.form.setValue({
      supplier:      e.supplier ?? '',
      doc_date:      e.doc_date ?? '',
      value:         e.value,
      nif:           e.nif ?? '',
      dest_path:     e.dest_path ?? '',
      dest_file_name:e.dest_file_name ?? '',
    });
  }

  async onSubmit(): Promise<void> {
    if (this.form.invalid) return;

    this.#saving.set(true);
    this.#error.set(null);

    const raw = this.form.getRawValue();
    const patch: MetadataFormValue = {
      supplier:      raw.supplier || null,
      doc_date:      raw.doc_date || null,
      value:         raw.value,
      nif:           raw.nif || null,
      dest_path:     raw.dest_path || null,
      dest_file_name:raw.dest_file_name || null,
    };

    const { error } = await this.#supabase
      .from('processing_queue')
      .update({ ...patch, status: 'pending' })
      .eq('id', this.entry().id);

    if (error) {
      this.#error.set(error.message);
      this.#saving.set(false);
      return;
    }

    await this.#supabase.from('processing_logs').insert({
      queue_id:  this.entry().id,
      file_id:   this.entry().file_id,
      file_name: this.entry().file_name,
      action:    'manual_edit',
      status:    'success',
      metadata:  patch,
    });

    this.#saving.set(false);
    this.saved.emit();
  }
}
