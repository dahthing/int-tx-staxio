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
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { LayoutService } from '../../services/layout.service';
import { SUPABASE_CLIENT } from '../../core/supabase.client';
import { QueueEntry } from '../../models/queue-entry.model';

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
  ],
  templateUrl: './archive-list.html',
  styleUrl: './archive-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArchiveList implements OnInit {
  readonly #supabase = inject(SUPABASE_CLIENT);
  readonly #snackBar = inject(MatSnackBar);
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
    await this.#load();
  }

  setSupplierFilter(v: string): void { this.#filterSupplier.set(v); }
  setMonthFilter(v: string): void { this.#filterMonth.set(v); }
  setDocTypeFilter(v: string): void { this.#filterDocType.set(v); }
  setYearFilter(v: string): void { this.#filterYear.set(v); this.#filterMonth.set(''); }

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
