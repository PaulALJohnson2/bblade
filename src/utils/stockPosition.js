/**
 * stockPosition — how much of each item is in the building, and how much that
 * figure deserves to be trusted.
 *
 * Deliberately NOT a forecast. An earlier version of this ran each item down by
 * its measured usage rate, so an item counted at nine in the morning had
 * "sold" a bottle by lunchtime on nothing but clock arithmetic — a week's trade
 * spread evenly over 168 hours, including the ones the pub is shut. With one
 * measured period behind it that is invented precision, and invented precision
 * is worse than an honest gap: a manager can act on "counted 7 on Tuesday", and
 * knows to go and look at "nobody has counted this in three weeks". Neither
 * needs a model.
 *
 * WHERE THE NUMBER COMES FROM. `item.quantity` already is the running figure —
 * a completed count sets it, a logged delivery adds to it, logged wastage takes
 * from it. So this reads that rather than recomputing a rival total, which
 * keeps the report agreeing with every other screen in the app. What the counts
 * and delivery log add here is provenance: when the figure was last anchored to
 * something somebody physically counted, and what has moved since.
 *
 * WHICH MEANS IT DRIFTS, UPWARD. There is no sales feed at the venues this is
 * built for, so nothing pulls the figure down as the pub trades — it only moves
 * on counts, deliveries and wastage. Between counts it therefore overstates,
 * and it overstates most just before someone orders. That isn't hidden: every
 * row says how long since the item was actually counted, and the whole design
 * is meant to make counting more often the obvious thing to do. Ordering
 * suggestions wait until there is enough history to earn them.
 *
 * ANCHORED PER ITEM, NOT PER COUNT. A stock take is not all-or-nothing — the
 * Richmond's second take covered 69 of the 79 items in its first. Anchoring the
 * report to "the last stock take" would silently treat eleven items as freshly
 * counted when nobody had looked at them in a week. Each item is therefore
 * anchored to the last count containing IT, and an item left out of a later
 * count of its own section is called out as such.
 */

const DAY = 24 * 60 * 60 * 1000;
const round2 = (n) => Math.round(n * 100) / 100;
const round1 = (n) => Math.round(n * 10) / 10;
const millis = (t) => (t?.toMillis ? t.toMillis() : (t instanceof Date ? t.getTime() : (typeof t === 'number' ? t : 0)));

/** Past this long uncounted, the figure is a running total, not a reading. */
export const UNSEEN_DAYS = 10;

/**
 * How much of a fact the figure is. Kept distinct because the difference is
 * the point: a count is something somebody saw, a running total is bookkeeping.
 */
export const BASIS = {
  counted: { key: 'counted', label: 'Counted', note: 'counted, and nothing logged since' },
  adjusted: { key: 'adjusted', label: 'Counted, then adjusted', note: 'counted, with deliveries and wastage applied since' },
  unknown: { key: 'unknown', label: 'Never counted', note: 'never counted — this is only what has been booked in' },
};

export const SIGNALS = {
  out: { key: 'out', label: 'Nothing left', group: 'out', rank: 0, tone: 'error' },
  skipped: { key: 'skipped', label: 'Left out of last count', group: 'check', rank: 1, tone: 'warning' },
  never: { key: 'never', label: 'Never counted', group: 'check', rank: 2, tone: 'info' },
  unseen: { key: 'unseen', label: 'Not counted lately', group: 'check', rank: 3, tone: 'info' },
};

export const GROUP_TITLES = {
  out: 'Nothing left',
  check: 'Worth a look',
  stock: 'In stock',
};

/**
 * The last completed count containing each item, plus the last completed count
 * of its section — which is what tells "left out" apart from "not counted in a
 * while".
 */
export function anchorCounts(sessions) {
  const byItem = new Map();
  const lastBySection = { bar: 0, kitchen: 0 };

  for (const s of sessions || []) {
    if (s.status !== 'completed' || !s.completedAt) continue;
    // A take pulled out of variance was pulled for a reason — usually a botched
    // count — and it shouldn't anchor a figure either.
    if (s.hiddenFromVariance) continue;
    const at = millis(s.completedAt);
    const section = s.section === 'kitchen' ? 'kitchen' : 'bar';
    if (at > lastBySection[section]) lastBySection[section] = at;

    for (const [id, c] of Object.entries(s.counts || {})) {
      const cur = byItem.get(id);
      if (cur && cur.at >= at) continue;
      byItem.set(id, { at, qty: Number(c?.quantity) || 0, itemName: c?.itemName || '', sessionId: s.id, section });
    }
  }

  return { byItem, lastBySection };
}

/**
 * Whether this venue's counters ever write a zero.
 *
 * Worth knowing, because it decides how to read a missing line. A venue that
 * records zeros means an absent item genuinely wasn't reached; a venue that has
 * never recorded one can't tell an empty shelf from an unvisited one. Recording
 * zero was impossible in the app until July 2026, so older counts contain none
 * of them by construction.
 */
export function countingHabits(sessions) {
  let counted = 0;
  let zeros = 0;
  let takes = 0;
  for (const s of sessions || []) {
    if (s.status !== 'completed' || s.hiddenFromVariance) continue;
    takes += 1;
    for (const c of Object.values(s.counts || {})) {
      counted += 1;
      if ((Number(c?.quantity) || 0) === 0) zeros += 1;
    }
  }
  return { takes, counted, zeros, everRecordsZero: zeros > 0 };
}

/** Total per item of log entries strictly after each item's anchor. */
function sumAfter(entries, timeField, since) {
  const out = new Map();
  for (const e of entries || []) {
    if (!e?.itemId) continue;
    const at = millis(e[timeField]);
    if (!at) continue;
    const from = since.get(e.itemId);
    // No anchor at all → everything booked in counts, since there is no count
    // to have already included it.
    if (from !== undefined && at <= from) continue;
    out.set(e.itemId, (out.get(e.itemId) || 0) + (Number(e.quantity) || 0));
  }
  return out;
}

/**
 * One row per stock item: what's there, and how solid that is.
 *
 * @param {Object} args
 *   items       - stock items (archived ones are skipped)
 *   sessions    - all stock sessions
 *   deliveries  - deliveryLog entries covering at least the oldest anchor
 *   wastage     - wastageLog entries over the same span
 *   unitInfoFor - (item) => parseUnitInfo(item)
 *   now         - ms, injectable for tests
 */
export function buildPositions({ items, sessions, deliveries, wastage, unitInfoFor, now = Date.now() }) {
  const { byItem: anchors, lastBySection } = anchorCounts(sessions);
  const since = new Map([...anchors].map(([id, a]) => [id, a.at]));
  const delivered = sumAfter(deliveries, 'receivedAt', since);
  const wasted = sumAfter(wastage, 'wastedAt', since);

  const rows = [];
  for (const item of items || []) {
    if (item.archived) continue;
    const id = item.id;
    const unitInfo = unitInfoFor ? unitInfoFor(item) : null;
    const upw = (unitInfo?.unitsPerWhole > 0 ? unitInfo.unitsPerWhole : 1);

    const anchor = anchors.get(id) || null;
    const inQty = delivered.get(id) || 0;
    const outQty = wasted.get(id) || 0;
    const daysSince = anchor ? (now - anchor.at) / DAY : null;

    // The app's own running figure, not a rival total computed here — so this
    // screen can never disagree with the stock list about how much there is.
    const quantity = Math.max(0, Number(item.quantity) || 0);

    let basis;
    if (!anchor) basis = BASIS.unknown;
    else if (inQty > 0 || outQty > 0) basis = BASIS.adjusted;
    else basis = BASIS.counted;

    const skipped = !!anchor && lastBySection[anchor.section] > anchor.at;
    const stale = daysSince !== null && daysSince >= UNSEEN_DAYS;

    const sig = [];
    // "Nothing left" is a claim that it ran out, so it needs a count behind it.
    // An item nobody has ever counted or booked in reads zero because nothing
    // has ever happened to it — that's a list needing a tidy, not a shortage.
    if (quantity <= 0.001 && anchor) sig.push(SIGNALS.out);
    if (!anchor) sig.push(SIGNALS.never);
    else if (skipped) sig.push(SIGNALS.skipped);
    else if (stale) sig.push(SIGNALS.unseen);

    const top = sig.slice().sort((a, b) => a.rank - b.rank)[0] || null;

    rows.push({
      itemId: id,
      name: item.name || anchor?.itemName || 'Item',
      category: item.category || '',
      section: item.section === 'kitchen' ? 'kitchen' : 'bar',
      unitInfo,
      basis,
      quantity: round2(quantity),
      wholes: round2(quantity / upw),
      anchorQty: anchor ? round2(anchor.qty) : null,
      anchorAt: anchor ? anchor.at : null,
      daysSinceCount: daysSince === null ? null : round1(daysSince),
      delivered: round2(inQty),
      wasted: round2(outQty),
      signals: sig,
      signal: top,
      group: top ? top.group : 'stock',
      skipped,
    });
  }

  return rows.sort((a, b) => {
    const ra = a.signal ? a.signal.rank : 99;
    const rb = b.signal ? b.signal.rank : 99;
    if (ra !== rb) return ra - rb;
    // The flagged groups are read as a worklist, so the biggest holdings come
    // first — a skipped cider keg matters more than a skipped shelf liqueur,
    // and alphabetical would bury it. The plain in-stock list is read as a
    // lookup ("how much Malibu?"), where alphabetical is the only useful order.
    const bothInStock = !a.signal && !b.signal;
    if (!bothInStock && b.wholes !== a.wholes) return b.wholes - a.wholes;
    return String(a.name).localeCompare(String(b.name));
  });
}

/** How much of the venue this figure can actually see. */
export function summarise(rows) {
  const counted = rows.filter((r) => r.anchorAt);
  const newest = counted.reduce((m, r) => Math.max(m, r.anchorAt), 0);
  return {
    items: rows.length,
    counted: counted.length,
    uncounted: rows.length - counted.length,
    skipped: rows.filter((r) => r.skipped).length,
    stale: rows.filter((r) => r.signal === SIGNALS.unseen).length,
    out: rows.filter((r) => r.group === 'out').length,
    check: rows.filter((r) => r.group === 'check').length,
    inStock: rows.filter((r) => r.group === 'stock').length,
    lastCountAt: newest || null,
  };
}

/**
 * The single most useful thing this venue could do next, in a sentence.
 *
 * One instruction, not a list. A venue this early has one bottleneck at a time,
 * and naming it beats a page of caveats it will read once.
 */
export function nextBestAction(summary, rows, habits) {
  if (summary.counted === 0) return 'Nothing has been counted yet — the figures below are only what has been booked in. A stock take turns them into real numbers.';
  if (summary.skipped > 0) {
    if (habits && habits.counted > 20 && !habits.everRecordsZero) {
      return `${summary.skipped} item${summary.skipped === 1 ? ' was' : 's were'} left out of the last count, and across ${habits.counted} counted lines not one zero has ever been recorded — so nobody can now tell an empty shelf from one that wasn't reached. Tap None left when something's out, or settle the stragglers on the Anything empty? screen when you finish a take.`;
    }
    return `${summary.skipped} item${summary.skipped === 1 ? ' was' : 's were'} left out of the last count, so ${summary.skipped === 1 ? 'its figure is' : 'their figures are'} older than the rest. Catching them next time keeps the whole list in step.`;
  }
  if (summary.uncounted > 0) {
    return `${summary.uncounted} item${summary.uncounted === 1 ? ' has' : 's have'} never been counted. Until they are, the only thing known about them is what was booked in — and anything you don't actually stock is worth archiving.`;
  }
  if (summary.stale > 0) return `${summary.stale} item${summary.stale === 1 ? " hasn't" : "s haven't"} been counted in over ${UNSEEN_DAYS} days. Their figures have only moved on deliveries since.`;
  return 'Every item has been counted recently — these figures are as good as they get without a till.';
}

/**
 * Draught, and anything else measured rather than counted, is stored in litres
 * — a keg and a cask and a bag-in-box only share arithmetic through a common
 * unit. But nobody orders in litres. "100 Litres" is a number a cellar person
 * has to divide before it means anything, and dividing it is the app's job:
 * two kegs is the thing being decided about.
 *
 * Discrete stock is left alone. A pub counts bottled beer in bottles and
 * spirits in bottles, so "23 items" and "5 Bottles" already read the way they
 * are ordered, and pushing those into cases would turn a clear figure into
 * "0.96 Cases".
 */
export const isMeasured = (unitInfo) => !!unitInfo?.hasTenthsOption;

/** "2 Kegs", "1 Keg", "1.8 Kegs" — a measured quantity in whole containers. */
export function formatContainers(quantity, unitInfo) {
  const upw = (unitInfo?.unitsPerWhole > 0 ? unitInfo.unitsPerWhole : 1);
  const n = round1((Number(quantity) || 0) / upw);
  const label = unitInfo?.wholeLabel || 'units';
  return `${n} ${n === 1 ? label.replace(/s$/i, '') : label}`;
}

/** "counted today", "counted 7 days ago" — freshness in plain words. */
export function countedAgo(days) {
  if (days === null || days === undefined) return 'never counted';
  if (days < 1) return 'counted today';
  if (days < 2) return 'counted yesterday';
  if (days < 14) return `counted ${Math.round(days)} days ago`;
  if (days < 60) return `counted ${Math.round(days / 7)} weeks ago`;
  return 'counted months ago';
}
