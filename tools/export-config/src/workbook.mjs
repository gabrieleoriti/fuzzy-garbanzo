// Loads an .xlsx into a plain, engine-agnostic model so the export rules don't
// depend on ExcelJS:
//
//   Map<sheetName, { name, rowCount, colCount, cell(row, col) -> { v, f } }>
//
// v: number | string | boolean | null | { error: "#REF!" }  (for formulas: the cached result)
// f: the formula text (without "="), or null for a typed value.
// Rows and columns are 1-based, as in the spreadsheet.
import ExcelJS from 'exceljs';

export async function loadXlsx(path) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  return fromExcelJs(wb);
}

export function fromExcelJs(wb) {
  const sheets = new Map();
  wb.eachSheet((ws) => {
    const rowCount = ws.rowCount;
    const colCount = ws.columnCount;
    const grid = [];
    for (let r = 1; r <= rowCount; r++) {
      const row = ws.getRow(r);
      const cells = [];
      for (let c = 1; c <= colCount; c++) cells.push(normalizeCell(row.getCell(c)));
      grid.push(cells);
    }
    sheets.set(ws.name, {
      name: ws.name,
      rowCount,
      colCount,
      cell: (r, c) => grid[r - 1]?.[c - 1] ?? EMPTY,
    });
  });
  return sheets;
}

const EMPTY = Object.freeze({ v: null, f: null });

function normalizeCell(cell) {
  const raw = cell.value;
  if (raw && typeof raw === 'object' && ('formula' in raw || 'sharedFormula' in raw)) {
    const f = cell.formula || raw.formula || raw.sharedFormula || '';
    return { v: normalizeValue(raw.result), f: String(f).replace(/^=/, '') };
  }
  return { v: normalizeValue(raw), f: null };
}

function normalizeValue(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number' || typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') return raw.trim() === '' ? null : raw.trim();
  if (raw instanceof Date) return raw.toISOString();
  if (typeof raw === 'object') {
    if ('error' in raw) return { error: String(raw.error) };
    if (Array.isArray(raw.richText)) return normalizeValue(raw.richText.map((t) => t.text).join(''));
    if ('text' in raw) return normalizeValue(typeof raw.text === 'string' ? raw.text : raw.text?.richText?.map((t) => t.text).join(''));
  }
  return String(raw);
}

/** 1 -> "A", 27 -> "AA" */
export function colLetter(c) {
  let s = '';
  for (; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + ((c - 1) % 26)) + s;
  return s;
}
