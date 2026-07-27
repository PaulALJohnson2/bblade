/**
 * supplierLearning — what a venue learns from each delivery note it scans.
 *
 * The review screen is a labelling exercise nobody thinks of as one: a manager
 * confirms "this line is that product", and today that judgement is used once
 * and thrown away. Kept instead, it turns matching from inference into lookup —
 * the supplier's own item code is a stable key the venue never knew it had.
 * `5004310` IS Madri, permanently, because a human said so.
 *
 * Two kinds of fact come off a note:
 *   IDENTITY  — supplier code → stock item. Confirmed once, trusted after.
 *   PACKAGING — what container it comes in, how many to an outer. Derivable
 *               from the printed pack size, and needed to add a product the
 *               venue buys but doesn't yet count.
 *
 * All pure: the caller decides what to persist and what to show.
 */

/** Firestore-safe slug (doc ids can't contain '/' and mustn't be '.'/'..'). */
const slug = (s) => String(s || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 60);

/** Supplier identity, tolerant of the name drifting between notes. */
export function supplierKey(supplier) {
  return slug(supplier) || 'unknown';
}

/**
 * How a line is recognised next time. The supplier's item code when there is
 * one; otherwise the description, normalised — some suppliers print no codes
 * at all, and a stable description is better than nothing.
 */
export function lineKey(line) {
  const code = String(line?.itemCode || '').trim();
  if (code) return `c-${slug(code)}`;
  const desc = slug(line?.description);
  return desc ? `d-${desc}` : '';
}

/** Deterministic doc id, so re-seeing a line upserts rather than duplicates. */
export function learnedId(supplier, line) {
  const key = lineKey(line);
  return key ? `${supplierKey(supplier)}__${key}` : '';
}

/**
 * Index learned records for lookup. Two ways in:
 *   - supplier + line key (the precise match);
 *   - line key alone, used only when exactly ONE record across all suppliers
 *     claims it. Supplier names drift between documents ("Tradeteam" vs
 *     "TRADETEAM (Molson Coors)") and an item code is distinctive enough that
 *     a single unambiguous claim is safe to honour.
 */
export function indexLearned(records) {
  const exact = new Map();
  const byKey = new Map();
  for (const r of records || []) {
    if (!r?.key) continue;
    exact.set(`${r.supplierKey}__${r.key}`, r);
    const seen = byKey.get(r.key);
    if (seen === undefined) byKey.set(r.key, r);
    else if (seen && seen.itemId !== r.itemId) byKey.set(r.key, null); // ambiguous
  }
  return { exact, byKey };
}

/** Learned record for a line, or null. */
export function lookupLearned(index, supplier, line) {
  const key = lineKey(line);
  if (!key || !index) return null;
  return index.exact.get(`${supplierKey(supplier)}__${key}`) || index.byKey.get(key) || null;
}

/**
 * Build the records to persist from a reviewed note.
 *
 * Only lines that were INCLUDED in what got logged are learned from: the
 * manager looked at the screen and pressed the button, which is confirmation.
 * Lines left unmatched teach nothing, and a match the manager deliberately
 * unticked is a signal we can't read — silence is the honest response.
 *
 * When the existing index is supplied, records also carry the provenance the
 * contribution scoring depends on:
 *
 *   isNew / firstConfirmedBy  — who established the mapping, written once and
 *                               never overwritten, so a later edit can't
 *                               transfer credit for the discovery.
 *   corrected / previousOwner — a correction is only a correction when the
 *                               mapping actually CHANGED TARGET. Re-picking
 *                               the same item isn't one, and neither is
 *                               "fixing" your own entry — that's the obvious
 *                               way to farm a correction bonus, so the owner
 *                               it replaced is recorded and checked.
 */
export function learnedRecordsFrom(rows, note, confirmedBy, index) {
  const key = supplierKey(note?.supplier);
  return (rows || [])
    .filter((r) => r.include && r.item && lineKey(r.line))
    .map((r) => {
      const outer = outerPack(r.line);
      const existing = index ? lookupLearned(index, note?.supplier, r.line) : null;
      const changedTarget = !!existing && existing.itemId !== r.item.id;
      return {
        id: learnedId(note?.supplier, r.line),
        supplier: note?.supplier || '',
        supplierKey: key,
        key: lineKey(r.line),
        itemCode: String(r.line.itemCode || '').trim(),
        itemId: r.item.id,
        itemName: r.item.name,
        description: r.line.description || '',
        packSize: r.line.packSize || '',
        container: r.containerClass || '',
        unitCode: String(r.line.unitCode || '').trim(),
        unitsPerOuter: outer?.per || 0,
        corrected: changedTarget,
        previousOwner: changedTarget ? (existing.confirmedBy || '') : (existing?.previousOwner || ''),
        confirmedBy: confirmedBy || '',
        isNew: !existing,
        firstConfirmedBy: existing ? undefined : (confirmedBy || ''),
      };
    });
}

// ---------------------------------------------------------------------------
//  Packaging facts read off the printed pack size
// ---------------------------------------------------------------------------

/**
 * The "X24" / "4X24" outer on a line: `per` is the innermost count (a card of
 * 24), `packs` how many of those make the outer. A pub counts the inner.
 */
export function outerPack(line) {
  const text = `${line?.packSize || ''} ${line?.description || ''}`;
  const m = text.match(/(?:(\d+)\s*)?X\s*(\d+)\b/i);
  if (!m) return null;
  return { packs: m[1] ? parseInt(m[1], 10) : 1, per: parseInt(m[2], 10) };
}

/**
 * Case size to offer when a "1 CA" line lands on an item with none set.
 * Only when the outer is unambiguous — "4X24" could mean 4 or 96 depending on
 * what the venue calls one unit, so it's left for the human.
 */
export function suggestedCasePack(line) {
  const outer = outerPack(line);
  if (!outer || outer.packs !== 1) return 0;
  return outer.per >= 2 && outer.per <= 200 ? outer.per : 0;
}

/**
 * Keg size in litres from the printed token.
 *
 * UK trade prints traditional kegs in GALLONS (11 = 50L, 22 = 100L) and
 * continental ones in LITRES (30, 50). Only 11 and 22 are treated as gallons —
 * guessing by magnitude would turn a real 20L craft keg into 91 litres.
 */
export function kegLitres(packSize) {
  const m = String(packSize || '').match(/(\d+(?:\.\d+)?)\s*K/i);
  if (!m) return 50;
  const n = parseFloat(m[1]);
  if (n === 11) return 50;
  if (n === 22) return 100;
  return n > 0 ? n : 50;
}

const num = (text, re) => {
  const m = String(text || '').match(re);
  return m ? parseFloat(m[1]) : 0;
};

/**
 * How a product off this line should be COUNTED, in the canonical
 * wholeUnit/partUnit pair parseUnitInfo() understands.
 *
 * Order matters: a "70CL … X6" spirit is counted as bottles and tenths with a
 * case size of 6, not as a case of 6 — you count part bottles behind a bar.
 *
 * @returns {{ wholeUnit, partUnit, unit, casePack }}
 */
export function unitFromLine(line, containerClass) {
  const size = `${line?.packSize || ''}`;
  const both = `${size} ${line?.description || ''}`;
  const outer = outerPack(line);

  if (containerClass === 'keg') {
    const l = kegLitres(size);
    return { wholeUnit: `Keg 1*${l}ltr`, partUnit: 'Litre', unit: `${l}L`, casePack: 0 };
  }
  if (containerClass === 'cask') {
    const g = num(both, /(\d+(?:\.\d+)?)\s*G/i) || 9;
    return { wholeUnit: `Cask 1*${g}gall`, partUnit: 'Gallon', unit: `${g}G`, casePack: 0 };
  }
  if (containerClass === 'bib') {
    const l = num(both, /(\d+(?:\.\d+)?)\s*L/i) || 7;
    return { wholeUnit: `BIB 1*${l}ltr`, partUnit: 'Litre', unit: `${l}L`, casePack: 0 };
  }

  // Spirits and wine: bottles with tenths, the outer becomes the case size.
  const cl = num(size, /(\d+(?:\.\d+)?)\s*CL\b/i)
    || (num(size, /(\d+(?:\.\d+)?)\s*L\b/i) ? num(size, /(\d+(?:\.\d+)?)\s*L\b/i) * 100 : 0);
  if (cl >= 18) {
    return {
      wholeUnit: `Bottle 1*${cl}cl`, partUnit: 'Tenth', unit: `${cl}cl`,
      casePack: outer?.packs === 1 ? outer.per : 0,
    };
  }

  // Anything else arriving in an outer is counted as cases plus loose singles.
  if (outer) {
    return {
      wholeUnit: `Case 1*${outer.per}Each`, partUnit: 'Each', unit: `of ${outer.per}`,
      casePack: outer.packs > 1 ? outer.packs : 0,
    };
  }

  if (containerClass === 'weight') {
    const kg = num(both, /(\d+(?:\.\d+)?)\s*KG\b/i);
    if (kg) return { wholeUnit: `Bag 1*${kg}kg`, partUnit: 'Kilogram', unit: `${kg}kg`, casePack: 0 };
    const g = num(both, /(\d+(?:\.\d+)?)\s*G\b/i);
    if (g) return { wholeUnit: `Bag 1*${g}g`, partUnit: 'Gram', unit: `${g}g`, casePack: 0 };
  }

  const ml = num(size, /(\d+(?:\.\d+)?)\s*ML\b/i);
  if (ml) return { wholeUnit: `${ml}ml`, partUnit: '', unit: `${ml}ml`, casePack: 0 };

  return { wholeUnit: 'Each', partUnit: '', unit: 'Each', casePack: 0 };
}

const SMALL = new Set(['and', 'of', 'the', 'with']);

const titleCase = (s) => s
  .split(' ')
  .map((w, i) => (i > 0 && SMALL.has(w.toLowerCase())
    ? w.toLowerCase()
    : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
  .join(' ');

/**
 * A readable product name from the supplier's shouty abbreviation, as a
 * starting point for the human to edit — "MADRI LAGER KEG 4.6%" → "Madri
 * Lager". ABV is stripped, but "0%" is kept: on a delivery note that's the
 * product, not a statistic.
 */
export function cleanProductName(line) {
  let s = ` ${line?.description || ''} `;
  s = s.replace(/(?:\d+\s*)?X\s*\d+\b/gi, ' ');
  s = s.replace(/(\d+(?:\.\d+)?)\s*%/g, (full, n) => (parseFloat(n) === 0 ? ' 0% ' : ' '));
  s = s.replace(/\b\d+(?:\.\d+)?\s*(ML|CL|LTR|GM|KG|G|L|K)\b/gi, ' ');
  s = s.replace(/\b(KEG|CASK|CAN|CANS|BTL|BIB|CARD|DRGHT|DRAUGHT)\b/gi, ' ');
  s = s.replace(/[^A-Za-z0-9&%'’/\- ]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? titleCase(s) : String(line?.description || '').trim();
}
