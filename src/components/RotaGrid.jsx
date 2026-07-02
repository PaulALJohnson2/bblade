/**
 * RotaGrid — the "paper rota": staff names down the first column, the seven
 * days across the top, and a tappable cell per staff/day holding one shift.
 *
 * Presentational only — all state lives in the Rota page. Tapping a day cell
 * calls onCellClick(rowIndex, dayKey); the footer's dropdown adds a staff row.
 *
 * Props:
 *   days             - [{ key:'mon', label:'Mon', dateLabel:'30/6', weekend }]
 *   rows             - [{ memberId, name, shifts: { mon:{start,end}|null, ... } }]
 *   availableMembers - members not yet on the rota, for the add dropdown
 *   onCellClick(rowIndex, dayKey)
 *   onRemoveRow(rowIndex)
 *   onAddStaff(memberId)
 */

import React from 'react';
import { getThemeColors } from '../utils/theme';
import useTheme from '../hooks/useTheme';

const NAME_COL = '150px';

// Compact shift-time label: drop ":00" and the leading zero on whole hours
// (09:00 → 9), keep minutes otherwise (09:30 → 9:30), and show a midnight end
// as 24 so a close reads "18–24" rather than "18–0".
function fmtTime(t, isEnd = false) {
  if (isEnd && t === '00:00') return '24';
  const [h, m] = t.split(':');
  const hour = parseInt(h, 10);
  return m === '00' ? String(hour) : `${hour}:${m}`;
}

function RotaGrid({ days, rows, availableMembers = [], onCellClick, onRemoveRow, onAddStaff }) {
  const { isDark } = useTheme();
  const colors = getThemeColors(isDark);

  const grid = {
    display: 'grid',
    gridTemplateColumns: `${NAME_COL} repeat(7, minmax(78px, 1fr))`,
    minWidth: '620px',
    border: `1px solid ${colors.border}`,
    borderRadius: '10px',
    overflow: 'hidden',
    backgroundColor: colors.bgCard,
  };
  // Every cell shares the same ruled-paper borders (right + bottom); the grid's
  // own border closes the outer edge.
  const cellBase = {
    borderRight: `1px solid ${colors.borderLight}`,
    borderBottom: `1px solid ${colors.borderLight}`,
    padding: '0.5rem',
    minHeight: '46px',
    display: 'flex',
    alignItems: 'center',
  };
  const headCell = (weekend) => ({
    ...cellBase,
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '1px',
    backgroundColor: weekend ? colors.primarySoft : colors.bgLight,
    fontWeight: 700,
    fontSize: '0.82rem',
    color: colors.textPrimary,
    textAlign: 'center',
  });
  const nameCell = {
    ...cellBase,
    justifyContent: 'space-between',
    gap: '0.4rem',
    backgroundColor: colors.bgLight,
    fontWeight: 600,
    fontSize: '0.88rem',
    color: colors.textPrimary,
  };
  const dayCell = (weekend) => ({
    ...cellBase,
    justifyContent: 'center',
    cursor: 'pointer',
    backgroundColor: weekend ? (isDark ? colors.bgLight : colors.primarySoft) : colors.bgCard,
    WebkitTapHighlightColor: 'transparent',
  });
  const chip = {
    fontSize: '0.78rem',
    fontWeight: 700,
    lineHeight: 1.2,
    color: colors.onPrimary,
    backgroundColor: colors.primary,
    borderRadius: '8px',
    padding: '0.3rem 0.4rem',
    textAlign: 'center',
    whiteSpace: 'nowrap',
  };
  const removeBtn = {
    border: 'none', background: 'transparent', cursor: 'pointer',
    color: colors.textMuted, fontSize: '1rem', lineHeight: 1, padding: '0 0.15rem',
  };

  return (
    <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <div style={grid}>
        {/* Header row */}
        <div style={{ ...headCell(false), backgroundColor: colors.bgLight }}>Staff</div>
        {days.map((d) => (
          <div key={d.key} style={headCell(d.weekend)}>
            <span>{d.label}</span>
            <span style={{ fontSize: '0.7rem', fontWeight: 500, color: colors.textSecondary }}>{d.dateLabel}</span>
          </div>
        ))}

        {/* Staff rows */}
        {rows.map((row, rowIndex) => (
          <React.Fragment key={row.memberId || rowIndex}>
            <div style={nameCell}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</span>
              <button
                type="button"
                style={removeBtn}
                title={`Remove ${row.name}`}
                aria-label={`Remove ${row.name}`}
                onClick={() => onRemoveRow(rowIndex)}
              >
                ×
              </button>
            </div>
            {days.map((d) => {
              const shift = row.shifts?.[d.key];
              return (
                <div
                  key={d.key}
                  style={dayCell(d.weekend)}
                  onClick={() => onCellClick(rowIndex, d.key)}
                  role="button"
                  tabIndex={0}
                >
                  {shift
                    ? <span style={chip}>{fmtTime(shift.start)}–{fmtTime(shift.end, true)}</span>
                    : <span style={{ color: colors.textMuted, fontSize: '1.1rem', opacity: 0.5 }}>+</span>}
                </div>
              );
            })}
          </React.Fragment>
        ))}

        {rows.length === 0 && (
          <div style={{ gridColumn: '1 / -1', padding: '1.25rem', textAlign: 'center', color: colors.textSecondary, fontSize: '0.9rem' }}>
            No staff on this rota yet — add someone below.
          </div>
        )}
      </div>

      {/* Add-staff footer */}
      <div style={{ marginTop: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
        <label style={{ fontSize: '0.8rem', fontWeight: 600, color: colors.textSecondary }}>Add staff:</label>
        <select
          value=""
          disabled={availableMembers.length === 0}
          onChange={(e) => { if (e.target.value) onAddStaff(e.target.value); }}
          style={{
            padding: '0.55rem 0.7rem', fontSize: '0.95rem', borderRadius: '8px',
            border: `2px solid ${colors.border}`, backgroundColor: colors.bgCard, color: colors.textPrimary,
          }}
        >
          <option value="">{availableMembers.length ? '+ Choose a staff member…' : 'Everyone is on the rota'}</option>
          {availableMembers.map((m) => (
            <option key={m.id} value={m.id}>{m.displayName || m.email}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

export default RotaGrid;
