/**
 * varianceReport — expected vs actual stock between two completed counts.
 *
 * A stock period is the gap between two consecutive COMPLETED stock sessions
 * (whatever the venue's cadence — weekly, fortnightly, monthly). For every
 * item counted at both ends:
 *
 *   expected closing = opening count + deliveries − wastage − sales depletion
 *   variance         = actual closing − expected     (negative = missing)
 *
 * Deliveries/wastage are windowed by their exact timestamps. Sales reports
 * are whole trading DAYS, so counts are snapped to a trading-day boundary:
 * a count completed before 17:00 is treated as start-of-trade for that day
 * (its date's sales fall AFTER it); a later count as end-of-trade (trading
 * starts the next day). The UI shows the resulting date range so the
 * convention is never hidden.
 */

import { parseUnitInfo } from './stockUnitUtils';
import { computeDepletion } from './tillMapping';

const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const round2 = (n) => Math.round(n * 100) / 100;
const toDate = (t) => (t?.toDate ? t.toDate() : new Date(t));

/** First trading date (ISO) covered AFTER a count completed at `completedAt`. */
export function tradingStartDate(completedAt) {
  const d = toDate(completedAt);
  const start = new Date(d);
  if (d.getHours() >= 17) start.setDate(start.getDate() + 1);
  return isoDate(start);
}

/** ISO dates from `startIso` (inclusive) to `endIso` (exclusive). */
export function tradingDatesBetween(startIso, endIso) {
  const dates = [];
  const d = new Date(`${startIso}T12:00:00`);
  // Hard cap of a year guards against a bad boundary producing a runaway loop.
  for (let i = 0; i < 366 && isoDate(d) < endIso; i++) {
    dates.push(isoDate(d));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

/** £ cost of ONE base unit of an item (costPrice is per whole unit). 0 = unknown. */
export function costPerBase(item) {
  const cost = Number(item?.costPrice) || Number(item?.unitCost) || 0;
  if (!(cost > 0)) return 0;
  const upw = parseUnitInfo(item).unitsPerWhole || 1;
  return cost / upw;
}

/**
 * Build the variance rows for a period.
 *
 * @param {Object} args
 *   opening, closing  - completed session docs (with .counts)
 *   deliveries        - deliveryLog entries in the window
 *   wastage           - wastageLog entries in the window
 *   salesReports      - salesReports docs whose reportDate is in the window
 *   mappingsByKey     - tillProducts docs keyed by id
 *   items             - stock items
 * @returns {{ rows, notCounted, totals, salesTotals }}
 */
export function computeVariance({ opening, closing, deliveries, wastage, salesReports, mappingsByKey, items }) {
  const itemsById = Object.fromEntries(items.map((i) => [i.id, i]));

  const del = {};
  for (const e of deliveries || []) {
    if (e.itemId) del[e.itemId] = (del[e.itemId] || 0) + (Number(e.quantity) || 0);
  }
  const was = {};
  for (const e of wastage || []) {
    if (e.itemId) was[e.itemId] = (was[e.itemId] || 0) + (Number(e.quantity) || 0);
  }

  const sales = {};
  let salesMappedValue = 0, salesTotalValue = 0;
  for (const r of salesReports || []) {
    const d = computeDepletion(r.lines, mappingsByKey);
    for (const x of d.perItem) sales[x.itemId] = (sales[x.itemId] || 0) + x.quantity;
    salesMappedValue += d.mappedValue;
    salesTotalValue += d.totalValue;
  }

  const openCounts = opening?.counts || {};
  const closeCounts = closing?.counts || {};
  const ids = new Set([
    ...Object.keys(openCounts), ...Object.keys(closeCounts),
    ...Object.keys(sales), ...Object.keys(del), ...Object.keys(was),
  ]);

  const rows = [];
  const notCounted = [];
  for (const id of ids) {
    const item = itemsById[id];
    const name = closeCounts[id]?.itemName || openCounts[id]?.itemName || item?.name || 'Item';
    const d = del[id] || 0, w = was[id] || 0, s = sales[id] || 0;

    if (!(openCounts[id] && closeCounts[id])) {
      // Movement without both counts → no trustworthy variance for this item.
      notCounted.push({ itemId: id, name, missing: !openCounts[id] ? 'opening count' : 'closing count', hasMovement: (d + w + s) > 0 });
      continue;
    }

    const openingQty = Number(openCounts[id].quantity) || 0;
    const actual = Number(closeCounts[id].quantity) || 0;
    if (openingQty === 0 && actual === 0 && d === 0 && w === 0 && s === 0) continue;

    const expected = openingQty + d - w - s;
    const variance = round2(actual - expected);
    const cpb = costPerBase(item);
    rows.push({
      itemId: id, name, item,
      opening: round2(openingQty), deliveries: round2(d), wastage: round2(w), sales: round2(s),
      expected: round2(expected), actual: round2(actual), variance,
      valueVariance: cpb > 0 ? round2(variance * cpb) : null,
    });
  }

  rows.sort((a, b) =>
    Math.abs(b.valueVariance ?? 0) - Math.abs(a.valueVariance ?? 0) ||
    Math.abs(b.variance) - Math.abs(a.variance)
  );
  notCounted.sort((a, b) => (b.hasMovement - a.hasMovement) || a.name.localeCompare(b.name));

  const totals = { shortValue: 0, overValue: 0, netValue: 0, unvalued: 0 };
  for (const r of rows) {
    if (r.valueVariance == null) { if (r.variance !== 0) totals.unvalued++; continue; }
    if (r.valueVariance < 0) totals.shortValue += r.valueVariance;
    else totals.overValue += r.valueVariance;
  }
  totals.shortValue = round2(totals.shortValue);
  totals.overValue = round2(totals.overValue);
  totals.netValue = round2(totals.shortValue + totals.overValue);

  return {
    rows, notCounted, totals,
    salesTotals: { mappedValue: round2(salesMappedValue), totalValue: round2(salesTotalValue) },
  };
}
