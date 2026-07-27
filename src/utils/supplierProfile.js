/**
 * supplierProfile — what a stack of scanned delivery notes says about a
 * supplier, derived rather than captured.
 *
 * Every note already stores the three quantity columns per line. Accumulated,
 * they answer questions an independent pub has no back office to answer:
 * when does this supplier actually come, how much of what I order do they
 * actually deliver, and how many empties are still sitting behind the bar.
 *
 * FILL RATE IS A LEARNING SIGNAL ONLY. Ordered and despatched never move
 * stock and never touch variance — expected closing must be built from what
 * physically arrived, or you manufacture a shortfall out of paperwork and go
 * looking for theft that never happened. What fill rate is for is safety
 * stock: an unreliable line justifies more buffer than a dependable one.
 */

const DAY = 24 * 60 * 60 * 1000;
const pad = (n) => String(n).padStart(2, '0');
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const present = (n) => typeof n === 'number' && n >= 0;

/** The date a note describes: its printed delivery date, else when it was scanned. */
export function noteDate(note) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(note?.deliveryDate || '')) return note.deliveryDate;
  const at = note?.uploadedAt?.toDate ? note.uploadedAt.toDate() : null;
  return at ? isoOf(at) : '';
}

const parseIso = (iso) => new Date(`${iso}T12:00:00`);

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Delivery rhythm from the dates alone.
 * @returns {{ medianGap, weekday, weekdayName, confident, label }}
 *   confident = enough deliveries, and consistent enough, to plan around.
 */
export function cadenceOf(dates) {
  const unique = [...new Set(dates.filter(Boolean))].sort();
  if (unique.length < 2) {
    return { medianGap: 0, weekday: -1, weekdayName: '', confident: false, label: 'Not enough deliveries yet' };
  }

  const gaps = [];
  for (let i = 1; i < unique.length; i++) {
    gaps.push(Math.round((parseIso(unique[i]) - parseIso(unique[i - 1])) / DAY));
  }
  const medianGap = median(gaps);

  // Modal weekday — a supplier that always comes on a Thursday is planable
  // even when the odd bank holiday stretches a gap.
  const tally = new Array(7).fill(0);
  for (const iso of unique) tally[parseIso(iso).getDay()] += 1;
  const weekday = tally.indexOf(Math.max(...tally));
  const weekdayShare = tally[weekday] / unique.length;

  const confident = unique.length >= 3 && medianGap > 0;
  let label;
  if (!confident) label = `${unique.length} deliveries so far`;
  else if (medianGap >= 6 && medianGap <= 8) label = weekdayShare >= 0.6 ? `Weekly, ${WEEKDAYS[weekday]}s` : 'Weekly';
  else if (medianGap >= 12 && medianGap <= 16) label = weekdayShare >= 0.6 ? `Fortnightly, ${WEEKDAYS[weekday]}s` : 'Fortnightly';
  else if (medianGap >= 26 && medianGap <= 35) label = 'Monthly';
  else label = `Every ${Math.round(medianGap)} days`;

  return { medianGap, weekday, weekdayName: WEEKDAYS[weekday] || '', confident, weekdayShare, label };
}

/** When the next delivery is due, if the rhythm is clear enough to say. */
export function nextExpected(lastIso, cadence) {
  if (!lastIso || !cadence?.confident || !(cadence.medianGap > 0)) return '';
  const d = parseIso(lastIso);
  d.setDate(d.getDate() + Math.round(cadence.medianGap));
  // Snap to the usual weekday when there is one — cadence drifts, habits don't.
  if (cadence.weekday >= 0 && cadence.weekdayShare >= 0.6) {
    const shift = (cadence.weekday - d.getDay() + 7) % 7;
    if (shift <= 3) d.setDate(d.getDate() + shift);
    else d.setDate(d.getDate() - (7 - shift));
  }
  return isoOf(d);
}

/**
 * Supplier identity, stripped back to the bit that stays the same between
 * documents: bracketed parents and corporate boilerplate go, so
 * "TRADETEAM (Molson Coors) Ltd" and "Tradeteam" reduce alike.
 */
const baseSlug = (name) => String(name || '')
  .replace(/\(.*?\)/g, ' ')
  .replace(/\b(ltd|limited|plc|uk|wholesale|wholesalers|distribution|logistics|group|co)\b/gi, ' ')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '');

/**
 * Group the supplier names seen across notes onto one canonical key each.
 *
 * The same supplier prints its name differently on different documents, and
 * left alone that splits one profile into several — halving the delivery
 * count, breaking the cadence, and stranding a short delivery in a phantom
 * supplier with a terrible fill rate. Names are merged when one is a prefix of
 * the other, with a four-character floor so short slugs don't swallow
 * unrelated suppliers.
 *
 * @returns {Map} original name → { key, display }
 */
export function groupSupplierNames(names) {
  const counts = new Map();
  for (const n of names) counts.set(n, (counts.get(n) || 0) + 1);

  const unique = [...counts.keys()].map((n) => ({ n, s: baseSlug(n) })).filter((x) => x.s);
  // Shortest first, so the tidiest form becomes the root others attach to.
  unique.sort((a, b) => a.s.length - b.s.length || a.n.localeCompare(b.n));

  const roots = [];
  const keyOf = new Map();
  for (const { n, s } of unique) {
    const root = roots.find((r) => r === s
      || (r.length >= 4 && s.startsWith(r))
      || (s.length >= 4 && r.startsWith(s)));
    if (root) keyOf.set(n, root);
    else { roots.push(s); keyOf.set(n, s); }
  }

  // Display the name the venue sees most often; ties go to the shorter one.
  const best = new Map();
  for (const [n, key] of keyOf) {
    const cur = best.get(key);
    const score = counts.get(n);
    if (!cur || score > cur.score || (score === cur.score && n.length < cur.name.length)) {
      best.set(key, { name: n, score });
    }
  }

  const out = new Map();
  for (const [n, key] of keyOf) out.set(n, { key, display: best.get(key).name });
  return out;
}

/**
 * Build one profile per supplier from saved delivery notes.
 *
 * @param {Array} notes - deliveryNotes docs (newest first or any order)
 * @returns {Array} profiles, most recently delivering first
 */
export function buildSupplierProfiles(notes) {
  const bySupplier = new Map();
  const naming = groupSupplierNames((notes || []).map((n) => (n.supplier || '').trim() || 'Unknown supplier'));

  for (const note of notes || []) {
    const raw = (note.supplier || '').trim() || 'Unknown supplier';
    const grouped = naming.get(raw);
    const name = grouped?.display || raw;
    const key = grouped?.key || raw.toLowerCase();
    const date = noteDate(note);
    const p = bySupplier.get(key) || {
      supplier: name, key, dates: [], noteCount: 0,
      ordered: 0, despatched: 0, delivered: 0,
      shortLines: 0, shortNotes: 0, comparableLines: 0,
      emptiesReturned: 0, products: new Map(),
    };

    p.noteCount += 1;
    if (date) p.dates.push(date);

    let noteHadShort = false;
    for (const line of note.lines || []) {
      if (line.isReturn || line.status === 'return') {
        p.emptiesReturned += present(line.qtyDelivered) ? line.qtyDelivered : 0;
        continue;
      }

      // Fill rate only over lines that printed BOTH columns — a note without a
      // despatched column tells us nothing about reliability either way.
      if (present(line.qtyDespatched) && present(line.qtyDelivered)) {
        p.despatched += line.qtyDespatched;
        p.delivered += line.qtyDelivered;
        p.comparableLines += 1;
        if (line.qtyDelivered < line.qtyDespatched) { p.shortLines += 1; noteHadShort = true; }
      }
      if (present(line.qtyOrdered)) p.ordered += line.qtyOrdered;

      if (line.itemId) {
        const prod = p.products.get(line.itemId) || {
          itemId: line.itemId, itemName: line.itemName || '', itemCode: line.itemCode || '',
          times: 0, totalDelivered: 0, quantities: [], shortTimes: 0, lastDate: '',
        };
        prod.times += 1;
        const q = present(line.qtyDelivered) ? line.qtyDelivered : 0;
        prod.totalDelivered += q;
        if (q > 0) prod.quantities.push(q);
        if (present(line.qtyDespatched) && present(line.qtyDelivered) && line.qtyDelivered < line.qtyDespatched) {
          prod.shortTimes += 1;
        }
        if (date > prod.lastDate) prod.lastDate = date;
        if (!prod.itemName && line.itemName) prod.itemName = line.itemName;
        p.products.set(line.itemId, prod);
      }
    }
    if (noteHadShort) p.shortNotes += 1;
    bySupplier.set(key, p);
  }

  const out = [];
  for (const p of bySupplier.values()) {
    const dates = [...p.dates].sort();
    const cadence = cadenceOf(dates);
    const lastDelivery = dates[dates.length - 1] || '';
    out.push({
      supplier: p.supplier,
      key: p.key,
      noteCount: p.noteCount,
      firstDelivery: dates[0] || '',
      lastDelivery,
      cadence,
      nextExpected: nextExpected(lastDelivery, cadence),
      // null rather than 100% when nothing is comparable — "no data" and
      // "perfect record" must not look the same.
      fillRate: p.despatched > 0 ? p.delivered / p.despatched : null,
      orderFillRate: p.ordered > 0 && p.despatched > 0 ? p.despatched / p.ordered : null,
      comparableLines: p.comparableLines,
      shortLines: p.shortLines,
      shortNotes: p.shortNotes,
      emptiesReturned: p.emptiesReturned,
      products: [...p.products.values()]
        .map((x) => ({ ...x, typicalQty: median(x.quantities) }))
        .sort((a, b) => b.times - a.times || a.itemName.localeCompare(b.itemName)),
    });
  }
  return out.sort((a, b) => (b.lastDelivery || '').localeCompare(a.lastDelivery || ''));
}

/**
 * The key a supplier's records group under. Learned mappings are keyed by the
 * supplier name as PRINTED (their doc ids must stay stable), so anything
 * displaying them beside a profile has to reduce both sides the same way.
 */
export const supplierGroupKey = (name) => baseSlug(name);

/**
 * "94%", "99.9%", "—" when there's nothing to compare.
 *
 * Never rounds a shortfall away. A supplier who missed one line in eighteen
 * hundred is not a perfect record, and 99.97% displayed as "100%" beside "1
 * short line" makes the card contradict itself — which is exactly the sort of
 * thing that teaches people to stop believing the numbers.
 */
export const formatFillRate = (r) => {
  if (r === null || r === undefined) return '—';
  if (r >= 1) return '100%';
  const pct = r * 100;
  if (Math.round(pct) >= 100) return `${(Math.floor(pct * 10) / 10).toFixed(1)}%`;
  return `${Math.round(pct)}%`;
};

/** Short human date from ISO ("23 Jul"). */
export function shortDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return '';
  return parseIso(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });
}
