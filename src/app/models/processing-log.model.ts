export type LogAction = 'classify' | 'move' | 'manual_edit' | 'error';
export type LogStatus = 'success' | 'error';

export interface ProcessingLog {
  id: string;
  queue_id: string | null;
  file_id: string;
  file_name: string;
  action: LogAction;
  origin_path: string | null;
  dest_path: string | null;
  status: LogStatus;
  error_message: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}
