// supabase/functions/move/move.test.ts
// Vitest — testes unitários para lógica da Edge Function /move
// Correr: pnpm vitest run --config vitest.config.edge.ts

import { describe, it, expect } from 'vitest';
import {
  splitDestPath,
  resolveDestFileName,
  validateQueueEntry,
  hasExceededMaxAttempts,
  buildDriveFilesUrl,
  buildDriveFileUrl,
  MAX_ATTEMPTS,
  type QueueEntry,
} from './move.utils.ts';

// ============================================================
// FIXTURE
// ============================================================
const baseEntry: QueueEntry = {
  id: 'uuid-1',
  file_id: 'gdrive-file-1',
  file_name: 'fatura.pdf',
  inbox_folder_id: 'inbox-folder-id',
  dest_path: '2025/Faturas e Talões 1T/JAN',
  dest_file_name: '2025-01-15_continente_150.00.pdf',
  dest_root_folder_id: 'root-folder-id',
  doc_type: 'received',
  dest_quarter: 1,
  attempts: 0,
};

// ============================================================
// splitDestPath
// ============================================================
describe('splitDestPath', () => {
  it('path de um segmento (issued/bank/supplies)', () => {
    expect(splitDestPath('MAR')).toEqual(['MAR']);
  });

  it('path received em segmentos', () => {
    expect(splitDestPath('2025/Faturas e Talões 1T/JAN')).toEqual(['2025', 'Faturas e Talões 1T', 'JAN']);
  });

  it('path internacional (ano/mês)', () => {
    expect(splitDestPath('2025/ABR')).toEqual(['2025', 'ABR']);
  });

  it('path ecommerce', () => {
    expect(splitDestPath('2025/Faturas e Talões 4T/eCommerce')).toEqual(['2025', 'Faturas e Talões 4T', 'eCommerce']);
  });

  it('_aguardar_validacao', () => {
    expect(splitDestPath('_aguardar_validacao')).toEqual(['_aguardar_validacao']);
  });

  it('limpa segmentos vazios de barras duplicadas', () => {
    expect(splitDestPath('2025//Faturas e Talões 1T/JAN')).toEqual(['2025', 'Faturas e Talões 1T', 'JAN']);
  });

  it('path Q4/DEZ', () => {
    expect(splitDestPath('2025/Faturas e Talões 4T/DEZ')).toEqual(['2025', 'Faturas e Talões 4T', 'DEZ']);
  });
});

// ============================================================
// resolveDestFileName
// ============================================================
describe('resolveDestFileName', () => {
  it('retorna dest_file_name quando presente', () => {
    expect(resolveDestFileName(baseEntry)).toBe('2025-01-15_continente_150.00.pdf');
  });

  it('fallback para file_name quando dest_file_name é null', () => {
    const entry: QueueEntry = { ...baseEntry, dest_file_name: null };
    expect(resolveDestFileName(entry)).toBe('fatura.pdf');
  });
});

// ============================================================
// validateQueueEntry
// ============================================================
describe('validateQueueEntry', () => {
  it('valid=true para entrada completa', () => {
    expect(validateQueueEntry(baseEntry).valid).toBe(true);
  });

  it('invalid quando dest_path é null', () => {
    const entry: QueueEntry = { ...baseEntry, dest_path: null };
    const result = validateQueueEntry(entry);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('dest_path');
  });

  it('invalid quando dest_file_name é null', () => {
    const entry: QueueEntry = { ...baseEntry, dest_file_name: null };
    const result = validateQueueEntry(entry);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('dest_file_name');
  });

  it('invalid quando file_id está vazio', () => {
    const entry: QueueEntry = { ...baseEntry, file_id: '' };
    const result = validateQueueEntry(entry);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('file_id');
  });

  it('invalid quando inbox_folder_id está vazio', () => {
    const entry: QueueEntry = { ...baseEntry, inbox_folder_id: '' };
    const result = validateQueueEntry(entry);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('inbox_folder_id');
  });
});

// ============================================================
// hasExceededMaxAttempts
// ============================================================
describe('hasExceededMaxAttempts', () => {
  it('false quando attempts < MAX_ATTEMPTS', () => {
    expect(hasExceededMaxAttempts(0)).toBe(false);
    expect(hasExceededMaxAttempts(MAX_ATTEMPTS - 1)).toBe(false);
  });

  it('true quando attempts === MAX_ATTEMPTS', () => {
    expect(hasExceededMaxAttempts(MAX_ATTEMPTS)).toBe(true);
  });

  it('true quando attempts > MAX_ATTEMPTS', () => {
    expect(hasExceededMaxAttempts(MAX_ATTEMPTS + 1)).toBe(true);
  });

  it(`MAX_ATTEMPTS é ${MAX_ATTEMPTS}`, () => {
    expect(MAX_ATTEMPTS).toBe(3);
  });
});

// ============================================================
// buildDriveFilesUrl
// ============================================================
describe('buildDriveFilesUrl', () => {
  it('constrói URL com query string correcta', () => {
    const url = buildDriveFilesUrl({ q: "'parent-id' in parents", fields: 'files(id,name)' });
    expect(url).toContain('https://www.googleapis.com/drive/v3/files');
    expect(url).toContain('fields=files%28id%2Cname%29');
  });

  it('URL base sempre presente', () => {
    const url = buildDriveFilesUrl({});
    expect(url.startsWith('https://www.googleapis.com/drive/v3/files')).toBe(true);
  });
});

// ============================================================
// buildDriveFileUrl
// ============================================================
describe('buildDriveFileUrl', () => {
  it('constrói URL de ficheiro com ID correcto', () => {
    const url = buildDriveFileUrl('file-abc-123');
    expect(url).toBe('https://www.googleapis.com/drive/v3/files/file-abc-123');
  });

  it('diferentes IDs produzem URLs diferentes', () => {
    const url1 = buildDriveFileUrl('id-1');
    const url2 = buildDriveFileUrl('id-2');
    expect(url1).not.toBe(url2);
  });
});
