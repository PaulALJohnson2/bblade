/**
 * stockAnalysis — the fetch-and-derive half of the usage pipeline.
 *
 * The arithmetic lives in utils/usageRate.js and utils/deliveryRate.js, which
 * are pure and stay that way. This is the part that knows which queries feed
 * them, and it lives here because two screens now need the same answer: the
 * Usage rates panel, where someone deliberately asks for it, and the stock
 * position report, which can't work at all without it.
 *
 * That second caller is why this exists rather than staying inline. A venue
 * that has never opened the Sales screen has an empty itemStats collection, so
 * a position report reading only stored rates would show a venue nothing and
 * blame it on having no data — when in truth the data was there and nobody had
 * pressed a button two screens away.
 */

import {
  getAllStockSessions, getDeliveriesBetween, getWastageBetween,
  getDeliveryNotesBetween,
} from './apiService';
import {
  usagePeriods, computePeriodUsage, shortDeliveredItems, aggregateUsage,
} from '../utils/usageRate';
import { ratesFromDeliveries, mergeRates } from '../utils/deliveryRate';

/** How far back the delivery-only estimate looks when there are no counts. */
export const DELIVERY_WINDOW_DAYS = 180;

/**
 * Derive one usage rate per item from everything the venue has logged.
 *
 * Periods are walked sequentially rather than in parallel: a venue with a year
 * of fortnightly counts is 26 periods × 3 queries, and firing 78 at once to
 * shave a second off something nobody runs twice isn't a good trade.
 *
 * @param {string} venuePath
 * @returns {Promise<{ rates, periods }>} periods is [] when there aren't two
 *   counts yet — the rates are then delivery-estimates alone.
 */
export async function deriveUsageRates(venuePath) {
  // Deliveries alone give a usable rate long before two counts exist — a pub
  // can't hoard kegs, so what comes in is what gets drunk. This is the whole
  // answer for a venue in its first month.
  const since = new Date(Date.now() - DELIVERY_WINDOW_DAYS * 86400000);
  const now = new Date();
  const [allDel, allNotes] = await Promise.all([
    getDeliveriesBetween(venuePath, since, now),
    getDeliveryNotesBetween(venuePath, since, now),
  ]);
  const derived = ratesFromDeliveries(
    allDel.data || [],
    shortDeliveredItems(allNotes.data || [], since.getTime(), now.getTime()),
  );

  const res = await getAllStockSessions(venuePath);
  const sessions = (res.success ? res.data : []).filter((s) => !s.hiddenFromVariance);
  const pairs = usagePeriods(sessions);

  if (!pairs.length) return { rates: mergeRates([], derived), periods: [] };

  const results = [];
  for (const { opening, closing } of pairs) {
    const [d, w, n] = await Promise.all([
      getDeliveriesBetween(venuePath, opening.completedAt, closing.completedAt),
      getWastageBetween(venuePath, opening.completedAt, closing.completedAt),
      getDeliveryNotesBetween(venuePath, opening.completedAt, closing.completedAt),
    ]);
    results.push(computePeriodUsage({
      opening,
      closing,
      deliveries: d.data || [],
      wastage: w.data || [],
      shortItems: shortDeliveredItems(
        n.data || [], opening.completedAt.toMillis(), closing.completedAt.toMillis(),
      ),
    }));
  }

  return {
    rates: mergeRates(aggregateUsage(results), derived),
    periods: results.map((p) => ({
      from: p.from, to: p.to, days: p.days, items: p.rows.length,
      censored: p.rows.filter((r) => r.censored).length,
      implausible: p.rows.filter((r) => r.implausible).length,
    })),
  };
}
