/**
 * parseStockList — turn an uploaded stock list (CSV or JSON) into the stock
 * item shape used by importStockList():
 *   { name, section, category, productCode, costPrice, wholeUnit, partUnit, unit }
 *
 * CSV: first row is treated as a header. Column names are matched loosely
 * (case/spacing/punctuation-insensitive) against a set of aliases, so a
 * customer's export doesn't have to use our exact field names.
 *
 * JSON: an array of objects (or { items: [...] }) whose keys are coerced the
 * same way.
 *
 * Only `name` is required. `section` defaults to 'bar' unless the value clearly
 * indicates kitchen. Everything else is optional.
 */

const FIELD_ALIASES = {
  name: ['name', 'product', 'productname', 'description', 'item', 'itemname'],
  section: ['section', 'area', 'location'],
  category: ['category', 'type', 'group', 'department'],
  productCode: ['productcode', 'code', 'sku', 'barcode', 'ref'],
  costPrice: ['costprice', 'cost', 'price', 'unitcost', 'buyingprice'],
  wholeUnit: ['wholeunit', 'pack', 'packsize', 'case', 'casesize', 'container', 'packaging'],
  partUnit: ['partunit', 'splitunit', 'split', 'subunit'],
  unit: ['unit', 'uom', 'unitofmeasure', 'measure'],
};

// Normalise a header/key for fuzzy matching: lowercase, strip non-alphanumerics.
function normKey(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeSection(value) {
  const s = String(value || '').toLowerCase();
  if (s.includes('kitchen') || s.includes('food') || s === 'k') return 'kitchen';
  return 'bar';
}

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const cleaned = String(value || '').replace(/[^0-9.\-]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

// Build a normalised item from a raw record (object with arbitrary-ish keys
// already resolved to our field names).
function coerceItem(raw) {
  const name = String(raw.name ?? '').trim();
  if (!name) return null;

  const wholeUnit = String(raw.wholeUnit ?? '').trim();
  return {
    name,
    section: normalizeSection(raw.section),
    category: String(raw.category ?? '').trim(),
    productCode: String(raw.productCode ?? '').trim(),
    costPrice: toNumber(raw.costPrice),
    wholeUnit,
    partUnit: String(raw.partUnit ?? '').trim(),
    unit: String(raw.unit ?? '').trim() || wholeUnit,
  };
}

// Map an arbitrary object's keys onto our field names using the alias table.
function mapObjectKeys(obj) {
  const out = {};
  const normalised = {};
  for (const k of Object.keys(obj)) normalised[normKey(k)] = obj[k];
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const alias of aliases) {
      if (normalised[alias] !== undefined) {
        out[field] = normalised[alias];
        break;
      }
    }
  }
  return out;
}

// Split CSV text into rows of fields, honouring quoted fields and "" escapes.
function splitCsvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }

  // Drop fully-empty rows (e.g. trailing newline)
  return rows.filter(r => r.some(cell => String(cell).trim() !== ''));
}

function parseCsv(text) {
  const rows = splitCsvRows(text);
  if (rows.length < 2) {
    return { items: [], skipped: 0, error: 'The file needs a header row and at least one item row.' };
  }

  const header = rows[0].map(normKey);

  // Resolve each of our fields to a column index via aliases.
  const colIndex = {};
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const idx = header.findIndex(h => aliases.includes(h));
    if (idx !== -1) colIndex[field] = idx;
  }

  if (colIndex.name === undefined) {
    return {
      items: [],
      skipped: 0,
      error: 'Could not find a "name" column. Include a column headed name (or product / item / description).',
    };
  }

  const items = [];
  let skipped = 0;
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const raw = {};
    for (const [field, idx] of Object.entries(colIndex)) {
      raw[field] = cells[idx];
    }
    const item = coerceItem(raw);
    if (item) items.push(item); else skipped++;
  }

  return { items, skipped, error: null };
}

function parseJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { items: [], skipped: 0, error: 'That file is not valid JSON.' };
  }
  const arr = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : null;
  if (!arr) {
    return { items: [], skipped: 0, error: 'Expected a JSON array of stock items.' };
  }
  const items = [];
  let skipped = 0;
  for (const entry of arr) {
    if (!entry || typeof entry !== 'object') { skipped++; continue; }
    const item = coerceItem(mapObjectKeys(entry));
    if (item) items.push(item); else skipped++;
  }
  return { items, skipped, error: null };
}

/**
 * Parse uploaded stock-list text into normalised items.
 * @param {string} text - file contents
 * @param {string} filename - used to pick CSV vs JSON (falls back to sniffing)
 * @returns {{ items: Array, skipped: number, error: string|null }}
 */
export function parseStockList(text, filename = '') {
  const trimmed = (text || '').trim();
  if (!trimmed) return { items: [], skipped: 0, error: 'The file is empty.' };

  const isJson = /\.json$/i.test(filename) || trimmed[0] === '[' || trimmed[0] === '{';
  return isJson ? parseJson(trimmed) : parseCsv(trimmed);
}

// A ready-made CSV template customers can fill in.
export const STOCK_CSV_TEMPLATE =
  'name,section,category,productCode,costPrice,wholeUnit,partUnit,unit\n' +
  '"Ale Example IPA Keg",bar,Draught Ale,1234,90.42,Keg 1*30ltr,Litre,Keg 1*30ltr\n' +
  '"House Red Wine",bar,Wine,5678,5.50,Bottle 1*75cl,Tenth,Bottle 1*75cl\n' +
  '"Chips 10kg",kitchen,Frozen,9012,12.00,10kg,,10kg\n';
