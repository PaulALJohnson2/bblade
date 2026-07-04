/**
 * Rota — admin-only weekly staff rota builder.
 *
 * A paper-style grid: staff down the first column, Mon–Sun across the top, one
 * shift per cell. Gated to owners/managers and scoped to the selected venue.
 * Each week is stored as its own doc at {venuePath}/rotas/{weekId}.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { subscribeToRota, saveRota, setRotaPublished, subscribeToShiftPatterns, bumpShiftPattern, subscribeToStaffOrder, saveStaffOrder } from '../services/apiService';
import { getThemeColors } from '../utils/theme';
import useTheme from '../hooks/useTheme';
import RotaGrid from '../components/RotaGrid';
import ShiftEditor from '../components/ShiftEditor';

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

// Compact 12-hour label for a preset pill (matches the grid): 17:00 → 5.
const fmtHour = (t) => { const [h, m] = t.split(':'); const hr = parseInt(h, 10) % 12 || 12; return m === '00' ? String(hr) : `${hr}:${m}`; };
const patternLabel = (s, e) => `${fmtHour(s)}–${fmtHour(e)}`;

// Seed patterns so the pills are useful before any usage has accumulated;
// learned patterns rank ahead of these once they start being used.
const DEFAULT_PATTERNS = [
  { start: '09:00', end: '17:00' },
  { start: '11:00', end: '15:00' },
  { start: '17:00', end: '23:00' },
  { start: '18:00', end: '00:00' },
];
const MAX_PRESETS = 6;

function Rota() {
  const { members, selectedPub, isAdmin, pubName, currentUser } = useAuth();
  const { isDark } = useTheme();
  const colors = getThemeColors(isDark);
  const admin = !!(isAdmin && isAdmin());

  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [savedRows, setSavedRows] = useState([]); // only members who have shifts
  const [published, setPublished] = useState(false);
  const [patternCounts, setPatternCounts] = useState({}); // 'HH:MM-HH:MM' → uses
  const [staffOrder, setStaffOrder] = useState([]); // custom memberId ordering
  const [loading, setLoading] = useState(true);
  const [sent, setSent] = useState(false); // transient "Sent ✓" feedback
  const [editing, setEditing] = useState(null); // { row, dayKey }
  // "Fit to screen": shrink the grid so the whole week fits with no sideways
  // scroll. Remembered across visits.
  const [compact, setCompact] = useState(() => {
    try { return localStorage.getItem('rotaCompact') === '1'; } catch { return false; }
  });
  const toggleCompact = () => setCompact((c) => {
    const next = !c;
    try { localStorage.setItem('rotaCompact', next ? '1' : '0'); } catch { /* ignore */ }
    return next;
  });

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

  // Quick-pick pills: learned patterns ranked by usage, then defaults to fill.
  const presets = useMemo(() => {
    const learned = Object.entries(patternCounts)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([key]) => { const [start, end] = key.split('-'); return { start, end }; });
    const seen = new Set();
    const out = [];
    for (const p of [...learned, ...DEFAULT_PATTERNS]) {
      const k = `${p.start}-${p.end}`;
      if (seen.has(k) || !p.start || !p.end) continue;
      seen.add(k);
      out.push({ start: p.start, end: p.end, label: patternLabel(p.start, p.end) });
      if (out.length >= MAX_PRESETS) break;
    }
    return out;
  }, [patternCounts]);

  const days = useMemo(() => DAY_KEYS.map((key, i) => {
    const date = addDays(weekStart, i);
    return { key, label: DAY_LABELS[key], dateLabel: `${date.getDate()}/${date.getMonth() + 1}` };
  }), [weekStart]);

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

  // Set/clear one shift; store only members who have at least one shift.
  const setShift = (row, dayKey, shift) => {
    const byId = new Map(savedRows.map((r) => [r.memberId, { ...r, shifts: { ...r.shifts } }]));
    const entry = byId.get(row.memberId) || { memberId: row.memberId, name: row.name, shifts: {} };
    entry.name = row.name;
    if (shift) entry.shifts[dayKey] = shift; else delete entry.shifts[dayKey];
    if (Object.keys(entry.shifts).length > 0) byId.set(row.memberId, entry);
    else byId.delete(row.memberId);
    const next = Array.from(byId.values());
    setSavedRows(next);
    if (venuePath) {
      saveRota(venuePath, weekId, { weekStart: weekId, rows: next });
      if (shift) bumpShiftPattern(venuePath, shift.start, shift.end); // learn the pattern
    }
    setEditing(null);
  };

  // Persist a new staff ordering (array of memberIds, in display order).
  const reorderStaff = (orderedIds) => {
    setStaffOrder(orderedIds);
    if (venuePath) saveStaffOrder(venuePath, orderedIds);
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
    padding: '0.5rem 0.8rem', fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer',
    borderRadius: '8px', border: `1px solid ${colors.border}`,
    backgroundColor: colors.bgCard, color: colors.textPrimary,
  };
  const card = {
    backgroundColor: colors.bgCard, border: `1px solid ${colors.borderLight}`,
    borderRadius: '12px', padding: '1.25rem', boxShadow: `0 2px 12px ${colors.shadow}`,
  };

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
      <h1 style={{ margin: '0.25rem 0 0.1rem', fontSize: '1.6rem', color: colors.textPrimary }}>Rota</h1>
      <p style={{ margin: '0 0 1.1rem', color: colors.textSecondary, fontSize: '0.9rem' }}>
        {pubName ? `${pubName} — weekly staff rota` : 'Weekly staff rota'}
      </p>

      {/* Week navigation */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <button type="button" style={navBtn} onClick={() => setWeekStart(addDays(weekStart, -7))}>‹ Prev</button>
        <div style={{ fontWeight: 700, fontSize: '1rem', color: colors.textPrimary, minWidth: '190px', textAlign: 'center' }}>{rangeLabel}</div>
        <button type="button" style={navBtn} onClick={() => setWeekStart(addDays(weekStart, 7))}>Next ›</button>
        <button type="button" style={{ ...navBtn, color: colors.primary }} onClick={() => setWeekStart(mondayOf(new Date()))}>This week</button>
        <button
          type="button"
          style={{ ...navBtn, marginLeft: 'auto', ...(compact ? { backgroundColor: colors.primary, color: colors.onPrimary, border: 'none' } : {}) }}
          onClick={toggleCompact}
          aria-pressed={compact}
          title={compact ? 'Show the full-size rota' : 'Shrink the rota so the whole week fits on screen'}
        >
          {compact ? 'Full size' : 'Fit to screen'}
        </button>
        <button type="button" style={navBtn} onClick={() => window.print()}>Print</button>
        {admin && (
          <button
            type="button"
            style={{ ...navBtn, backgroundColor: colors.primary, color: colors.onPrimary, border: 'none', fontWeight: 700 }}
            onClick={sendToStaff}
          >
            {sent ? 'Sent ✓' : published ? 'Re-send to staff' : 'Send to staff'}
          </button>
        )}
      </div>

      {admin && published && !sent && (
        <div style={{ margin: '-0.4rem 0 1rem', fontSize: '0.82rem', color: colors.textSecondary }}>
          Published — staff can see this week. Any edits are visible to them immediately.
        </div>
      )}

      <div style={card}>
        {loading ? (
          <div style={{ padding: '1.5rem', textAlign: 'center', color: colors.textSecondary }}>Loading rota…</div>
        ) : (!admin && !published) ? (
          <div style={{ padding: '1.75rem', textAlign: 'center', color: colors.textSecondary, fontSize: '0.95rem' }}>
            This week's rota hasn't been published yet.
          </div>
        ) : (
          <RotaGrid
            days={days}
            rows={rows}
            readOnly={!admin}
            compact={compact}
            highlightMemberId={myMemberId}
            onCellClick={(row, dayKey) => setEditing({ row, dayKey })}
            onReorder={reorderStaff}
          />
        )}
      </div>

      {admin && editing && (
        <ShiftEditor
          staffName={editing.row.name}
          dayLabel={(() => { const d = days.find((x) => x.key === editing.dayKey); return `${d.label} ${d.dateLabel}`; })()}
          presets={presets}
          value={editing.row.shifts?.[editing.dayKey] || null}
          onSave={(shift) => setShift(editing.row, editing.dayKey, shift)}
          onClear={() => setShift(editing.row, editing.dayKey, null)}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}

export default Rota;
