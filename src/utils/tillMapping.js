/**
 * tillMapping — join till products (sales-report lines) to stock items.
 *
 * A till sells SALE UNITS ("GUINNESS HALF", "175 PINOT GRIGO", "GORDONS GIN
 * DOUBLE"); stock is counted in base units. A mapping doc per till product
 * ({venuePath}/tillProducts/{key}) records which stock item it depletes and
 * the sale measure, as a perBase factor:
 *   expected depletion = qty sold × perBase   (in the item's base units)
 *
 * The sale-unit rows come from wastageUnitsFor — wastage and sales deplete
 * stock in exactly the same measures — so perBase is never invented here.
 */

import { wastageUnitsFor } from './wastageUnits';

export const normName = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Stable doc key for a till line: its till ProductID when present, else its
 * normalised name ('/' is illegal in Firestore ids).
 */
export function productKeyFor(line) {
  const id = String(line.productId || '').trim();
  return (id || `n:${normName(line.name)}`).replace(/\//g, '_');
}

/** The sale-unit choices for mapping a stock item (labels ready for chips). */
export function saleUnitOptions(item) {
  const { rows, baseLabel } = wastageUnitsFor(item);
  return {
    baseLabel,
    options: rows.map((r) => ({
      key: r.key,
      label: r.hint ? `${r.label} (${r.hint})` : r.label,
      perBase: r.perBase,
    })),
  };
}

// AI unit vocabulary → candidate row keys, tried in order against the item's
// actual rows (a "bottle" of beer is a packaged 'single'; of wine, a 'bottle').
const UNIT_KEY_CANDIDATES = {
  single: ['single'],
  double: ['double'],
  bottle: ['bottle', 'single', 'whole'],
  glass125: ['g125'],
  glass175: ['g175'],
  glass250: ['g250'],
  pint: ['pint'],
  half: ['half'],
  whole: ['whole', 'bottle', 'single'],
  one: ['single', 'whole', 'bottle'],
};

/** Resolve an AI-suggested unit word to one of the item's sale-unit rows. */
export function resolveUnitRow(item, unitWord) {
  const candidates = UNIT_KEY_CANDIDATES[unitWord] || [];
  const { rows } = wastageUnitsFor(item);
  for (const key of candidates) {
    const row = rows.find((r) => r.key === key);
    if (row) return row;
  }
  return null;
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Aggregate a report's lines into expected stock depletion per item.
 *
 * @param {Array} lines - sales report lines
 * @param {Object} mappingsByKey - productKey → tillProducts doc
 * @returns {{ perItem: Array<{itemId,itemName,baseLabel,quantity,lines}>,
 *   mappedLines, ignoredLines, unmappedLines, mappedValue, totalValue }}
 */
export function computeDepletion(lines, mappingsByKey) {
  const perItem = new Map();
  let mappedLines = 0, ignoredLines = 0, unmappedLines = 0, mappedValue = 0, totalValue = 0;

  for (const l of lines || []) {
    const value = Number(l.valueIncVAT) || 0;
    totalValue += value;
    const m = mappingsByKey[productKeyFor(l)];
    if (!m) { unmappedLines++; continue; }
    if (m.ignore) { ignoredLines++; mappedValue += value; continue; }
    if (!(m.itemId && Number(m.perBase) > 0)) { unmappedLines++; continue; }

    mappedLines++;
    mappedValue += value;
    const cur = perItem.get(m.itemId) || {
      itemId: m.itemId, itemName: m.itemName || '', baseLabel: m.baseLabel || '', quantity: 0, lines: 0,
    };
    cur.quantity += (Number(l.qty) || 0) * Number(m.perBase);
    cur.lines++;
    perItem.set(m.itemId, cur);
  }

  const arr = [...perItem.values()]
    .map((x) => ({ ...x, quantity: round2(x.quantity) }))
    .sort((a, b) => a.itemName.localeCompare(b.itemName));

  return {
    perItem: arr,
    mappedLines, ignoredLines, unmappedLines,
    mappedValue: round2(mappedValue), totalValue: round2(totalValue),
  };
}
