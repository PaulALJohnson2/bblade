/**
 * Rota shift helpers.
 *
 * A day's shifts are stored as an array of { start, end } objects so a person
 * can work more than one shift in a day (a split shift). Older rotas stored a
 * single { start, end } object per day; `dayShifts` normalises both shapes to
 * an array so old and new data render the same.
 */

export function dayShifts(value) {
  if (!value) return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr.filter((s) => s && s.start && s.end);
}
