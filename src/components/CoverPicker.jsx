/**
 * CoverPicker — "who can cover this shift?" A centred modal the manager gets
 * right after marking someone sick (or from the sick day's editor). Lists
 * everyone on the rota with their status that day and their planned hours this
 * week; free people with the fewest hours float to the top. One tap assigns
 * the sick person's shift(s) to them — on top of anything they already work
 * that day, so covering while already on simply becomes a split shift.
 */

import React, { useState } from 'react';
import { getThemeColors } from '../utils/theme';
import { shiftRangeLabel, fmtHours } from '../utils/rota';
import { applyCoverToRota } from '../services/apiService';
import useTheme from '../hooks/useTheme';

function CoverPicker({ staffName, dayLabel, weekId, dayKey, shifts, candidates, timeFormat, venuePath, onDone, onClose }) {
  const { isDark } = useTheme();
  const colors = getThemeColors(isDark);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');

  // Free first (fewest planned hours first — spreads the load and keeps the
  // wage bill flatter), then people already working (a split is allowed, the
  // manager knows best), then leave/sick who genuinely can't.
  const rank = { free: 0, working: 1, leave: 2, sick: 2 };
  const sorted = [...candidates].sort((a, b) => (
    rank[a.status] - rank[b.status] || a.weekMinutes - b.weekMinutes || a.name.localeCompare(b.name)
  ));

  const assign = async (c) => {
    if (busyId) return;
    setError('');
    setBusyId(c.memberId);
    const res = await applyCoverToRota(venuePath, { weekId, memberId: c.memberId, name: c.name, dayKey, shifts });
    setBusyId(null);
    if (res.success) onDone(c);
    else setError(res.error || 'Could not assign cover.');
  };

  // Overlay/modal match ShiftEditor so the two read as one editing surface.
  const overlay = {
    position: 'fixed', inset: 0, zIndex: 7000,
    backgroundColor: 'rgba(0,0,0,0.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
  };
  const modal = {
    width: '100%', maxWidth: '360px', maxHeight: '90vh', overflowY: 'auto',
    backgroundColor: colors.bgCard, color: colors.textPrimary,
    border: `1px solid ${colors.borderLight}`, borderRadius: '14px',
    boxShadow: colors.shadowMd, padding: '1.25rem',
  };
  const chip = (color) => ({
    fontSize: '0.68rem', fontWeight: 800, letterSpacing: '0.03em', color,
    border: `1px solid ${color}`, borderRadius: '9999px', padding: '0.05rem 0.45rem',
    whiteSpace: 'nowrap', flexShrink: 0,
  });

  const times = shifts.map((s) => shiftRangeLabel(s, timeFormat)).join(' & ');

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>Cover for {staffName}</div>
        <div style={{ color: colors.textSecondary, fontSize: '0.85rem', marginBottom: '0.9rem' }}>
          {dayLabel} · {times}
        </div>

        {error && (
          <div style={{ marginBottom: '0.75rem', padding: '0.5rem 0.75rem', borderRadius: '8px', backgroundColor: colors.bgLight, color: colors.error, fontSize: '0.85rem', fontWeight: 600 }}>
            {error}
          </div>
        )}

        {sorted.length === 0 && (
          <div style={{ color: colors.textSecondary, fontSize: '0.9rem', padding: '0.5rem 0' }}>
            No one else is on the rota for this venue.
          </div>
        )}

        {sorted.map((c) => {
          const off = c.status === 'leave' || c.status === 'sick';
          const busy = busyId === c.memberId;
          return (
            <button
              key={c.memberId}
              type="button"
              disabled={off || !!busyId}
              onClick={() => assign(c)}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%',
                padding: '0.6rem 0.65rem', marginBottom: '0.4rem', textAlign: 'left',
                background: 'none', border: `1px solid ${colors.border}`, borderRadius: '10px',
                color: colors.textPrimary, cursor: off ? 'default' : (busyId ? 'progress' : 'pointer'),
                opacity: off ? 0.45 : (busyId && !busy ? 0.6 : 1),
              }}
            >
              <span style={{ fontWeight: 700, fontSize: '0.92rem', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {busy ? 'Assigning…' : c.name}
              </span>
              {c.status === 'free' && <span style={chip(colors.success)}>FREE</span>}
              {c.status === 'working' && (
                <span style={{ fontSize: '0.75rem', color: colors.textSecondary, whiteSpace: 'nowrap', flexShrink: 0 }}>
                  on {c.dayShifts.map((s) => shiftRangeLabel(s, timeFormat)).join(' & ')}
                </span>
              )}
              {c.status === 'leave' && <span style={chip(colors.warning)}>A/L</span>}
              {c.status === 'sick' && <span style={chip(colors.error)}>SICK</span>}
              <span style={{ fontSize: '0.75rem', color: colors.textMuted, whiteSpace: 'nowrap', flexShrink: 0, minWidth: '2.6rem', textAlign: 'right' }}>
                {fmtHours(c.weekMinutes) || '0'}h wk
              </span>
            </button>
          );
        })}

        <div style={{ display: 'flex', marginTop: '0.6rem' }}>
          <button
            type="button"
            onClick={onClose}
            style={{ marginLeft: 'auto', padding: '0.7rem 1rem', fontSize: '0.95rem', fontWeight: 700, borderRadius: '8px', cursor: 'pointer', backgroundColor: 'transparent', color: colors.textSecondary, border: `1px solid ${colors.border}` }}
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}

export default CoverPicker;
