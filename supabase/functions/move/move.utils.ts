// supabase/functions/move/move.utils.ts
// Lógica pura da operação de mover — sem I/O, testável isoladamente

// ============================================================
// TIPOS
// ============================================================
export interface QueueEntry {
  id: string;
  file_id: string;
  file_name: string;
  inbox_folder_id: string;
  dest_path: string | null;
  dest_file_name: string | null;
  dest_root_folder_id: string | null;
  doc_type: string;
  dest_quarter: number | null;
  attempts: number;
}

export interface FolderNode {
  id: string;
  name: string;
}

export interface MoveResult {
  success: boolean;
  movedFileId: string;
  finalFolderId: string;
  finalFileName: string;
  error?: string;
}

export interface EnsureFolderInput {
  segments: string[];
  rootFolderId: string;
}

// ============================================================
// PATH SEGMENTATION
// ============================================================

/**
 * Converte um dest_path em segmentos de pasta Drive a criar/procurar.
 * O path é sempre relativo a dest_root_folder_id.
 * 'MAR'                          → ['MAR']
 * '2026/Faturas e Talões 1T/JAN' → ['2026', 'Faturas e Talões 1T', 'JAN']
 */
export function splitDestPath(destPath: string): string[] {
  return destPath.split('/').filter(s => s.length > 0);
}

// ============================================================
// NOME DE FICHEIRO FINAL
// ============================================================
export function resolveDestFileName(entry: QueueEntry): string {
  return entry.dest_file_name ?? entry.file_name;
}

// ============================================================
// VALIDAÇÃO DE ENTRADA
// ============================================================
export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export function validateQueueEntry(entry: QueueEntry): ValidationResult {
  if (!entry.dest_path) {
    return { valid: false, reason: 'dest_path em falta — classificação incompleta' };
  }
  if (!entry.dest_file_name) {
    return { valid: false, reason: 'dest_file_name em falta — classificação incompleta' };
  }
  if (!entry.file_id) {
    return { valid: false, reason: 'file_id em falta' };
  }
  if (!entry.inbox_folder_id) {
    return { valid: false, reason: 'inbox_folder_id em falta' };
  }
  return { valid: true };
}

// ============================================================
// TENTATIVAS ESGOTADAS
// ============================================================
export const MAX_ATTEMPTS = 3;

export function hasExceededMaxAttempts(attempts: number): boolean {
  return attempts >= MAX_ATTEMPTS;
}

// ============================================================
// URL BUILDER — Drive API
// ============================================================
export function buildDriveFilesUrl(params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return `https://www.googleapis.com/drive/v3/files?${qs}`;
}

export function buildDriveFileUrl(fileId: string): string {
  return `https://www.googleapis.com/drive/v3/files/${fileId}`;
}
