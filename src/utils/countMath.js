/**
 * countMath — convert a whole + tenths/part entry into a saved stock count,
 * using the item's parsed unit info. Mirrors the count-page logic exactly so a
 * count captured while building the list matches one captured in a stock take.
 */

/**
 * @param unitInfo - from parseUnitInfo(item)
 * @param {object} entry - { whole, tenths, part } raw string/number inputs
 * @returns { empty, wholeCount, partCount, partLabel, quantity }
 */
export function computeCount(unitInfo, { whole, tenths, part } = {}) {
  const wholeVal = parseFloat(whole) || 0;
  let tenthsVal = parseFloat(tenths) || 0;
  // ".3" or "0.3" means 3 tenths, not 0.3 tenths
  if (tenthsVal > 0 && tenthsVal < 1) tenthsVal = Math.round(tenthsVal * 10);
  const partVal = parseFloat(part) || 0;
  const usedTenths = unitInfo.hasTenthsOption && tenthsVal > 0;

  const partContribution = usedTenths ? tenthsVal * (unitInfo.unitsPerWhole / 10) : partVal;
  const partCount = usedTenths ? tenthsVal : partVal;
  const partLabel = usedTenths ? 'Tenths' : unitInfo.partLabel;
  const quantity = Math.round(((wholeVal * unitInfo.unitsPerWhole) + partContribution) * 100) / 100;

  return {
    empty: wholeVal === 0 && partVal === 0 && tenthsVal === 0,
    wholeCount: wholeVal,
    partCount,
    partLabel,
    quantity,
  };
}
