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

// A day marked as annual leave is stored as [{ type: 'leave' }] instead of
// shifts — it shows "A/L" on the rota and counts as zero planned hours (the
// pay for it is handled outside the rota).
export const LEAVE_MARKER = [{ type: 'leave' }];

/** True if a day is marked as annual leave (A/L) rather than holding shifts. */
export function isLeaveDay(value) {
  if (!value) return false;
  const arr = Array.isArray(value) ? value : [value];
  return arr.some((s) => s && s.type === 'leave');
}
