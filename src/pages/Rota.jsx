/**
 * Rota — weekly staff rota. View-only for everyone (including owners) except
 * when opened from the Admin section (?edit=1), which unlocks editing and the
 * "Send to staff" publish control.
 *
 * A paper-style grid: staff down the first column, Mon–Sun across the top, one
 * shift per cell. Gated to owners/managers and scoped to the selected venue.
 * Each week is stored as its own doc at {venuePath}/rotas/{weekId}.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { subscribeToRota, saveRota, setRotaPublished, subscribeToShiftPatterns, bumpShiftPattern, subscribeToStaffOrder, saveStaffOrder, subscribeToRotaSettings, saveRotaSettings, subscribeToShiftRequests, createShiftRequest } from '../services/apiService';
import { getThemeColors } from '../utils/theme';
import { dayShifts, isLeaveDay, isSickDay, shiftsOverlap, dayMinutes, requestDayISO } from '../utils/rota';
import useTheme from '../hooks/useTheme';
import RotaGrid from '../components/RotaGrid';
import ShiftEditor from '../components/ShiftEditor';
import CoverPicker from '../components/CoverPicker';
import ShiftBoard from '../components/ShiftBoard';
import ShiftRequestSheet from '../components/ShiftRequestSheet';

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABELS = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

const pad = (n) => String(n).padStart(2, '0');
const toISODate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Monday (local midnight) of the week containing `d`. */
function mondayOf(d) {
  const x = new Date(d);
  const offset = (x.getDay() + 6) % 7; // 0=Sun..6=Sat → Mon=0..Sun=6
  x.setDate(x.getDate() - offset);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

// Compact preset-pill label (matches the grid): 12-hour 17:00 → 5, 24-hour
// 17:00 → 17; an open-ended finish reads "close".
const fmtHour = (t, format = '12h') => {
  if (t === 'close') return 'close';
  const [h, m] = t.split(':');
  if (format === '24h') return `${h}:${m}`; // full HH:MM, matching the grid
  const hr = parseInt(h, 10) % 12 || 12;
  return m === '00' ? String(hr) : `${hr}:${m}`;
};
const patternLabel = (s, e, format) => `${fmtHour(s, format)}–${fmtHour(e, format)}`;

// Seed patterns so the pills are useful before any usage has accumulated;
// learned patterns rank ahead of these once they start being used.
const DEFAULT_PATTERNS = [
  { start: '09:00', end: '17:00' },
  { start: '11:00', end: '15:00' },
  { start: '17:00', end: '23:00' },
  { start: '18:00', end: '00:00' },
  { start: '18:00', end: 'close' },
];
const MAX_PRESETS = 6;

function Rota() {
  const { members, selectedPub, isAdmin, pubName, currentUser, currentMember } = useAuth();
  const navigate = useNavigate();
  const { isDark } = useTheme();
  const colors = getThemeColors(isDark);
  const admin = !!(isAdmin && isAdmin());
  // The rota is only editable when opened from the Admin section (which links
  // with ?edit=1). Everywhere else — including the users-section "Rota" tile —
  // it's view-only for everyone, owners included.
  const [searchParams] = useSearchParams();
  const canEdit = admin && searchParams.get('edit') === '1';

  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [savedRows, setSavedRows] = useState([]); // only members who have shifts
  const [published, setPublished] = useState(false);
  const [patternCounts, setPatternCounts] = useState({}); // 'HH:MM-HH:MM' → uses
  const [staffOrder, setStaffOrder] = useState([]); // custom memberId ordering
  const [timeFormat, setTimeFormat] = useState('12h'); // venue display: '12h' | '24h'
  const [loading, setLoading] = useState(true);
  const [sent, setSent] = useState(false); // transient "Sent ✓" feedback
  const [editing, setEditing] = useState(null); // { row, dayKey }
  const [cover, setCover] = useState(null); // { row, dayKey, shifts } — "find cover" picker
  const [asking, setAsking] = useState(null); // { dayKey, shifts } — staff "can't work this?" sheet
  const [notice, setNotice] = useState(''); // transient staff-view feedback
  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth < 768 : false));
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // On phones the in-page rota uses the compact (fit-to-screen) layout so the
  // whole week fits with no sideways scroll; laptops show it full size.
  const compact = isMobile;

  const venuePath = selectedPub?.path;
  const weekId = useMemo(() => toISODate(weekStart), [weekStart]);

  // Subscribe to the active week's rota. Re-runs when the week or venue changes.
  useEffect(() => {
    if (!venuePath) return undefined;
    setLoading(true);
    setSent(false);
    const unsub = subscribeToRota(
      venuePath,
      weekId,
      (data) => { setSavedRows(data?.rows || []); setPublished(!!data?.published); setLoading(false); },
      () => setLoading(false),
    );
    return () => unsub();
  }, [venuePath, weekId]);

  // Subscribe to this venue's learned shift-pattern usage counts.
  useEffect(() => {
    if (!venuePath) return undefined;
    const unsub = subscribeToShiftPatterns(venuePath, setPatternCounts, () => {});
    return () => unsub();
  }, [venuePath]);

  // Subscribe to the custom staff ordering.
  useEffect(() => {
    if (!venuePath) return undefined;
    const unsub = subscribeToStaffOrder(venuePath, setStaffOrder, () => {});
    return () => unsub();
  }, [venuePath]);

  // Subscribe to the venue's rota display settings (12h/24h clock).
  useEffect(() => {
    if (!venuePath) return undefined;
    const unsub = subscribeToRotaSettings(venuePath, (s) => setTimeFormat(s?.timeFormat === '24h' ? '24h' : '12h'), () => {});
    return () => unsub();
  }, [venuePath]);

  // Staff view only: live shift give-aways & swaps for the whole venue (the
  // board under the grid). The admin edit view doesn't need it — managers act
  // on requests from the Admin → Requests queue instead.
  const [shiftRequests, setShiftRequests] = useState(null);
  useEffect(() => {
    if (!venuePath || canEdit) return undefined;
    const unsub = subscribeToShiftRequests(venuePath, setShiftRequests, () => {});
    return () => unsub();
  }, [venuePath, canEdit]);

  // Quick-pick pills: learned patterns ranked by usage, then defaults to fill.
  // A "close" pill is always kept one tap away — if the top ones are all
  // concrete-ended, the last slot is swapped for the most-used close pattern
  // (falling back to the seeded default, which DEFAULT_PATTERNS always has).
  const presets = useMemo(() => {
    const learned = Object.entries(patternCounts)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([key]) => { const [start, end] = key.split('-'); return { start, end }; });
    const seen = new Set();
    const all = [];
    for (const p of [...learned, ...DEFAULT_PATTERNS]) {
      const k = `${p.start}-${p.end}`;
      if (seen.has(k) || !p.start || !p.end) continue;
      seen.add(k);
      all.push({ start: p.start, end: p.end, label: patternLabel(p.start, p.end, timeFormat) });
    }
    const out = all.slice(0, MAX_PRESETS);
    // Keep a "close" pill visible. Append it as an extra rather than displacing
    // a slot, so a real learned pattern is never hidden behind it — the ranking
    // itself stays pure cumulative (fast to learn when a venue is new, stable
    // once plenty of shifts have accrued).
    if (!out.some((p) => p.end === 'close')) {
      const closePill = all.find((p) => p.end === 'close');
      if (closePill) out.push(closePill);
    }
    return out;
  }, [patternCounts, timeFormat]);

  const days = useMemo(() => DAY_KEYS.map((key, i) => {
    const date = addDays(weekStart, i);
    return { key, label: DAY_LABELS[key], dateLabel: `${date.getDate()}/${date.getMonth() + 1}` };
  }), [weekStart]);

  // On the current week, the grid scrolls today's column as far left as it can.
  const todayKey = useMemo(() => {
    const now = new Date();
    if (toISODate(mondayOf(now)) !== weekId) return null;
    return DAY_KEYS[(now.getDay() + 6) % 7];
  }, [weekId]);

  // Rota rows: active members with venue access that are flagged On rota
  // (default true), merged with saved shifts, in the custom drag order
  // (unordered members fall back to A–Z).
  const rows = useMemo(() => {
    const shiftsById = new Map(savedRows.map((r) => [r.memberId, r.shifts || {}]));
    const orderIndex = new Map(staffOrder.map((id, i) => [id, i]));
    const hasVenue = (m) => m.venueAccess === 'all' || (Array.isArray(m.venueAccess) && m.venueAccess.includes(selectedPub?.id));
    return (members || [])
      .filter((m) => m.active !== false && m.onRota !== false && hasVenue(m))
      .map((m) => ({ memberId: m.id, name: m.displayName || m.email || 'Staff', shifts: shiftsById.get(m.id) || {} }))
      .sort((a, b) => {
        const ai = orderIndex.has(a.memberId) ? orderIndex.get(a.memberId) : Infinity;
        const bi = orderIndex.has(b.memberId) ? orderIndex.get(b.memberId) : Infinity;
        return ai !== bi ? ai - bi : a.name.localeCompare(b.name);
      });
  }, [members, savedRows, selectedPub, staffOrder]);

  // The signed-in user's own member row (matched by email), for highlighting.
  const myMemberId = useMemo(() => {
    const email = (currentUser?.email || '').toLowerCase();
    return (members || []).find((m) => (m.email || '').toLowerCase() === email)?.id || null;
  }, [members, currentUser]);

  // Cover-picker candidates: everyone on the rota except the sick person, with
  // their status on that day and their planned hours this week. The picker
  // sorts free-and-fewest-hours first.
  const coverCandidates = useMemo(() => {
    if (!cover) return [];
    return rows
      .filter((r) => r.memberId !== cover.row.memberId)
      .map((r) => {
        const value = r.shifts?.[cover.dayKey];
        const working = dayShifts(value);
        const status = isSickDay(value) ? 'sick'
          : isLeaveDay(value) ? 'leave'
            : working.length ? 'working' : 'free';
        return {
          memberId: r.memberId,
          name: r.name,
          status,
          dayShifts: working,
          weekMinutes: DAY_KEYS.reduce((sum, k) => sum + dayMinutes(r.shifts?.[k]), 0),
        };
      });
  }, [cover, rows]);

  // ---- Staff "can't work this?" flow: tap your own shift on the grid. ----

  const flashNotice = (msg) => {
    setNotice(msg);
    setTimeout(() => setNotice(''), 3500);
  };

  const PENDING_STATUSES = ['open', 'claimed', 'pending_peer', 'accepted'];

  // Tap on one of my own worked days (the grid only wires this up for real
  // shifts on my row). Past days and days I've already asked about get a
  // gentle explanation instead of the sheet.
  const askAboutDay = (dayKey, shifts) => {
    if (requestDayISO(weekId, dayKey) < toISODate(new Date())) {
      flashNotice("That shift's already been — you can only offer up days still to come.");
      return;
    }
    const already = (shiftRequests || []).some((q) => PENDING_STATUSES.includes(q.status)
      && q.from.memberId === myMemberId && q.weekId === weekId && q.from.dayKey === dayKey);
    if (already) {
      flashNotice('You already have a request in for this day — see "Your requests" below.');
      return;
    }
    setAsking({ dayKey, shifts });
  };

  // Swap partners for the sheet. Eligibility is clash-based, not free-day
  // based — someone already on the Thursday lunch CAN take your Thursday
  // evening (it becomes a split), so a partner just needs: not marked off on
  // your day, no time clash with your shifts there; and their offered days
  // are ones they work where YOUR existing shifts don't clash either. Days
  // already tied up in another pending request are out on both sides.
  const colleaguesFor = (dayKey) => {
    const myRow = rows.find((r) => r.memberId === myMemberId);
    const givenShifts = dayShifts(myRow?.shifts?.[dayKey]);
    const today = toISODate(new Date());
    const pendingReqs = (shiftRequests || []).filter((q) => PENDING_STATUSES.includes(q.status));
    const markedOff = (value) => isSickDay(value) || isLeaveDay(value);
    return rows
      .filter((r) => r.memberId !== myMemberId
        && !markedOff(r.shifts?.[dayKey])
        && !shiftsOverlap(r.shifts?.[dayKey], givenShifts))
      .map((r) => ({
        memberId: r.memberId,
        name: r.name,
        days: DAY_KEYS
          .filter((k) => k !== dayKey
            && dayShifts(r.shifts?.[k]).length > 0
            && !markedOff(r.shifts?.[k])
            && !markedOff(myRow?.shifts?.[k])
            && !shiftsOverlap(myRow?.shifts?.[k], r.shifts?.[k])
            && requestDayISO(weekId, k) >= today
            && !pendingReqs.some((q) => q.weekId === weekId
              && ((q.from.memberId === r.memberId && q.from.dayKey === k)
                || (q.target?.memberId === r.memberId && q.target?.dayKey === k))))
          .map((k) => ({
            dayKey: k,
            dayLabel: (() => { const d = days.find((x) => x.key === k); return `${d.label} ${d.dateLabel}`; })(),
            shifts: dayShifts(r.shifts?.[k]),
          })),
      }));
  };

  const submitAsk = async (kind, target) => {
    const res = await createShiftRequest(venuePath, {
      kind,
      weekId,
      from: { memberId: myMemberId, name: currentMember?.displayName || '', dayKey: asking.dayKey, shifts: asking.shifts },
      target,
      byUid: currentUser?.uid || null,
    });
    if (res.success) {
      setAsking(null);
      flashNotice(kind === 'swap' ? 'Swap sent — waiting for their answer.' : 'Shift offered up — anyone free can take it.');
    }
    return res;
  };

  // Set a day's shifts (an array — one entry, or several for a split shift; an
  // empty array clears the day). Store only members who have at least one shift.
  const setDayShifts = (row, dayKey, shifts) => {
    // Annual leave replaces the day — it's booked in advance, so there's no
    // shift to keep. Sickness keeps the shifts it landed on (they still need
    // covering), so the marker is appended rather than swapped in.
    const arr = Array.isArray(shifts) ? shifts : [];
    const isLeave = arr.some((s) => s && s.type === 'leave');
    const isSick = arr.some((s) => s && s.type === 'sick');
    const real = arr.filter((s) => s && s.start && s.end);
    // Whether this save is the moment the day BECAME sick — the one time the
    // cover picker auto-opens (marking sick and finding cover are one motion
    // in real life: "Sarah's ill, who can do her 6–close?").
    const wasSick = isSickDay(savedRows.find((r) => r.memberId === row.memberId)?.shifts?.[dayKey]);
    let clean;
    if (isLeave) clean = [{ type: 'leave' }];
    else if (isSick) clean = [...real, { type: 'sick' }];
    else clean = real;
    const byId = new Map(savedRows.map((r) => [r.memberId, { ...r, shifts: { ...r.shifts } }]));
    const entry = byId.get(row.memberId) || { memberId: row.memberId, name: row.name, shifts: {} };
    entry.name = row.name;
    if (clean.length) entry.shifts[dayKey] = clean; else delete entry.shifts[dayKey];
    if (Object.keys(entry.shifts).length > 0) byId.set(row.memberId, entry);
    else byId.delete(row.memberId);
    const next = Array.from(byId.values());
    setSavedRows(next);
    if (venuePath) {
      saveRota(venuePath, weekId, { weekStart: weekId, rows: next });
      // Learn only real shift patterns — a marker isn't a pattern. Marking a
      // day sick doesn't re-learn its shift either: it was already learned when
      // the shift was first rota'd, and counting it again would rank a pattern
      // by how often people call in sick on it.
      if (!isLeave && !isSick) real.forEach((s) => bumpShiftPattern(venuePath, s.start, s.end));
    }
    setEditing(null);
    // A day that just went sick with a shift still attached → straight into
    // the cover picker. A sick day with no shift has nothing to cover.
    if (isSick && !wasSick && real.length) setCover({ row, dayKey, shifts: real });
  };

  // Persist a new staff ordering (array of memberIds, in display order).
  const reorderStaff = (orderedIds) => {
    setStaffOrder(orderedIds);
    if (venuePath) saveStaffOrder(venuePath, orderedIds);
  };

  // Flip the venue's clock display between 12h and 24h (admin only). Optimistic
  // — the subscription confirms it — and applies everywhere the rota is shown.
  const toggleTimeFormat = () => {
    const next = timeFormat === '24h' ? '12h' : '24h';
    setTimeFormat(next);
    if (venuePath) saveRotaSettings(venuePath, { timeFormat: next });
  };

  // Publish this week's rota so staff can see it.
  const sendToStaff = async () => {
    if (!venuePath) return;
    setPublished(true);
    setSent(true);
    setTimeout(() => setSent(false), 2500);
    await setRotaPublished(venuePath, weekId, true);
  };

  const weekEnd = addDays(weekStart, 6);
  const fmt = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const rangeLabel = `${fmt(weekStart)} – ${fmt(weekEnd)} ${weekEnd.getFullYear()}`;

  const navBtn = {
    padding: isMobile ? '0.45rem 0.6rem' : '0.5rem 0.8rem', fontSize: isMobile ? '0.85rem' : '0.9rem',
    fontWeight: 600, cursor: 'pointer',
    borderRadius: '8px', border: `1px solid ${colors.border}`,
    backgroundColor: colors.bgCard, color: colors.textPrimary,
  };
  const card = {
    backgroundColor: colors.bgCard, border: `1px solid ${colors.borderLight}`,
    borderRadius: '12px', padding: isMobile ? '0.55rem' : '1.25rem', boxShadow: `0 2px 12px ${colors.shadow}`,
  };

  // The grid is on screen in the admin edit view always, and elsewhere once the
  // week has been published (sent to staff).
  const showGrid = !loading && (canEdit || published);

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
      <h1 style={{ margin: '0.25rem 0 0.1rem', fontSize: '1.6rem', color: colors.textPrimary }}>Rota</h1>
      <p style={{ margin: '0 0 1.1rem', color: colors.textSecondary, fontSize: '0.9rem' }}>
        {pubName ? `${pubName} — weekly staff rota` : 'Weekly staff rota'}
      </p>

      {/* Week navigation */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <button type="button" style={navBtn} onClick={() => setWeekStart(addDays(weekStart, -7))}>‹ Prev</button>
        <div style={{ fontWeight: 700, fontSize: isMobile ? '0.9rem' : '1rem', color: colors.textPrimary, minWidth: isMobile ? '110px' : '190px', flex: isMobile ? 1 : 'none', textAlign: 'center' }}>{rangeLabel}</div>
        <button type="button" style={navBtn} onClick={() => setWeekStart(addDays(weekStart, 7))}>Next ›</button>
        <button type="button" style={{ ...navBtn, color: colors.primary }} onClick={() => setWeekStart(mondayOf(new Date()))}>This week</button>
        {/* Staff request annual leave straight from their rota (admins mark A/L
            directly on the grid in the edit view, so it's hidden there). */}
        {currentMember && !canEdit && (
          <button
            type="button"
            style={{ ...navBtn, marginLeft: 'auto', backgroundColor: colors.warning, color: '#fff', border: 'none', fontWeight: 700 }}
            onClick={() => navigate('/leave')}
            title="Request annual leave"
          >
            Request leave
          </button>
        )}
        {canEdit && (
          <button
            type="button"
            style={{ ...navBtn, marginLeft: 'auto' }}
            onClick={toggleTimeFormat}
            title="Switch the rota between 12-hour and 24-hour clock"
          >
            {timeFormat === '24h' ? '24h' : '12h'} clock
          </button>
        )}
        {canEdit && (
          <button
            type="button"
            style={{ ...navBtn, marginLeft: showGrid ? undefined : 'auto', backgroundColor: colors.primary, color: colors.onPrimary, border: 'none', fontWeight: 700 }}
            onClick={sendToStaff}
          >
            {sent ? 'Sent ✓' : published ? 'Re-send to staff' : 'Send to staff'}
          </button>
        )}
      </div>

      {canEdit && published && !sent && (
        <div style={{ margin: '-0.4rem 0 1rem', fontSize: '0.82rem', color: colors.textSecondary }}>
          Published — staff can see this week. Any edits are visible to them immediately.
        </div>
      )}

      <div style={card}>
        {loading ? (
          <div style={{ padding: '1.5rem', textAlign: 'center', color: colors.textSecondary }}>Loading rota…</div>
        ) : (!canEdit && !published) ? (
          <div style={{ padding: '1.75rem', textAlign: 'center', color: colors.textSecondary, fontSize: '0.95rem' }}>
            This week's rota hasn't been published yet.
          </div>
        ) : (
          <RotaGrid
            days={days}
            rows={rows}
            readOnly={!canEdit}
            compact={compact}
            focusDayKey={canEdit ? null : todayKey}
            highlightMemberId={myMemberId}
            timeFormat={timeFormat}
            onCellClick={(row, dayKey) => setEditing({ row, dayKey })}
            onMyDayClick={!canEdit && myMemberId ? askAboutDay : undefined}
            onReorder={reorderStaff}
          />
        )}
      </div>

      {/* Staff: how to start a request (tapping your own shift is the entry
          point, so it needs saying once), plus transient feedback for it. */}
      {!canEdit && myMemberId && showGrid && (
        <div style={{ margin: '0.5rem 0 0', fontSize: '0.82rem', color: colors.textSecondary }}>
          Can't make one of your shifts? Tap it to offer it up or swap it.
        </div>
      )}
      {!canEdit && notice && (
        <div style={{ margin: '0.6rem 0 0', padding: '0.5rem 0.75rem', borderRadius: '8px', backgroundColor: colors.bgCard, border: `1px solid ${colors.borderLight}`, color: colors.textPrimary, fontSize: '0.85rem', fontWeight: 600 }}>
          {notice}
        </div>
      )}

      {/* Staff shift board: swaps needing an answer, open shifts, and "can't
          work this?" cards. Mounted below the grid even when the visible week
          is unpublished — a swap for NEXT week must stay answerable from any
          week. */}
      {!canEdit && myMemberId && !loading && shiftRequests && (
        <ShiftBoard
          venuePath={venuePath}
          weekId={weekId}
          rows={rows}
          requests={shiftRequests}
          myMemberId={myMemberId}
          myName={currentMember?.displayName || ''}
          timeFormat={timeFormat}
          colors={colors}
        />
      )}

      {!canEdit && asking && (
        <ShiftRequestSheet
          dayLabel={(() => { const d = days.find((x) => x.key === asking.dayKey); return `${d.label} ${d.dateLabel}`; })()}
          shifts={asking.shifts}
          timeFormat={timeFormat}
          colleagues={colleaguesFor(asking.dayKey)}
          onSubmit={submitAsk}
          onClose={() => setAsking(null)}
        />
      )}

      {canEdit && editing && (
        <ShiftEditor
          staffName={editing.row.name}
          dayLabel={(() => { const d = days.find((x) => x.key === editing.dayKey); return `${d.label} ${d.dateLabel}`; })()}
          presets={presets}
          value={dayShifts(editing.row.shifts?.[editing.dayKey])}
          isLeave={isLeaveDay(editing.row.shifts?.[editing.dayKey])}
          isSick={isSickDay(editing.row.shifts?.[editing.dayKey])}
          onSave={(shifts) => setDayShifts(editing.row, editing.dayKey, shifts)}
          onCancel={() => setEditing(null)}
          onFindCover={(shifts) => { const e = editing; setEditing(null); setCover({ row: e.row, dayKey: e.dayKey, shifts }); }}
        />
      )}

      {canEdit && cover && (
        <CoverPicker
          staffName={cover.row.name}
          dayLabel={(() => { const d = days.find((x) => x.key === cover.dayKey); return `${d.label} ${d.dateLabel}`; })()}
          weekId={weekId}
          dayKey={cover.dayKey}
          shifts={cover.shifts}
          candidates={coverCandidates}
          timeFormat={timeFormat}
          venuePath={venuePath}
          onDone={() => setCover(null)}
          onClose={() => setCover(null)}
        />
      )}
    </div>
  );
}

export default Rota;
