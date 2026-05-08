import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { SUPABASE_CLIENT } from '../../core/supabase.client';

export interface TrainingExample {
  id: string;
  file_id: string;
  file_name: string | null;
  doc_type: string;
  is_my_doc: boolean;
  my_doc_kind: string | null;
  supplier: string | null;
  nif: string | null;
  user_label: string | null;
  notes: string | null;
  created_at: string;
}

const DOC_TYPE_OPTIONS = [
  { value: 'received',        label: 'Fatura recebida' },
  { value: 'invoice_issued',  label: 'Fatura emitida' },
  { value: 'receipt_issued',  label: 'Recibo emitido' },
  { value: 'quote_issued',    label: 'Orçamento emitido' },
  { value: 'ecommerce',       label: 'eCommerce' },
  { value: 'bank_statement',  label: 'Extrato bancário' },
  { value: 'supplies',        label: 'Compras / MP' },
  { value: 'international',   label: 'Internacional' },
  { value: 'unknown',         label: 'Desconhecido' },
];

const MY_DOC_TYPES = new Set(['invoice_issued', 'receipt_issued', 'quote_issued']);

const DOC_TYPE_ICONS: Record<string, string> = {
  received:        'receipt',
  invoice_issued:  'description',
  receipt_issued:  'payments',
  quote_issued:    'request_quote',
  ecommerce:       'shopping_cart',
  bank_statement:  'account_balance',
  supplies:        'inventory',
  international:   'language',
  unknown:         'help_outline',
};

@Component({
  selector: 'app-training',
  imports: [
    FormsModule,
    ReactiveFormsModule,
    DatePipe,
    MatIconModule,
    MatButtonModule,
    MatSnackBarModule,
  ],
  templateUrl: './training.html',
  styleUrl: './training.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Training implements OnInit {
  readonly #supabase = inject(SUPABASE_CLIENT);
  readonly #fb = inject(FormBuilder);
  readonly #snackBar = inject(MatSnackBar);

  readonly docTypeOptions = DOC_TYPE_OPTIONS;
  readonly docTypeIcons = DOC_TYPE_ICONS;

  readonly #examples = signal<TrainingExample[]>([]);
  readonly #loading = signal(false);
  readonly #newFormVisible = signal(false);
  readonly #editingId = signal<string | null>(null);
  readonly #filterMyDoc = signal<'all' | 'mine' | 'suppliers'>('all');
  readonly #filterDocType = signal('');

  readonly examples = this.#examples.asReadonly();
  readonly loading = this.#loading.asReadonly();
  readonly newFormVisible = this.#newFormVisible.asReadonly();
  readonly editingId = this.#editingId.asReadonly();
  readonly filterMyDoc = this.#filterMyDoc.asReadonly();
  readonly filterDocType = this.#filterDocType.asReadonly();

  readonly filteredExamples = computed(() => {
    const myDoc = this.#filterMyDoc();
    const dt = this.#filterDocType();
    return this.#examples().filter(e => {
      if (myDoc === 'mine' && !e.is_my_doc) return false;
      if (myDoc === 'suppliers' && e.is_my_doc) return false;
      if (dt && e.doc_type !== dt) return false;
      return true;
    });
  });

  readonly stats = computed(() => {
    const all = this.#examples();
    const byType: Record<string, number> = {};
    for (const e of all) byType[e.doc_type] = (byType[e.doc_type] ?? 0) + 1;
    return {
      total: all.length,
      mine: all.filter(e => e.is_my_doc).length,
      suppliers: all.filter(e => !e.is_my_doc).length,
      byType,
    };
  });

  readonly newForm = this.#fb.nonNullable.group({
    supplier:    ['', Validators.required],
    nif:         [''],
    doc_type:    ['received', Validators.required],
    is_my_doc:   [false],
    my_doc_kind: [''],
    user_label:  [''],
    notes:       [''],
  });

  readonly #newFormValue = toSignal(this.newForm.valueChanges, { initialValue: this.newForm.value });

  readonly newFormPreview = computed(() => {
    const v = this.#newFormValue();
    const supplier = v.supplier?.trim() || '?';
    const nif = v.nif?.trim() || null;
    const isMyDoc = v.is_my_doc ?? false;
    const docType = v.doc_type || 'received';
    const myDocKind = v.my_doc_kind || docType;
    const kind = isMyDoc ? myDocKind : docType;
    const nifPart = nif ? `, NIF "${nif}"` : '';
    return `- Supplier "${supplier}"${nifPart} → doc_type: ${kind}, is_my_doc: ${isMyDoc}`;
  });

  readonly editForm = this.#fb.nonNullable.group({
    supplier:    ['' as string],
    nif:         ['' as string],
    doc_type:    ['received', Validators.required],
    is_my_doc:   [false],
    my_doc_kind: ['' as string],
    user_label:  ['' as string],
    notes:       ['' as string],
  });

  async ngOnInit(): Promise<void> {
    await this.#load();
  }

  setFilterMyDoc(v: 'all' | 'mine' | 'suppliers'): void {
    this.#filterMyDoc.set(v);
  }

  setFilterDocType(v: string): void {
    this.#filterDocType.set(v);
  }

  setNewDocType(value: string): void {
    this.newForm.patchValue({ doc_type: value });
    if (MY_DOC_TYPES.has(value)) {
      this.newForm.patchValue({ is_my_doc: true, my_doc_kind: value });
    } else {
      this.newForm.patchValue({ is_my_doc: false, my_doc_kind: '' });
    }
  }

  setNewOrigin(isMine: boolean): void {
    this.newForm.patchValue({ is_my_doc: isMine });
    const currentType = this.newForm.value.doc_type ?? '';
    if (isMine && !MY_DOC_TYPES.has(currentType)) {
      this.newForm.patchValue({ doc_type: 'invoice_issued', my_doc_kind: 'invoice_issued' });
    } else if (!isMine && MY_DOC_TYPES.has(currentType)) {
      this.newForm.patchValue({ doc_type: 'received', my_doc_kind: '' });
    }
  }

  showNewForm(): void {
    this.newForm.reset({ supplier: '', nif: '', doc_type: 'received', is_my_doc: false, my_doc_kind: '', user_label: '', notes: '' });
    this.#newFormVisible.set(true);
    this.#editingId.set(null);
  }

  cancelNew(): void {
    this.#newFormVisible.set(false);
  }

  async addExample(): Promise<void> {
    if (this.newForm.invalid) return;
    const raw = this.newForm.getRawValue();
    const isMyDoc = raw.is_my_doc || MY_DOC_TYPES.has(raw.doc_type);
    const { error } = await this.#supabase.from('training_examples').insert({
      file_id:     crypto.randomUUID(),
      file_name:   null,
      doc_type:    raw.doc_type,
      is_my_doc:   isMyDoc,
      my_doc_kind: isMyDoc ? (raw.my_doc_kind || raw.doc_type) : null,
      supplier:    raw.supplier.trim() || null,
      nif:         raw.nif.trim() || null,
      user_label:  raw.user_label.trim() || null,
      notes:       raw.notes.trim() || null,
    });
    if (error) { this.#toast(error.message, 'error'); return; }
    this.#newFormVisible.set(false);
    this.#toast('Exemplo adicionado', 'success');
    await this.#load();
  }

  startEdit(ex: TrainingExample): void {
    this.#editingId.set(ex.id);
    this.#newFormVisible.set(false);
    this.editForm.setValue({
      supplier:    ex.supplier ?? '',
      nif:         ex.nif ?? '',
      doc_type:    ex.doc_type,
      is_my_doc:   ex.is_my_doc,
      my_doc_kind: ex.my_doc_kind ?? '',
      user_label:  ex.user_label ?? '',
      notes:       ex.notes ?? '',
    });
  }

  cancelEdit(): void {
    this.#editingId.set(null);
  }

  async saveEdit(ex: TrainingExample): Promise<void> {
    if (this.editForm.invalid) return;
    const raw = this.editForm.getRawValue();
    const isMyDoc = raw.is_my_doc || MY_DOC_TYPES.has(raw.doc_type);
    const { error } = await this.#supabase
      .from('training_examples')
      .update({
        doc_type:    raw.doc_type,
        is_my_doc:   isMyDoc,
        my_doc_kind: isMyDoc ? (raw.my_doc_kind || raw.doc_type) : null,
        supplier:    raw.supplier.trim() || null,
        nif:         raw.nif.trim() || null,
        user_label:  raw.user_label.trim() || null,
        notes:       raw.notes.trim() || null,
      })
      .eq('id', ex.id);
    if (error) { this.#toast(error.message, 'error'); return; }
    this.#editingId.set(null);
    this.#toast('Exemplo actualizado', 'success');
    await this.#load();
  }

  async deleteExample(ex: TrainingExample): Promise<void> {
    const label = ex.supplier ?? ex.file_name ?? ex.id.slice(0, 8);
    if (!confirm(`Apagar exemplo "${label}"?`)) return;
    const { error } = await this.#supabase
      .from('training_examples')
      .delete()
      .eq('id', ex.id);
    if (error) { this.#toast(error.message, 'error'); return; }
    this.#examples.update(list => list.filter(e => e.id !== ex.id));
    this.#toast('Exemplo apagado', 'success');
  }

  docTypeLabel(value: string): string {
    return DOC_TYPE_OPTIONS.find(o => o.value === value)?.label ?? value;
  }

  isMyDocType(docType: string): boolean {
    return MY_DOC_TYPES.has(docType);
  }

  async #load(): Promise<void> {
    this.#loading.set(true);
    const { data, error } = await this.#supabase
      .from('training_examples')
      .select('id, file_id, file_name, doc_type, is_my_doc, my_doc_kind, supplier, nif, user_label, notes, created_at')
      .order('created_at', { ascending: false });
    this.#loading.set(false);
    if (error) { this.#toast(error.message, 'error'); return; }
    this.#examples.set((data ?? []) as TrainingExample[]);
  }

  #toast(msg: string, type: 'success' | 'error' | 'info' = 'info'): void {
    this.#snackBar.open(msg, '✕', {
      duration: 4000,
      panelClass: [`toast--${type}`],
      horizontalPosition: 'end',
      verticalPosition: 'bottom',
    });
  }
}
