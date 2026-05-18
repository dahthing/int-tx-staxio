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
import { environment } from '../../../environments/environment';
import { DriveFolderPicker } from '../drive-folder-picker/drive-folder-picker';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { LayoutService } from '../../services/layout.service';
import { SUPABASE_CLIENT } from '../../core/supabase.client';
import { QueueEntry } from '../../models/queue-entry.model';
import { QueueService } from '../../services/queue.service';

@Component({
  selector: 'app-archive-list',
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
  templateUrl: './archive-list.html',
  styleUrl: './archive-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArchiveList implements OnInit {
  readonly #supabase = inject(SUPABASE_CLIENT);
  readonly #snackBar = inject(MatSnackBar);
  readonly #http = inject(HttpClient);
  readonly #queue = inject(QueueService);
  readonly #reprocessingId = signal<string | null>(null);
  readonly reprocessingId = this.#reprocessingId.asReadonly();
  readonly #movingId = signal<string | null>(null);
  readonly movingId = this.#movingId.asReadonly();
  readonly #pickerEntry = signal<QueueEntry | null>(null);
  readonly pickerEntry = this.#pickerEntry.asReadonly();
  readonly #rootFolderId = signal('');
  readonly rootFolderId = this.#rootFolderId.asReadonly();
  readonly #sanitizer = inject(DomSanitizer);
  readonly #layout = inject(LayoutService);
  readonly isMobile = this.#layout.isMobile;

  readonly #entries = signal<QueueEntry[]>([]);
  readonly entries = this.#entries.asReadonly();

  readonly #loading = signal(false);
  readonly loading = this.#loading.asReadonly();

  readonly #filterSupplier = signal('');
  readonly #filterMonth = signal('');
  readonly #filterDocType = signal('');
  readonly #filterYear = signal('');

  readonly filterSupplier = this.#filterSupplier.asReadonly();
  readonly filterMonth = this.#filterMonth.asReadonly();
  readonly filterDocType = this.#filterDocType.asReadonly();
  readonly filterYear = this.#filterYear.asReadonly();

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
    return this.#entries().filter(e => {
      if (sup && !(e.supplier ?? '').toLowerCase().includes(sup)) return false;
      if (month && !(e.doc_date ?? '').startsWith(month)) return false;
      if (docType && e.doc_type !== docType) return false;
      if (year && !(e.doc_date ?? '').startsWith(year)) return false;
      return true;
    });
  });

  onSelectEntry(entry: QueueEntry): void {
    this.#selectedId.update(id => id === entry.id ? null : entry.id);
  }

  async ngOnInit(): Promise<void> {
    const { data } = await this.#supabase
      .from('folder_config')
      .select('folder_id')
      .eq('key', 'archive_root')
      .single();
    if (data?.folder_id) this.#rootFolderId.set(data.folder_id);
    await this.#load();
  }

  setSupplierFilter(v: string): void { this.#filterSupplier.set(v); }
  setMonthFilter(v: string): void { this.#filterMonth.set(v); }
  setDocTypeFilter(v: string): void { this.#filterDocType.set(v); }
  setYearFilter(v: string): void { this.#filterYear.set(v); this.#filterMonth.set(''); }

  onReprocess(entry: QueueEntry): void {
    if (!confirm(`Reprocessar "${entry.file_name}"? O documento será reclassificado e movido dentro do arquivo.`)) return;
    this.#reprocessingId.set(entry.id);
    this.#queue.reprocess(entry.id).subscribe({
      next: r => {
        this.#reprocessingId.set(null);
        this.#toast(`Reprocessado → ${r.doc_type} / ${r.dest_path}`, 'success');
        void this.#load();
      },
      error: (err: Error) => {
        this.#reprocessingId.set(null);
        this.#toast(err.message ?? 'Erro ao reprocessar', 'error');
      },
    });
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
          void this.#load();
        },
        error: (err: Error) => {
          this.#movingId.set(null);
          this.#toast(err.message ?? 'Erro ao mover ficheiro', 'error');
        },
      });
  }

  clearFilters(): void {
    this.#filterSupplier.set('');
    this.#filterMonth.set('');
    this.#filterDocType.set('');
    this.#filterYear.set('');
  }

  async #load(): Promise<void> {
    this.#loading.set(true);
    const { data, error } = await this.#supabase
      .from('processing_queue')
      .select('*')
      .eq('status', 'done')
      .eq('source', 'archive')
      .order('updated_at', { ascending: false })
      .limit(500);
    this.#loading.set(false);
    if (error) { this.#toast(error.message, 'error'); return; }
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
