/**
 * RotaGrid — the "paper rota": every staff member is a row, the seven days run
 * across the top, and each cell holds one shift's time (tap to edit).
 *
 * Flat, minimal styling: white cells, thin ruled lines, no fills; shift times
 * are plain slate-blue text rather than solid chips.
 *
 * Props:
 *   days    - [{ key:'mon', label:'Mon', dateLabel:'30/6' }]
 *   rows    - [{ memberId, name, shifts: { mon:[{start,end},...]|undefined, ... } }]
 *             (a day holds an array of shifts; legacy single-object days still read)
 *   onCellClick(row, dayKey)
 *   onReorder(orderedMemberIds) - persist a new staff order (drag to reorder)
 *   readOnly          - staff view: no editing, no dragging, no "+" affordances
 *   highlightMemberId - tint this member's row (the signed-in user's own row)
 *   compact           - shrink cells/fonts so the whole week fits on screen with
 *                       no horizontal scroll (the "fit to screen" view)
 *   fill              - stretch to fill the parent's width AND height (day
 *                       columns and staff rows share the space): used by the
 *                       whole-screen view so the rota fills the screen
 */

import React, { useRef, useState } from 'react';
import { getThemeColors } from '../utils/theme';
import { dayShifts } from '../utils/rota';
import useTheme from '../hooks/useTheme';

const NAME_COL = '190px';

// Slate-blue text accent for shift times (light + dark variants).
const ACCENT = { light: '#2F4A6B', dark: '#8FB4DE' };
// Own-row highlight tint.
const HILITE = { light: '#EAF1F8', dark: '#1B2735' };

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

// Total minutes worked in a day across all of its shifts (handles split days).
function dayMinutes(value) {
  return dayShifts(value).reduce((sum, s) => sum + shiftMinutes(s), 0);
}

// Minutes → decimal hours, e.g. 330→"5.5", 435→"7.25", 765→"12.75", 480→"12"
// (shifts are 15-min steps, so hours land on exact .25 increments). Blank for zero.
function fmtHours(min) {
  if (!min) return '';
  return String(Number((min / 60).toFixed(2)));
}

function RotaGrid({ days, rows, onCellClick, onReorder, readOnly = false, highlightMemberId = null, compact = false, fill = false }) {
  const { isDark } = useTheme();
  const colors = getThemeColors(isDark);
  const accent = isDark ? ACCENT.dark : ACCENT.light;
  const hilite = isDark ? HILITE.dark : HILITE.light;

  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);
  const nameRefs = useRef({}); // rowIndex → name-cell DOM node, for hit-testing

  const moveRow = (from, to) => {
    if (from == null || to == null || from === to) return;
    const ids = rows.map((r) => r.memberId);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    onReorder?.(ids);
  };
  const endDrag = () => { setDragIndex(null); setOverIndex(null); };

  // Pointer-based drag (works for both mouse and touch). Grabbing the grip
  // captures the pointer; movement hit-tests against the name-cell rows.
  const startDrag = (e, index) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDragIndex(index);
    setOverIndex(index);
  };
  const moveDrag = (e) => {
    if (dragIndex == null) return;
    const n = rows.length;
    const y = e.clientY;
    const first = nameRefs.current[0]?.getBoundingClientRect();
    const last = nameRefs.current[n - 1]?.getBoundingClientRect();
    let target = dragIndex;
    if (first && y < first.top) target = 0;
    else if (last && y > last.bottom) target = n - 1;
    else {
      for (let i = 0; i < n; i += 1) {
        const el = nameRefs.current[i];
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (y >= r.top && y <= r.bottom) { target = i; break; }
      }
    }
    if (target !== overIndex) setOverIndex(target);
  };
  const dropDrag = (e) => {
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    moveRow(dragIndex, overIndex);
    endDrag();
  };

  // Compact ("fit to screen") mode: let the seven day columns shrink to share
  // the available width (no min column width, no grid min-width) and dial the
  // padding/fonts down so a full week fits without horizontal scrolling.
  // Keep the name/hours columns tight so the day columns get as much width as
  // possible (long names truncate with an ellipsis). Full-screen and compact
  // fit the whole week; only the plain in-page (laptop) grid scrolls sideways.
  const nameColW = compact ? '58px' : (fill ? '92px' : NAME_COL);
  const totalColW = compact ? 'minmax(30px, 0.5fr)' : (fill ? '58px' : '96px');
  const dayCols = (compact || fill) ? 'repeat(7, minmax(0, 1fr))' : 'repeat(7, minmax(96px, 1fr))';

  const grid = {
    display: 'grid',
    gridTemplateColumns: `${nameColW} ${dayCols} ${totalColW}`,
    minWidth: (compact || fill) ? 0 : '860px',
    border: `1px solid ${colors.borderLight}`,
    borderRadius: '8px',
    overflow: 'hidden',
    backgroundColor: colors.bgCard,
    // Fill mode: occupy the whole parent and let the staff rows share the
    // height (header + total stay content-sized).
    ...(fill ? {
      width: '100%',
      height: '100%',
      // Staff view drops the grand-total row, so no trailing auto track.
      gridTemplateRows: rows.length ? `auto repeat(${rows.length}, minmax(0, 1fr))${readOnly ? '' : ' auto'}` : undefined,
    } : {}),
  };
  // Thin ruled lines only — right + bottom on each cell; the grid border closes
  // the outer edge.
  const cellBase = {
    borderRight: `1px solid ${colors.borderLight}`,
    borderBottom: `1px solid ${colors.borderLight}`,
    padding: compact ? '0.15rem 0.06rem' : (fill ? '0.15rem 0.1rem' : '1rem 0.5rem'),
    minHeight: fill ? 0 : (compact ? '34px' : '76px'),
    display: 'flex',
    alignItems: 'center',
  };
  const headCell = {
    ...cellBase,
    // Staff view: a slimmer header row (less padding, smaller labels).
    ...(readOnly ? { padding: compact ? '0.2rem 0.06rem' : '0.25rem 0.1rem', minHeight: 0 } : {}),
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '1px',
    borderBottom: `2px solid ${colors.border}`,
    fontWeight: 700,
    fontSize: readOnly ? (compact ? '0.66rem' : '0.8rem') : (compact ? '0.72rem' : '0.95rem'),
    color: colors.textPrimary,
    textAlign: 'center',
  };
  const nameCell = {
    ...cellBase,
    fontWeight: 600,
    fontSize: compact ? '0.74rem' : (fill ? '0.85rem' : '1rem'),
    color: colors.textPrimary,
  };
  const dayCell = {
    ...cellBase,
    justifyContent: 'center',
    cursor: 'pointer',
    overflow: 'hidden', // keep shift times inside their own cell
    WebkitTapHighlightColor: 'transparent',
  };
  const totalCell = {
    ...cellBase,
    justifyContent: 'center',
    textAlign: 'center', // keep "12h 45m" centred when it wraps to two lines
    borderRight: 'none',
    fontWeight: 700,
    fontSize: compact ? '0.6rem' : (fill ? '0.8rem' : '1rem'),
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
    <div style={fill ? { width: '100%', height: '100%', overflow: 'hidden' } : { overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <div style={grid}>
        {/* Header row */}
        <div style={{ ...headCell, alignItems: 'flex-start' }}>Staff</div>
        {days.map((d) => (
          <div key={d.key} style={headCell}>
            <span>{d.label}</span>
          </div>
        ))}
        <div style={{ ...headCell, borderRight: 'none' }}>Hours</div>

        {/* Staff rows */}
        {rows.map((row) => {
          const totalMin = days.reduce((sum, d) => sum + dayMinutes(row.shifts?.[d.key]), 0);
          const rowIndex = rows.indexOf(row);
          const hi = highlightMemberId && row.memberId === highlightMemberId;
          const rowBg = hi ? hilite : undefined;
          const dragProps = readOnly ? {} : {
            ref: (el) => { nameRefs.current[rowIndex] = el; },
            title: 'Drag to reorder',
            onPointerDown: (e) => startDrag(e, rowIndex),
            onPointerMove: moveDrag,
            onPointerUp: dropDrag,
            onPointerCancel: endDrag,
          };
          return (
            <React.Fragment key={row.memberId}>
              <div
                {...dragProps}
                style={{
                  ...nameCell,
                  gap: '0.4rem',
                  backgroundColor: rowBg,
                  cursor: readOnly ? 'default' : 'grab',
                  touchAction: readOnly ? 'auto' : 'none',
                  userSelect: readOnly ? 'auto' : 'none',
                  boxShadow: !readOnly && overIndex === rowIndex && dragIndex !== rowIndex ? `inset 0 2px 0 ${accent}` : 'none',
                  opacity: dragIndex === rowIndex ? 0.4 : 1,
                }}
              >
                {!readOnly && !compact && <span aria-hidden="true" style={{ color: colors.textMuted, fontSize: '1.15rem', lineHeight: 1, flexShrink: 0 }}>⠿</span>}
                <span style={{ fontWeight: hi ? 800 : nameCell.fontWeight, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {row.name}{hi ? ' (you)' : ''}
                </span>
              </div>
              {days.map((d) => {
                const shifts = dayShifts(row.shifts?.[d.key]);
                const n = shifts.length;
                const split = n >= 2;
                // Longest range label in the cell, e.g. "9–5" (3) vs "12:30–2:30" (10).
                const maxLen = n ? Math.max(...shifts.map((s) => fmtTime(s.start).length + 1 + fmtTime(s.end).length)) : 0;
                // A single shift reads big; a split day drops so both lines fit the
                // row. In the full-screen view each range must stay on one line, so
                // a single shift's size adapts to its length (a long half-hour range
                // shrinks to fit the column instead of clipping).
                let timeFont;
                if (compact) timeFont = split ? '0.56rem' : '0.78rem';
                else if (fill) timeFont = split ? '0.72rem' : (maxLen <= 5 ? '1.5rem' : maxLen <= 7 ? '1.25rem' : '0.95rem');
                else timeFont = split ? '1rem' : '1.4rem'; // laptop in-page
                return (
                  <div
                    key={d.key}
                    style={{ ...dayCell, backgroundColor: rowBg, cursor: readOnly ? 'default' : 'pointer' }}
                    onClick={readOnly ? undefined : () => onCellClick(row, d.key)}
                    role={readOnly ? undefined : 'button'}
                    tabIndex={readOnly ? undefined : 0}
                  >
                    {n > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: split ? '0px' : '2px', width: '100%', lineHeight: 1.05, overflow: 'hidden' }}>
                        {shifts.map((s, i) => (
                          <span
                            key={i}
                            style={{
                              fontSize: timeFont, fontWeight: 700, color: accent, textAlign: 'center',
                              // Full-screen rows are short and fixed, so keep each
                              // range on one line there; the in-page views can let a
                              // long range wrap at the dash (inner spans are nowrap).
                              whiteSpace: fill ? 'nowrap' : 'normal',
                            }}
                          >
                            <span style={{ whiteSpace: 'nowrap' }}>{fmtTime(s.start)}</span>
                            <span style={{ padding: compact ? '0 0.06rem' : '0 0.3rem' }}>–</span>
                            <span style={{ whiteSpace: 'nowrap' }}>{fmtTime(s.end)}</span>
                          </span>
                        ))}
                      </div>
                    ) : (!readOnly && <span style={{ color: colors.textMuted, fontSize: compact ? '1.1rem' : '1.8rem', opacity: 0.4 }}>+</span>)}
                  </div>
                );
              })}
              <div style={{ ...totalCell, backgroundColor: rowBg }}>{fmtHours(totalMin)}</div>
            </React.Fragment>
          );
        })}

        {/* Grand total row — omitted in the staff view. */}
        {rows.length > 0 && !readOnly && (() => {
          const grand = rows.reduce((sum, r) => sum + days.reduce((s, d) => s + dayMinutes(r.shifts?.[d.key]), 0), 0);
          return (
            <>
              <div style={{ ...footBase, fontSize: compact ? '0.72rem' : '0.95rem' }}>Total</div>
              {days.map((d) => (
                <div key={d.key} style={footBase} />
              ))}
              <div style={{ ...footBase, justifyContent: 'center', borderRight: 'none', fontSize: compact ? '0.85rem' : '1.1rem', color: accent }}>
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
