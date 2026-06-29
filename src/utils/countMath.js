/**
 * countMath — convert a whole + tenths/part entry into a saved stock count,
 * using the item's parsed unit info. Mirrors the count-page logic exactly so a
 * count captured while building the list matches one captured in a stock take.
 */

/**
 * @param unitInfo - from parseUnitInfo(item)
 * @param {object} entry - { cases, whole, tenths, part } raw string/number inputs
 * @returns { empty, caseCount, wholeCount, partCount, partLabel, quantity }
 */
export function computeCount(unitInfo, { cases, whole, tenths, part } = {}) {
  const caseVal = parseFloat(cases) || 0;
  const wholeVal = parseFloat(whole) || 0;
  let tenthsVal = parseFloat(tenths) || 0;
  // ".3" or "0.3" means 3 tenths, not 0.3 tenths
  if (tenthsVal > 0 && tenthsVal < 1) tenthsVal = Math.round(tenthsVal * 10);
  const partVal = parseFloat(part) || 0;
  const usedTenths = unitInfo.hasTenthsOption && tenthsVal > 0;

  const partContribution = usedTenths ? tenthsVal * (unitInfo.unitsPerWhole / 10) : partVal;
  const partCount = usedTenths ? tenthsVal : partVal;
  const partLabel = usedTenths ? 'Tenths' : unitInfo.partLabel;
  // A case holds `casePack` whole units; fold it into the whole-unit total.
  const casePack = unitInfo.casePack || 0;
  const wholeUnits = caseVal * casePack + wholeVal;
  const quantity = Math.round(((wholeUnits * unitInfo.unitsPerWhole) + partContribution) * 100) / 100;

  return {
    empty: caseVal === 0 && wholeVal === 0 && partVal === 0 && tenthsVal === 0,
    caseCount: caseVal,
    wholeCount: wholeVal,
    partCount,
    partLabel,
    quantity,
  };
}
