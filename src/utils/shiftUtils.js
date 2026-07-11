/**
 * shiftUtils — shared punch-clock helpers (ported from the standalone Punch app).
 *
 * A member's department decides their station: bar → bar, kitchen → kitchen,
 * both → they choose at clock-in. While a backdated punch awaits approval the
 * shift is treated as starting at the ACTUAL punch time; approval switches it
 * to the requested time (refusal reverts the stored times — see apiService).
 */

export const toMs = (v) => (v == null ? v : (typeof v.toMillis === 'function' ? v.toMillis() : v));

export const effectiveClockIn = (shift) => {
  if (!shift) return null;
  const clockIn = toMs(shift.clockIn);
  const actual = toMs(shift.clockInActual);
  const backdated = actual && actual !== clockIn;
  if (backdated && shift.approvalStatus !== 'approved') return actual;
  return clockIn;
};

export const activeShiftFor = (shifts, memberId) =>
  (shifts || []).find((s) => s.memberId === memberId && !s.clockOut) || null;

export const stationForDepartment = (department) => {
  if (department === 'kitchen') return 'kitchen';
  if (department === 'both') return null; // they choose
  return 'bar';
};

export const stationLabel = (station) => (station === 'kitchen' ? 'Kitchen' : 'Bar');

export const formatClock = (ms) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export const formatDuration = (fromMs, toMs2 = Date.now()) => {
  const total = Math.max(0, Math.floor((toMs2 - fromMs) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return h === 0 ? `${m}m` : `${h}h ${m}m`;
};

export const formatDayShort = (ms) =>
  new Date(ms).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

// ---- Punch's time-picker mechanics: 15-minute floors, "Xm ago" labels ----

export const FIFTEEN_MIN = 15 * 60 * 1000;
export const EARLIER_CAP_HRS = 6; // how far back a clock-in can be backdated

export const floor15 = (ms) => Math.floor(ms / FIFTEEN_MIN) * FIFTEEN_MIN;

export const agoLabel = (ms) => {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h ago` : `${h}h ${m}m ago`;
};

/**
 * Earlier-time options, newest first: 15-minute marks from just before now
 * back to `minMs` (skipping a mark within a minute of now so "Now" isn't
 * duplicated). Used for both backdated clock-ins (min = now − 6h) and
 * earlier clock-outs (min = the shift's start).
 */
export const earlierOptions = (minMs, now = Date.now()) => {
  const out = [];
  let t = floor15(now);
  if (now - t < 60_000) t -= FIFTEEN_MIN;
  while (t >= minMs) {
    out.push(t);
    t -= FIFTEEN_MIN;
  }
  return out;
};
