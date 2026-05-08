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
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { HttpClient } from '@angular/common/http';
import { LayoutService } from '../../services/layout.service';
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
  readonly #sanitizer = inject(DomSanitizer);
  readonly #layout = inject(LayoutService);
  readonly isMobile = this.#layout.isMobile;

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
  readonly #filterDocType = signal('');
  readonly #filterYear = signal('');
  readonly #filterValueMin = signal('');
  readonly #filterValueMax = signal('');

  readonly filterSupplier = this.#filterSupplier.asReadonly();
  readonly filterMonth = this.#filterMonth.asReadonly();
  readonly filterDocType = this.#filterDocType.asReadonly();
  readonly filterYear = this.#filterYear.asReadonly();
  readonly filterValueMin = this.#filterValueMin.asReadonly();
  readonly filterValueMax = this.#filterValueMax.asReadonly();

  readonly availableYears = computed(() => {
    const years = new Set(
      this.#entries()
        .map(e => e.doc_date?.slice(0, 4))
        .filter((y): y is string => !!y)
    );
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  });

  readonly #selectedId = signal<string | null>(null);
  readonly selectedId = this.#selectedId.asReadonly();

  readonly previewUrl = computed<SafeResourceUrl | null>(() => {
    const id = this.#selectedId();
    if (!id) return null;
    const entry = this.#entries().find(e => e.id === id);
    if (!entry?.file_id) return null;
    return this.#sanitizer.bypassSecurityTrustResourceUrl(
      `https://drive.google.com/file/d/${entry.file_id}/preview`
    );
  });

  readonly driveViewerUrl = computed<string | null>(() => {
    const id = this.#selectedId();
    if (!id) return null;
    const entry = this.#entries().find(e => e.id === id);
    return entry?.file_id ? `https://drive.google.com/file/d/${entry.file_id}/view` : null;
  });

  readonly selectedEntry = computed<QueueEntry | null>(() => {
    const id = this.#selectedId();
    return id ? (this.#entries().find(e => e.id === id) ?? null) : null;
  });

  readonly filteredEntries = computed(() => {
    const sup = this.#filterSupplier().toLowerCase().trim();
    const month = this.#filterMonth();
    const docType = this.#filterDocType();
    const year = this.#filterYear();
    const vMin = this.#filterValueMin() ? parseFloat(this.#filterValueMin()) : null;
    const vMax = this.#filterValueMax() ? parseFloat(this.#filterValueMax()) : null;
    return this.#entries().filter(e => {
      if (sup && !(e.supplier ?? '').toLowerCase().includes(sup)) return false;
      if (month && !(e.doc_date ?? '').startsWith(month)) return false;
      if (docType && e.doc_type !== docType) return false;
      if (year && !(e.doc_date ?? '').startsWith(year)) return false;
      if (vMin != null && (e.value ?? 0) < vMin) return false;
      if (vMax != null && (e.value ?? 0) > vMax) return false;
      return true;
    });
  });

  onSelectEntry(entry: QueueEntry): void {
    this.#selectedId.update(id => id === entry.id ? null : entry.id);
  }

  async ngOnInit(): Promise<void> {
    const { data } = await this.#supabase
      .from('app_config')
      .select('value')
      .eq('key', 'drive_root_folder_id')
      .single();
    if (data?.value) this.#rootFolderId.set(data.value);
    await this.#loadDone();
  }

  setSupplierFilter(v: string): void { this.#filterSupplier.set(v); }
  setMonthFilter(v: string): void { this.#filterMonth.set(v); }
  setDocTypeFilter(v: string): void { this.#filterDocType.set(v); }
  setYearFilter(v: string): void { this.#filterYear.set(v); this.#filterMonth.set(''); }
  setValueMinFilter(v: string): void { this.#filterValueMin.set(v); }
  setValueMaxFilter(v: string): void { this.#filterValueMax.set(v); }

  clearFilters(): void {
    this.#filterSupplier.set('');
    this.#filterMonth.set('');
    this.#filterDocType.set('');
    this.#filterYear.set('');
    this.#filterValueMin.set('');
    this.#filterValueMax.set('');
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
