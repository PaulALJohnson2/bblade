/**
 * wastageUnits — how an item is WASTED (= how it's sold), and the exact
 * conversion of each sale-unit into the item's base quantity unit.
 *
 * Stock counts record an item in the unit it's *counted* in; wastage records it
 * in the unit it's *sold* in (spirits as singles/doubles, draught as pints, …).
 * Each row carries `perBase` = how many of the item's base quantity units one of
 * that sale-unit equals, so a wasted amount can be subtracted from item.quantity
 * precisely:  quantity = Σ(count × perBase).
 *
 * Base unit per item (set by parseUnitInfo in stockUnitUtils):
 *   spirits/wine → tenths (10 per bottle) · keg → litres · cask → gallons
 *   packaged → each · weight → kg or g
 */

import { parseUnitInfo } from './stockUnitUtils';

// Sale-measure sizes (ml). Single/pint are UK standards; kept here so they can
// later become a per-venue setting.
export const SINGLE_ML = 25;
export const DOUBLE_ML = SINGLE_ML * 2;
export const PINT_ML = 568;
export const HALF_PINT_ML = PINT_ML / 2;
export const WINE_GLASSES_ML = [125, 175, 250];

const WINE_RE = /wine|prosecco|champagne|cava|sparkl|fizz/i;

/** Millilitres in one container described by a wholeUnit string, or null. */
export function parseWholeSizeMl(wholeUnit) {
  const w = (wholeUnit || '').trim();
  // "Bottle 1*70cl", "Keg 1*50ltr" → take the qty + suffix after the "*"
  let m = w.match(/\*\s*(\d+(?:\.\d+)?)\s*([a-zA-Z]+)/);
  // plain "330ml", "70cl"
  if (!m) m = w.match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  if (!(n > 0)) return null;
  if (unit === 'ml') return n;
  if (unit === 'cl') return n * 10;
  if (unit === 'l' || unit === 'ltr' || unit === 'litre') return n * 1000;
  return null; // gall / kg / g / Each → not a millilitre volume
}

const round = (n) => Math.round(n * 1e6) / 1e6;

/**
 * Sale-unit rows for wasting an item.
 * @returns { mode, baseLabel, rows: [{ key, label, perBase, integer }] }
 */
export function wastageUnitsFor(item) {
  const info = parseUnitInfo(item);
  const part = (item.partUnit || '').trim().toLowerCase();
  const unitsPerWhole = info.unitsPerWhole || 1;

  // ---- Spirits / Wine (sold in measures of a bottle; base = tenths) ----
  if (part.includes('tenth')) {
    const bottleMl = parseWholeSizeMl(item.wholeUnit);
    const isWine = WINE_RE.test(item.category || '');
    const rows = [];
    if (bottleMl) {
      // Keep perBase at full precision; only the final total is rounded.
      const perMl = (ml) => (ml / bottleMl) * unitsPerWhole;
      if (isWine) {
        WINE_GLASSES_ML.forEach((ml) => rows.push({ key: `g${ml}`, label: `${ml}ml`, perBase: perMl(ml), integer: true }));
      } else {
        rows.push({ key: 'single', label: 'Single', perBase: perMl(SINGLE_ML), integer: true });
        rows.push({ key: 'double', label: 'Double', perBase: perMl(DOUBLE_ML), integer: true });
      }
    }
    rows.push({ key: 'bottle', label: 'Bottle', perBase: unitsPerWhole, integer: true });
    rows.push({ key: 'tenth', label: 'Tenths', perBase: 1, integer: true });
    return { mode: isWine ? 'wine' : 'spirit', baseLabel: 'Tenths', rows };
  }

  // ---- Draught (keg/cask; base = litres or gallons, or pints) ----
  if (part === 'litre' || part === 'gallon' || part === 'pint') {
    let pint, half;
    if (part === 'litre') { pint = PINT_ML / 1000; half = HALF_PINT_ML / 1000; }
    else if (part === 'gallon') { pint = 1 / 8; half = 1 / 16; }
    else { pint = 1; half = 0.5; } // base already in pints
    return {
      mode: 'draught', baseLabel: info.partLabel,
      rows: [
        { key: 'whole', label: info.wholeLabel, perBase: unitsPerWhole, integer: true },
        { key: 'pint', label: 'Pints', perBase: pint, integer: true },
        { key: 'half', label: 'Half pints', perBase: half, integer: true },
      ],
    };
  }

  // ---- Food / weight (base = kg or g) ----
  if (part === 'kilogram' || part === 'gram') {
    const baseIsKg = part === 'kilogram';
    return {
      mode: 'weight', baseLabel: baseIsKg ? 'Kg' : 'Grams',
      rows: [
        { key: 'whole', label: info.wholeLabel, perBase: unitsPerWhole, integer: false },
        { key: 'kg', label: 'Kg', perBase: baseIsKg ? 1 : 1000, integer: false },
        { key: 'g', label: 'Grams', perBase: baseIsKg ? 0.001 : 1, integer: false },
      ],
    };
  }

  // ---- Packaged (cans, bottled beer, packs; base = each) ----
  const rows = [];
  const casePack = info.casePack || 0;
  if (casePack > 0) rows.push({ key: 'cases', label: `Cases (×${casePack})`, perBase: casePack * unitsPerWhole, integer: true });
  if (info.hasPartUnit) {
    // The whole is a multi-pack (e.g. "Case 1*24Each") → offer the whole + singles.
    rows.push({ key: 'whole', label: info.wholeLabel, perBase: unitsPerWhole, integer: true });
    rows.push({ key: 'single', label: 'Singles', perBase: 1, integer: true });
  } else {
    rows.push({ key: 'single', label: 'Singles', perBase: unitsPerWhole, integer: true });
  }
  return { mode: 'packaged', baseLabel: 'Each', rows };
}

/** Base-unit total wasted, summed at full precision then rounded once. */
export function computeWastageQuantity(rows, values) {
  let total = 0;
  for (const r of rows) {
    const v = parseFloat(values?.[r.key]) || 0;
    if (v > 0) total += v * r.perBase;
  }
  return round(total);
}
