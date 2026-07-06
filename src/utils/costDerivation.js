/**
 * costDerivation — derive stock-item cost prices from till sales data.
 *
 * The till already knows its cost of sales: each report line carries TotCost
 * for Qty units sold. Through the till-product mapping that becomes cost per
 * BASE unit (cost ÷ (qty × perBase)), and ×unitsPerWhole gives the item's
 * costPrice per whole unit (keg, bottle, case) — the same convention the rest
 * of the app uses.
 *
 * Several till lines can price one item (pint + half, single + double, three
 * glass sizes); they're combined weighted by volume, and the spread between
 * their individual estimates is reported — a wide spread usually means a
 * mis-mapped measure, so it's surfaced rather than averaged away silently.
 */

import { parseUnitInfo } from './stockUnitUtils';
import { productKeyFor } from './tillMapping';

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * @param {Object} args - { reports, mappingsByKey, items }
 * @returns {Array<{ itemId, name, current, suggested, lines, spread }>}
 *   suggested = £ per whole unit; spread = (max−min)/min across line estimates.
 */
export function deriveCostPrices({ reports, mappingsByKey, items }) {
  const acc = new Map(); // itemId → { cost, baseUnits, ests: [] }

  for (const r of reports || []) {
    for (const l of r.lines || []) {
      const m = mappingsByKey[productKeyFor(l)];
      if (!m || m.ignore || !m.itemId || !(Number(m.perBase) > 0)) continue;
      const qty = Number(l.qty) || 0;
      const cost = Number(l.cost) || 0;
      if (!(qty > 0 && cost > 0)) continue; // many till lines have no cost configured
      const base = qty * Number(m.perBase);
      const a = acc.get(m.itemId) || { cost: 0, baseUnits: 0, ests: [] };
      a.cost += cost;
      a.baseUnits += base;
      a.ests.push(cost / base);
      acc.set(m.itemId, a);
    }
  }

  const itemsById = Object.fromEntries(items.map((i) => [i.id, i]));
  const out = [];
  for (const [itemId, a] of acc) {
    const item = itemsById[itemId];
    if (!item || !(a.baseUnits > 0)) continue;
    const upw = parseUnitInfo(item).unitsPerWhole || 1;
    const suggested = round2((a.cost / a.baseUnits) * upw);
    if (!(suggested > 0)) continue;
    const current = Number(item.costPrice) || 0;
    // Skip items whose price is already right (within 2%) — nothing to review.
    if (current > 0 && Math.abs(suggested - current) / current < 0.02) continue;
    const min = Math.min(...a.ests);
    const max = Math.max(...a.ests);
    out.push({
      itemId,
      name: item.name,
      item,
      current,
      suggested,
      lines: a.ests.length,
      spread: min > 0 ? round2((max - min) / min) : 0,
    });
  }

  // Unpriced items first, then by value so the big numbers get eyes.
  out.sort((x, y) => (x.current > 0) - (y.current > 0) || y.suggested - x.suggested);
  return out;
}
