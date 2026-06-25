/**
 * stockDedup — a stock item is a duplicate only when BOTH its name AND its
 * volume (wholeUnit + partUnit) match. "House Red 75cl" and "House Red 1.5L"
 * are allowed; two identical name+volume items are not.
 */

export const dupKey = (name, wholeUnit, partUnit) =>
  `${String(name || '').trim().toLowerCase().replace(/\s+/g, ' ')}|${wholeUnit || ''}|${partUnit || ''}`;

/** Does `items` already contain a non-archived item with this name + volume? */
export function isDuplicateItem(items, candidate) {
  const key = dupKey(candidate.name, candidate.wholeUnit, candidate.partUnit);
  return (items || []).some((i) => !i.archived && dupKey(i.name, i.wholeUnit, i.partUnit) === key);
}
