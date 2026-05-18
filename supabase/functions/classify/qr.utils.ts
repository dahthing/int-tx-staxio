// supabase/functions/classify/qr.utils.ts
// Pré-classificação via QR code AT — 3 tiers antes de chamar Claude Vision

import type { ClaudeMeta } from './classify.utils.ts';

// Regex que identifica a string QR do AT dentro de texto extraído
// Formato: A:NIF*B:NIF*C:país*D:tipo*E:estado*F:YYYYMMDD*G:nºdoc*H:ATCUD*...*O:total*...
const AT_QR_REGEX = /A:\d{9}\*B:[^*]+\*C:[^*]+\*D:[^*]+\*E:[^*]+\*F:\d{8}\*G:[^*]+\*H:[A-Z0-9]+-\d+/;

// ============================================================
// Tier 1: extracção de texto do PDF via npm:unpdf
// ============================================================
export async function extractQrTextFromPdf(pdfBuffer: Uint8Array): Promise<string | null> {
  try {
    // @ts-ignore — npm:unpdf não tem types no Deno
    const { extractText } = await import('npm:unpdf@0.11.0');
    const { text } = await extractText(pdfBuffer, { mergePages: true });
    if (!text) return null;

    const match = text.match(AT_QR_REGEX);
    return match ? match[0] : null;
  } catch {
    return null;
  }
}

// ============================================================
// Tier 2: thumbnail Drive → decode QR image via npm:jsqr
// ============================================================
export async function extractQrTextFromThumbnail(
  fileId: string,
  accessToken: string,
): Promise<string | null> {
  try {
    // Drive thumbnail (PNG) — sz=w2000 para resolução suficiente para QR
    const thumbRes = await fetch(
      `https://drive.google.com/thumbnail?id=${fileId}&sz=w2000`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!thumbRes.ok) return null;

    const imgBuffer = new Uint8Array(await thumbRes.arrayBuffer());

    // Decode PNG para pixels via npm:jimp (suporta Deno, inclui PNG decode)
    // @ts-ignore
    const { Jimp } = await import('npm:jimp@1.6.0');
    const image = await Jimp.read(Buffer.from(imgBuffer));
    const { width, height } = image.bitmap;
    const data = new Uint8ClampedArray(image.bitmap.data);

    // @ts-ignore
    const jsQR = (await import('npm:jsqr@1.4.0')).default;
    const code = jsQR(data, width, height);
    if (!code?.data) return null;

    const match = code.data.match(AT_QR_REGEX);
    return match ? match[0] : null;
  } catch {
    return null;
  }
}

// ============================================================
// Parser do QR string AT → ClaudeMeta parcial
// ============================================================
const ATCUD_REGEX = /^[A-Z0-9]{8,}-\d+$/;

// Mapeia campo D do QR para classificação determinística
// Retorna null quando não há mapeamento (cai no Claude)
function mapDocType(d: string): 'issued' | 'received' | 'ecommerce' | null {
  switch (d.toUpperCase()) {
    case 'FT':  // Fatura
    case 'FS':  // Fatura simplificada
    case 'FR':  // Fatura-recibo
      return null; // Precisa do NIF B vs companyNif para saber issued/received
    case 'NC':  // Nota de crédito
    case 'ND':  // Nota de débito
      return 'received';
    case 'TV':  // Talão de venda
    case 'TD':  // Talão de devolução
      return 'ecommerce';
    default:
      return null;
  }
}

export interface QrMeta {
  partial: Partial<ClaudeMeta>;
  rawDocTypeCode: string;
  issuerNifFromQr: string;
  buyerNifFromQr: string;
}

export function parseAtQrString(qr: string): QrMeta | null {
  // Split por * e parse key:value
  const fields: Record<string, string> = {};
  for (const segment of qr.split('*')) {
    const colon = segment.indexOf(':');
    if (colon === -1) continue;
    fields[segment.slice(0, colon)] = segment.slice(colon + 1);
  }

  // Campos obrigatórios
  if (!fields['A'] || !fields['F'] || !fields['H'] || !fields['O']) return null;

  // Data: YYYYMMDD → YYYY-MM-DD
  const rawDate = fields['F'];
  if (rawDate.length !== 8) return null;
  const docDate = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;

  // ATCUD
  const atcud = fields['H'].toUpperCase();
  if (!ATCUD_REGEX.test(atcud)) return null;

  // Total
  const value = parseFloat(fields['O']);
  if (isNaN(value)) return null;

  const issuerNif = fields['A'] ?? '';
  const buyerNif = fields['B'] ?? '';
  const rawDocTypeCode = fields['D'] ?? '';

  return {
    partial: {
      doc_date: docDate,
      value,
      atcud,
      issuerNif: issuerNif || null,
      nif: issuerNif || null,
      country: 'Portugal',
      currency: 'EUR',
      confidence: 1.0,
    },
    rawDocTypeCode,
    issuerNifFromQr: issuerNif,
    buyerNifFromQr: buyerNif,
  };
}

// ============================================================
// Verifica se os metadados do QR são suficientes para saltar o Claude
// (precisa de data + valor + NIF emitente + ATCUD)
// ============================================================
export function isQrMetaSufficient(partial: Partial<ClaudeMeta>): boolean {
  return !!(partial.doc_date && partial.value !== null && partial.atcud);
}
