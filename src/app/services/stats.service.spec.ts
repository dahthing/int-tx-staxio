import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { StatsService } from './stats.service';
import { QueueService } from './queue.service';
import type { QueueEntry } from '../models/queue-entry.model';

function makeEntry(overrides: Partial<QueueEntry> = {}): QueueEntry {
  return {
    id: crypto.randomUUID(),
    file_id: 'file-1',
    file_name: 'doc.pdf',
    inbox_folder_id: 'inbox-1',
    status: 'done',
    doc_date: '2025-05-15',
    supplier: 'Fornecedor A',
    value: 100,
    nif: '123456789',
    country: 'PT',
    currency: 'EUR',
    is_international: false,
    dest_year: 2025,
    dest_quarter: null,
    dest_month: null,
    dest_path: null,
    dest_file_name: null,
    error_message: null,
    attempts: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('StatsService', () => {
  let service: StatsService;
  const entriesSignal = signal<QueueEntry[]>([]);

  const mockQueueService = {
    entries: entriesSignal.asReadonly(),
  } as unknown as QueueService;

  beforeEach(() => {
    entriesSignal.set([]);
    TestBed.configureTestingModule({
      providers: [
        StatsService,
        { provide: QueueService, useValue: mockQueueService },
      ],
    });
    service = TestBed.inject(StatsService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('totalDone', () => {
    it('returns 0 when no entries', () => {
      expect(service.totalDone()).toBe(0);
    });

    it('counts only done entries', () => {
      entriesSignal.set([
        makeEntry({ status: 'done' }),
        makeEntry({ status: 'done' }),
        makeEntry({ status: 'error' }),
        makeEntry({ status: 'pending' }),
      ]);
      expect(service.totalDone()).toBe(2);
    });
  });

  describe('totalInternational', () => {
    it('returns 0 when no international entries', () => {
      entriesSignal.set([makeEntry({ is_international: false })]);
      expect(service.totalInternational()).toBe(0);
    });

    it('counts international entries regardless of status', () => {
      entriesSignal.set([
        makeEntry({ is_international: true, status: 'done' }),
        makeEntry({ is_international: true, status: 'pending' }),
        makeEntry({ is_international: false }),
      ]);
      expect(service.totalInternational()).toBe(2);
    });
  });

  describe('totalValue', () => {
    it('returns 0 for empty list', () => {
      expect(service.totalValue()).toBe(0);
    });

    it('sums value of all entries, treating null as 0', () => {
      entriesSignal.set([
        makeEntry({ value: 150.5 }),
        makeEntry({ value: 49.5 }),
        makeEntry({ value: null }),
      ]);
      expect(service.totalValue()).toBe(200);
    });
  });

  describe('thisMonthDone', () => {
    it('counts only done entries for current month', () => {
      const now = new Date();
      const currentYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1);
      const lastYM = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;

      entriesSignal.set([
        makeEntry({ status: 'done', doc_date: `${currentYM}-10` }),
        makeEntry({ status: 'done', doc_date: `${currentYM}-20` }),
        makeEntry({ status: 'done', doc_date: `${lastYM}-05` }),
        makeEntry({ status: 'pending', doc_date: `${currentYM}-01` }),
        makeEntry({ status: 'done', doc_date: null }),
      ]);
      expect(service.thisMonthDone()).toBe(2);
    });
  });

  describe('byMonth', () => {
    it('returns exactly 12 buckets', () => {
      expect(service.byMonth()).toHaveLength(12);
    });

    it('buckets outside last 12 months are ignored', () => {
      entriesSignal.set([
        makeEntry({ status: 'done', doc_date: '2000-01-01' }),
      ]);
      const total = service.byMonth().reduce((s, b) => s + b.count, 0);
      expect(total).toBe(0);
    });

    it('counts done entries per month bucket', () => {
      const now = new Date();
      const currentYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      entriesSignal.set([
        makeEntry({ status: 'done', doc_date: `${currentYM}-01` }),
        makeEntry({ status: 'done', doc_date: `${currentYM}-15` }),
        makeEntry({ status: 'error', doc_date: `${currentYM}-10` }),
      ]);
      const current = service.byMonth().at(-1)!;
      expect(current.count).toBe(2);
    });

    it('each bucket has a non-empty label', () => {
      service.byMonth().forEach(b => expect(b.label.length).toBeGreaterThan(0));
    });
  });

  describe('topSuppliers', () => {
    it('returns empty array for no entries', () => {
      expect(service.topSuppliers()).toHaveLength(0);
    });

    it('aggregates by supplier and sorts descending by count', () => {
      entriesSignal.set([
        makeEntry({ supplier: 'A', value: 100 }),
        makeEntry({ supplier: 'A', value: 200 }),
        makeEntry({ supplier: 'B', value: 50 }),
      ]);
      const top = service.topSuppliers();
      expect(top[0].supplier).toBe('A');
      expect(top[0].count).toBe(2);
      expect(top[0].total).toBe(300);
      expect(top[1].supplier).toBe('B');
      expect(top[1].count).toBe(1);
    });

    it('limits result to 10 suppliers', () => {
      const entries = Array.from({ length: 15 }, (_, i) =>
        makeEntry({ supplier: `Supplier ${i}` })
      );
      entriesSignal.set(entries);
      expect(service.topSuppliers().length).toBeLessThanOrEqual(10);
    });

    it('uses (desconhecido) as key for null supplier', () => {
      entriesSignal.set([makeEntry({ supplier: null })]);
      expect(service.topSuppliers()[0].supplier).toBe('(desconhecido)');
    });
  });
});
