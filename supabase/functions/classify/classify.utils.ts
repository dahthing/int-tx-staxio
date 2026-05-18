// supabase/functions/classify/classify.utils.ts
// v2 — lógica completa com doc_type, fornecedores, pastas dinâmicas

export type DocType =
  | 'received'
  | 'issued'
  | 'invoice_issued'
  | 'receipt_issued'
  | 'quote_issued'
  | 'ecommerce'
  | 'bank_statement'
  | 'supplies'
  | 'international'
  | 'unknown';

export interface Supplier {
  name: string;
  nif: string | null;
  keywords: string[];
  type: 'ecommerce' | 'normal' | 'bank' | 'supplies';
}

export interface ClassifyInput {
  nif: string | null;
  country: string | null;
  currency: string | null;
  supplier: string | null;
  issuerNif: string | null;    // NIF do emitente
  companyNif: string;          // NIF da nossa empresa (514084235)
  suppliers: Supplier[];       // lista da tabela suppliers
  confidence: number;          // 0-1, da IA
}

export interface ParsedDate {
  year: number;
  month: number;
  day: number;
}

export interface DestPathInput {
  docType: DocType;
  year: number;
  month: number;
  quarter: number;
}

export interface DestFileNameInput {
  date: string | null;
  supplier: string | null;
  value: number | null;
  ext: string;
}

export interface FolderConfig {
  key: string;
  folder_id: string | null;
  folder_name: string;
  parent_key: string | null;
  auto_create: boolean;
}

// ============================================================
// NIF
// ============================================================
export function extractNif(text: string): string | null {
  const euVat = text.match(/(?:VAT|NIF|NIPC|NIF\/NIPC)[:\s]*([A-Z]{2}\d{7,12})/i);
  if (euVat) return euVat[1];
  const ptNif = text.match(/(?:NIF|NIPC|NIF\/NIPC)[:\s]*(\d{9})/i);
  if (ptNif) return ptNif[1];
  return null;
}

export function isPortugueseNif(nif: string): boolean {
  return /^\d{9}$/.test(nif);
}

// ============================================================
// DETECÇÃO DE FORNECEDOR
// ============================================================
export function detectSupplier(
  supplierName: string | null,
  nif: string | null,
  suppliers: Supplier[]
): Supplier | null {
  if (!supplierName && !nif) return null;

  const nameLower = supplierName?.toLowerCase() ?? '';

  for (const s of suppliers) {
    // Match por NIF exacto
    if (nif && s.nif && s.nif === nif) return s;

    // Match por keyword
    for (const kw of s.keywords) {
      if (nameLower.includes(kw.toLowerCase())) return s;
    }
  }

  return null;
}

// ============================================================
// CLASSIFICAÇÃO PRINCIPAL
// ============================================================
const PT_COUNTRY_VARIANTS = ['portugal', 'pt', 'prt'];
const BANK_KEYWORDS = ['extrato', 'statement', 'account statement', 'bank statement', 'movimentos'];
const SUPPLIES_KEYWORDS = ['matéria', 'materia prima', 'material', 'stock', 'inventário'];
const CONFIDENCE_THRESHOLD = 0.6;

export function classifyDocument(input: ClassifyInput): DocType {
  const { nif, issuerNif, companyNif, country, currency, supplier, suppliers, confidence } = input;

  // Emitido por nós — sinal determinístico, ignora confiança
  if (issuerNif === companyNif) return 'issued';
  if (nif === companyNif) return 'issued';

  // Moeda não-EUR → internacional — sinal determinístico
  if (currency && currency.toUpperCase() !== 'EUR') return 'international';

  // NIF não-PT → internacional — sinal determinístico
  if (nif && !isPortugueseNif(nif)) return 'international';

  // País não-PT → internacional — sinal determinístico
  if (country) {
    const normalized = country.toLowerCase().trim();
    if (!PT_COUNTRY_VARIANTS.includes(normalized)) return 'international';
  }

  // A partir daqui precisamos de confiança suficiente na extracção
  if (confidence < CONFIDENCE_THRESHOLD) return 'unknown';

  // Detecta fornecedor na lista
  const matched = detectSupplier(supplier, nif, suppliers);
  if (matched) {
    if (matched.type === 'ecommerce') return 'ecommerce';
    if (matched.type === 'bank')      return 'bank_statement';
    if (matched.type === 'supplies')  return 'supplies';
  }

  // Keywords de extrato bancário
  const supplierLower = supplier?.toLowerCase() ?? '';
  if (BANK_KEYWORDS.some(kw => supplierLower.includes(kw))) return 'bank_statement';

  // Keywords de compras/materiais
  if (SUPPLIES_KEYWORDS.some(kw => supplierLower.includes(kw))) return 'supplies';

  // Sem NIF e sem país → incerto
  if (!nif && !country) return 'unknown';

  return 'received';
}

// ============================================================
// GERAÇÃO DE PATH DESTINO
// ============================================================
export function buildDestPath(
  input: DestPathInput,
  folderConfig: FolderConfig[],
  rootMode: 'current' | 'archive' = 'current',
): { path: string; rootFolderId: string | null; needsCreate: boolean } {
  const { docType, year, month, quarter } = input;
  const monthLabel = resolveMonthPT(month);

  const rootKey = rootMode === 'archive' ? 'archive_root' : 'root';
  const getFolder = (key: string) => folderConfig.find(f => f.key === key);

  switch (docType) {
    case 'issued':
    case 'invoice_issued':
      return {
        path: `${year}/Faturas Vendas/${monthLabel}`,
        rootFolderId: getFolder(rootKey)?.folder_id ?? null,
        needsCreate: true
      };

    case 'receipt_issued':
      return {
        path: `${year}/Recibos Emitidos/${monthLabel}`,
        rootFolderId: getFolder(rootKey)?.folder_id ?? null,
        needsCreate: true
      };

    case 'quote_issued':
      return {
        path: `${year}/Orçamentos/${monthLabel}`,
        rootFolderId: getFolder(rootKey)?.folder_id ?? null,
        needsCreate: true
      };

    case 'bank_statement':
      return {
        path: `${year}/Extratos Bancarios`,
        rootFolderId: getFolder(rootKey)?.folder_id ?? null,
        needsCreate: true
      };

    case 'supplies':
      return {
        path: `${year}/Compras & Materias Primas`,
        rootFolderId: getFolder(rootKey)?.folder_id ?? null,
        needsCreate: true
      };

    case 'international':
      return {
        path: `${year}/Internacional/${monthLabel}`,
        rootFolderId: getFolder(rootKey)?.folder_id ?? null,
        needsCreate: true
      };

    case 'ecommerce':
      return {
        path: `${year}/Faturas e Talões ${quarter}T/eCommerce`,
        rootFolderId: getFolder(rootKey)?.folder_id ?? null,
        needsCreate: true
      };

    case 'received':
      return {
        path: `${year}/Faturas e Talões ${quarter}T/${monthLabel}`,
        rootFolderId: getFolder(rootKey)?.folder_id ?? null,
        needsCreate: true
      };

    default: // unknown
      return {
        path: `_aguardar_validacao`,
        rootFolderId: getFolder(rootKey)?.folder_id ?? null,
        needsCreate: true
      };
  }
}

// ============================================================
// PARSING DE DATA
// ============================================================
const MONTHS_PT: Record<string, number> = {
  janeiro: 1, fevereiro: 2, março: 3, abril: 4,
  maio: 5, junho: 6, julho: 7, agosto: 8,
  setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

const MONTHS_EN: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4,
  may: 5, june: 6, july: 7, august: 8,
  september: 9, october: 10, november: 11, december: 12,
};

export function parseDocDate(text: string): ParsedDate | null {
  if (!text) return null;
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return { year: +iso[1], month: +iso[2], day: +iso[3] };
  const pt = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (pt) return { year: +pt[3], month: +pt[2], day: +pt[1] };
  const ptExt = text.match(/(\d{1,2})\s+de\s+([a-záéíóúâêîôûã]+)\s+de\s+(\d{4})/i);
  if (ptExt) {
    const month = MONTHS_PT[ptExt[2].toLowerCase()];
    if (month) return { year: +ptExt[3], month, day: +ptExt[1] };
  }
  const enExt = text.match(/([a-z]+)\s+(\d{1,2}),?\s+(\d{4})/i);
  if (enExt) {
    const month = MONTHS_EN[enExt[1].toLowerCase()];
    if (month) return { year: +enExt[3], month, day: +enExt[2] };
  }
  return null;
}

// ============================================================
// TRIMESTRE E MÊS PT
// ============================================================
export function resolveQuarter(month: number): number {
  return Math.ceil(month / 3);
}

const MONTH_LABELS_PT = [
  '', 'JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN',
  'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ',
];

export function resolveMonthPT(month: number): string {
  return MONTH_LABELS_PT[month];
}

// ============================================================
// NOME DE FICHEIRO
// ============================================================
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function buildDestFileName(input: DestFileNameInput): string {
  const { date, supplier, value, ext } = input;
  const d = date ?? 'sem-data';
  const s = supplier ? slugify(supplier) : 'desconhecido';
  const v = (value ?? 0).toFixed(2);
  return `${d}_${s}_${v}.${ext}`;
}

// ============================================================
// QUEUE PAYLOAD — monta o objecto a inserir na processing_queue
// ============================================================
const ATCUD_REGEX = /^[A-Z0-9]{8,}-\d+$/;

export function parseAtcud(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toUpperCase();
  return ATCUD_REGEX.test(trimmed) ? trimmed : null;
}

export interface ClaudeMeta {
  doc_date: string | null;
  supplier: string | null;
  issuerNif: string | null;
  value: number | null;
  nif: string | null;
  country: string | null;
  currency: string | null;
  confidence: number;
  atcud?: string | null;
  is_my_doc?: boolean;
  my_doc_kind?: string | null;
  vat_amount?: number | null;
  vat_rate?: number | null;
}

export interface QueuePayload {
  file_id: string;
  file_name: string;
  inbox_folder_id: string;
  source: 'current' | 'archive';
  atcud: string | null;
  status: 'pending' | 'manual_review';
  doc_type: DocType;
  doc_date: string | null;
  supplier: string | null;
  value: number | null;
  nif: string | null;
  country: string | null;
  currency: string | null;
  confidence: number;
  dest_path: string;
  dest_file_name: string;
  dest_root_folder_id: string | null;
  dest_year: number | null;
  dest_quarter: number | null;
  dest_month: string | null;
  is_my_doc: boolean;
  vat_amount: number | null;
  vat_rate: number | null;
}

const MY_DOC_RECEIPT_KEYWORDS = ['recibo'];
const MY_DOC_QUOTE_KEYWORDS = ['orçamento', 'orcamento', 'quote'];

function resolveMyDocKind(supplier: string | null, rawText?: string): 'invoice_issued' | 'receipt_issued' | 'quote_issued' {
  const haystack = [supplier ?? '', rawText ?? ''].join(' ').toLowerCase();
  if (MY_DOC_RECEIPT_KEYWORDS.some(kw => haystack.includes(kw))) return 'receipt_issued';
  if (MY_DOC_QUOTE_KEYWORDS.some(kw => haystack.includes(kw))) return 'quote_issued';
  return 'invoice_issued';
}

export function buildQueuePayload(
  file: { id: string; name: string },
  inboxFolderId: string,
  meta: ClaudeMeta,
  suppliers: Supplier[],
  folderConfig: FolderConfig[],
  companyNif: string,
  source: 'current' | 'archive' = 'current',
): QueuePayload {
  const nif = meta.nif ?? extractNif(meta.supplier ?? '');

  const isMyDoc = meta.issuerNif === companyNif || nif === companyNif || meta.is_my_doc === true;
  const myDocKind: 'invoice_issued' | 'receipt_issued' | 'quote_issued' | null = isMyDoc
    ? (meta.my_doc_kind as 'invoice_issued' | 'receipt_issued' | 'quote_issued' | null) ?? resolveMyDocKind(meta.supplier, file.name)
    : null;

  let docType: DocType;
  if (isMyDoc && myDocKind) {
    docType = myDocKind;
  } else {
    docType = classifyDocument({
      nif,
      country: meta.country,
      currency: meta.currency ?? 'EUR',
      supplier: meta.supplier,
      issuerNif: meta.issuerNif,
      companyNif,
      suppliers,
      confidence: meta.confidence,
    });
  }

  const parsedDate = meta.doc_date ? parseDocDate(meta.doc_date) : null;
  const year = parsedDate?.year ?? new Date().getFullYear();
  const month = parsedDate?.month ?? (new Date().getMonth() + 1);
  const quarter = resolveQuarter(month);

  const { path: destPath, rootFolderId } = buildDestPath(
    { docType, year, month, quarter },
    folderConfig,
    source,
  );

  const ext = file.name.split('.').pop() ?? 'pdf';
  const destFileName = buildDestFileName({
    date: meta.doc_date,
    supplier: meta.supplier,
    value: meta.value,
    ext,
  });

  return {
    file_id: file.id,
    file_name: file.name,
    inbox_folder_id: inboxFolderId,
    source,
    atcud: parseAtcud(meta.atcud),
    status: docType === 'unknown' ? 'manual_review' : 'pending',
    doc_type: docType,
    doc_date: meta.doc_date,
    supplier: meta.supplier,
    value: meta.value,
    nif,
    country: meta.country,
    currency: meta.currency ?? 'EUR',
    confidence: meta.confidence,
    dest_path: destPath,
    dest_file_name: destFileName,
    dest_root_folder_id: rootFolderId,
    dest_year: parsedDate?.year ?? null,
    dest_quarter: parsedDate ? quarter : null,
    dest_month: parsedDate ? resolveMonthPT(month) : null,
    is_my_doc: isMyDoc,
    vat_amount: meta.vat_amount ?? null,
    vat_rate: meta.vat_rate ?? null,
  };
}
