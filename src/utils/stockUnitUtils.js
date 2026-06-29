/**
 * Stock Unit Utilities
 *
 * Parses wholeUnit/partUnit from stock items to determine
 * dynamic counting fields and labels for stock taking.
 */

/**
 * Parse a stock item's unit info to determine counting configuration.
 *
 * @param {Object} item - Stock item with wholeUnit, partUnit fields
 * @returns {Object} { wholeLabel, partLabel, hasPartUnit, unitsPerWhole, hasTenthsOption, casePack, caseLabel }
 */
export function parseUnitInfo(item) {
  // casePack is an orthogonal "comes in a case of N (whole units)" multiplier that
  // composes with every unit type — so we compute the base unit info and just
  // attach it. casePack === 0 means the item has no case size (unchanged behaviour).
  const info = parseUnitInfoBase(item);
  const casePack = Number(item.casePack) || 0;
  return { ...info, casePack, caseLabel: 'Cases' };
}

function parseUnitInfoBase(item) {
  const whole = (item.wholeUnit || '').trim();
  const part = (item.partUnit || '').trim();

  if (!whole) {
    return { wholeLabel: 'Quantity', partLabel: '', hasPartUnit: false, unitsPerWhole: 1, hasTenthsOption: false };
  }

  // Check for "tenth" in partUnit - spirits/wine industry standard
  // Tenths are already the primary part unit, no need for dual option
  if (part.toLowerCase().includes('tenth')) {
    const wholeLabel = parseContainerLabel(whole) || 'Bottles';
    return { wholeLabel, partLabel: 'Tenths', hasPartUnit: true, unitsPerWhole: 10, hasTenthsOption: false };
  }

  // Compound units with multiplier: "Keg 1*50ltr", "Case 1*24Each", "Bag 1*2.5kg",
  // "Box 1*32Each", "Pack 1*5Each", "Tub 1*4ltr", "Punnet 1*16Each", "Case 12*Litre",
  // "Case 4*2.5kg", "Pack 6*4Each", "Case 10*10Each", "Case 36*50g"
  const compoundMatch = whole.match(/^(\w+)\s+(\d+(?:\.\d+)?)\*(\d+(?:\.\d+)?)(.*)$/);
  if (compoundMatch) {
    const [, container, countStr, qtyStr, unitSuffix] = compoundMatch;
    const count = parseFloat(countStr);
    const qty = parseFloat(qtyStr);
    const suffix = unitSuffix.trim();

    if (count === 1) {
      // "Case 1*24Each" → Cases / Loose (24)
      // "Keg 1*50ltr" → Kegs / Litres (50)
      // "Bag 1*2.5kg" → Bags / x 2.5kg (2.5 - but multiplier is qty)
      const wholeLabel = pluralize(container);
      const partLabel = formatPartLabel(qty, suffix, part);
      const tenths = !!part && isMeasurementUnit(part);
      return { wholeLabel, partLabel, hasPartUnit: !!part, unitsPerWhole: qty, hasTenthsOption: tenths };
    } else {
      // "Case 4*2.5kg" → count=4, qty=2.5, suffix="kg"
      // "Pack 6*4Each" → count=6, qty=4, suffix="Each"
      // "Case 36*50g" → count=36, qty=50, suffix="g"
      const wholeLabel = pluralize(container);
      const multiplier = count; // number of sub-units in the whole
      const partLabel = formatSubUnitLabel(qty, suffix, part);
      const tenths = !!part && isMeasurementUnit(part);
      return { wholeLabel, partLabel, hasPartUnit: !!part, unitsPerWhole: multiplier, hasTenthsOption: tenths };
    }
  }

  // Compound units where qty part is not a number: "Case 12*Litre", "Case 3*Kilogram"
  const compoundTextMatch = whole.match(/^(\w+)\s+(\d+(?:\.\d+)?)\*(\w+)$/);
  if (compoundTextMatch) {
    const [, container, countStr, unitName] = compoundTextMatch;
    const count = parseFloat(countStr);
    const wholeLabel = pluralize(container);
    const partLabel = formatUnitName(unitName);
    const tenths = !!part && isMeasurementUnit(part);
    return { wholeLabel, partLabel, hasPartUnit: !!part, unitsPerWhole: count, hasTenthsOption: tenths };
  }

  // "Dozen" whole unit
  if (whole.toLowerCase() === 'dozen') {
    const partLabel = part ? formatUnitName(part) : 'Loose';
    return { wholeLabel: 'Dozens', partLabel, hasPartUnit: !!part, unitsPerWhole: 12, hasTenthsOption: false };
  }

  // "Gallon" whole unit with Pint part
  if (whole.toLowerCase() === 'gallon' && part.toLowerCase() === 'pint') {
    return { wholeLabel: 'Gallons', partLabel: 'Pints', hasPartUnit: true, unitsPerWhole: 8, hasTenthsOption: true };
  }

  // Numeric prefix units: "6Each", "280Each", "10kg", "500g", "5ltr", "4ltr", "42ltr"
  const numericMatch = whole.match(/^(\d+(?:\.\d+)?)([\w]+)$/);
  if (numericMatch) {
    const [, numStr, unitName] = numericMatch;
    const num = parseFloat(numStr);
    const wholeLabel = formatNumericWholeLabel(num, unitName);
    const partLabel = part ? formatUnitName(part) : '';
    const tenths = !!part && isMeasurementUnit(part);
    return { wholeLabel, partLabel, hasPartUnit: !!part, unitsPerWhole: part ? num : 1, hasTenthsOption: tenths };
  }

  // Simple single units: "Litre", "Kilogram", "Each", "70cl", "75cl"
  if (!part) {
    const wholeLabel = formatUnitName(whole);
    return { wholeLabel, partLabel: '', hasPartUnit: false, unitsPerWhole: 1, hasTenthsOption: false };
  }

  // Fallback for any remaining with part unit
  const wholeLabel = formatUnitName(whole);
  const partLabel = formatUnitName(part);
  const tenths = isMeasurementUnit(part);
  return { wholeLabel, partLabel, hasPartUnit: true, unitsPerWhole: 1, hasTenthsOption: tenths };
}

/**
 * Check if a part unit is a measurement (volume/weight) rather than discrete (each/slice).
 * Measurement units get a tenths alternative since containers can't be precisely counted.
 */
function isMeasurementUnit(partUnit) {
  if (!partUnit) return false;
  const lower = partUnit.toLowerCase();
  const measurements = ['litre', 'gallon', 'pint', 'kilogram', 'gram', 'millilitre', 'ltr', 'kg', 'g', 'ml'];
  if (measurements.includes(lower)) return true;
  // Numeric measurement like "2.5kg", "400ml"
  if (/^\d+(?:\.\d+)?(kg|g|ltr|ml|l)$/i.test(lower)) return true;
  return false;
}

/**
 * Parse container name from compound units like "Bottle 1*70cl" → "Bottles"
 */
function parseContainerLabel(whole) {
  // "Bottle 1*70cl" → "Bottle"
  const match = whole.match(/^(\w+)\s+\d/);
  if (match) return pluralize(match[1]);

  // Plain "70cl", "75cl" → "Bottles" (spirits are always bottles)
  if (/^\d+cl$/.test(whole)) return 'Bottles';

  return null;
}

/**
 * Format the part label for compound units where count=1
 */
function formatPartLabel(qty, suffix, partUnit) {
  if (!partUnit) return '';
  const partLower = partUnit.toLowerCase();

  // "Each" part units → "Loose"
  if (partLower === 'each') return 'Loose';

  // "Slice" → "Slices"
  if (partLower === 'slice') return 'Slices';

  // Unit-based parts: "Litre", "Gallon", "Kilogram", "Gram"
  return formatUnitName(partUnit);
}

/**
 * Format sub-unit label for multi-count compounds like "Case 4*2.5kg"
 */
function formatSubUnitLabel(qty, suffix, partUnit) {
  if (!partUnit) return '';
  const partLower = partUnit.toLowerCase();

  // "Each" → "Loose"
  if (partLower === 'each') return 'Loose';

  // Numeric sub-units like "2.5kg", "50g", "500g", "4Each", "10Each"
  // Check if partUnit has a number prefix
  const partNumMatch = partUnit.match(/^(\d+(?:\.\d+)?)([\w]+)$/);
  if (partNumMatch) {
    const [, pNum, pUnit] = partNumMatch;
    if (pUnit.toLowerCase() === 'each') return `x ${pNum}`;
    return `x ${pNum}${pUnit}`;
  }

  return formatUnitName(partUnit);
}

/**
 * Format the whole label for numeric prefix units like "6Each" → "Packs (6)"
 */
function formatNumericWholeLabel(num, unitName) {
  const lower = unitName.toLowerCase();

  if (lower === 'each') return `Packs (${num})`;
  if (lower === 'kg') return 'Kg';
  if (lower === 'g') return `${num}g`;
  if (lower === 'ltr') return `${num} Litres`;
  if (lower === 'ml') return `${num}ml`;
  if (lower === 'cl') return 'Bottles';

  return `${num} ${formatUnitName(unitName)}`;
}

/**
 * Format a unit name for display
 */
function formatUnitName(name) {
  if (!name) return '';
  const lower = name.toLowerCase();

  const unitMap = {
    'each': 'Loose',
    'litre': 'Litres',
    'gallon': 'Gallons',
    'pint': 'Pints',
    'kilogram': 'Kg',
    'gram': 'Grams',
    'millilitre': 'ml',
    'slice': 'Slices',
  };

  if (unitMap[lower]) return unitMap[lower];

  // Handle measurement strings like "2.5kg", "400ml", "50g"
  if (/^\d+(?:\.\d+)?[a-z]+$/.test(lower)) return `x ${name}`;

  // Capitalize first letter
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Pluralize a container name
 */
function pluralize(word) {
  if (!word) return '';
  const lower = word.toLowerCase();

  const plurals = {
    'case': 'Cases',
    'keg': 'Kegs',
    'bottle': 'Bottles',
    'bag': 'Bags',
    'box': 'Boxes',
    'pack': 'Packs',
    'tub': 'Tubs',
    'dozen': 'Dozens',
    'punnet': 'Punnets',
    'gallon': 'Gallons',
  };

  return plurals[lower] || (word.charAt(0).toUpperCase() + word.slice(1) + 's');
}

/**
 * Format a stock item's wholeUnit into a human-readable description.
 *
 * Examples:
 *   "Keg 1*50ltr"   → "50 Litre Keg"
 *   "Keg 1*9gall"   → "9 Gallon Keg"
 *   "Bottle 1*70cl"  → "70cl Bottle"
 *   "Case 1*24Each"  → "Case of 24"
 *   "Case 4*2.5kg"   → "Case (4 × 2.5kg)"
 *   "Pack 6*4Each"   → "Pack (6 × 4)"
 *   "Dozen"          → "Dozen"
 *   "6Each"          → "Pack of 6"
 *   "10kg"           → "10kg"
 *   "5ltr"           → "5 Litres"
 *   "Each"           → "Each"
 *   "70cl"           → "70cl"
 *   "Litre"          → "Litre"
 *
 * @param {Object} item - Stock item with wholeUnit field
 * @returns {string} Human-readable description
 */
export function formatItemDescription(item) {
  const whole = (item.wholeUnit || item.unit || '').trim();
  if (!whole) return '';

  // Compound units: "Keg 1*50ltr", "Case 1*24Each", "Case 4*2.5kg", "Pack 6*4Each"
  const compoundMatch = whole.match(/^(\w+)\s+(\d+(?:\.\d+)?)\*(\d+(?:\.\d+)?)(.*)$/);
  if (compoundMatch) {
    const [, container, countStr, qtyStr, unitSuffix] = compoundMatch;
    const count = parseFloat(countStr);
    const qty = parseFloat(qtyStr);
    const suffix = unitSuffix.trim().toLowerCase();

    if (count === 1) {
      // "Keg 1*50ltr" → "50 Litre Keg", "Case 1*24Each" → "Case of 24"
      if (suffix === 'each') return `${container} of ${qty}`;
      const readableUnit = descriptionUnit(qty, suffix);
      return `${readableUnit} ${container}`;
    } else {
      // "Case 4*2.5kg" → "Case (4 × 2.5kg)", "Pack 6*4Each" → "Pack (6 × 4)"
      if (suffix === 'each') return `${container} (${count} × ${qty})`;
      return `${container} (${count} × ${qtyStr}${unitSuffix.trim()})`;
    }
  }

  // Compound with text qty: "Case 12*Litre"
  const compoundTextMatch = whole.match(/^(\w+)\s+(\d+(?:\.\d+)?)\*(\w+)$/);
  if (compoundTextMatch) {
    const [, container, countStr, unitName] = compoundTextMatch;
    const count = parseFloat(countStr);
    if (unitName.toLowerCase() === 'each') return `${container} of ${count}`;
    return `${container} (${count} × ${unitName})`;
  }

  // "Dozen"
  if (whole.toLowerCase() === 'dozen') return 'Dozen';

  // "Gallon" (shouldn't appear after normalisation, but handle as fallback)
  if (whole.toLowerCase() === 'gallon') return 'Gallon';

  // Numeric prefix: "6Each", "10kg", "5ltr", "500g", "70cl", "75cl"
  const numericMatch = whole.match(/^(\d+(?:\.\d+)?)([\w]+)$/);
  if (numericMatch) {
    const [, numStr, unitName] = numericMatch;
    const num = parseFloat(numStr);
    const lower = unitName.toLowerCase();

    if (lower === 'each') return `Pack of ${num}`;
    if (lower === 'ltr') return `${num} Litre${num !== 1 ? 's' : ''}`;
    if (lower === 'kg') return `${numStr}kg`;
    if (lower === 'g') return `${numStr}g`;
    if (lower === 'cl') return `${numStr}cl`;
    if (lower === 'ml') return `${numStr}ml`;
    return `${numStr}${unitName}`;
  }

  // Simple units: "Litre", "Each", "Kilogram"
  const simpleMap = {
    'litre': 'Litre',
    'each': 'Each',
    'kilogram': 'Kilogram',
    'pint': 'Pint',
  };
  if (simpleMap[whole.toLowerCase()]) return simpleMap[whole.toLowerCase()];

  // Fallback: capitalise
  return whole.charAt(0).toUpperCase() + whole.slice(1);
}

/**
 * Format a unit with quantity for description display.
 * E.g. (50, "ltr") → "50 Litre", (9, "gall") → "9 Gallon"
 */
function descriptionUnit(qty, suffix) {
  const unitMap = {
    'ltr': 'Litre',
    'gall': 'Gallon',
    'kg': 'kg',
    'g': 'g',
    'cl': 'cl',
    'ml': 'ml',
  };
  const readable = unitMap[suffix];
  if (readable) return `${qty} ${readable}`;
  return `${qty}${suffix}`;
}

/**
 * Format a saved count for display.
 * Handles both new format (wholeCount/partCount/wholeLabel/partLabel)
 * and old format (cases/bottles) for backward compatibility.
 *
 * @param {Object} count - Saved count data
 * @returns {Object} { short, detail }
 */
export function formatCountDisplay(count) {
  if (!count) return { short: '', detail: '' };

  const base = formatCountDisplayBase(count);

  // Prefix whole cases (the orthogonal "case of N" dimension) when present.
  const caseVal = count.caseCount ?? 0;
  if (caseVal > 0) {
    const label = count.caseLabel || 'Cases';
    const caseLabel = caseVal === 1 && label === 'Cases' ? 'Case' : label;
    const zero = base.detail === '0' || base.detail === '';
    return {
      short: zero ? `${caseVal}cs` : `${caseVal}cs + ${base.short}`,
      detail: zero ? `${caseVal} ${caseLabel}` : `${caseVal} ${caseLabel} + ${base.detail}`,
    };
  }
  return base;
}

function formatCountDisplayBase(count) {
  // New format
  const wholeVal = count.wholeCount ?? count.cases ?? 0;
  let partVal = count.partCount ?? count.bottles ?? 0;
  const wholeLabel = count.wholeLabel || 'cases';
  const partLabel = count.partLabel || 'bottles';

  // Tenths should always display as integers
  if (partLabel.toLowerCase() === 'tenths') partVal = Math.round(partVal);

  // Abbreviations for short display
  const shortWhole = abbreviateLabel(wholeLabel);
  const shortPart = abbreviateLabel(partLabel);

  if (wholeVal > 0 && partVal > 0) {
    return {
      short: `${wholeVal}${shortWhole} + ${partVal}${shortPart}`,
      detail: `${wholeVal} ${wholeLabel} + ${partVal} ${partLabel}`
    };
  } else if (wholeVal > 0) {
    return {
      short: `${wholeVal} ${wholeLabel.toLowerCase()}`,
      detail: `${wholeVal} ${wholeLabel}`
    };
  } else if (partVal > 0) {
    return {
      short: `${partVal} ${partLabel.toLowerCase()}`,
      detail: `${partVal} ${partLabel}`
    };
  }

  return { short: '0', detail: '0' };
}

/**
 * Format a count for summary display with tenths conversion.
 * Shows whole + tenths as primary, with total in original unit in brackets.
 *
 * @param {Object} count - Saved count data (wholeCount, partCount, quantity, wholeLabel, partLabel)
 * @param {Object} unitInfo - From parseUnitInfo(item) — needed for tenths conversion
 * @returns {string} e.g. "3 Kegs, 5 Tenths (175 Litres)" or "5 Bottles, 3 Tenths"
 */
export function formatCountSummary(count, unitInfo) {
  if (!count) return '0';

  // Prefix whole cases (the orthogonal "case of N" dimension) when present.
  const caseVal = count.caseCount ?? 0;
  const base = formatCountSummaryBase(count, unitInfo);
  if (caseVal > 0) {
    const label = count.caseLabel || 'Cases';
    const caseStr = `${caseVal} ${caseVal === 1 && label === 'Cases' ? 'Case' : label}`;
    return base === '0' ? caseStr : `${caseStr}, ${base}`;
  }
  return base;
}

function formatCountSummaryBase(count, unitInfo) {
  const wholeVal = count.wholeCount ?? count.cases ?? 0;
  let partVal = count.partCount ?? count.bottles ?? 0;
  const wholeLabel = count.wholeLabel || 'Cases';
  const partLabel = count.partLabel || '';
  const totalQty = count.quantity || 0;

  // No part unit — just show whole count
  if (!unitInfo?.hasPartUnit) {
    return wholeVal > 0 ? `${wholeVal} ${wholeLabel}` : '0';
  }

  // Items with hasTenthsOption (measurement-based: kegs/litres, gallons/pints)
  // Always display as whole + tenths, with total in the original measurement unit
  if (unitInfo.hasTenthsOption) {
    let tenthsVal;
    const originalUnit = unitInfo.partLabel; // e.g. "Litres", "Pints", "Gallons"

    if (partLabel === 'Tenths') {
      // User entered tenths directly
      tenthsVal = Math.round(partVal);
    } else {
      // User entered measurement directly — convert to tenths
      const perTenth = unitInfo.unitsPerWhole / 10;
      tenthsVal = perTenth > 0 ? Math.round(partVal / perTenth) : 0;
    }

    const bracketTotal = `(${totalQty} ${originalUnit})`;

    if (wholeVal > 0 && tenthsVal > 0) {
      return `${wholeVal} ${wholeLabel}, ${tenthsVal} Tenths ${bracketTotal}`;
    } else if (wholeVal > 0) {
      return `${wholeVal} ${wholeLabel} ${bracketTotal}`;
    } else if (tenthsVal > 0) {
      return `${tenthsVal} Tenths ${bracketTotal}`;
    }
    return `0 ${bracketTotal}`;
  }

  // Native tenths (spirits — partUnit is "Tenth", no hasTenthsOption)
  if (partLabel === 'Tenths') {
    const tv = Math.round(partVal);
    if (wholeVal > 0 && tv > 0) return `${wholeVal} ${wholeLabel}, ${tv} Tenths`;
    if (wholeVal > 0) return `${wholeVal} ${wholeLabel}`;
    if (tv > 0) return `${tv} Tenths`;
    return '0';
  }

  // Non-measurement parts (cases + loose, etc.)
  // Show total when wholes are present (e.g. "2 Cases, 5 Loose (53 total)")
  const totalSuffix = (totalQty > 0 && wholeVal > 0) ? ` (${totalQty} total)` : '';
  if (wholeVal > 0 && partVal > 0) {
    return `${wholeVal} ${wholeLabel}, ${partVal} ${partLabel}${totalSuffix}`;
  } else if (wholeVal > 0) {
    return `${wholeVal} ${wholeLabel}${totalSuffix}`;
  } else if (partVal > 0) {
    return `${partVal} ${partLabel}`;
  }
  return '0';
}

/**
 * Normalize a count record to an array of entries.
 * Handles both new multi-entry format (has `entries` array) and
 * old single-entry format (flat count object) for backward compatibility.
 *
 * @param {Object} count - Count data from session
 * @returns {Array} Array of entry objects
 */
export function getCountEntries(count) {
  if (!count) return [];
  if (count.entries && Array.isArray(count.entries)) return count.entries;
  // Old format: wrap as single entry
  return [{ ...count }];
}

/**
 * Get the aggregate quantity for a count record.
 *
 * @param {Object} count - Count data from session
 * @returns {number} Total quantity
 */
export function getCountTotal(count) {
  if (!count) return 0;
  return count.quantity || 0;
}

/**
 * Create a short abbreviation for a unit label
 */
function abbreviateLabel(label) {
  if (!label) return '';
  const lower = label.toLowerCase();

  const abbrevs = {
    'cases': 'c',
    'kegs': 'k',
    'bottles': 'b',
    'tenths': 't',
    'dozens': 'd',
    'gallons': 'gal',
    'pints': 'pt',
    'litres': 'L',
    'loose': '',
    'slices': 'sl',
    'kg': 'kg',
    'grams': 'g',
  };

  if (abbrevs[lower] !== undefined) return abbrevs[lower];

  // For "Packs (6)" etc, use first letter
  return lower.charAt(0);
}
