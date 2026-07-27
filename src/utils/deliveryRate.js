/**
 * deliveryRate — a usage rate from the delivery feed alone, before any second
 * stock take exists.
 *
 * A pub can't accumulate kegs indefinitely. Stock on hand is bounded by the
 * cellar and by cash, so over a long enough window what comes IN is what gets
 * drunk. That makes the delivery log a usable proxy for consumption at a venue
 * with no back office, no till export and — for its first month or two — no
 * pair of counts to measure between.
 *
 * THE ESTIMATOR. For deliveries at t₁ … tₙ, stock obeys
 *
 *     S(tₙ) = S(t₁) + Σ deliveries in (t₁, tₙ] − consumption
 *
 * so if the level is roughly the same at both ends, consumption is the sum of
 * every delivery EXCEPT the first, over the span from first to last. Counting
 * the first delivery too is the obvious mistake and inflates the rate by a
 * whole delivery — with 3 kegs arriving weekly it reads 4 a week, not 3.
 *
 * WHAT IT CANNOT DO. It assumes the stock level is stationary. A line being
 * built up, run down before delisting, or bought ahead for Christmas will read
 * wrong, and nothing here can tell the difference without counts. So a
 * delivery-derived rate never claims better than "fair" confidence, and a
 * counted rate always beats it (see mergeRates).
 */

const DAY = 24 * 60 * 60 * 1000;
const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;
const millis = (t) => (t?.toMillis ? t.toMillis() : (t instanceof Date ? t.getTime() : 0));

/** Below this the span is too short for the stationarity argument to hold. */
const MIN_SPAN_DAYS = 10;

/**
 * Rates from delivery-log entries, whose quantities are already in base units
 * (so this covers hand-entered deliveries as well as scanned ones).
 *
 * @param {Array} deliveries - deliveryLog docs { itemId, itemName, quantity, receivedAt }
 * @param {Set}   shortItems - item ids short-delivered somewhere in the window
 * @returns {Array} one row per item with at least two deliveries
 */
export function ratesFromDeliveries(deliveries, shortItems) {
  const byItem = new Map();
  for (const d of deliveries || []) {
    if (!d.itemId) continue;
    const at = millis(d.receivedAt);
    const qty = Number(d.quantity) || 0;
    if (!at || qty <= 0) continue;
    if (!byItem.has(d.itemId)) byItem.set(d.itemId, { itemName: d.itemName || '', events: [] });
    const e = byItem.get(d.itemId);
    if (!e.itemName && d.itemName) e.itemName = d.itemName;
    e.events.push({ at, qty });
  }

  const out = [];
  for (const [itemId, { itemName, events }] of byItem) {
    events.sort((a, b) => a.at - b.at);

    // Deliveries on the same day are one drop, not two — merging them keeps a
    // split order from inventing an extra gap of zero days.
    const merged = [];
    for (const ev of events) {
      const last = merged[merged.length - 1];
      if (last && ev.at - last.at < DAY / 2) last.qty += ev.qty;
      else merged.push({ ...ev });
    }
    if (merged.length < 2) {
      out.push({
        itemId, itemName, usagePerWeek: 0, deliveries: merged.length,
        gaps: 0, spanDays: 0, spread: null, censoredGaps: 0,
        confidence: 'none', source: 'deliveries', lastDelivery: merged[0]?.at || 0,
      });
      continue;
    }

    const first = merged[0];
    const last = merged[merged.length - 1];
    const spanDays = (last.at - first.at) / DAY;
    // Everything after the first drop is what replaced what was drunk.
    const total = merged.slice(1).reduce((s, e) => s + e.qty, 0);

    // Per-gap rates give the consistency signal; a line that takes 3 kegs
    // every week reads very differently from one taking 12 then nothing.
    const rates = [];
    for (let i = 1; i < merged.length; i++) {
      const days = (merged[i].at - merged[i - 1].at) / DAY;
      if (days > 0.5) rates.push((merged[i].qty / days) * 7);
    }
    let spread = null;
    if (rates.length >= 2) {
      const mean = rates.reduce((s, x) => s + x, 0) / rates.length;
      if (mean > 0) spread = round2((Math.max(...rates) - Math.min(...rates)) / mean);
    }

    // A short delivery means they wanted more than arrived, so the feed
    // understates demand for this item — the same censoring rule as counted
    // usage, applied to the only evidence available here.
    const censored = shortItems?.has(itemId) ? 1 : 0;

    out.push({
      itemId,
      itemName,
      usagePerWeek: spanDays > 0 ? round3((total / spanDays) * 7) : 0,
      deliveries: merged.length,
      gaps: merged.length - 1,
      spanDays: round2(spanDays),
      spread,
      censoredGaps: censored,
      lowerBound: censored > 0,
      confidence: confidenceOf(merged.length, spanDays, spread),
      source: 'deliveries',
      lastDelivery: last.at,
    });
  }

  return out.sort((a, b) => b.usagePerWeek - a.usagePerWeek || a.itemName.localeCompare(b.itemName));
}

/**
 * Capped at "fair" on purpose. However many deliveries back it, this can't
 * see a line being stocked up or run down, and pretending otherwise would put
 * a confident number in front of a manager who'd act on it.
 */
function confidenceOf(deliveries, spanDays, spread) {
  if (deliveries < 2 || spanDays < 1) return 'none';
  if (deliveries < 3 || spanDays < MIN_SPAN_DAYS) return 'low';
  if (spread !== null && spread > 1) return 'low';
  return 'fair';
}

const RANK = { none: 0, low: 1, fair: 2, good: 3 };

/**
 * One rate per item, counted measurements beating delivery estimates.
 *
 * A counted rate is a measurement of what actually left the cellar; a
 * delivery-derived one is an inference resting on an assumption. So counted
 * wins wherever it exists, even at low confidence — with one exception: a
 * counted rate built entirely from censored periods has no observations at
 * all, and an estimate beats nothing.
 *
 * @param {Array} counted  - rows from aggregateUsage()
 * @param {Array} derived  - rows from ratesFromDeliveries()
 */
export function mergeRates(counted, derived) {
  const out = new Map();

  for (const d of derived || []) {
    if (d.confidence === 'none') continue;
    out.set(d.itemId, { ...d, source: 'deliveries' });
  }

  for (const c of counted || []) {
    if (c.observations > 0) {
      const d = out.get(c.itemId);
      out.set(c.itemId, {
        ...c,
        source: 'counts',
        // Keep the estimate alongside: a big disagreement between what was
        // delivered and what was counted out is worth someone's attention.
        deliveryRate: d ? d.usagePerWeek : null,
      });
    } else if (!out.has(c.itemId)) {
      out.set(c.itemId, { ...c, source: 'counts' });
    }
  }

  return [...out.values()].sort((a, b) =>
    RANK[b.confidence] - RANK[a.confidence]
    || b.usagePerWeek - a.usagePerWeek
    || String(a.itemName).localeCompare(String(b.itemName)));
}

export const SOURCE_LABEL = {
  counts: 'measured between counts',
  deliveries: 'estimated from deliveries',
};
