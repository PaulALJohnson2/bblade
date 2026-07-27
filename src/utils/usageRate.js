/**
 * usageRate — how fast the venue actually gets through each product.
 *
 * Derived, never captured. Between two completed stock takes:
 *
 *   usage = opening count + deliveries − wastage − closing count
 *
 * That's total depletion, which is what you want for ordering: it includes
 * sales, spillage, staff drinks and whatever else left the cellar. No till
 * export is needed, which matters — an independent may not export sales
 * reliably, but it always counts and always takes deliveries.
 *
 * The figure is only as good as the delivery feed underneath it, which is why
 * this stage waited for scanning. Three things are excluded rather than
 * averaged in, because each would quietly bias the rate:
 *
 *   CENSORED   A short delivery in a period where the item ran down means the
 *              venue sold what it had, not what it could have. Measured usage
 *              is a LOWER BOUND. Averaged in, it teaches the system to order
 *              less, which shorts the next period harder — the spiral that
 *              makes delivered-only demand data dangerous.
 *   IMPLAUSIBLE Negative usage — closing higher than everything available.
 *              That's a miscount or an unlogged delivery, not consumption.
 *   UNCOUNTED  An item missing from either count has no period at all.
 *
 * Confidence is reported, not hidden: one period is an anecdote, six with
 * consistent rates is something to order against.
 */

const DAY = 24 * 60 * 60 * 1000;
const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;
const present = (n) => typeof n === 'number' && n >= 0;
const millis = (t) => (t?.toMillis ? t.toMillis() : (t instanceof Date ? t.getTime() : 0));

/** Fraction of what was available that's still there at closing. */
const RAN_LOW_FRACTION = 0.1;

/**
 * Consecutive pairs of completed sessions, oldest period first.
 * @param {Array} sessions - completed sessions (any order)
 */
export function usagePeriods(sessions) {
  // Paired WITHIN a section. Stock takes are created per section — the app has
  // separate "Bar stock take" and "Kitchen stock take" buttons — so a venue
  // that counts both produces an interleaved run of sessions. Pairing them in
  // plain date order puts a bar take opposite a kitchen one, and since the two
  // share no items every period comes back empty: a venue counting both halves
  // of its stock would silently get no usage rates at all.
  const bySection = new Map();
  for (const s of sessions || []) {
    if (s.status !== 'completed' || !s.completedAt) continue;
    const key = s.section === 'kitchen' ? 'kitchen' : 'bar';
    if (!bySection.has(key)) bySection.set(key, []);
    bySection.get(key).push(s);
  }

  const pairs = [];
  for (const group of bySection.values()) {
    group.sort((a, b) => millis(a.completedAt) - millis(b.completedAt));
    for (let i = 1; i < group.length; i++) {
      pairs.push({ opening: group[i - 1], closing: group[i] });
    }
  }
  // Oldest period first, whichever section it belongs to.
  return pairs.sort((a, b) => millis(a.closing.completedAt) - millis(b.closing.completedAt));
}

/**
 * Item ids that were short-delivered inside a window, from the scanned notes.
 * Short means the supplier despatched more than was signed for — the only
 * evidence available that supply, not demand, capped consumption.
 */
export function shortDeliveredItems(notes, fromMs, toMs) {
  const out = new Set();
  for (const note of notes || []) {
    const at = millis(note.uploadedAt);
    if (at <= fromMs || at > toMs) continue;
    for (const line of note.lines || []) {
      if (!line.itemId) continue;
      if (present(line.qtyDespatched) && present(line.qtyDelivered) && line.qtyDelivered < line.qtyDespatched) {
        out.add(line.itemId);
      }
    }
  }
  return out;
}

/**
 * Usage for every item counted at both ends of one period.
 *
 * @param {Object} args - { opening, closing, deliveries, wastage, shortItems }
 * @returns {{ days, from, to, rows }}
 */
export function computePeriodUsage({ opening, closing, deliveries, wastage, shortItems }) {
  const fromMs = millis(opening?.completedAt);
  const toMs = millis(closing?.completedAt);
  const days = (toMs - fromMs) / DAY;

  const del = {};
  for (const e of deliveries || []) {
    if (e.itemId) del[e.itemId] = (del[e.itemId] || 0) + (Number(e.quantity) || 0);
  }
  const was = {};
  for (const e of wastage || []) {
    if (e.itemId) was[e.itemId] = (was[e.itemId] || 0) + (Number(e.quantity) || 0);
  }

  const openCounts = opening?.counts || {};
  const closeCounts = closing?.counts || {};
  const rows = [];

  for (const id of Object.keys(openCounts)) {
    // Both ends or nothing — the same rule the variance report uses, and for
    // the same reason: a half-counted item has no trustworthy movement.
    if (!closeCounts[id]) continue;

    const openingQty = Number(openCounts[id].quantity) || 0;
    const closingQty = Number(closeCounts[id].quantity) || 0;
    const delivered = del[id] || 0;
    const wasted = was[id] || 0;
    const usage = openingQty + delivered - wasted - closingQty;

    if (openingQty === 0 && closingQty === 0 && delivered === 0 && wasted === 0) continue;

    const available = openingQty + delivered;
    const ranOut = available > 0 && closingQty <= 0;
    const ranLow = available > 0 && closingQty / available <= RAN_LOW_FRACTION;
    const wasShort = !!shortItems?.has(id);

    rows.push({
      itemId: id,
      itemName: closeCounts[id].itemName || openCounts[id].itemName || '',
      opening: round2(openingQty),
      delivered: round2(delivered),
      wasted: round2(wasted),
      closing: round2(closingQty),
      usage: round2(usage),
      days: round2(days),
      perWeek: days > 0 ? round3((usage / days) * 7) : 0,
      wasShort,
      ranOut,
      // Supply capped consumption — a floor under demand, not a measure of it.
      censored: wasShort && (ranOut || ranLow),
      // Closing above everything available: a miscount or a missing delivery.
      implausible: usage < 0,
    });
  }

  return { days: round2(days), from: fromMs, to: toMs, rows };
}

function confidenceOf(observations, spread) {
  if (observations === 0) return 'none';
  if (observations < 3) return 'low';
  if (spread !== null && spread > 1) return 'low';
  if (observations < 6 || (spread !== null && spread > 0.5)) return 'fair';
  return 'good';
}

/**
 * Combine periods into one rate per item.
 *
 * Weighted by DAYS rather than a plain mean of the per-period rates, so a
 * three-week period counts for three times a one-week one instead of equally.
 *
 * @param {Array} periods - results of computePeriodUsage, any order
 * @returns {Array} one row per item, busiest first
 */
export function aggregateUsage(periods) {
  const acc = new Map();

  for (const p of periods || []) {
    if (!(p.days > 0.5)) continue; // two counts hours apart say nothing
    for (const r of p.rows) {
      const a = acc.get(r.itemId) || {
        itemId: r.itemId, itemName: r.itemName,
        totalUsage: 0, totalDays: 0, rates: [],
        observations: 0, censoredPeriods: 0, implausiblePeriods: 0,
        ranOutPeriods: 0, lastPeriodEnd: 0,
      };
      if (r.itemName && !a.itemName) a.itemName = r.itemName;
      if (p.to > a.lastPeriodEnd) a.lastPeriodEnd = p.to;

      if (r.censored) a.censoredPeriods += 1;
      else if (r.implausible) a.implausiblePeriods += 1;
      else {
        a.totalUsage += r.usage;
        a.totalDays += r.days;
        a.rates.push(r.perWeek);
        a.observations += 1;
        if (r.ranOut) a.ranOutPeriods += 1;
      }
      acc.set(r.itemId, a);
    }
  }

  const out = [];
  for (const a of acc.values()) {
    const usagePerWeek = a.totalDays > 0 ? round3((a.totalUsage / a.totalDays) * 7) : 0;
    // Spread across periods is the honest confidence signal — a product with a
    // steady 12/week is orderable; one swinging 2 to 40 is not, however many
    // periods back it.
    let spread = null;
    if (a.rates.length >= 2) {
      const mean = a.rates.reduce((s, x) => s + x, 0) / a.rates.length;
      if (mean > 0) spread = round2((Math.max(...a.rates) - Math.min(...a.rates)) / mean);
    }
    out.push({
      itemId: a.itemId,
      itemName: a.itemName,
      usagePerWeek,
      observations: a.observations,
      censoredPeriods: a.censoredPeriods,
      implausiblePeriods: a.implausiblePeriods,
      ranOutPeriods: a.ranOutPeriods,
      totalUsage: round2(a.totalUsage),
      totalDays: round2(a.totalDays),
      spread,
      confidence: confidenceOf(a.observations, spread),
      lastPeriodEnd: a.lastPeriodEnd,
    });
  }

  return out.sort((a, b) => b.usagePerWeek - a.usagePerWeek || a.itemName.localeCompare(b.itemName));
}

/**
 * Usage in the units a person thinks in. The base unit is tenths for spirits
 * and litres for kegs, neither of which anyone orders in.
 *
 * @param {number} perWeek - base units per week
 * @param {Object} unitInfo - parseUnitInfo(item)
 */
export function formatUsage(perWeek, unitInfo) {
  const upw = unitInfo?.unitsPerWhole || 1;
  const whole = perWeek / upw;
  const label = unitInfo?.wholeLabel || 'units';
  const single = label.replace(/^(\w+?)s\b/, '$1');
  if (whole >= 10) return `${Math.round(whole)} ${label}`;
  if (whole >= 1) return `${round2(whole)} ${round2(whole) === 1 ? single : label}`;
  return `${round2(whole)} ${label}`;
}

export const CONFIDENCE_LABEL = {
  none: 'No data',
  low: 'Low',
  fair: 'Fair',
  good: 'Good',
};
