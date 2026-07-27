/**
 * deliveryDoc — reading a supplier's delivery note and reconciling its lines
 * against the venue's stock list.
 *
 * A delivery note names the same product three different ways to three
 * different audiences, and only one of them is safe to act on:
 *
 *   "11 K CARLING LAGER  …  2 EA"
 *      ↑ container size        ↑ quantity
 *
 * The leading token is the CONTAINER, never a quantity: "11 K" is an 11-gallon
 * (50 litre) keg, "50 K" a 50-litre keg, "30 K" a 30-litre one. Read as a count
 * it would put eleven of something into stock instead of two kegs. The quantity
 * always comes from the Qty Delivered column, and its unit code says what one
 * of them is (see unitsForLine).
 *
 * Matching lines to stock items is CONTAINER CLASS FIRST, name second. Names
 * alone mislead: "30 K REKORD STRAWB/LIME" scores higher against the bottled
 * "Rekorderlig - Strawberry & Lime 0%" than against the draught "Rekorderlig"
 * it actually is, and "11 K GUINNESS KEG" looks a lot like "Guinness - 0%".
 * Filtering candidates to the same container class first turns both of those
 * into single-candidate matches before any name is compared.
 *
 * Everything here is pure and offline — the AI pass (extractDeliveryNote) only
 * turns the document into lines; this decides what those lines mean.
 */

import { deliveryUnitsFor } from './deliveryUnits';

/**
 * The hard constraint when matching. Deliberately coarse: bottles/cans/cases
 * all collapse into "packaged" because venues model those differently (a case
 * of 6 spirits might be six "Bottle 1*70cl" items or one "Case 1*6Each"), while
 * keg / cask / bib / weight are genuinely different things that must never be
 * matched across.
 */
export const CONTAINER_CLASSES = ['keg', 'cask', 'bib', 'packaged', 'weight', 'other'];

/** Container class of a stock item, from how it's counted (wholeUnit). */
export function containerClassOfItem(item) {
  const whole = (item?.wholeUnit || item?.unit || '').trim().toLowerCase();
  if (!whole) return 'other';
  if (/^keg\b/.test(whole)) return 'keg';
  if (/^cask\b/.test(whole)) return 'cask';
  if (/^bib\b/.test(whole) || /bag.?in.?box/.test(whole)) return 'bib';
  // Checked before the weight rule: "Case 36*50g" is a box of crisps, not bulk.
  if (/^(bottle|case|box|pack|punnet|tray|dozen)\b/.test(whole)) return 'packaged';
  if (/^\d+(\.\d+)?(cl|ml)$/.test(whole)) return 'packaged';
  if (/\b\d*(\.\d+)?(kg|kilogram|gram)s?\b/.test(whole)) return 'weight';
  if (/^(bag|tub|sack)\b/.test(whole)) return 'packaged';
  return 'other';
}

/**
 * Container class of a note line, from its pack-size token and description.
 * The supplier's own `container` guess (from the AI extraction) is only used
 * when nothing in the text is decisive.
 */
export function containerClassOfLine(line) {
  const text = `${line?.packSize || ''} ${line?.description || ''}`.toUpperCase();
  if (/\b\d+\s*K\b/.test(text) || /\bKEGS?\b/.test(text)) return 'keg';
  if (/\bCASKS?\b/.test(text) || /\bFIRKIN\b/.test(text)) return 'cask';
  if (/\bBIB\b/.test(text) || /BAG.?IN.?BOX/.test(text) || /POST.?MIX/.test(text)) return 'bib';
  // "X24", "4X24", "X6" — an outer of packaged units, whatever its contents.
  if (/X\s*\d+\b/.test(text)) return 'packaged';
  if (/\b\d+(\.\d+)?\s*(KG|KILO)\b/.test(text)) return 'weight';
  if (/\b\d+(\.\d+)?\s*(ML|CL|LTR|L|GM|G)\b/.test(text)) return 'packaged';
  if (/\b(CAN|CANS|BTL|BOTTLE|BOTTLES)\b/.test(text)) return 'packaged';
  return CONTAINER_CLASSES.includes(line?.container) ? line.container : 'other';
}

/** Two container classes may describe the same product ('other' matches all). */
export function containersCompatible(a, b) {
  return a === 'other' || b === 'other' || a === b;
}

/** Blank numeric columns come back as -1 from the extraction. */
const present = (n) => typeof n === 'number' && n >= 0;

/**
 * What actually arrived. Delivered is the signed-for column and the only one
 * stock should move on; Despatched/Ordered are fallbacks for notes that don't
 * print a Delivered column at all.
 */
export function deliveredQty(line) {
  if (present(line?.qtyDelivered)) return line.qtyDelivered;
  if (present(line?.qtyDespatched)) return line.qtyDespatched;
  if (present(line?.qtyOrdered)) return line.qtyOrdered;
  return 0;
}

/** Delivered short of what left the depot — a credit claim, not a silent write-down. */
export function shortDelivery(line) {
  return present(line?.qtyDespatched) && present(line?.qtyDelivered)
    && line.qtyDelivered < line.qtyDespatched;
}

/** The depot couldn't fill the order. Doesn't affect stock; managers want to see it. */
export function shortDespatch(line) {
  return present(line?.qtyOrdered) && present(line?.qtyDespatched)
    && line.qtyDespatched < line.qtyOrdered;
}

/**
 * Goods going the OTHER way — empty kegs collected, returns, crate swaps.
 * The tell is structural rather than lexical: no supplier item code and no
 * ordered/despatched figures, just a delivered count. Safer than matching the
 * word "KEG", which appears on half the real lines too.
 */
export function isReturnLine(line) {
  if (line?.isReturn) return true;
  const noCode = !String(line?.itemCode || '').trim();
  const noOrder = !present(line?.qtyOrdered) && !present(line?.qtyDespatched);
  return noCode && noOrder && deliveredQty(line) > 0;
}

// ---------------------------------------------------------------------------
//  Name matching (within a container class)
// ---------------------------------------------------------------------------

// Words that describe the packaging or the trade, not the product. Dropping
// them stops "50 K ASPALL DRGHT ORA CAP 4.5%" scoring against every keg.
const NOISE = new Set([
  'the', 'and', 'of', 'x', 'case', 'cases', 'bottle', 'bottles', 'btl', 'keg', 'kegs',
  'cask', 'can', 'cans', 'pack', 'packs', 'box', 'bib', 'ltr', 'l', 'cl', 'ml', 'gm', 'g',
  'kg', 'drght', 'draught', 'drt', 'cap', 'ea', 'ca', 'si', 'un', 'abv', 'nrb',
]);

function tokenise(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !NOISE.has(t) && !/^\d+$/.test(t));
}

/**
 * Fraction of the STOCK ITEM's distinctive words the line accounts for, with
 * prefix credit for the supplier's abbreviations ("GUIN" → "Guinness",
 * "REKORD" → "Rekorderlig", "TEQ" → "Tequila").
 */
function nameScore(lineTokens, itemTokens) {
  if (!itemTokens.length) return 0;
  let hits = 0;
  for (const it of itemTokens) {
    const hit = lineTokens.some((lt) =>
      lt === it || (lt.length >= 3 && it.startsWith(lt)) || (it.length >= 3 && lt.startsWith(it)));
    if (hit) hits += 1;
  }
  return hits / itemTokens.length;
}

const MIN_SCORE = 0.5;    // at least half the item's distinctive words
const MIN_MARGIN = 0.15;  // ...and clearly ahead of the runner-up

/**
 * Best stock item for a line, or null. Candidates are filtered by container
 * class BEFORE names are scored, and a near-tie is refused rather than guessed
 * — an unmatched line costs one tap in review, a wrong one corrupts stock.
 *
 * @returns {{ item, score, runnerUp }|null}
 */
export function matchLineToItem(line, items) {
  const cls = containerClassOfLine(line);
  const candidates = items.filter((i) => !i.archived && containersCompatible(cls, containerClassOfItem(i)));
  if (!candidates.length) return null;

  const lineTokens = tokenise(`${line.description || ''} ${line.packSize || ''}`);
  if (!lineTokens.length) return null;

  const scored = candidates
    .map((item) => ({ item, score: nameScore(lineTokens, tokenise(item.name)) }))
    .sort((a, b) => b.score - a.score);

  const [best, second] = scored;
  if (!best || best.score < MIN_SCORE) return null;
  if (second && best.score - second.score < MIN_MARGIN) return null;
  return { item: best.item, score: best.score, runnerUp: second?.item || null };
}

// ---------------------------------------------------------------------------
//  Quantity → the item's purchase-unit rows
// ---------------------------------------------------------------------------

/** Whole units that are themselves an outer, so "1 case" is "1 whole". */
const wholeIsOuter = (label) => /^(cases|boxes|packs|trays|punnets)$/i.test(label || '');

/**
 * Turn a line's delivered quantity into values for deliveryUnitsFor(item).rows.
 *
 * Unit codes, as UK drinks wholesalers use them:
 *   EA / UN — one container (a keg)
 *   CA      — one full outer as described ("X24" ⇒ 24 units)
 *   SI      — one INNER unit out of that outer. "70CL MALIBU X6 · 1 SI" is one
 *             bottle, not six; "27GM SCAMP FRIE CARD 4X24 · 1 SI" is one card
 *             of 24, not the four-card outer. Reading SI as a case is the most
 *             expensive mistake available here, so it maps to the whole unit.
 *
 * A CA line against an item whose whole unit ISN'T an outer needs the item's
 * case size to be resolvable — flagged so review can capture it once, the same
 * casePack the manual entry screen uses.
 *
 * @returns {{ values, needsCasePack, quantity, units, baseLabel }}
 */
export function unitsForLine(line, item) {
  const { rows, baseLabel } = deliveryUnitsFor(item);
  const qty = deliveredQty(line);
  const code = String(line?.unitCode || '').trim().toUpperCase();
  const caseRow = rows.find((r) => r.key === 'case');
  const wholeRow = rows.find((r) => r.key === 'whole');

  let values;
  let needsCasePack = false;
  if (code === 'CA' && !wholeIsOuter(wholeRow?.label)) {
    if (caseRow) values = { case: String(qty) };
    else { values = {}; needsCasePack = true; }
  } else {
    values = { whole: String(qty) };
  }

  const units = rows
    .filter((r) => (parseFloat(values[r.key]) || 0) > 0)
    .map((r) => ({ label: r.label, count: Number(values[r.key]) }));
  const quantity = rows.reduce(
    (t, r) => t + (parseFloat(values[r.key]) || 0) * r.perBase, 0);

  return { values, needsCasePack, units, baseLabel, quantity: Math.round(quantity * 1e6) / 1e6 };
}

// ---------------------------------------------------------------------------
//  Whole-document reconciliation
// ---------------------------------------------------------------------------

/**
 * Reconcile every extracted line against the stock list, ready for review.
 *
 * Each row: { line, index, containerClass, qty, itemId, item, status, include,
 *             viaLearned, needsCasePack, shortDelivery, shortDespatch }
 * status: 'matched' | 'unmatched' | 'return'
 *
 * `resolve(line)` is the venue's learned supplier-code → item lookup. It wins
 * outright over name matching: a human confirmed it, and no amount of string
 * similarity outranks that.
 *
 * Returns are excluded by default and can't be included — they're stock going
 * out of the door, and the note has no way to say which of your items they are.
 */
export function reconcileLines(lines, items, { resolve } = {}) {
  return (lines || []).map((line, index) => {
    const qty = deliveredQty(line);
    if (isReturnLine(line)) {
      return {
        index, line, qty, containerClass: containerClassOfLine(line),
        item: null, itemId: null, status: 'return', include: false, viaLearned: false,
        needsCasePack: false, shortDelivery: false, shortDespatch: false,
      };
    }
    const learned = resolve ? resolve(line) : null;
    const hit = learned ? null : matchLineToItem(line, items);
    const item = learned || hit?.item || null;
    const units = item ? unitsForLine(line, item) : null;
    return {
      index,
      line,
      qty,
      containerClass: containerClassOfLine(line),
      item,
      itemId: item?.id || null,
      status: item ? 'matched' : 'unmatched',
      viaLearned: !!learned,
      include: !!item && qty > 0 && !units?.needsCasePack,
      needsCasePack: !!units?.needsCasePack,
      shortDelivery: shortDelivery(line),
      shortDespatch: shortDespatch(line),
    };
  });
}

/**
 * Re-derive a row after its item (or the item's case size) changed.
 * `corrected` marks a human overruling the match — the strongest signal the
 * learning layer gets, and it must survive into what's persisted.
 */
export function withItem(row, item, { corrected = false } = {}) {
  if (!item) {
    return {
      ...row, item: null, itemId: null, status: 'unmatched',
      include: false, needsCasePack: false, viaLearned: false, corrected,
    };
  }
  const units = unitsForLine(row.line, item);
  return {
    ...row,
    item,
    itemId: item.id,
    status: 'matched',
    viaLearned: corrected ? false : row.viaLearned,
    corrected: corrected || !!row.corrected,
    needsCasePack: units.needsCasePack,
    include: row.qty > 0 && !units.needsCasePack,
  };
}
