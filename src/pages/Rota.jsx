/**
 * Rota — admin-only weekly staff rota builder.
 *
 * A paper-style grid: staff down the first column, Mon–Sun across the top, one
 * shift per cell. Gated to owners/managers and scoped to the selected venue.
 * Each week is stored as its own doc at {venuePath}/rotas/{weekId}.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { subscribeToRota, saveRota } from '../services/apiService';
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

function Rota() {
  const { members, selectedPub, isAdmin, pubName } = useAuth();
  const { isDark } = useTheme();
  const colors = getThemeColors(isDark);

  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // { rowIndex, dayKey }

  const venuePath = selectedPub?.path;
  const weekId = useMemo(() => toISODate(weekStart), [weekStart]);

  // Subscribe to the active week's rota. Re-runs when the week or venue changes.
  useEffect(() => {
    if (!venuePath) return undefined;
    setLoading(true);
    const unsub = subscribeToRota(
      venuePath,
      weekId,
      (data) => { setRows(data?.rows || []); setLoading(false); },
      () => setLoading(false),
    );
    return () => unsub();
  }, [venuePath, weekId]);

  // Persist the current rows for this week (whole-doc write — low volume).
  const persist = (nextRows) => {
    setRows(nextRows);
    if (venuePath) saveRota(venuePath, weekId, { weekStart: weekId, rows: nextRows });
  };

  const days = useMemo(() => DAY_KEYS.map((key, i) => {
    const date = addDays(weekStart, i);
    return { key, label: DAY_LABELS[key], dateLabel: `${date.getDate()}/${date.getMonth() + 1}`, weekend: key === 'sat' || key === 'sun' };
  }), [weekStart]);

  const availableMembers = useMemo(() => {
    const used = new Set(rows.map((r) => r.memberId));
    const hasVenue = (m) => m.venueAccess === 'all' || (Array.isArray(m.venueAccess) && m.venueAccess.includes(selectedPub?.id));
    return (members || []).filter((m) => m.active !== false && hasVenue(m) && !used.has(m.id));
  }, [members, rows, selectedPub]);

  // Gate after hooks so hook order stays stable.
  if (!(isAdmin && isAdmin())) return <Navigate to="/" replace />;

  const addStaff = (memberId) => {
    const m = (members || []).find((x) => x.id === memberId);
    if (!m) return;
    persist([...rows, { memberId, name: m.displayName || m.email || 'Staff', shifts: {} }]);
  };
  const removeRow = (rowIndex) => persist(rows.filter((_, i) => i !== rowIndex));
  const setShift = (rowIndex, dayKey, shift) => {
    persist(rows.map((r, i) => (i === rowIndex ? { ...r, shifts: { ...r.shifts, [dayKey]: shift } } : r)));
    setEditing(null);
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

  const editRow = editing != null ? rows[editing.rowIndex] : null;

  return (
    <div style={{ maxWidth: '820px', margin: '0 auto' }}>
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
        <button type="button" style={{ ...navBtn, marginLeft: 'auto' }} onClick={() => window.print()}>Print</button>
      </div>

      <div style={card}>
        {loading ? (
          <div style={{ padding: '1.5rem', textAlign: 'center', color: colors.textSecondary }}>Loading rota…</div>
        ) : (
          <RotaGrid
            days={days}
            rows={rows}
            availableMembers={availableMembers}
            onCellClick={(rowIndex, dayKey) => setEditing({ rowIndex, dayKey })}
            onRemoveRow={removeRow}
            onAddStaff={addStaff}
          />
        )}
      </div>

      {editing != null && editRow && (
        <ShiftEditor
          staffName={editRow.name}
          dayLabel={(() => { const d = days.find((x) => x.key === editing.dayKey); return `${d.label} ${d.dateLabel}`; })()}
          value={editRow.shifts?.[editing.dayKey] || null}
          onSave={(shift) => setShift(editing.rowIndex, editing.dayKey, shift)}
          onClear={() => setShift(editing.rowIndex, editing.dayKey, null)}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}

export default Rota;
