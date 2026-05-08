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
const SECTIONS = ['revenue', 'cost', 'people'] as const;
type Section = typeof SECTIONS[number];

interface ForecastRow {
  year: number;
  month: number;
  section: Section;
  category: string;
  owner: string | null;
  forecast_value: number;
}

function parseSheetYear(sheet: XLSX.WorkSheet, sheetName: string): number {
  // Try to extract year from sheet name first
  const nameMatch = sheetName.match(/\d{4}/);
  if (nameMatch) return parseInt(nameMatch[0], 10);

  // Fallback: scan first 3 rows for a 4-digit year number
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

  let sectionIdx = 0;
  let headerFound = false;
  // monthOffset: col index where Jan starts (2 for 2025-style, 1 for 2026-style)
  let monthOffset = 2;
  // categoryCol: col index of the category name
  let categoryCol = 1;
  // ownerCol: col index of owner (-1 = none)
  let ownerCol = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as unknown[];

    if (!headerFound) {
      // Detect header row: find first row that has "Jan"/"Fev"/"Mar" in col[1] or col[2]
      const c1 = row[1]; const c2 = row[2];
      if (typeof c1 === 'string' && /^jan/i.test(c1)) {
        // 2026-style: [Category, Jan, Fev, ..., Dez, TOTAL, ...]
        monthOffset = 1;
        categoryCol = 0;
        ownerCol = -1;
        headerFound = true;
      } else if (typeof c2 === 'string' && /^jan/i.test(c2)) {
        // 2025-style: [Owner, Category, Jan, Fev, ..., Dez, TOTAL, ...]
        monthOffset = 2;
        categoryCol = 1;
        ownerCol = 0;
        headerFound = true;
      }
      continue;
    }

    const col0 = row[0];
    const catRaw = row[categoryCol];

    const col0Empty = col0 == null || String(col0).trim() === '';
    const catEmpty  = catRaw == null || String(catRaw).trim() === '';

    // Detect subtotal row: category cell is empty but numeric values exist in month cols
    const hasMonthValues = (() => {
      for (let m = monthOffset; m < monthOffset + MONTH_COUNT; m++) {
        if (row[m] != null && typeof row[m] === 'number') return true;
      }
      return false;
    })();

    if (catEmpty) {
      if (hasMonthValues) sectionIdx++; // subtotal row → next section
      continue;
    }

    // Skip if category is a number (total/summary row)
    if (typeof catRaw === 'number') continue;

    const section = SECTIONS[Math.min(sectionIdx, SECTIONS.length - 1)];
    const category = String(catRaw).trim();
    const owner = (ownerCol >= 0 && !col0Empty && section === 'revenue')
      ? String(col0).trim()
      : null;

    // Extract month values
    let allZero = true;
    const monthRows: ForecastRow[] = [];
    for (let m = 0; m < MONTH_COUNT; m++) {
      const raw = row[monthOffset + m];
      const value = (raw != null && typeof raw === 'number') ? raw : 0;
      if (value !== 0) allZero = false;
      monthRows.push({ year, month: m + 1, section, category, owner, forecast_value: value });
    }

    // Skip rows where every month is 0 AND row has no data at all
    if (!allZero) result.push(...monthRows);
  }

  return result;
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
