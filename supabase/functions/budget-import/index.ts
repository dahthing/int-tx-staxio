// supabase/functions/budget-import/index.ts
// Edge Function: POST multipart/form-data { file: xlsx }
// Parses budget forecast Excel and upserts into budget_forecasts table

import { createClient } from 'npm:@supabase/supabase-js@2';
import * as XLSX from 'npm:xlsx@0.18.5';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MONTH_COUNT = 12;

interface ForecastRow {
  year: number;
  month: number;
  section: string;
  category: string;
  owner: string | null;
  forecast_value: number;
}

interface Budget2026Categories {
  label: string;
  weight: number;
  forecast: number;
  actual: number;
  variance: number;
}

// Maps section-header labels to their section key; rows matching these are skipped (they are subtotals)
const SECTION_TRANSITIONS: Record<string, string> = {
  'Custos': 'cost',
  'Impostos / Taxas': 'tax',
  'Pessoas': 'people',
};

function parseSheetYear(sheet: XLSX.WorkSheet, sheetName: string): number {
  const nameMatch = sheetName.match(/\d{4}/);
  if (nameMatch) return parseInt(nameMatch[0], 10);

  const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1:A1');
  for (let r = range.s.r; r <= Math.min(range.s.r + 2, range.e.r); r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell && typeof cell.v === 'number' && cell.v >= 2020 && cell.v <= 2100) {
        return cell.v;
      }
    }
  }
  return new Date().getFullYear();
}

function parseSheet(sheet: XLSX.WorkSheet, year: number): ForecastRow[] {
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  const result: ForecastRow[] = [];

  let headerFound = false;
  let monthOffset = 2;
  let categoryCol = 1;
  let ownerCol = 0;
  let currentSection = 'revenue';
  let prevRowWasBlank = false; // guard: advance section only once per blank-row block

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as unknown[];

    if (!headerFound) {
      const c1 = row[1];
      const c2 = row[2];
      if (typeof c1 === 'string' && /^jan/i.test(c1)) {
        // compact-style: [Category, Jan, Fev, ..., Dez, TOTAL, ...]
        monthOffset = 1;
        categoryCol = 0;
        ownerCol = -1;
        headerFound = true;
      } else if (typeof c2 === 'string' && /^jan/i.test(c2)) {
        // extended-style: [Owner?, Category, Jan, Fev, ..., Dez, TOTAL, ...]
        monthOffset = 2;
        categoryCol = 1;
        ownerCol = 0;
        headerFound = true;
      }
      continue;
    }

    const catRaw = row[categoryCol];
    const catStr = catRaw != null ? String(catRaw).trim() : '';

    // Blank rows: only advance section once per contiguous blank block (old 2025 subtotal detection)
    if (!catStr) {
      if (!prevRowWasBlank && monthOffset === 2 && row[0] == null && row[1] == null) {
        const hasSubtotalValues = (row as unknown[])
          .slice(monthOffset, monthOffset + MONTH_COUNT)
          .some(v => typeof v === 'number' && (v as number) !== 0);
        if (hasSubtotalValues) {
          if (currentSection === 'revenue') currentSection = 'cost';
          else if (currentSection === 'cost') currentSection = 'people';
        }
      }
      prevRowWasBlank = true;
      continue;
    }
    prevRowWasBlank = false;

    // Skip numeric categories (subtotal rows)
    if (typeof catRaw === 'number') continue;

    // Named section-header rows → transition and skip
    if (catStr in SECTION_TRANSITIONS) {
      currentSection = SECTION_TRANSITIONS[catStr];
      continue;
    }

    // Skip header label rows
    if (catStr === 'Owner' || catStr === 'entrada' || catStr === 'Receita') continue;

    const section = currentSection;
    const owner =
      ownerCol >= 0 &&
      row[ownerCol] != null &&
      typeof row[ownerCol] === 'string' &&
      section === 'revenue'
        ? String(row[ownerCol]).trim()
        : null;

    // Extract month values
    let hasAnyValue = false;
    const monthRows: ForecastRow[] = [];
    for (let m = 0; m < MONTH_COUNT; m++) {
      const raw = row[monthOffset + m];
      const value = raw != null && typeof raw === 'number' ? raw : 0;
      if (value !== 0) hasAnyValue = true;
      monthRows.push({ year, month: m + 1, section, category: catStr, owner, forecast_value: value });
    }

    if (hasAnyValue) result.push(...monthRows);
  }

  return result;
}

function extract2026Categories(sheet: XLSX.WorkSheet): Budget2026Categories[] | null {
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  const result: Budget2026Categories[] = [];

  // Side annotations are in cols 14-18, rows 8-11 (0-indexed: rows 7-10)
  // Labels: Custos Fixo, Custos Variaveis, Impostos, Lucro
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as unknown[];
    const label = row[14];
    if (typeof label !== 'string') continue;
    const weight = typeof row[15] === 'number' ? row[15] : null;
    const forecast = typeof row[16] === 'number' ? row[16] : null;
    const actual = typeof row[17] === 'number' ? row[17] : null;
    const variance = typeof row[18] === 'number' ? row[18] : null;
    if (weight !== null && forecast !== null && actual !== null && variance !== null) {
      result.push({ label: label.trim(), weight, forecast, actual, variance });
    }
  }

  return result.length > 0 ? result : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return new Response(JSON.stringify({ error: 'Missing file field' }), {
        status: 400,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    let totalImported = 0;
    const years: number[] = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;

      const year = parseSheetYear(sheet, sheetName);
      const rows = parseSheet(sheet, year);

      if (rows.length === 0) continue;

      years.push(year);

      // Extract 2026 budget category metadata if present
      if (year === 2026) {
        const categories = extract2026Categories(sheet);
        if (categories) {
          await supabase.from('app_config').upsert(
            { key: 'budget_2026_categories', value: JSON.stringify(categories) },
            { onConflict: 'key' }
          );
        }
      }

      // Upsert in batches of 200
      const BATCH = 200;
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        const { error } = await supabase.from('budget_forecasts').upsert(batch, {
          onConflict: 'year,month,section,category',
        });
        if (error) throw new Error(error.message);
        totalImported += batch.length;
      }
    }

    return new Response(
      JSON.stringify({ imported: totalImported, years: [...new Set(years)].sort() }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
