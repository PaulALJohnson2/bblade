/**
 * RotaGrid — the "paper rota": every staff member is a row, the seven days run
 * across the top, and each cell holds one shift's time (tap to edit).
 *
 * Flat, minimal styling: white cells, thin ruled lines, no fills; shift times
 * are plain slate-blue text rather than solid chips.
 *
 * Props:
 *   days    - [{ key:'mon', label:'Mon', dateLabel:'30/6' }]
 *   rows    - [{ memberId, name, shifts: { mon:{start,end}|undefined, ... } }]
 *   onCellClick(row, dayKey)
 */

import React from 'react';
import { getThemeColors } from '../utils/theme';
import useTheme from '../hooks/useTheme';

const NAME_COL = '190px';

// Slate-blue text accent for shift times (light + dark variants).
const ACCENT = { light: '#2F4A6B', dark: '#8FB4DE' };

// Compact 12-hour shift-time label (no am/pm for now): 17:00 → 5, 09:30 → 9:30,
// and 12/0 map to 12 (noon/midnight). Whole hours drop the ":00".
function fmtTime(t) {
  const [h, m] = t.split(':');
  const hour = parseInt(h, 10) % 12 || 12;
  return m === '00' ? String(hour) : `${hour}:${m}`;
}

// Length of a shift in minutes; midnight end counts as end-of-day and an end
// at/before the start is treated as running overnight.
function shiftMinutes(shift) {
  if (!shift) return 0;
  const [sh, sm] = shift.start.split(':').map(Number);
  const [eh, em] = shift.end.split(':').map(Number);
  const s = sh * 60 + sm;
  let e = shift.end === '00:00' ? 1440 : eh * 60 + em;
  if (e <= s) e += 1440;
  return e - s;
}

// Minutes → "40h" / "37h 30m" (blank for zero).
function fmtHours(min) {
  if (!min) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function RotaGrid({ days, rows, onCellClick }) {
  const { isDark } = useTheme();
  const colors = getThemeColors(isDark);
  const accent = isDark ? ACCENT.dark : ACCENT.light;

  const grid = {
    display: 'grid',
    gridTemplateColumns: `${NAME_COL} repeat(7, minmax(96px, 1fr)) 96px`,
    minWidth: '860px',
    border: `1px solid ${colors.borderLight}`,
    borderRadius: '8px',
    overflow: 'hidden',
    backgroundColor: colors.bgCard,
  };
  // Thin ruled lines only — right + bottom on each cell; the grid border closes
  // the outer edge.
  const cellBase = {
    borderRight: `1px solid ${colors.borderLight}`,
    borderBottom: `1px solid ${colors.borderLight}`,
    padding: '1rem 0.5rem',
    minHeight: '76px',
    display: 'flex',
    alignItems: 'center',
  };
  const headCell = {
    ...cellBase,
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '1px',
    borderBottom: `2px solid ${colors.border}`,
    fontWeight: 700,
    fontSize: '0.95rem',
    color: colors.textPrimary,
    textAlign: 'center',
  };
  const nameCell = {
    ...cellBase,
    fontWeight: 600,
    fontSize: '1rem',
    color: colors.textPrimary,
  };
  const dayCell = {
    ...cellBase,
    justifyContent: 'center',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  };
  const timeText = {
    fontSize: '1.7rem',
    fontWeight: 700,
    color: accent,
    whiteSpace: 'nowrap',
    width: '100%',
    textAlign: 'center',
  };
  const totalCell = {
    ...cellBase,
    justifyContent: 'center',
    borderRight: 'none',
    fontWeight: 700,
    fontSize: '1rem',
    color: colors.textPrimary,
  };
  const footBase = {
    ...cellBase,
    borderTop: `2px solid ${colors.border}`,
    borderBottom: 'none',
    fontWeight: 700,
    color: colors.textPrimary,
  };

  return (
    <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <div style={grid}>
        {/* Header row */}
        <div style={{ ...headCell, alignItems: 'flex-start' }}>Staff</div>
        {days.map((d) => (
          <div key={d.key} style={headCell}>
            <span>{d.label}</span>
            <span style={{ fontSize: '0.8rem', fontWeight: 500, color: colors.textSecondary }}>{d.dateLabel}</span>
          </div>
        ))}
        <div style={{ ...headCell, borderRight: 'none' }}>Hours</div>

        {/* Staff rows */}
        {rows.map((row) => {
          const totalMin = days.reduce((sum, d) => sum + shiftMinutes(row.shifts?.[d.key]), 0);
          return (
            <React.Fragment key={row.memberId}>
              <div style={nameCell}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</span>
              </div>
              {days.map((d) => {
                const shift = row.shifts?.[d.key];
                return (
                  <div
                    key={d.key}
                    style={dayCell}
                    onClick={() => onCellClick(row, d.key)}
                    role="button"
                    tabIndex={0}
                  >
                    {shift
                      ? <span style={timeText}>{fmtTime(shift.start)}<span style={{ padding: '0 0.35rem' }}>–</span>{fmtTime(shift.end)}</span>
                      : <span style={{ color: colors.textMuted, fontSize: '1.8rem', opacity: 0.4 }}>+</span>}
                  </div>
                );
              })}
              <div style={totalCell}>{fmtHours(totalMin)}</div>
            </React.Fragment>
          );
        })}

        {/* Grand total row */}
        {rows.length > 0 && (() => {
          const grand = rows.reduce((sum, r) => sum + days.reduce((s, d) => s + shiftMinutes(r.shifts?.[d.key]), 0), 0);
          return (
            <>
              <div style={{ ...footBase, fontSize: '0.95rem' }}>Total</div>
              {days.map((d) => (
                <div key={d.key} style={footBase} />
              ))}
              <div style={{ ...footBase, justifyContent: 'center', borderRight: 'none', fontSize: '1.1rem', color: accent }}>
                {fmtHours(grand)}
              </div>
            </>
          );
        })()}

        {rows.length === 0 && (
          <div style={{ gridColumn: '1 / -1', padding: '1.25rem', textAlign: 'center', color: colors.textSecondary, fontSize: '0.9rem' }}>
            No staff yet — add people in Admin → Account.
          </div>
        )}
      </div>
    </div>
  );
}

export default RotaGrid;
