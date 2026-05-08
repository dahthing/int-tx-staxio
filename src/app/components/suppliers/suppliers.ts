import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { SUPABASE_CLIENT } from '../../core/supabase.client';

export interface Supplier {
  id: string;
  name: string;
  nif: string | null;
  keywords: string[];
  type: 'ecommerce' | 'normal' | 'bank' | 'supplies';
  auto_detected: boolean;
  active: boolean;
}

const TYPE_LABEL: Record<Supplier['type'], string> = {
  normal:    'Normal',
  ecommerce: 'eCommerce',
  bank:      'Banco',
  supplies:  'Compras / MP',
};

@Component({
  selector: 'app-suppliers',
  imports: [
    ReactiveFormsModule,
    MatIconModule,
    MatButtonModule,
    MatSlideToggleModule,
    MatSnackBarModule,
  ],
  templateUrl: './suppliers.html',
  styleUrl: './suppliers.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Suppliers implements OnInit {
  readonly #supabase = inject(SUPABASE_CLIENT);
  readonly #fb = inject(FormBuilder);
  readonly #snackBar = inject(MatSnackBar);

  readonly #suppliers = signal<Supplier[]>([]);
  readonly #loading = signal(true);
  readonly #newVisible = signal(false);
  readonly #filter = signal('');

  readonly suppliers = this.#suppliers.asReadonly();
  readonly loading = this.#loading.asReadonly();
  readonly newVisible = this.#newVisible.asReadonly();
  readonly filter = this.#filter.asReadonly();

  readonly typeLabel = TYPE_LABEL;

  readonly filtered = computed(() => {
    const q = this.#filter().toLowerCase().trim();
    if (!q) return this.#suppliers();
    return this.#suppliers().filter(s =>
      s.name.toLowerCase().includes(q) ||
      (s.nif ?? '').includes(q) ||
      s.keywords.some(k => k.includes(q))
    );
  });

  readonly counts = computed(() => ({
    total:    this.#suppliers().length,
    active:   this.#suppliers().filter(s => s.active).length,
    auto:     this.#suppliers().filter(s => s.auto_detected).length,
  }));

  readonly newForm = this.#fb.nonNullable.group({
    name:     ['', Validators.required],
    nif:      ['' as string],
    keywords: ['', Validators.required],
    type:     ['normal' as Supplier['type'], Validators.required],
  });

  async ngOnInit(): Promise<void> {
    await this.#load();
  }

  async #load(): Promise<void> {
    this.#loading.set(true);
    const { data, error } = await this.#supabase
      .from('suppliers')
      .select('id, name, nif, keywords, type, auto_detected, active')
      .order('name');
    this.#loading.set(false);
    if (error) { this.#toast(error.message, 'error'); return; }
    this.#suppliers.set((data ?? []) as Supplier[]);
  }

  setFilter(v: string): void { this.#filter.set(v); }

  showNew(): void {
    this.newForm.reset({ name: '', nif: '', keywords: '', type: 'normal' });
    this.#newVisible.set(true);
  }

  cancelNew(): void { this.#newVisible.set(false); }

  async add(): Promise<void> {
    if (this.newForm.invalid) return;
    const raw = this.newForm.getRawValue();
    const keywords = raw.keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
    const { error } = await this.#supabase.from('suppliers').insert({
      name: raw.name, nif: raw.nif || null, keywords, type: raw.type,
      auto_detected: false, active: true,
    });
    if (error) { this.#toast(error.message, 'error'); return; }
    this.#newVisible.set(false);
    this.#toast(`"${raw.name}" adicionado`, 'success');
    await this.#load();
  }

  async toggle(s: Supplier): Promise<void> {
    const active = !s.active;
    const { error } = await this.#supabase.from('suppliers').update({ active }).eq('id', s.id);
    if (error) { this.#toast(error.message, 'error'); return; }
    this.#suppliers.update(list => list.map(x => x.id === s.id ? { ...x, active } : x));
  }

  async saveName(s: Supplier, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed || trimmed === s.name) return;
    const { error } = await this.#supabase.from('suppliers').update({ name: trimmed }).eq('id', s.id);
    if (error) { this.#toast(error.message, 'error'); return; }
    this.#suppliers.update(list => list.map(x => x.id === s.id ? { ...x, name: trimmed } : x));
    this.#toast('Nome actualizado', 'success');
  }

  async saveNif(s: Supplier, nif: string): Promise<void> {
    const trimmed = nif.trim() || null;
    if (trimmed === s.nif) return;
    const { error } = await this.#supabase.from('suppliers').update({ nif: trimmed }).eq('id', s.id);
    if (error) { this.#toast(error.message, 'error'); return; }
    this.#suppliers.update(list => list.map(x => x.id === s.id ? { ...x, nif: trimmed } : x));
    this.#toast('NIF actualizado', 'success');
  }

  async saveKeywords(s: Supplier, raw: string): Promise<void> {
    const keywords = raw.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
    const { error } = await this.#supabase.from('suppliers').update({ keywords }).eq('id', s.id);
    if (error) { this.#toast(error.message, 'error'); return; }
    this.#suppliers.update(list => list.map(x => x.id === s.id ? { ...x, keywords } : x));
    this.#toast('Keywords actualizadas', 'success');
  }

  async saveType(s: Supplier, type: Supplier['type']): Promise<void> {
    const { error } = await this.#supabase.from('suppliers').update({ type }).eq('id', s.id);
    if (error) { this.#toast(error.message, 'error'); return; }
    this.#suppliers.update(list => list.map(x => x.id === s.id ? { ...x, type } : x));
  }

  async delete(s: Supplier): Promise<void> {
    if (!confirm(`Apagar "${s.name}"? Esta acção não pode ser desfeita.`)) return;
    const { error } = await this.#supabase.from('suppliers').delete().eq('id', s.id);
    if (error) { this.#toast(error.message, 'error'); return; }
    this.#suppliers.update(list => list.filter(x => x.id !== s.id));
    this.#toast(`"${s.name}" apagado`, 'success');
  }

  #toast(msg: string, type: 'success' | 'error' | 'info' = 'info'): void {
    this.#snackBar.open(msg, '✕', {
      duration: 4000, panelClass: [`toast--${type}`],
      horizontalPosition: 'end', verticalPosition: 'bottom',
    });
  }
}
