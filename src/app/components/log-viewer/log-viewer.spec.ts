import { TestBed, ComponentFixture } from '@angular/core/testing';
import { LogViewer } from './log-viewer';
import type { ProcessingLog } from '../../models/processing-log.model';

function makeLog(overrides: Partial<ProcessingLog> = {}): ProcessingLog {
  return {
    id: crypto.randomUUID(),
    queue_id: null,
    file_id: 'file-1',
    file_name: 'fatura.pdf',
    action: 'classify',
    origin_path: null,
    dest_path: '/2025/Q2/fatura.pdf',
    status: 'success',
    error_message: null,
    metadata: null,
    created_at: '2025-05-15T10:00:00Z',
    ...overrides,
  };
}

describe('LogViewer', () => {
  let fixture: ComponentFixture<LogViewer>;
  let component: LogViewer;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LogViewer],
    }).compileComponents();

    fixture = TestBed.createComponent(LogViewer);
    fixture.componentRef.setInput('logs', []);
    await fixture.whenStable();
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('filtered — no filters', () => {
    it('returns all logs when no filter is set', () => {
      const logs = [makeLog(), makeLog({ action: 'move' }), makeLog({ action: 'error' })];
      fixture.componentRef.setInput('logs', logs);
      expect(component.filtered()).toHaveLength(3);
    });
  });

  describe('filterAction', () => {
    it('filters by action', () => {
      const logs = [
        makeLog({ action: 'classify' }),
        makeLog({ action: 'move' }),
        makeLog({ action: 'classify' }),
      ];
      fixture.componentRef.setInput('logs', logs);
      component.filterAction.set('classify');
      expect(component.filtered()).toHaveLength(2);
      expect(component.filtered().every(l => l.action === 'classify')).toBe(true);
    });

    it('empty action shows all logs', () => {
      const logs = [makeLog({ action: 'classify' }), makeLog({ action: 'move' })];
      fixture.componentRef.setInput('logs', logs);
      component.filterAction.set('');
      expect(component.filtered()).toHaveLength(2);
    });
  });

  describe('filterDate', () => {
    it('filters logs by date prefix', () => {
      const logs = [
        makeLog({ created_at: '2025-05-15T10:00:00Z' }),
        makeLog({ created_at: '2025-06-01T08:00:00Z' }),
        makeLog({ created_at: '2025-05-20T14:00:00Z' }),
      ];
      fixture.componentRef.setInput('logs', logs);
      component.filterDate.set('2025-05');
      expect(component.filtered()).toHaveLength(2);
    });
  });

  describe('filterSupplier (file name search)', () => {
    it('filters by file_name case-insensitively', () => {
      const logs = [
        makeLog({ file_name: 'EDP_fatura_maio.pdf' }),
        makeLog({ file_name: 'galp_maio.pdf' }),
        makeLog({ file_name: 'EDP_junho.pdf' }),
      ];
      fixture.componentRef.setInput('logs', logs);
      component.filterSupplier.set('edp');
      expect(component.filtered()).toHaveLength(2);
    });

    it('empty supplier string shows all', () => {
      const logs = [makeLog({ file_name: 'a.pdf' }), makeLog({ file_name: 'b.pdf' })];
      fixture.componentRef.setInput('logs', logs);
      component.filterSupplier.set('');
      expect(component.filtered()).toHaveLength(2);
    });
  });

  describe('combined filters', () => {
    it('applies all active filters simultaneously', () => {
      const logs = [
        makeLog({ action: 'classify', file_name: 'EDP.pdf', created_at: '2025-05-10T00:00:00Z' }),
        makeLog({ action: 'move', file_name: 'EDP.pdf', created_at: '2025-05-11T00:00:00Z' }),
        makeLog({ action: 'classify', file_name: 'Galp.pdf', created_at: '2025-05-12T00:00:00Z' }),
        makeLog({ action: 'classify', file_name: 'EDP.pdf', created_at: '2025-06-01T00:00:00Z' }),
      ];
      fixture.componentRef.setInput('logs', logs);
      component.filterAction.set('classify');
      component.filterDate.set('2025-05');
      component.filterSupplier.set('edp');
      expect(component.filtered()).toHaveLength(1);
      expect(component.filtered()[0].file_name).toBe('EDP.pdf');
    });
  });

  describe('clearFilters', () => {
    it('resets all filters to empty', () => {
      const logs = [makeLog({ action: 'classify' }), makeLog({ action: 'move' })];
      fixture.componentRef.setInput('logs', logs);
      component.filterAction.set('classify');
      component.filterDate.set('2025-05');
      component.filterSupplier.set('edp');

      component.clearFilters();

      expect(component.filterAction()).toBe('');
      expect(component.filterDate()).toBe('');
      expect(component.filterSupplier()).toBe('');
      expect(component.filtered()).toHaveLength(2);
    });
  });

  describe('exportCsv', () => {
    it('creates a CSV blob and triggers download', () => {
      const logs = [
        makeLog({ file_name: 'fatura.pdf', dest_path: '/2025/Q2/', error_message: null }),
        makeLog({ file_name: 'nota.pdf', action: 'error', status: 'error', error_message: 'timeout' }),
      ];
      fixture.componentRef.setInput('logs', logs);

      const createObjectURL = vi.fn(() => 'blob:mock-url');
      const revokeObjectURL = vi.fn();
      const clickSpy = vi.fn();

      vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

      const anchorMock = { href: '', download: '', click: clickSpy } as unknown as HTMLAnchorElement;
      vi.spyOn(document, 'createElement').mockReturnValue(anchorMock);

      component.exportCsv();

      expect(createObjectURL).toHaveBeenCalledOnce();
      expect(clickSpy).toHaveBeenCalledOnce();
      expect(anchorMock.download).toMatch(/^staxio-log-\d{4}-\d{2}-\d{2}\.csv$/);

      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it('CSV contains header row', () => {
      fixture.componentRef.setInput('logs', [makeLog()]);

      let capturedBlob: Blob | null = null;
      vi.stubGlobal('URL', {
        createObjectURL: (b: Blob) => { capturedBlob = b; return 'blob:mock'; },
        revokeObjectURL: vi.fn(),
      });
      vi.spyOn(document, 'createElement').mockReturnValue({
        href: '', download: '', click: vi.fn(),
      } as unknown as HTMLAnchorElement);

      component.exportCsv();

      return capturedBlob!.text().then(text => {
        expect(text).toContain('data,ação,ficheiro,destino,erro');
      }).finally(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
      });
    });

    it('escapes double quotes in CSV fields', () => {
      const logs = [makeLog({ file_name: 'fatura "especial".pdf' })];
      fixture.componentRef.setInput('logs', logs);

      let capturedBlob: Blob | null = null;
      vi.stubGlobal('URL', {
        createObjectURL: (b: Blob) => { capturedBlob = b; return 'blob:mock'; },
        revokeObjectURL: vi.fn(),
      });
      vi.spyOn(document, 'createElement').mockReturnValue({
        href: '', download: '', click: vi.fn(),
      } as unknown as HTMLAnchorElement);

      component.exportCsv();

      return capturedBlob!.text().then(text => {
        expect(text).toContain('fatura ""especial"".pdf');
      }).finally(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
      });
    });
  });
});
