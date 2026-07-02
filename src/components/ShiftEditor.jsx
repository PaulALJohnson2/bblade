/**
 * ShiftEditor — a small centred modal for setting one shift's start/end time.
 *
 * Opened when a rota day cell is tapped. Offers quick presets plus two
 * 15-minute time dropdowns. Calls onSave({start,end}) to set the shift,
 * onClear() to remove it, or onCancel() to dismiss without changes.
 */

import React, { useState } from 'react';
import { getThemeColors } from '../utils/theme';
import useTheme from '../hooks/useTheme';

// 15-minute time options across the full day, 'HH:MM'.
const TIME_OPTIONS = (() => {
  const out = [];
  for (let h = 0; h < 24; h += 1) {
    for (let m = 0; m < 60; m += 15) {
      out.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  return out;
})();

// Fallback presets if none are supplied (usage-ranked ones come from the page).
const DEFAULT_PRESETS = [
  { label: '9–5', start: '09:00', end: '17:00' },
  { label: '11–3', start: '11:00', end: '15:00' },
  { label: '5–11', start: '17:00', end: '23:00' },
  { label: '6–12', start: '18:00', end: '00:00' },
];

function ShiftEditor({ staffName, dayLabel, presets, value, onSave, onClear, onCancel }) {
  const { isDark } = useTheme();
  const colors = getThemeColors(isDark);

  const [start, setStart] = useState(value?.start || '09:00');
  const [end, setEnd] = useState(value?.end || '17:00');

  // End "00:00" reads as midnight (end of day), so only flag a genuine reversal.
  const invalid = end !== '00:00' && end <= start;

  const overlay = {
    position: 'fixed', inset: 0, zIndex: 1000,
    backgroundColor: 'rgba(0,0,0,0.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
  };
  const modal = {
    width: '100%', maxWidth: '360px',
    backgroundColor: colors.bgCard, color: colors.textPrimary,
    border: `1px solid ${colors.borderLight}`, borderRadius: '14px',
    boxShadow: colors.shadowMd, padding: '1.25rem',
  };
  const select = {
    flex: 1, padding: '0.6rem', fontSize: '1rem',
    border: `2px solid ${colors.border}`, borderRadius: '8px',
    backgroundColor: colors.bgCard, color: colors.textPrimary,
  };
  const label = { fontSize: '0.72rem', fontWeight: 600, color: colors.textSecondary, marginBottom: '0.25rem' };
  const preset = {
    padding: '0.4rem 0.7rem', fontSize: '0.82rem', fontWeight: 600,
    borderRadius: '9999px', cursor: 'pointer',
    border: `1px solid ${colors.border}`,
    backgroundColor: colors.bgLight, color: colors.textPrimary,
  };
  const btn = (kind) => ({
    padding: '0.7rem 1rem', fontSize: '0.95rem', fontWeight: 700,
    borderRadius: '8px', cursor: 'pointer', border: 'none',
    ...(kind === 'save' && { backgroundColor: colors.primary, color: colors.onPrimary, opacity: invalid ? 0.5 : 1 }),
    ...(kind === 'clear' && { backgroundColor: 'transparent', color: colors.wastage, border: `1px solid ${colors.border}` }),
    ...(kind === 'cancel' && { backgroundColor: 'transparent', color: colors.textSecondary, border: `1px solid ${colors.border}` }),
  });

  return (
    <div style={overlay} onClick={onCancel}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>{staffName}</div>
        <div style={{ color: colors.textSecondary, fontSize: '0.85rem', marginBottom: '1rem' }}>{dayLabel}</div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '1rem' }}>
          {(presets && presets.length ? presets : DEFAULT_PRESETS).map((p) => (
            <button
              key={`${p.start}-${p.end}`}
              type="button"
              style={preset}
              onClick={() => { setStart(p.start); setEnd(p.end); }}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.35rem' }}>
          <div style={{ flex: 1 }}>
            <div style={label}>Start</div>
            <select style={select} value={start} onChange={(e) => setStart(e.target.value)}>
              {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <div style={label}>End</div>
            <select style={select} value={end} onChange={(e) => setEnd(e.target.value)}>
              {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t === '00:00' ? '00:00 (midnight)' : t}</option>)}
            </select>
          </div>
        </div>

        {invalid && (
          <div style={{ color: colors.error, fontSize: '0.78rem', marginBottom: '0.5rem' }}>
            End time must be after the start time.
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
          <button type="button" style={btn('save')} disabled={invalid} onClick={() => onSave({ start, end })}>
            Save
          </button>
          {value && (
            <button type="button" style={btn('clear')} onClick={onClear}>Clear</button>
          )}
          <button type="button" style={{ ...btn('cancel'), marginLeft: 'auto' }} onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default ShiftEditor;
