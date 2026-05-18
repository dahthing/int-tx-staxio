import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { QueueService } from '../../services/queue.service';
import { SUPABASE_CLIENT } from '../../core/supabase.client';
import { environment } from '../../../environments/environment';

interface AppConfig {
  drive_inbox_folder_id: string;
  drive_root_folder_id: string;
  drive_internacional_folder_id: string;
  drive_faturas_vendas_folder_id: string;
  drive_extratos_folder_id: string;
  drive_compras_folder_id: string;
  cron_enabled: string;
  inbound_provider: string;
  inbound_email: string;
  inbound_signing_secret: string;
  digest_enabled: string;
  digest_to_email: string;
}

export interface Supplier {
  id: string;
  name: string;
  nif: string | null;
  keywords: string[];
  type: 'ecommerce' | 'normal' | 'bank' | 'supplies';
  auto_detected: boolean;
  active: boolean;
}

@Component({
  selector: 'app-settings',
  imports: [
    ReactiveFormsModule,
    MatIconModule,
    MatButtonModule,
    MatSlideToggleModule,
    MatSnackBarModule,
  ],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Settings implements OnInit {
  readonly #http = inject(HttpClient);
  readonly #queue = inject(QueueService);
  readonly #fb = inject(FormBuilder);
  readonly #snackBar = inject(MatSnackBar);
  readonly #supabase = inject(SUPABASE_CLIENT);

  readonly #loading = signal(true);
  readonly #saving = signal(false);
  readonly #testing = signal(false);
  readonly #processing = signal(false);
  readonly #testResult = signal<{ ok: boolean; message: string } | null>(null);
  readonly #testingInbound = signal(false);
  readonly #testInboundResult = signal<{ ok: boolean; message: string } | null>(null);
  readonly #inboundDocsOpen = signal(false);
  readonly #suppliers = signal<Supplier[]>([]);
  readonly #suppliersLoading = signal(false);
  readonly #newSupplierVisible = signal(false);

  readonly loading = this.#loading.asReadonly();
  readonly saving = this.#saving.asReadonly();
  readonly testing = this.#testing.asReadonly();
  readonly processing = this.#processing.asReadonly();
  readonly testResult = this.#testResult.asReadonly();
  readonly testingInbound = this.#testingInbound.asReadonly();
  readonly testInboundResult = this.#testInboundResult.asReadonly();
  readonly inboundDocsOpen = this.#inboundDocsOpen.asReadonly();
  readonly suppliers = this.#suppliers.asReadonly();
  readonly suppliersLoading = this.#suppliersLoading.asReadonly();
  readonly newSupplierVisible = this.#newSupplierVisible.asReadonly();

  readonly #configUrl = `${environment.edgeFunctionsUrl}/config`;

  readonly form = this.#fb.nonNullable.group({
    drive_inbox_folder_id:          ['', Validators.required],
    drive_root_folder_id:           ['', Validators.required],
    drive_inbox_archive_folder_id:  ['' as string],
    drive_archive_root_folder_id:   ['' as string],
    drive_internacional_folder_id:  ['', Validators.required],
    drive_faturas_vendas_folder_id: ['', Validators.required],
    drive_extratos_folder_id:       ['', Validators.required],
    drive_compras_folder_id:        ['', Validators.required],
    cron_enabled:                   [true],
    inbound_provider:               ['resend' as 'resend' | 'sendgrid'],
    inbound_email:                  ['' as string],
    inbound_signing_secret:         ['' as string],
    digest_enabled:                 [true],
    digest_to_email:                ['' as string, Validators.email],
  });

  readonly newSupplierForm = this.#fb.nonNullable.group({
    name:     ['', Validators.required],
    nif:      ['' as string],
    keywords: ['', Validators.required],
    type:     ['normal' as Supplier['type'], Validators.required],
  });

  async ngOnInit(): Promise<void> {
    // Carrega folder_config do arquivo (inbox_archive, archive_root) em paralelo com app_config
    const archiveConfigPromise = this.#supabase
      .from('folder_config')
      .select('key, folder_id')
      .in('key', ['inbox_archive', 'archive_root']);

    this.#http.get<AppConfig>(this.#configUrl).subscribe({
      next: async cfg => {
        const { data: archiveFolders } = await archiveConfigPromise;
        const archiveMap = Object.fromEntries((archiveFolders ?? []).map(r => [r.key, r.folder_id ?? '']));

        this.form.setValue({
          drive_inbox_folder_id:          cfg.drive_inbox_folder_id ?? '',
          drive_root_folder_id:           cfg.drive_root_folder_id ?? '',
          drive_inbox_archive_folder_id:  archiveMap['inbox_archive'] ?? '',
          drive_archive_root_folder_id:   archiveMap['archive_root'] ?? '',
          drive_internacional_folder_id:  cfg.drive_internacional_folder_id ?? '',
          drive_faturas_vendas_folder_id: cfg.drive_faturas_vendas_folder_id ?? '1ZHYr7mXTFifFMO9FNRWo6dzqWw3iVv8d',
          drive_extratos_folder_id:       cfg.drive_extratos_folder_id ?? '1Bul9s71rvh0ijYjhKNRF9gMNJ2tFDMpN',
          drive_compras_folder_id:        cfg.drive_compras_folder_id ?? '1G7OOdefj6aod2AHLypzhs-yxettbxEr5',
          cron_enabled:                   cfg.cron_enabled !== 'false',
          inbound_provider:               (cfg.inbound_provider as 'resend' | 'sendgrid') ?? 'resend',
          inbound_email:                  cfg.inbound_email ?? '',
          inbound_signing_secret:         '',
          digest_enabled:                 cfg.digest_enabled !== 'false',
          digest_to_email:                cfg.digest_to_email ?? '',
        });
        this.#loading.set(false);
      },
      error: (err: Error) => {
        this.#loading.set(false);
        this.#toast(err.message, 'error');
      },
    });
    await this.#loadSuppliers();
  }

  async #loadSuppliers(): Promise<void> {
    this.#suppliersLoading.set(true);
    const { data, error } = await this.#supabase
      .from('suppliers')
      .select('id, name, nif, keywords, type, auto_detected, active')
      .order('name');
    this.#suppliersLoading.set(false);
    if (error) { this.#toast(error.message, 'error'); return; }
    this.#suppliers.set((data ?? []) as Supplier[]);
  }

  async toggleSupplier(supplier: Supplier): Promise<void> {
    const newActive = !supplier.active;
    const { error } = await this.#supabase
      .from('suppliers')
      .update({ active: newActive })
      .eq('id', supplier.id);
    if (error) { this.#toast(error.message, 'error'); return; }
    this.#suppliers.update(list =>
      list.map(s => s.id === supplier.id ? { ...s, active: newActive } : s)
    );
  }

  async saveSupplierKeywords(supplier: Supplier, keywordsRaw: string): Promise<void> {
    const keywords = keywordsRaw.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
    const { error } = await this.#supabase
      .from('suppliers')
      .update({ keywords })
      .eq('id', supplier.id);
    if (error) { this.#toast(error.message, 'error'); return; }
    this.#suppliers.update(list =>
      list.map(s => s.id === supplier.id ? { ...s, keywords } : s)
    );
    this.#toast('Keywords actualizadas', 'success');
  }

  async saveSupplierType(supplier: Supplier, type: Supplier['type']): Promise<void> {
    const { error } = await this.#supabase
      .from('suppliers')
      .update({ type })
      .eq('id', supplier.id);
    if (error) { this.#toast(error.message, 'error'); return; }
    this.#suppliers.update(list =>
      list.map(s => s.id === supplier.id ? { ...s, type } : s)
    );
  }

  async saveSupplierName(supplier: Supplier, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed || trimmed === supplier.name) return;
    const { error } = await this.#supabase
      .from('suppliers')
      .update({ name: trimmed })
      .eq('id', supplier.id);
    if (error) { this.#toast(error.message, 'error'); return; }
    this.#suppliers.update(list =>
      list.map(s => s.id === supplier.id ? { ...s, name: trimmed } : s)
    );
    this.#toast('Nome actualizado', 'success');
  }

  async saveSupplierNif(supplier: Supplier, nif: string): Promise<void> {
    const trimmed = nif.trim() || null;
    if (trimmed === supplier.nif) return;
    const { error } = await this.#supabase
      .from('suppliers')
      .update({ nif: trimmed })
      .eq('id', supplier.id);
    if (error) { this.#toast(error.message, 'error'); return; }
    this.#suppliers.update(list =>
      list.map(s => s.id === supplier.id ? { ...s, nif: trimmed } : s)
    );
    this.#toast('NIF actualizado', 'success');
  }

  async deleteSupplier(supplier: Supplier): Promise<void> {
    if (!confirm(`Apagar fornecedor "${supplier.name}"? Esta acção não pode ser desfeita.`)) return;
    const { error } = await this.#supabase
      .from('suppliers')
      .delete()
      .eq('id', supplier.id);
    if (error) { this.#toast(error.message, 'error'); return; }
    this.#suppliers.update(list => list.filter(s => s.id !== supplier.id));
    this.#toast(`Fornecedor "${supplier.name}" apagado`, 'success');
  }

  showNewSupplierForm(): void {
    this.newSupplierForm.reset({ name: '', nif: '', keywords: '', type: 'normal' });
    this.#newSupplierVisible.set(true);
  }

  cancelNewSupplier(): void {
    this.#newSupplierVisible.set(false);
  }

  async addSupplier(): Promise<void> {
    if (this.newSupplierForm.invalid) return;
    const raw = this.newSupplierForm.getRawValue();
    const keywords = raw.keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
    const { error } = await this.#supabase.from('suppliers').insert({
      name: raw.name,
      nif: raw.nif || null,
      keywords,
      type: raw.type,
      auto_detected: false,
      active: true,
    });
    if (error) { this.#toast(error.message, 'error'); return; }
    this.#newSupplierVisible.set(false);
    this.#toast(`Fornecedor "${raw.name}" adicionado`, 'success');
    await this.#loadSuppliers();
  }

  onSave(): void {
    if (this.form.invalid) return;
    this.#saving.set(true);
    const raw = this.form.getRawValue();
    const patch = {
      drive_inbox_folder_id:          raw.drive_inbox_folder_id,
      drive_root_folder_id:           raw.drive_root_folder_id,
      drive_internacional_folder_id:  raw.drive_internacional_folder_id,
      drive_faturas_vendas_folder_id: raw.drive_faturas_vendas_folder_id,
      drive_extratos_folder_id:       raw.drive_extratos_folder_id,
      drive_compras_folder_id:        raw.drive_compras_folder_id,
      cron_enabled:                   String(raw.cron_enabled),
      inbound_provider:               raw.inbound_provider,
      inbound_email:                  raw.inbound_email,
      ...(raw.inbound_signing_secret ? { inbound_signing_secret: raw.inbound_signing_secret } : {}),
      digest_enabled:                 String(raw.digest_enabled),
      ...(raw.digest_to_email ? { digest_to_email: raw.digest_to_email } : {}),
    };

    // Guarda archive folder IDs directamente em folder_config (usados pelo classify)
    const archiveUpserts = [
      { key: 'inbox_archive', label: 'Inbox Archive Files', folder_id: raw.drive_inbox_archive_folder_id || null, folder_name: 'Inbox_Archive_Files', parent_key: null, auto_create: false, editable: true },
      { key: 'archive_root',  label: 'Raiz Archive_Files',  folder_id: raw.drive_archive_root_folder_id  || null, folder_name: 'Archive_Files',        parent_key: null, auto_create: false, editable: true },
    ];
    const archiveSave = this.#supabase.from('folder_config').upsert(archiveUpserts, { onConflict: 'key' });

    this.#http.patch<{ updated: string[] }>(this.#configUrl, patch).subscribe({
      next: async () => {
        await archiveSave;
        this.#saving.set(false);
        this.#toast('Definições guardadas', 'success');
      },
      error: (err: Error) => {
        this.#saving.set(false);
        this.#toast(err.message, 'error');
      },
    });
  }

  onTestDrive(): void {
    this.#testing.set(true);
    this.#testResult.set(null);
    this.#queue.triggerClassify().subscribe({
      next: r => {
        this.#testing.set(false);
        this.#testResult.set({
          ok: true,
          message: r.queued > 0
            ? `Drive OK — ${r.queued} ficheiro(s) novos encontrados`
            : 'Drive OK — inbox vazia',
        });
      },
      error: (err: Error) => {
        this.#testing.set(false);
        this.#testResult.set({ ok: false, message: err.message });
      },
    });
  }

  toggleInboundDocs(): void {
    this.#inboundDocsOpen.update(v => !v);
  }

  onTestInbound(): void {
    this.#testingInbound.set(true);
    this.#testInboundResult.set(null);
    const url = `${environment.edgeFunctionsUrl.replace('/config', '')}/inbound-email`;
    this.#http.post<{ uploaded: number; message?: string; error?: string }>(url, {}).subscribe({
      next: r => {
        this.#testingInbound.set(false);
        this.#testInboundResult.set({
          ok: true,
          message: r.message ?? `OK — função acessível (${r.uploaded} uploads)`,
        });
      },
      error: (err: Error) => {
        this.#testingInbound.set(false);
        this.#testInboundResult.set({ ok: false, message: err.message });
      },
    });
  }

  onProcessNow(): void {
    this.#processing.set(true);
    this.#queue.triggerClassify().subscribe({
      next: () => {
        this.#queue.triggerMove().subscribe({
          next: r => {
            this.#processing.set(false);
            this.#toast(
              `Processado: ${r.moved} documento(s) movido(s)`,
              r.moved > 0 ? 'success' : 'info'
            );
            void this.#queue.loadAll();
          },
          error: (err: Error) => {
            this.#processing.set(false);
            this.#toast(err.message, 'error');
          },
        });
      },
      error: (err: Error) => {
        this.#processing.set(false);
        this.#toast(err.message, 'error');
      },
    });
  }

  #toast(msg: string, type: 'success' | 'error' | 'info'): void {
    this.#snackBar.open(msg, '✕', {
      duration: 4000,
      panelClass: [`toast--${type}`],
      horizontalPosition: 'end',
      verticalPosition: 'bottom',
    });
  }
}
