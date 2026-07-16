/**
 * Rota shift helpers.
 *
 * A day's shifts are stored as an array of { start, end } objects so a person
 * can work more than one shift in a day (a split shift). Older rotas stored a
 * single { start, end } object per day; `dayShifts` normalises both shapes to
 * an array so old and new data render the same.
 *
 * Everything here is pure (no imports, no Firebase) so the shift-request apply
 * and validation logic can be exercised directly under node.
 */

export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

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

/** True if a day holds no real shifts and no leave/sick marker — genuinely off. */
export function isFreeDay(value) {
  return dayShifts(value).length === 0 && !isLeaveDay(value) && !isSickDay(value);
}

// ---------------------------------------------------------------------------
// Time / label helpers (shared by the grid, the cover picker and the boards).
// ---------------------------------------------------------------------------

// Compact shift-time label. 12-hour (default): 17:00 → 5, 09:30 → 9:30, and
// 12/0 map to 12 (noon/midnight). 24-hour is always the full HH:MM on both
// ends (e.g. 07:00, 09:30, 23:45) so every value is the same width — the grid
// reads as a tidy aligned table instead of a ragged mix of 07–15 and 16–23:45.
// 12-hour stays compact (drops a whole hour's ":00": 17:00 → 5).
export function fmtTime(t, format = '12h') {
  if (t === 'close') return 'close';
  const [h, m] = t.split(':');
  if (format === '24h') return `${h}:${m}`;
  const hour = parseInt(h, 10) % 12 || 12;
  return m === '00' ? String(hour) : `${hour}:${m}`;
}

/** One shift's range label, e.g. "5–11" (12h) or "17:00–23:00" (24h). */
export function shiftRangeLabel(shift, format = '12h') {
  return `${fmtTime(shift.start, format)}–${fmtTime(shift.end, format)}`;
}

// Length of a shift in minutes; midnight end counts as end-of-day and an end
// at/before the start is treated as running overnight. A "close" (open-ended)
// shift has no planned length — its real hours come from the clock-out — so it
// contributes nothing to the planned total.
export function shiftMinutes(shift) {
  if (!shift || shift.end === 'close') return 0;
  const [sh, sm] = shift.start.split(':').map(Number);
  const [eh, em] = shift.end.split(':').map(Number);
  const s = sh * 60 + sm;
  let e = shift.end === '00:00' ? 1440 : eh * 60 + em;
  if (e <= s) e += 1440;
  return e - s;
}

// Total minutes worked in a day across all of its shifts (handles split days).
// A sick day keeps its shifts so the grid can show what needs covering, but
// nobody is working them — so they contribute nothing to the planned total.
export function dayMinutes(value) {
  if (isSickDay(value)) return 0;
  return dayShifts(value).reduce((sum, s) => sum + shiftMinutes(s), 0);
}

// Minutes → decimal hours, e.g. 330→"5.5", 435→"7.25", 765→"12.75", 480→"12"
// (shifts are 15-min steps, so hours land on exact .25 increments). Blank for zero.
export function fmtHours(min) {
  if (!min) return '';
  return String(Number((min / 60).toFixed(2)));
}

/**
 * Local ISO date ('YYYY-MM-DD') of a day within a rota week. weekId is the
 * Monday's ISO date; noon-anchored so DST weeks never skip or double a date.
 */
export function requestDayISO(weekId, dayKey) {
  const d = new Date(`${weekId}T12:00:00`);
  d.setDate(d.getDate() + DAY_KEYS.indexOf(dayKey));
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ---------------------------------------------------------------------------
// Shift requests (giveaways & swaps) — pure apply/validate logic.
//
// A request carries a SNAPSHOT of the day(s) as they were when it was made:
//   { kind: 'giveaway'|'swap', weekId,
//     from:   { memberId, name, dayKey, shifts: [{start,end},...] },
//     target: { memberId, name, dayKey, shifts } | null,   // swap only
//     claimedBy: { memberId, name } | null }               // giveaway only
//
// Approval re-validates the snapshot against the live week rows before
// applying: the rota may have changed between request and decision, and
// there are no transactions — this validate-then-apply is the backstop for
// every race (double claims, concurrent edits, duplicate requests).
// ---------------------------------------------------------------------------

// A shift's [start, end) in minutes for clash tests: 'close' runs to end of
// day, an end at/before the start runs overnight (same convention as
// shiftMinutes). Overnight spill into the NEXT day is ignored — same-day
// clashes are what matter, and the manager approves everything anyway.
function shiftRange(s) {
  const [sh, sm] = s.start.split(':').map(Number);
  const start = sh * 60 + sm;
  if (s.end === 'close') return [start, 1440];
  const [eh, em] = s.end.split(':').map(Number);
  let end = s.end === '00:00' ? 1440 : eh * 60 + em;
  if (end <= start) end += 1440;
  return [start, end];
}

/**
 * True if any shift in `a` overlaps in time with any shift in `b` (same day).
 * The swap/give-away rule is clash-based, not free-day-based: someone already
 * on the Thursday lunch CAN take your Thursday evening — it's just a split.
 */
export function shiftsOverlap(a, b) {
  const ra = dayShifts(a).map(shiftRange);
  const rb = dayShifts(b).map(shiftRange);
  return ra.some(([s1, e1]) => rb.some(([s2, e2]) => s1 < e2 && s2 < e1));
}

/** Real shifts sorted by start time — keeps merged split days reading in order. */
function sortedShifts(list) {
  return [...list].sort((x, y) => (x.start < y.start ? -1 : x.start > y.start ? 1 : 0));
}

/** Order-insensitive equality of two real-shift arrays (start+end pairs). */
export function shiftsEqual(a, b) {
  const norm = (list) => (list || [])
    .filter((s) => s && s.start && s.end)
    .map((s) => `${s.start}|${s.end}`)
    .sort();
  const na = norm(a);
  const nb = norm(b);
  return na.length === nb.length && na.every((v, i) => v === nb[i]);
}

// Deep-copy rows so applies never mutate their input (mirrors the Map pattern
// in Rota.jsx's setDayShifts). Returns [map, orderedIds].
function rowsToMap(rows) {
  const map = new Map();
  (rows || []).forEach((r) => map.set(r.memberId, { ...r, shifts: { ...(r.shifts || {}) } }));
  return map;
}

function rowFor(map, memberId, name) {
  let row = map.get(memberId);
  if (!row) {
    row = { memberId, name: name || '', shifts: {} };
    map.set(memberId, row);
  }
  return row;
}

// Rows are sparse: a member with no days left drops out entirely (matching
// setDayShifts), so empty rows never linger in the doc.
function mapToRows(map) {
  return Array.from(map.values()).filter((r) => Object.keys(r.shifts).length > 0);
}

/**
 * Check a request still matches the live rota. `rows` is the week the
 * requester's day lives in; `targetRows` is the week the counter-day lives in
 * (a swap can trade across weeks — "take my Friday, I'll do your Monday next
 * week"). For same-week swaps and give-aways the two are the same rows.
 * Returns { ok: true } or { ok: false, reason } ready for the queue UI.
 */
export function validateRequestAgainstRows(rows, req, targetRows = rows) {
  const byId = new Map((rows || []).map((r) => [r.memberId, r]));
  const targetById = new Map((targetRows || []).map((r) => [r.memberId, r]));
  const giverDay = byId.get(req.from.memberId)?.shifts?.[req.from.dayKey];

  if (isLeaveDay(giverDay) || isSickDay(giverDay)) {
    return { ok: false, reason: `${req.from.name}'s ${req.from.dayKey} is now marked off` };
  }
  if (!shiftsEqual(dayShifts(giverDay), req.from.shifts)) {
    return { ok: false, reason: `${req.from.name}'s shifts that day have changed` };
  }

  // Receiving a day doesn't need it empty — a split shift is fine. It only
  // needs the receiver not marked off (A/L/sick) and no time clash with what
  // they already work. The manager approving is the judgement call on whether
  // the resulting split is sensible.
  const canReceive = (value, incoming, name) => {
    if (isLeaveDay(value) || isSickDay(value)) {
      return { ok: false, reason: `${name} is now marked off that day` };
    }
    if (shiftsOverlap(value, incoming)) {
      return { ok: false, reason: `${name} now has a clashing shift that day` };
    }
    return { ok: true };
  };

  if (req.kind === 'giveaway') {
    if (!req.claimedBy) return { ok: false, reason: 'No one has taken this shift yet' };
    const claimantDay = byId.get(req.claimedBy.memberId)?.shifts?.[req.from.dayKey];
    return canReceive(claimantDay, req.from.shifts, req.claimedBy.name);
  }

  // Swap: the target's day (in ITS week) must still match its snapshot, and
  // each side must be able to receive the day they're taking — the giver
  // receives in the target's week, the target receives in the giver's week.
  const targetDay = targetById.get(req.target.memberId)?.shifts?.[req.target.dayKey];
  if (isLeaveDay(targetDay) || isSickDay(targetDay)) {
    return { ok: false, reason: `${req.target.name}'s ${req.target.dayKey} is now marked off` };
  }
  if (!shiftsEqual(dayShifts(targetDay), req.target.shifts)) {
    return { ok: false, reason: `${req.target.name}'s shifts that day have changed` };
  }
  const giverReceives = canReceive(targetById.get(req.from.memberId)?.shifts?.[req.target.dayKey], req.target.shifts, req.from.name);
  if (!giverReceives.ok) return giverReceives;
  return canReceive(byId.get(req.target.memberId)?.shifts?.[req.from.dayKey], req.from.shifts, req.target.name);
}

// The one primitive every trade reduces to: within one week's rows, take a
// day off the giver and land its shifts on the receiver — ON TOP of anything
// non-clashing the receiver already works that day (a split). Returns NEW rows.
function moveDay(rows, giver, receiver, dayKey, shifts) {
  const map = rowsToMap(rows);
  const from = rowFor(map, giver.memberId, giver.name);
  delete from.shifts[dayKey];
  const to = rowFor(map, receiver.memberId, receiver.name);
  to.shifts[dayKey] = sortedShifts([...dayShifts(to.shifts[dayKey]), ...shifts]);
  return mapToRows(map);
}

/**
 * Apply an approved giveaway: the claimant gains the day's shifts ON TOP of
 * anything non-clashing they already work that day (a split), and the giver
 * loses the day. Returns NEW rows; callers must have validated first.
 */
export function applyGiveawayToRows(rows, req) {
  return moveDay(rows, req.from, req.claimedBy, req.from.dayKey, req.from.shifts);
}

/**
 * Apply an approved same-week swap: each member's traded day moves to the
 * other, landing on top of anything non-clashing already worked on the
 * receiving day (a split). Returns NEW rows; callers must have validated.
 */
export function applySwapToRows(rows, req) {
  const once = moveDay(rows, req.from, req.target, req.from.dayKey, req.from.shifts);
  return moveDay(once, req.target, req.from, req.target.dayKey, req.target.shifts);
}

/**
 * Apply an approved CROSS-WEEK swap: the giver's day moves to the target in
 * the giver's week, the target's day moves to the giver in the target's week.
 * Returns { fromRows, targetRows }; callers must have validated first (and
 * must write both week docs — this is the one trade that spans two).
 */
export function applySwapAcrossWeeks(fromRows, targetRows, req) {
  return {
    fromRows: moveDay(fromRows, req.from, req.target, req.from.dayKey, req.from.shifts),
    targetRows: moveDay(targetRows, req.target, req.from, req.target.dayKey, req.target.shifts),
  };
}

/**
 * Apply a cover assignment: the cover member gains `shifts` on dayKey ON TOP
 * of anything they already work that day (covering while already on = a split
 * shift). Callers must pre-check the day isn't leave/sick. Returns NEW rows.
 */
export function applyCoverToRows(rows, { memberId, name, dayKey, shifts }) {
  const map = rowsToMap(rows);
  const row = rowFor(map, memberId, name);
  row.shifts[dayKey] = [...dayShifts(row.shifts[dayKey]), ...shifts];
  return mapToRows(map);
}

/**
 * True if a request needs THIS member's action right now: a swap directed at
 * them awaiting their answer, or someone else's shift up for grabs. Days that
 * have already passed don't count. The staff board and the Home tile badge
 * both use this, so the badge number always matches what the board shows.
 */
export function isActionableForMember(req, memberId, todayISO) {
  if (!req || !memberId) return false;
  if (requestDayISO(req.weekId, req.from.dayKey) < todayISO) return false;
  if (req.kind === 'swap') {
    return req.status === 'pending_peer' && req.target?.memberId === memberId;
  }
  return req.status === 'open' && req.from.memberId !== memberId;
}
