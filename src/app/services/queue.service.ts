import { inject, Injectable, signal, computed, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { SUPABASE_CLIENT } from '../core/supabase.client';
import { QueueEntry, ProcessingStatus } from '../models/queue-entry.model';
import { ProcessingLog } from '../models/processing-log.model';
import { environment } from '../../environments/environment';
import type { RealtimeChannel } from '@supabase/supabase-js';

@Injectable({ providedIn: 'root' })
export class QueueService implements OnDestroy {
  readonly #supabase = inject(SUPABASE_CLIENT);
  readonly #http = inject(HttpClient);

  readonly #entries = signal<QueueEntry[]>([]);
  readonly #logs = signal<ProcessingLog[]>([]);
  readonly #loading = signal(false);
  readonly #error = signal<string | null>(null);

  readonly entries = this.#entries.asReadonly();
  readonly logs = this.#logs.asReadonly();
  readonly loading = this.#loading.asReadonly();
  readonly error = this.#error.asReadonly();

  readonly pendingCount = computed(
    () => this.#entries().filter(e => e.status === 'pending').length
  );
  readonly errorCount = computed(
    () => this.#entries().filter(e => e.status === 'error' || e.status === 'manual_review').length
  );
  readonly doneCount = computed(
    () => this.#entries().filter(e => e.status === 'done').length
  );

  #queueChannel: RealtimeChannel | null = null;
  #logsChannel: RealtimeChannel | null = null;

  async loadAll(): Promise<void> {
    this.#loading.set(true);
    this.#error.set(null);

    const [queueRes, logsRes] = await Promise.all([
      this.#supabase
        .from('processing_queue')
        .select('*')
        .order('created_at', { ascending: false }),
      this.#supabase
        .from('processing_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100),
    ]);

    if (queueRes.error) {
      this.#error.set(queueRes.error.message);
    } else {
      this.#entries.set(queueRes.data as QueueEntry[]);
    }

    if (!logsRes.error) {
      this.#logs.set(logsRes.data as ProcessingLog[]);
    }

    this.#loading.set(false);
  }

  subscribeRealtime(): void {
    this.#queueChannel = this.#supabase
      .channel('queue-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'processing_queue' },
        () => { void this.loadAll(); }
      )
      .subscribe();

    this.#logsChannel = this.#supabase
      .channel('logs-changes')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'processing_logs' },
        payload => {
          this.#logs.update(logs => [payload.new as ProcessingLog, ...logs].slice(0, 100));
        }
      )
      .subscribe();
  }

  triggerClassify(fileId?: string) {
    return this.#http.post<{ queued: number }>(
      `${environment.edgeFunctionsUrl}/classify`,
      fileId ? { file_id: fileId } : {}
    );
  }

  triggerMove(queueId?: string) {
    return this.#http.post<{ moved: number; errors: unknown[] }>(
      `${environment.edgeFunctionsUrl}/move`,
      queueId ? { queue_id: queueId } : {}
    );
  }

  async updateStatus(id: string, status: ProcessingStatus): Promise<void> {
    const { error } = await this.#supabase
      .from('processing_queue')
      .update({ status })
      .eq('id', id);

    if (error) throw new Error(error.message);
  }

  ngOnDestroy(): void {
    if (this.#queueChannel) void this.#supabase.removeChannel(this.#queueChannel);
    if (this.#logsChannel) void this.#supabase.removeChannel(this.#logsChannel);
  }
}
