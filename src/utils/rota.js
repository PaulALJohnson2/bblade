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

// Sickness works the other way round to annual leave. Leave is booked in
// advance, so the day genuinely has no shift and the marker stands alone. A
// sick day is always a shift someone has already been rota'd to work, so the
// marker sits *alongside* the shift rather than replacing it:
//
//   [{ start: '18:00', end: 'close' }, { type: 'sick' }]
//
// Keeping the shift is the whole point — it's what tells the manager there's a
// 6–close needing cover, and it's the only record of the hours lost. The day
// array already tolerates this: `dayShifts` keeps entries with a start and end
// (so it returns the shift), while `isSickDay` looks for the marker.
export const SICK_MARKER = { type: 'sick' };

/** True if a day is marked as annual leave (A/L) rather than holding shifts. */
export function isLeaveDay(value) {
  if (!value) return false;
  const arr = Array.isArray(value) ? value : [value];
  return arr.some((s) => s && s.type === 'leave');
}

/** True if a day is marked as sickness. Its shifts (if any) are still in `value`. */
export function isSickDay(value) {
  if (!value) return false;
  const arr = Array.isArray(value) ? value : [value];
  return arr.some((s) => s && s.type === 'sick');
}
