// supabase/functions/classify/classify.test.ts — v2
import { describe, it, expect } from 'vitest';
import {
  classifyDocument,
  detectSupplier,
  buildDestPath,
  buildDestFileName,
  buildQueuePayload,
  parseDocDate,
  resolveQuarter,
  resolveMonthPT,
  isPortugueseNif,
  extractNif,
  slugify,
} from './classify.utils.ts';
import type { Supplier, FolderConfig, ClassifyInput, ClaudeMeta } from './classify.utils.ts';

// ============================================================
// FIXTURES
// ============================================================
const COMPANY_NIF = '514084235';

const SUPPLIERS: Supplier[] = [
  { name: 'EasyPay',  nif: null, keywords: ['easypay'], type: 'ecommerce' },
  { name: 'Awartsian', nif: null, keywords: ['awartsian'], type: 'ecommerce' },
  { name: 'Gemmams',  nif: null, keywords: ['gemmams'], type: 'ecommerce' },
  { name: 'CGD',      nif: null, keywords: ['caixa geral', 'cgd'], type: 'bank' },
  { name: 'PayPal',   nif: null, keywords: ['paypal'], type: 'bank' },
  { name: 'Revolut',  nif: null, keywords: ['revolut'], type: 'bank' },
];

const FOLDERS: FolderConfig[] = [
  { key: 'root',          folder_id: '1klmq4RPuov5T9KJeYz7ffOH-avXIptN7', folder_name: 'Staxio',                    parent_key: null,   auto_create: false },
  { key: 'inbox',         folder_id: '1Ily9nKfC6Hnqi970kdcx92Xjtrz8V9Q7', folder_name: 'Inbox_Contabilidade',       parent_key: 'root', auto_create: false },
  { key: 'internacional', folder_id: '1gonX4rK5wP5N_7615tOdUw1E1EFs7iOo', folder_name: 'Internacional',             parent_key: 'root', auto_create: false },
  { key: 'faturas_vendas',folder_id: '1ZHYr7mXTFifFMO9FNRWo6dzqWw3iVv8d', folder_name: 'Faturas Vendas',            parent_key: 'root', auto_create: false },
  { key: 'extratos',      folder_id: '1Bul9s71rvh0ijYjhKNRF9gMNJ2tFDMpN', folder_name: 'Extratos Bancarios',        parent_key: 'root', auto_create: false },
  { key: 'compras',       folder_id: '1G7OOdefj6aod2AHLypzhs-yxettbxEr5', folder_name: 'Compras & Materias Primas', parent_key: 'root', auto_create: false },
];

const base = (overrides: Partial<ClassifyInput> = {}): ClassifyInput => ({
  nif: '123456789',
  issuerNif: '999999999',
  companyNif: COMPANY_NIF,
  country: 'Portugal',
  currency: 'EUR',
  supplier: 'Fornecedor Genérico',
  suppliers: SUPPLIERS,
  confidence: 0.9,
  ...overrides,
});

// ============================================================
// NIF
// ============================================================
describe('isPortugueseNif', () => {
  it('aceita 9 dígitos', () => expect(isPortugueseNif('123456789')).toBe(true));
  it('rejeita com prefixo país', () => expect(isPortugueseNif('PT123456789')).toBe(false));
  it('rejeita menos de 9', () => expect(isPortugueseNif('12345678')).toBe(false));
  it('rejeita mais de 9', () => expect(isPortugueseNif('1234567890')).toBe(false));
});

describe('extractNif', () => {
  it('extrai NIF PT', () => expect(extractNif('NIF: 123456789')).toBe('123456789'));
  it('extrai VAT EU', () => expect(extractNif('VAT: DE123456789')).toBe('DE123456789'));
  it('retorna null sem NIF', () => expect(extractNif('sem número')).toBeNull());
});

// ============================================================
// DETECÇÃO DE FORNECEDOR
// ============================================================
describe('detectSupplier', () => {
  it('detecta EasyPay por keyword', () =>
    expect(detectSupplier('EasyPay Portugal', null, SUPPLIERS)?.name).toBe('EasyPay'));

  it('detecta CGD por keyword parcial', () =>
    expect(detectSupplier('Caixa Geral de Depósitos', null, SUPPLIERS)?.name).toBe('CGD'));

  it('detecta Revolut', () =>
    expect(detectSupplier('Revolut Ltd', null, SUPPLIERS)?.name).toBe('Revolut'));

  it('retorna null para fornecedor desconhecido', () =>
    expect(detectSupplier('Empresa Desconhecida', null, SUPPLIERS)).toBeNull());

  it('retorna null para nome e NIF null', () =>
    expect(detectSupplier(null, null, SUPPLIERS)).toBeNull());
});

// ============================================================
// CLASSIFICAÇÃO
// ============================================================
describe('classifyDocument', () => {
  it('classifica como issued quando NIF emitente = company NIF', () =>
    expect(classifyDocument(base({ issuerNif: COMPANY_NIF }))).toBe('issued'));

  it('classifica como international com moeda USD', () =>
    expect(classifyDocument(base({ currency: 'USD' }))).toBe('international'));

  it('classifica como international com NIF não-PT', () =>
    expect(classifyDocument(base({ nif: 'DE123456789' }))).toBe('international'));

  it('classifica como international com país Spain', () =>
    expect(classifyDocument(base({ country: 'Spain' }))).toBe('international'));

  it('classifica como ecommerce para EasyPay', () =>
    expect(classifyDocument(base({ supplier: 'EasyPay Portugal' }))).toBe('ecommerce'));

  it('classifica como ecommerce para Gemmams', () =>
    expect(classifyDocument(base({ supplier: 'Gemmams Store' }))).toBe('ecommerce'));

  it('classifica como bank_statement para CGD', () =>
    expect(classifyDocument(base({ supplier: 'Caixa Geral de Depósitos' }))).toBe('bank_statement'));

  it('classifica como bank_statement para PayPal', () =>
    expect(classifyDocument(base({ supplier: 'PayPal' }))).toBe('bank_statement'));

  it('classifica como bank_statement para Revolut', () =>
    expect(classifyDocument(base({ supplier: 'Revolut' }))).toBe('bank_statement'));

  it('classifica como received para fatura PT normal', () =>
    expect(classifyDocument(base())).toBe('received'));

  it('classifica como unknown com confiança baixa (sem sinais determinísticos)', () =>
    expect(classifyDocument(base({ confidence: 0.4 }))).toBe('unknown'));

  it('classifica como international com confiança baixa mas moeda USD (sinal determinístico)', () =>
    expect(classifyDocument(base({ confidence: 0.4, currency: 'USD' }))).toBe('international'));

  it('classifica como international com confiança baixa mas NIF não-PT (sinal determinístico)', () =>
    expect(classifyDocument(base({ confidence: 0.4, nif: 'IE3335493BH' }))).toBe('international'));

  it('classifica como unknown sem NIF e sem país', () =>
    expect(classifyDocument(base({ nif: null, country: null }))).toBe('unknown'));
});

// ============================================================
// PATH DESTINO
// ============================================================
describe('buildDestPath', () => {
  it('issued → 2026/Faturas Vendas/MAR', () => {
    const r = buildDestPath({ docType: 'issued', year: 2026, month: 3, quarter: 1 }, FOLDERS);
    expect(r.path).toBe('2026/Faturas Vendas/MAR');
    expect(r.rootFolderId).toBe('1klmq4RPuov5T9KJeYz7ffOH-avXIptN7');
  });

  it('bank_statement → 2026/Extratos Bancarios (sem mês)', () => {
    const r = buildDestPath({ docType: 'bank_statement', year: 2026, month: 1, quarter: 1 }, FOLDERS);
    expect(r.path).toBe('2026/Extratos Bancarios');
    expect(r.rootFolderId).toBe('1klmq4RPuov5T9KJeYz7ffOH-avXIptN7');
  });

  it('supplies → 2026/Compras & Materias Primas (sem mês)', () => {
    const r = buildDestPath({ docType: 'supplies', year: 2026, month: 2, quarter: 1 }, FOLDERS);
    expect(r.path).toBe('2026/Compras & Materias Primas');
    expect(r.rootFolderId).toBe('1klmq4RPuov5T9KJeYz7ffOH-avXIptN7');
  });

  it('international → 2026/Internacional/ABR', () => {
    const r = buildDestPath({ docType: 'international', year: 2026, month: 4, quarter: 2 }, FOLDERS);
    expect(r.path).toBe('2026/Internacional/ABR');
    expect(r.rootFolderId).toBe('1klmq4RPuov5T9KJeYz7ffOH-avXIptN7');
  });

  it('ecommerce → 2026/Faturas e Talões 2T/eCommerce', () => {
    const r = buildDestPath({ docType: 'ecommerce', year: 2026, month: 5, quarter: 2 }, FOLDERS);
    expect(r.path).toBe('2026/Faturas e Talões 2T/eCommerce');
  });

  it('received → 2026/Faturas e Talões 1T/JAN', () => {
    const r = buildDestPath({ docType: 'received', year: 2026, month: 1, quarter: 1 }, FOLDERS);
    expect(r.path).toBe('2026/Faturas e Talões 1T/JAN');
  });

  it('unknown → _aguardar_validacao', () => {
    const r = buildDestPath({ docType: 'unknown', year: 2026, month: 1, quarter: 1 }, FOLDERS);
    expect(r.path).toBe('_aguardar_validacao');
  });
});

// ============================================================
// TRIMESTRE E MÊS
// ============================================================
describe('resolveQuarter', () => {
  it.each([
    [1,1],[2,1],[3,1],[4,2],[5,2],[6,2],
    [7,3],[8,3],[9,3],[10,4],[11,4],[12,4]
  ])('mês %i → Q%i', (m, q) => expect(resolveQuarter(m)).toBe(q));
});

describe('resolveMonthPT', () => {
  it.each([
    [1,'JAN'],[2,'FEV'],[3,'MAR'],[4,'ABR'],[5,'MAI'],[6,'JUN'],
    [7,'JUL'],[8,'AGO'],[9,'SET'],[10,'OUT'],[11,'NOV'],[12,'DEZ']
  ])('mês %i → %s', (m, label) => expect(resolveMonthPT(m)).toBe(label));
});

// ============================================================
// NOME DE FICHEIRO
// ============================================================
describe('buildDestFileName', () => {
  it('gera nome standard', () =>
    expect(buildDestFileName({ date: '2026-03-15', supplier: 'Continente', value: 150, ext: 'pdf' }))
      .toBe('2026-03-15_continente_150.00.pdf'));

  it('normaliza acentos e espaços', () =>
    expect(buildDestFileName({ date: '2026-03-15', supplier: 'Água & Luz Lda.', value: 45.5, ext: 'pdf' }))
      .toBe('2026-03-15_agua-luz-lda_45.50.pdf'));

  it('usa desconhecido quando supplier null', () =>
    expect(buildDestFileName({ date: '2026-01-01', supplier: null, value: 0, ext: 'pdf' }))
      .toBe('2026-01-01_desconhecido_0.00.pdf'));
});

// ============================================================
// SLUGIFY
// ============================================================
describe('slugify', () => {
  it('remove acentos', () => expect(slugify('Água')).toBe('agua'));
  it('substitui espaços por hífen', () => expect(slugify('Caixa Geral')).toBe('caixa-geral'));
  it('remove pontuação', () => expect(slugify('Lda.')).toBe('lda'));
});

// ============================================================
// BUILD QUEUE PAYLOAD
// ============================================================
describe('buildQueuePayload', () => {
  const file = { id: 'gdrive-abc', name: 'fatura.pdf' };
  const inboxId = '1Ily9nKfC6Hnqi970kdcx92Xjtrz8V9Q7';

  const baseMeta = (): ClaudeMeta => ({
    doc_date: '2026-03-15',
    supplier: 'Continente',
    issuerNif: null,
    value: 150,
    nif: '123456789',
    country: 'Portugal',
    currency: 'EUR',
    confidence: 0.9,
  });

  it('doc_type received para fatura PT normal', () => {
    const p = buildQueuePayload(file, inboxId, baseMeta(), SUPPLIERS, FOLDERS, COMPANY_NIF);
    expect(p.doc_type).toBe('received');
    expect(p.status).toBe('pending');
  });

  it('doc_type issued quando issuerNif = companyNif', () => {
    const p = buildQueuePayload(file, inboxId, { ...baseMeta(), issuerNif: COMPANY_NIF }, SUPPLIERS, FOLDERS, COMPANY_NIF);
    expect(p.doc_type).toBe('issued');
    expect(p.dest_path).toBe('2026/Faturas Vendas/MAR');
    expect(p.dest_root_folder_id).toBe('1klmq4RPuov5T9KJeYz7ffOH-avXIptN7');
  });

  it('doc_type ecommerce para EasyPay', () => {
    const p = buildQueuePayload(file, inboxId, { ...baseMeta(), supplier: 'EasyPay Portugal' }, SUPPLIERS, FOLDERS, COMPANY_NIF);
    expect(p.doc_type).toBe('ecommerce');
    expect(p.dest_path).toBe('2026/Faturas e Talões 1T/eCommerce');
  });

  it('doc_type bank_statement para CGD', () => {
    const p = buildQueuePayload(file, inboxId, { ...baseMeta(), supplier: 'Caixa Geral de Depósitos' }, SUPPLIERS, FOLDERS, COMPANY_NIF);
    expect(p.doc_type).toBe('bank_statement');
    expect(p.dest_path).toBe('2026/Extratos Bancarios');
  });

  it('doc_type international para moeda USD', () => {
    const p = buildQueuePayload(file, inboxId, { ...baseMeta(), currency: 'USD' }, SUPPLIERS, FOLDERS, COMPANY_NIF);
    expect(p.doc_type).toBe('international');
    expect(p.dest_path).toMatch(/^\d{4}\/Internacional\//);  // 2026/Internacional/...
  });

  it('status manual_review para doc_type unknown', () => {
    const p = buildQueuePayload(file, inboxId, { ...baseMeta(), confidence: 0.3 }, SUPPLIERS, FOLDERS, COMPANY_NIF);
    expect(p.doc_type).toBe('unknown');
    expect(p.status).toBe('manual_review');
    expect(p.dest_path).toBe('_aguardar_validacao');
  });

  it('preenche file_id, file_name e inbox_folder_id', () => {
    const p = buildQueuePayload(file, inboxId, baseMeta(), SUPPLIERS, FOLDERS, COMPANY_NIF);
    expect(p.file_id).toBe('gdrive-abc');
    expect(p.file_name).toBe('fatura.pdf');
    expect(p.inbox_folder_id).toBe(inboxId);
  });

  it('preenche dest_year, dest_quarter, dest_month a partir da data', () => {
    const p = buildQueuePayload(file, inboxId, baseMeta(), SUPPLIERS, FOLDERS, COMPANY_NIF);
    expect(p.dest_year).toBe(2026);
    expect(p.dest_quarter).toBe(1);
    expect(p.dest_month).toBe('MAR');
  });

  it('dest_year/quarter/month null quando sem data', () => {
    const p = buildQueuePayload(file, inboxId, { ...baseMeta(), doc_date: null }, SUPPLIERS, FOLDERS, COMPANY_NIF);
    expect(p.dest_year).toBeNull();
    expect(p.dest_quarter).toBeNull();
    expect(p.dest_month).toBeNull();
  });

  it('extrai NIF do nome do fornecedor quando nif null', () => {
    const p = buildQueuePayload(file, inboxId, { ...baseMeta(), nif: null, supplier: 'Empresa NIF: 987654321' }, SUPPLIERS, FOLDERS, COMPANY_NIF);
    expect(p.nif).toBe('987654321');
  });

  it('gera dest_file_name correcto', () => {
    const p = buildQueuePayload(file, inboxId, baseMeta(), SUPPLIERS, FOLDERS, COMPANY_NIF);
    expect(p.dest_file_name).toBe('2026-03-15_continente_150.00.pdf');
  });
});

