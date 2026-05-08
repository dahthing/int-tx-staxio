import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { SUPABASE_CLIENT } from '../../core/supabase.client';
import { QueueEntry } from '../../models/queue-entry.model';
import { environment } from '../../../environments/environment';
import { DriveFolderPicker } from '../drive-folder-picker/drive-folder-picker';

@Component({
  selector: 'app-done-list',
  imports: [
    FormsModule,
    DatePipe,
    DecimalPipe,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    MatSnackBarModule,
    DriveFolderPicker,
  ],
  templateUrl: './done-list.html',
  styleUrl: './done-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DoneList implements OnInit {
  readonly #supabase = inject(SUPABASE_CLIENT);
  readonly #http = inject(HttpClient);
  readonly #snackBar = inject(MatSnackBar);

  readonly #entries = signal<QueueEntry[]>([]);
  readonly entries = this.#entries.asReadonly();

  readonly #loading = signal(false);
  readonly loading = this.#loading.asReadonly();

  readonly #movingId = signal<string | null>(null);
  readonly movingId = this.#movingId.asReadonly();

  readonly #pickerEntry = signal<QueueEntry | null>(null);
  readonly pickerEntry = this.#pickerEntry.asReadonly();

  readonly #rootFolderId = signal('');
  readonly rootFolderId = this.#rootFolderId.asReadonly();

  readonly #filterSupplier = signal('');
  readonly #filterMonth = signal('');

  readonly filterSupplier = this.#filterSupplier.asReadonly();
  readonly filterMonth = this.#filterMonth.asReadonly();

  readonly filteredEntries = computed(() => {
    const sup = this.#filterSupplier().toLowerCase().trim();
    const month = this.#filterMonth();
    return this.#entries().filter(e => {
      if (sup && !(e.supplier ?? '').toLowerCase().includes(sup)) return false;
      if (month && !(e.doc_date ?? '').startsWith(month)) return false;
      return true;
    });
  });

  async ngOnInit(): Promise<void> {
    const { data } = await this.#supabase
      .from('app_config')
      .select('value')
      .eq('key', 'drive_root_folder_id')
      .single();
    if (data?.value) this.#rootFolderId.set(data.value);
    await this.#loadDone();
  }

  setSupplierFilter(v: string): void {
    this.#filterSupplier.set(v);
  }

  setMonthFilter(v: string): void {
    this.#filterMonth.set(v);
  }

  onMoveFolder(entry: QueueEntry): void {
    this.#pickerEntry.set(entry);
  }

  onPickerCancelled(): void {
    this.#pickerEntry.set(null);
  }

  onFolderSelected(selection: { id: string; path: string }): void {
    const entry = this.#pickerEntry();
    if (!entry) return;
    this.#pickerEntry.set(null);
    this.#movingId.set(entry.id);

    this.#http
      .post<{ moved: number }>(`${environment.edgeFunctionsUrl}/move-existing`, {
        queue_id: entry.id,
        new_folder_id: selection.id,
        new_folder_path: selection.path,
      })
      .subscribe({
        next: () => {
          this.#movingId.set(null);
          this.#toast('Ficheiro movido com sucesso', 'success');
          void this.#loadDone();
        },
        error: (err: Error) => {
          this.#movingId.set(null);
          this.#toast(err.message ?? 'Erro ao mover ficheiro', 'error');
        },
      });
  }

  async #loadDone(): Promise<void> {
    this.#loading.set(true);

    const { data, error } = await this.#supabase
      .from('processing_queue')
      .select('*')
      .eq('status', 'done')
      .order('updated_at', { ascending: false })
      .limit(200);

    this.#loading.set(false);

    if (error) {
      this.#toast(error.message, 'error');
      return;
    }

    this.#entries.set((data ?? []) as QueueEntry[]);
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
