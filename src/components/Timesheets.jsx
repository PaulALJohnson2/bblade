/**
 * Timesheets — manager view of the punch clock (merged from the Punch app).
 *
 * Top to bottom: backdated clock-ins awaiting a decision (approve keeps the
 * requested start, refuse reverts to the real punch time), who's on the clock
 * now (with one-click clock out), this week's hours per member, and the shift
 * log grouped by day with inline editing and manual entry.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  subscribeToShifts, clockOutShift, addManualShift, updateShiftTimes,
  approveShiftBackdate, refuseShiftBackdate, deleteShift,
} from '../services/apiService';
import {
  toMs, effectiveClockIn, stationLabel, formatClock, formatDuration, formatDayShort,
} from '../utils/shiftUtils';

const isoDay = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const timeHM = (ms) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const msFrom = (dayIso, hm) => {
  if (!dayIso || !hm) return null;
  const [h, m] = hm.split(':').map(Number);
  const d = new Date(`${dayIso}T12:00:00`);
  d.setHours(h, m, 0, 0);
  return d.getTime();
};
const mondayOf = (ms) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
};

function Timesheets({ venuePath, members, approverName, colors, showToast }) {
  const [shifts, setShifts] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editIn, setEditIn] = useState('');
  const [editOut, setEditOut] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  // manual entry
  const [showAdd, setShowAdd] = useState(false);
  const [addMemberId, setAddMemberId] = useState('');
  const [addDay, setAddDay] = useState(isoDay(Date.now()));
  const [addIn, setAddIn] = useState('');
  const [addOut, setAddOut] = useState('');
  const [addStation, setAddStation] = useState('bar');

  useEffect(() => {
    const unsub = subscribeToShifts(venuePath, setShifts, (e) => showToast('Could not load shifts: ' + e));
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venuePath]);

  const rotaMembers = useMemo(() => (members || []).filter((m) => m.onRota !== false), [members]);

  const pending = useMemo(() => (shifts || []).filter((s) => s.approvalStatus === 'pending'), [shifts]);
  const onClock = useMemo(() => (shifts || []).filter((s) => !s.clockOut), [shifts]);

  // This week's totals per member (Mon–Sun, effective times; open shifts to now).
  const weekTotals = useMemo(() => {
    if (!shifts) return [];
    const weekStart = mondayOf(Date.now());
    const totals = new Map();
    for (const s of shifts) {
      const start = effectiveClockIn(s);
      if (!start || start < weekStart) continue;
      const end = toMs(s.clockOut) || Date.now();
      const key = s.memberId;
      totals.set(key, { name: s.memberName || '?', ms: (totals.get(key)?.ms || 0) + Math.max(0, end - start) });
    }
    return [...totals.values()].sort((a, b) => b.ms - a.ms);
  }, [shifts]);

  // Shift log grouped by day, newest day first.
  const byDay = useMemo(() => {
    const groups = new Map();
    for (const s of shifts || []) {
      const key = isoDay(effectiveClockIn(s) || Date.now());
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    }
    return [...groups.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 14);
  }, [shifts]);

  const startEdit = (s) => {
    setEditingId(s.id);
    setEditIn(timeHM(toMs(s.clockIn)));
    setEditOut(s.clockOut ? timeHM(toMs(s.clockOut)) : '');
    setConfirmDeleteId(null);
  };

  const saveEdit = async (s) => {
    const day = isoDay(toMs(s.clockIn));
    const inMs = msFrom(day, editIn);
    const outMs = editOut ? msFrom(day, editOut) : null;
    if (!inMs) { showToast('Enter a clock-in time.'); return; }
    if (outMs !== null && outMs < inMs) { showToast('Clock-out is before clock-in.'); return; }
    const res = await updateShiftTimes(venuePath, s.id, { clockIn: inMs, clockOut: outMs });
    if (!res.success) { showToast('Could not save: ' + res.error); return; }
    setEditingId(null);
  };

  const handleAdd = async () => {
    const member = rotaMembers.find((m) => m.id === addMemberId);
    const inMs = msFrom(addDay, addIn);
    const outMs = addOut ? msFrom(addDay, addOut) : null;
    if (!member || !inMs) { showToast('Pick a person and a start time.'); return; }
    if (outMs !== null && outMs < inMs) { showToast('Clock-out is before clock-in.'); return; }
    const res = await addManualShift(venuePath, {
      memberId: member.id, memberName: member.displayName || '', station: addStation, clockIn: inMs, clockOut: outMs,
    });
    if (!res.success) { showToast('Could not add: ' + res.error); return; }
    setShowAdd(false); setAddIn(''); setAddOut('');
    showToast('Shift added');
  };

  const card = { backgroundColor: colors.bgCard, border: `1px solid ${colors.borderLight}`, borderRadius: '12px', padding: '1rem', marginBottom: '1rem' };
  const smallBtn = (bg, fg = '#fff') => ({ padding: '0.45rem 0.7rem', backgroundColor: bg, color: fg, border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700, flexShrink: 0 });
  const ghostBtn = { padding: '0.45rem 0.7rem', background: 'none', border: `1px solid ${colors.border}`, borderRadius: '6px', color: colors.textSecondary, cursor: 'pointer', fontSize: '0.8rem', flexShrink: 0 };
  const timeInput = { padding: '0.4rem', fontSize: '0.9rem', borderRadius: '6px', border: `1px solid ${colors.border}`, backgroundColor: colors.bgCard, color: colors.textPrimary };

  if (!shifts) return <div style={{ color: colors.textSecondary, fontSize: '0.9rem' }}>Loading shifts…</div>;

  return (
    <div>
      {/* Pending backdate approvals */}
      {pending.length > 0 && (
        <div style={{ ...card, borderColor: colors.warning }}>
          <h2 style={{ margin: '0 0 0.5rem', fontSize: '1rem', color: colors.warning }}>Needs approval</h2>
          {pending.map((s) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.45rem 0', borderTop: `1px solid ${colors.borderLight}`, fontSize: '0.85rem' }}>
              <span style={{ flex: 1, color: colors.textPrimary }}>
                <strong>{s.memberName}</strong> says they started {formatDayShort(toMs(s.clockIn))} {formatClock(toMs(s.clockIn))}
                {' '}(punched at {formatClock(toMs(s.clockInActual))})
                {s.clockInReason && <span style={{ color: colors.textSecondary }}> — “{s.clockInReason}”</span>}
              </span>
              <button onClick={async () => { const r = await approveShiftBackdate(venuePath, s.id, approverName); showToast(r.success ? 'Approved' : 'Failed: ' + r.error); }} style={smallBtn(colors.success)}>Approve</button>
              <button onClick={async () => { const r = await refuseShiftBackdate(venuePath, s); showToast(r.success ? 'Reverted to actual punch time' : 'Failed: ' + r.error); }} style={smallBtn(colors.error)}>Refuse</button>
            </div>
          ))}
        </div>
      )}

      {/* On the clock now */}
      <div style={card}>
        <h2 style={{ margin: '0 0 0.5rem', fontSize: '1rem', color: colors.textPrimary }}>On the clock now</h2>
        {onClock.length === 0 ? (
          <div style={{ color: colors.textSecondary, fontSize: '0.85rem' }}>Nobody clocked in.</div>
        ) : onClock.map((s) => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.45rem 0', fontSize: '0.9rem' }}>
            <span style={{ flex: 1, color: colors.textPrimary }}>
              <strong>{s.memberName}</strong> · {stationLabel(s.station)} · since {formatClock(effectiveClockIn(s))} ({formatDuration(effectiveClockIn(s))})
            </span>
            <button onClick={async () => { const r = await clockOutShift(venuePath, s); showToast(r.success ? `${s.memberName} clocked out` : 'Failed: ' + r.error); }} style={smallBtn(colors.error)}>Clock out</button>
          </div>
        ))}
      </div>

      {/* This week */}
      <div style={card}>
        <h2 style={{ margin: '0 0 0.5rem', fontSize: '1rem', color: colors.textPrimary }}>This week</h2>
        {weekTotals.length === 0 ? (
          <div style={{ color: colors.textSecondary, fontSize: '0.85rem' }}>No shifts yet this week.</div>
        ) : weekTotals.map((t) => (
          <div key={t.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.3rem 0', fontSize: '0.9rem' }}>
            <span style={{ color: colors.textPrimary }}>{t.name}</span>
            <span style={{ color: colors.textPrimary, fontWeight: 700 }}>{formatDuration(0, t.ms)}</span>
          </div>
        ))}
      </div>

      {/* Manual entry */}
      <div style={card}>
        {showAdd ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <h2 style={{ margin: 0, fontSize: '1rem', color: colors.textPrimary }}>Add a shift</h2>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <select value={addMemberId} onChange={(e) => setAddMemberId(e.target.value)} style={{ ...timeInput, flex: 1, minWidth: '130px' }}>
                <option value="">Who…</option>
                {rotaMembers.map((m) => <option key={m.id} value={m.id}>{m.displayName}</option>)}
              </select>
              <select value={addStation} onChange={(e) => setAddStation(e.target.value)} style={timeInput}>
                <option value="bar">Bar</option>
                <option value="kitchen">Kitchen</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <input type="date" value={addDay} onChange={(e) => setAddDay(e.target.value)} style={timeInput} />
              <input type="time" value={addIn} onChange={(e) => setAddIn(e.target.value)} style={timeInput} />
              <span style={{ color: colors.textSecondary }}>→</span>
              <input type="time" value={addOut} onChange={(e) => setAddOut(e.target.value)} style={timeInput} />
              <button onClick={handleAdd} style={smallBtn(colors.primary, colors.onPrimary)}>Add</button>
              <button onClick={() => setShowAdd(false)} style={ghostBtn}>Cancel</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowAdd(true)} style={{ background: 'none', border: 'none', color: colors.primary, cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600, textDecoration: 'underline', padding: 0 }}>
            + Add a shift manually
          </button>
        )}
      </div>

      {/* Shift log by day */}
      {byDay.map(([day, list]) => (
        <div key={day} style={card}>
          <h2 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem', color: colors.textSecondary }}>{formatDayShort(new Date(`${day}T12:00:00`).getTime())}</h2>
          {list.map((s) => {
            const start = effectiveClockIn(s);
            const out = toMs(s.clockOut);
            return (
              <div key={s.id} style={{ padding: '0.45rem 0', borderTop: `1px solid ${colors.borderLight}` }}>
                {editingId === s.id ? (
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.85rem' }}>
                    <span style={{ color: colors.textPrimary, fontWeight: 600 }}>{s.memberName}</span>
                    <input type="time" value={editIn} onChange={(e) => setEditIn(e.target.value)} style={timeInput} />
                    <span style={{ color: colors.textSecondary }}>→</span>
                    <input type="time" value={editOut} onChange={(e) => setEditOut(e.target.value)} style={timeInput} placeholder="open" />
                    <button onClick={() => saveEdit(s)} style={smallBtn(colors.primary, colors.onPrimary)}>Save</button>
                    <button onClick={() => setEditingId(null)} style={ghostBtn}>Cancel</button>
                    {confirmDeleteId === s.id ? (
                      <button onClick={async () => { const r = await deleteShift(venuePath, s.id); showToast(r.success ? 'Shift deleted' : 'Failed: ' + r.error); setEditingId(null); }} style={smallBtn(colors.error)}>Confirm delete</button>
                    ) : (
                      <button onClick={() => setConfirmDeleteId(s.id)} style={{ ...ghostBtn, color: colors.error }}>Delete</button>
                    )}
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.85rem' }}>
                    <span style={{ flex: 1, minWidth: 0, color: colors.textPrimary }}>
                      <strong>{s.memberName}</strong> · {formatClock(start)}–{out ? formatClock(out) : 'now'} · {stationLabel(s.station)}
                      {s.approvalStatus === 'pending' && <span style={{ color: colors.warning, fontWeight: 700 }}> · PENDING</span>}
                      {s.manual && <span style={{ color: colors.textMuted }}> · manual</span>}
                    </span>
                    <span style={{ color: colors.textSecondary, fontWeight: 700, flexShrink: 0 }}>{formatDuration(start, out || Date.now())}</span>
                    <button onClick={() => startEdit(s)} style={{ background: 'none', border: 'none', color: colors.primary, cursor: 'pointer', fontSize: '0.8rem', textDecoration: 'underline', padding: 0, flexShrink: 0 }}>Edit</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default Timesheets;
