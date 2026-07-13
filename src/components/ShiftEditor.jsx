/**
 * ShiftEditor — a small centred modal for setting a person's shifts on one day.
 *
 * Usually one shift, but a day can hold two (a split shift, e.g. a lunch and an
 * evening). Each shift has quick presets plus 15-minute start/end dropdowns and
 * a remove control; "Add a split shift" appends a second. Calls onSave(shifts)
 * with the (possibly empty) array — an empty array clears the day.
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
  { label: '6–close', start: '18:00', end: 'close' },
];

// An end before the start means the shift runs past midnight (a close shift) —
// legitimate, not an error. "close" is an open-ended finish (real hours come
// from the clock-out). The only genuine mistake is an end identical to the
// start (a zero-length / ambiguous shift).
const isInvalid = (s) => s.end !== 'close' && s.end === s.start;
// A concrete end earlier than the start (but not midnight) spills into the next day.
const endsNextDay = (s) => s.end !== 'close' && s.end !== '00:00' && s.end < s.start;

function ShiftEditor({ staffName, dayLabel, presets, value, onSave, onCancel }) {
  const { isDark } = useTheme();
  const colors = getThemeColors(isDark);

  const initial = (Array.isArray(value) ? value : (value ? [value] : []))
    .filter((s) => s && s.start && s.end)
    .map((s) => ({ start: s.start, end: s.end }));
  const [list, setList] = useState(initial.length ? initial : [{ start: '09:00', end: '17:00' }]);
  const [focus, setFocus] = useState(0); // which shift the presets act on

  const setAt = (i, patch) => setList((l) => l.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const removeAt = (i) => setList((l) => l.filter((_, j) => j !== i));
  const addShift = () => { setFocus(list.length); setList((l) => [...l, { start: '17:00', end: '23:00' }]); };
  const applyPreset = (p) => {
    if (!list.length) { setList([{ start: p.start, end: p.end }]); setFocus(0); return; }
    setAt(Math.min(focus, list.length - 1), { start: p.start, end: p.end });
  };

  const anyInvalid = list.some(isInvalid);
  const save = () => onSave(list.filter((s) => s.start && s.end && !isInvalid(s)));

  const overlay = {
    // Above the full-screen rota overlay (6000) so admins can edit from there.
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
  const select = {
    flex: 1, minWidth: 0, padding: '0.6rem', fontSize: '1rem',
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
    ...(kind === 'save' && { backgroundColor: colors.primary, color: colors.onPrimary, opacity: anyInvalid ? 0.5 : 1 }),
    ...(kind === 'clear' && { backgroundColor: 'transparent', color: colors.wastage, border: `1px solid ${colors.border}` }),
    ...(kind === 'cancel' && { backgroundColor: 'transparent', color: colors.textSecondary, border: `1px solid ${colors.border}` }),
  });
  const hadValue = initial.length > 0;

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
              onClick={() => applyPreset(p)}
            >
              {p.label}
            </button>
          ))}
        </div>

        {list.map((s, i) => (
          <div key={i} style={{ marginBottom: '0.6rem' }} onFocusCapture={() => setFocus(i)}>
            {list.length > 1 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: colors.textSecondary }}>Shift {i + 1}</span>
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  style={{ background: 'none', border: 'none', color: colors.wastage, cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}
                >
                  Remove
                </button>
              </div>
            )}
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={label}>Start</div>
                <select style={select} value={s.start} onChange={(e) => setAt(i, { start: e.target.value })}>
                  {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={label}>End</div>
                <select style={select} value={s.end} onChange={(e) => setAt(i, { end: e.target.value })}>
                  <option value="close">Close (open end)</option>
                  {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t === '00:00' ? '00:00 (midnight)' : t}</option>)}
                </select>
              </div>
            </div>
            {isInvalid(s) ? (
              <div style={{ color: colors.error, fontSize: '0.78rem', marginTop: '0.35rem' }}>
                Start and end can't be the same time.
              </div>
            ) : endsNextDay(s) ? (
              <div style={{ color: colors.textSecondary, fontSize: '0.78rem', marginTop: '0.35rem' }}>
                Runs past midnight — ends the next day.
              </div>
            ) : null}
          </div>
        ))}

        {list.length < 2 && (
          <button
            type="button"
            onClick={addShift}
            style={{ marginTop: '0.25rem', background: 'none', border: `1px dashed ${colors.border}`, borderRadius: '8px', color: colors.primary, cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, padding: '0.5rem 0.75rem', width: '100%' }}
          >
            + Add a split shift
          </button>
        )}

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
          <button type="button" style={btn('save')} disabled={anyInvalid} onClick={save}>
            Save
          </button>
          {hadValue && (
            <button type="button" style={btn('clear')} onClick={() => onSave([])}>Clear</button>
          )}
          <button type="button" style={{ ...btn('cancel'), marginLeft: 'auto' }} onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default ShiftEditor;
