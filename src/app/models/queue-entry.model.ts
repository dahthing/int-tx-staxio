export type ProcessingStatus = 'pending' | 'processing' | 'done' | 'error' | 'manual_review';
export type DocType = 'received' | 'issued' | 'invoice_issued' | 'receipt_issued' | 'quote_issued' | 'ecommerce' | 'bank_statement' | 'supplies' | 'international' | 'unknown';

export interface QueueEntry {
  id: string;
  file_id: string;
  file_name: string;
  inbox_folder_id: string;
  status: ProcessingStatus;
  doc_type: DocType | null;
  doc_date: string | null;
  supplier: string | null;
  value: number | null;
  nif: string | null;
  country: string | null;
  currency: string;
  dest_year: number | null;
  dest_quarter: number | null;
  dest_month: string | null;
  dest_path: string | null;
  dest_file_name: string | null;
  dest_root_folder_id: string | null;
  error_message: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
  is_my_doc: boolean | null;
  confidence: number | null;
  vat_amount: number | null;
  vat_rate: number | null;
  is_duplicate_suspect: boolean | null;
}
