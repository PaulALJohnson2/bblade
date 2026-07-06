/**
 * deliveryUnits — how an item is BOUGHT/received, and the exact conversion of
 * each purchase-unit into the item's base quantity unit.
 *
 * The purchasing mirror of wastageUnits: stock arrives in the units it's
 * bought in (cases, kegs, bottles, bags, loose kg…), not the units it's sold
 * in. Each row carries `perBase` = how many of the item's base quantity units
 * one of that purchase-unit equals, so a delivery can be added onto
 * item.quantity precisely:  quantity = Σ(count × perBase).
 *
 * Base unit per item (set by parseUnitInfo in stockUnitUtils):
 *   spirits/wine → tenths (10 per bottle) · keg → litres · cask → gallons
 *   packaged → each · weight → kg or g
 */

import { parseUnitInfo } from './stockUnitUtils';

const round = (n) => Math.round(n * 1e6) / 1e6;

/**
 * Purchase-unit rows for receiving an item.
 * @returns { baseLabel, rows: [{ key, label, perBase, integer }] }
 */
export function deliveryUnitsFor(item) {
  const info = parseUnitInfo(item);
  const unitsPerWhole = info.unitsPerWhole || 1;
  const rows = [];

  // Orthogonal "case of N whole units" dimension (from item.casePack).
  if (info.casePack > 0) {
    rows.push({ key: 'case', label: `Cases (×${info.casePack})`, perBase: info.casePack * unitsPerWhole, integer: true });
  }

  // The whole container (Keg, Bottle, Case, Bag, …).
  rows.push({ key: 'whole', label: info.wholeLabel, perBase: unitsPerWhole, integer: true });

  // Loose part units (split cases, loose kg from the butcher…). Tenths are a
  // counting convention, not something a supplier delivers, so skip those.
  if (info.hasPartUnit && info.partLabel !== 'Tenths') {
    const discrete = info.partLabel === 'Loose' || info.partLabel === 'Slices';
    rows.push({ key: 'part', label: info.partLabel, perBase: 1, integer: discrete });
  }

  const baseLabel = info.hasPartUnit ? info.partLabel : info.wholeLabel;
  return { baseLabel, rows };
}

/** Base-unit total received, summed at full precision then rounded once. */
export function computeDeliveryQuantity(rows, values) {
  let total = 0;
  for (const r of rows) {
    const v = parseFloat(values?.[r.key]) || 0;
    if (v > 0) total += v * r.perBase;
  }
  return round(total);
}

/** Human summary of received purchase-units: "2 Cases (×12), 6 Bottles". */
export function summariseDeliveryUnits(units = []) {
  return units
    .filter((u) => (Number(u.count) || 0) > 0)
    .map((u) => `${u.count} ${u.label}`)
    .join(', ');
}
