/**
 * parseSalesReport — turn a till's daily sales export (CSV) into the shape
 * stored in {venuePath}/salesReports.
 *
 * Currently supports per-product daily summary layouts (one row per till
 * product with qty/value/cost columns), matched by loose header aliases like
 * parseStockList — so column naming can vary a little between tills. Layouts
 * the aliases can't resolve will later fall back to AI column detection; tills
 * with an API will skip files entirely.
 *
 * The report DATE usually isn't in the data — tills put it in the filename
 * (e.g. "DailySales_2026_07_06_1623.csv") — so we extract a best guess for the
 * user to confirm.
 */

import { detectDelimiter, splitCsvRows } from './parseStockList';

const FIELD_ALIASES = {
  productId: ['productid', 'id', 'plu', 'productref'],
  name: ['name', 'product', 'productname', 'item', 'itemname', 'description'],
  size: ['size', 'measure'],
  qty: ['qty', 'quantity', 'qtysold', 'sold', 'units', 'count'],
  valueIncVAT: ['valueincvat', 'value', 'gross', 'grosssales', 'totalincvat', 'salesincvat', 'total'],
  valueExcVAT: ['valueexcvat', 'net', 'netsales', 'totalexcvat', 'salesexcvat'],
  discount: ['discount', 'discounts', 'discountvalue'],
  cost: ['totcost', 'cost', 'totalcost', 'costofsales', 'costvalue'],
  margin: ['margin', 'profit', 'grossprofit', 'gp'],
};

const normKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const cleaned = String(value || '').replace(/[^0-9.\-]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

const round2 = (n) => Math.round(n * 100) / 100;

/** Best-guess report date from the export's filename → 'YYYY-MM-DD' or null. */
export function dateFromFilename(filename) {
  const m = String(filename || '').match(/(20\d{2})[._\- ](\d{1,2})[._\- ](\d{1,2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const month = parseInt(mo, 10), day = parseInt(d, 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Parse a sales export.
 * @param {string} text - file contents
 * @param {string} filename - used for the report-date guess
 * @returns {{ lines, skipped, totals, reportDate, error }}
 *   lines:  [{ productId, name, size, qty, valueIncVAT, valueExcVAT, discount, cost, margin }]
 *   totals: { qty, valueIncVAT, valueExcVAT, discount, cost, margin, costedLines }
 */
export function parseSalesReport(text, filename = '') {
  const trimmed = (text || '').trim();
  if (!trimmed) return { lines: [], skipped: 0, totals: null, reportDate: null, error: 'The file is empty.' };

  const clean = trimmed.replace(/^﻿/, '');
  const delimiter = detectDelimiter(clean);
  const rows = splitCsvRows(clean, delimiter);
  if (rows.length < 2) {
    return { lines: [], skipped: 0, totals: null, reportDate: null, error: 'The file needs a header row and at least one sales row.' };
  }

  const header = rows[0].map(normKey);
  const colIndex = {};
  // Aliases are in priority order (e.g. an explicit ValueIncVAT column beats a
  // generic Value one), so resolve alias-first rather than header-first.
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const alias of aliases) {
      const idx = header.indexOf(alias);
      if (idx !== -1) { colIndex[field] = idx; break; }
    }
  }

  if (colIndex.name === undefined || colIndex.qty === undefined || colIndex.valueIncVAT === undefined) {
    return {
      lines: [], skipped: 0, totals: null, reportDate: null,
      error: "This doesn't look like a sales report we recognise yet — it needs product, quantity and value columns.",
    };
  }

  const lines = [];
  let skipped = 0;
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const get = (f) => (colIndex[f] !== undefined ? cells[colIndex[f]] : '');
    const name = String(get('name') ?? '').replace(/\s+/g, ' ').trim();
    // Footer/summary rows ("Total:") and nameless rows aren't sales lines.
    if (!name || /^total\b/i.test(name)) { skipped++; continue; }
    lines.push({
      productId: String(get('productId') ?? '').trim(),
      name,
      size: String(get('size') ?? '').trim(),
      qty: toNumber(get('qty')),
      valueIncVAT: toNumber(get('valueIncVAT')),
      valueExcVAT: toNumber(get('valueExcVAT')),
      discount: toNumber(get('discount')),
      cost: toNumber(get('cost')),
      margin: toNumber(get('margin')),
    });
  }

  if (lines.length === 0) {
    return { lines: [], skipped, totals: null, reportDate: null, error: 'No sales rows found in the file.' };
  }

  const totals = { qty: 0, valueIncVAT: 0, valueExcVAT: 0, discount: 0, cost: 0, margin: 0, costedLines: 0 };
  for (const l of lines) {
    totals.qty += l.qty;
    totals.valueIncVAT += l.valueIncVAT;
    totals.valueExcVAT += l.valueExcVAT;
    totals.discount += l.discount;
    totals.cost += l.cost;
    totals.margin += l.margin;
    if (l.cost > 0) totals.costedLines++;
  }
  for (const k of ['qty', 'valueIncVAT', 'valueExcVAT', 'discount', 'cost', 'margin']) totals[k] = round2(totals[k]);

  return { lines, skipped, totals, reportDate: dateFromFilename(filename), error: null };
}

/** Aggregate GP% for display: margin over net sales (0..1), or null if unknowable. */
export function grossProfitPct(totals) {
  if (!totals || !(totals.valueExcVAT > 0)) return null;
  return totals.margin / totals.valueExcVAT;
}
