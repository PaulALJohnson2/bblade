/**
 * Clock — punch in/out for the signed-in member (merged from the Punch app).
 *
 * Rota members clock in against a station (from their department; "both"
 * choose Bar or Kitchen), can request a backdated start with a reason (goes
 * to manager approval — until approved the shift counts from the real punch
 * time), and clock out with one tap. Shifts are stored per MEMBER, so the
 * later shared "bar account" mode can clock people in on their behalf.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { subscribeToShifts, clockInShift, clockOutShift } from '../services/apiService';
import { getThemeColors } from '../utils/theme';
import useTheme from '../hooks/useTheme';
import {
  toMs, effectiveClockIn, activeShiftFor, stationForDepartment, stationLabel,
  formatClock, formatDuration, formatDayShort,
  earlierOptions, agoLabel, EARLIER_CAP_HRS,
} from '../utils/shiftUtils';

function Clock() {
  const navigate = useNavigate();
  const { currentUser, currentMember, selectedPub } = useAuth();
  const { isDark } = useTheme();
  const colors = getThemeColors(isDark);

  const [shifts, setShifts] = useState(null);
  const [station, setStation] = useState(null); // chosen station for dept 'both'
  // Punch-style flow: tapping Clock in/out opens a picker — "Now" plus earlier
  // times at 15-minute marks. An earlier clock-IN also needs a reason (approval).
  const [picker, setPicker] = useState(null); // null | 'in' | 'out'
  const [pendingTime, setPendingTime] = useState(null); // chosen earlier clock-in time
  const [earlierReason, setEarlierReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [, forceTick] = useState(0);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

  useEffect(() => {
    if (!selectedPub?.path) return;
    const unsub = subscribeToShifts(selectedPub.path, (list) => setShifts(list), (e) => showToast('Could not load shifts: ' + e));
    return () => unsub();
  }, [selectedPub?.path]);

  // Live-ticking duration while clocked in.
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const active = currentMember && shifts ? activeShiftFor(shifts, currentMember.id) : null;
  const fixedStation = stationForDepartment(currentMember?.department || 'bar');
  const chosenStation = fixedStation || station;

  const recent = useMemo(() => {
    if (!currentMember || !shifts) return [];
    return shifts.filter((s) => s.memberId === currentMember.id && s.clockOut).slice(0, 5);
  }, [shifts, currentMember]);

  const resetPicker = () => { setPicker(null); setPendingTime(null); setEarlierReason(''); };

  // Clock in at `requestedTime` (null = now). Earlier times need a reason and
  // go to manager approval — same rules as Punch.
  const doClockIn = async (requestedTime, reason = null) => {
    if (!chosenStation || busy) return;
    if (requestedTime && !(reason || '').trim()) { showToast('Please enter a reason for the earlier start.'); return; }
    setBusy(true);
    const res = await clockInShift(selectedPub.path, {
      memberId: currentMember.id,
      memberName: currentMember.displayName || '',
      station: chosenStation,
      requestedTime,
      reason: reason ? reason.trim() : null,
      byUid: currentUser?.uid || null,
    });
    setBusy(false);
    if (!res.success) { showToast('Could not clock in: ' + res.error); return; }
    resetPicker();
    showToast(requestedTime
      ? `Clocked in — backdated to ${formatClock(requestedTime)}, awaiting approval`
      : 'Clocked in. Have a good shift!');
  };

  // Clock out at `at` (defaults to now) — earlier times need no approval,
  // they just can't be before the shift started (matches Punch).
  const doClockOut = async (at = Date.now()) => {
    if (!active || busy) return;
    setBusy(true);
    const res = await clockOutShift(selectedPub.path, active, at);
    setBusy(false);
    if (!res.success) { showToast('Could not clock out: ' + res.error); return; }
    resetPicker();
    showToast(`Clocked out · ${formatDuration(effectiveClockIn(active), Math.max(effectiveClockIn(active), at))}`);
  };

  const card = { backgroundColor: colors.bgCard, border: `1px solid ${colors.borderLight}`, borderRadius: '12px', padding: '1.25rem' };
  const bigBtn = (bg) => ({
    width: '100%', padding: '1.1rem', fontSize: '1.15rem', fontWeight: 800, border: 'none',
    borderRadius: '10px', cursor: busy ? 'default' : 'pointer', backgroundColor: bg, color: '#fff', opacity: busy ? 0.7 : 1,
  });
  const timeOption = {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%',
    padding: '0.7rem 0.9rem', borderRadius: '8px', border: `1px solid ${colors.border}`,
    backgroundColor: colors.bgCard, color: colors.textPrimary, cursor: 'pointer', fontSize: '1rem',
  };
  const cancelLink = { background: 'none', border: 'none', color: colors.textSecondary, cursor: 'pointer', fontSize: '0.85rem', textDecoration: 'underline', padding: 0, alignSelf: 'center' };

  // Earlier-time list, Punch-style: "18:45   23m ago" rows at 15-minute marks.
  const timeList = (minMs, onPick) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '260px', overflowY: 'auto' }}>
      {earlierOptions(minMs).map((t) => (
        <button key={t} onClick={() => onPick(t)} style={timeOption}>
          <span style={{ fontWeight: 700 }}>{formatClock(t)}</span>
          <span style={{ color: colors.textSecondary, fontSize: '0.85rem' }}>{agoLabel(Date.now() - t)}</span>
        </button>
      ))}
      {earlierOptions(minMs).length === 0 && (
        <div style={{ color: colors.textSecondary, fontSize: '0.85rem', textAlign: 'center' }}>No earlier times available.</div>
      )}
    </div>
  );

  if (!currentMember) {
    return (
      <div style={{ maxWidth: '480px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button onClick={() => navigate('/')} style={{ padding: '0.5rem 0.75rem', backgroundColor: colors.bgLight, color: colors.textPrimary, border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.9rem' }}>← Back</button>
          <h1 style={{ margin: 0, fontSize: '1.5rem', color: colors.primary }}>Clock in</h1>
        </div>
        <div style={{ color: colors.textSecondary, fontSize: '0.95rem' }}>
          Clocking in needs a staff record — shifts are logged against a person on
          the staff list. Your login ({currentUser?.email}) isn't linked to one.
          Add yourself in Admin → Account → Staff with this email, or ask an
          administrator to.
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '480px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <button onClick={() => navigate('/')} style={{ padding: '0.5rem 0.75rem', backgroundColor: colors.bgLight, color: colors.textPrimary, border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.9rem' }}>← Back</button>
        <h1 style={{ margin: 0, fontSize: '1.5rem', color: colors.primary }}>Clock in</h1>
      </div>

      {toast && (
        <div style={{ padding: '0.7rem 1rem', borderRadius: '8px', backgroundColor: colors.bgLight, color: colors.textPrimary, fontSize: '0.9rem' }}>{toast}</div>
      )}

      {!shifts ? (
        <div style={{ color: colors.textSecondary, fontSize: '0.9rem' }}>Loading…</div>
      ) : active ? (
        // ---- On the clock ----
        <div style={{ ...card, textAlign: 'center' }}>
          <div style={{ fontSize: '0.85rem', color: colors.textSecondary }}>
            {currentMember.displayName} · {stationLabel(active.station)}
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: colors.textPrimary, margin: '0.35rem 0' }}>
            {formatDuration(effectiveClockIn(active))}
          </div>
          <div style={{ fontSize: '0.85rem', color: colors.textSecondary, marginBottom: '1rem' }}>
            on the clock since {formatClock(effectiveClockIn(active))}
            {active.approvalStatus === 'pending' && (
              <span style={{ display: 'block', color: colors.warning, marginTop: '0.2rem' }}>
                Earlier start ({formatClock(toMs(active.clockIn))}) awaiting approval
              </span>
            )}
          </div>
          {picker === 'out' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', textAlign: 'left' }}>
              <button onClick={() => doClockOut()} style={bigBtn(colors.error)}>Now</button>
              {timeList(effectiveClockIn(active), (t) => doClockOut(t))}
              <button onClick={resetPicker} style={cancelLink}>Cancel</button>
            </div>
          ) : (
            <button onClick={() => setPicker('out')} style={bigBtn(colors.error)}>Clock out</button>
          )}
        </div>
      ) : (
        // ---- Off the clock ----
        <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          <div style={{ fontSize: '0.95rem', color: colors.textPrimary, fontWeight: 600 }}>
            Hello {currentMember.displayName} 👋
          </div>
          {!fixedStation && (
            <div style={{ display: 'flex', gap: '0.6rem' }}>
              {['bar', 'kitchen'].map((s) => (
                <button
                  key={s}
                  onClick={() => setStation(s)}
                  style={{
                    flex: 1, padding: '0.8rem', borderRadius: '8px', fontSize: '1rem', fontWeight: 700, cursor: 'pointer',
                    border: `2px solid ${station === s ? colors.primary : colors.border}`,
                    backgroundColor: station === s ? colors.primary : colors.bgCard,
                    color: station === s ? colors.onPrimary : colors.textPrimary,
                  }}
                >
                  {stationLabel(s)}
                </button>
              ))}
            </div>
          )}
          {picker === 'in' && pendingTime ? (
            // Confirm a backdated start: time + required reason → approval.
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ fontSize: '0.95rem', color: colors.textPrimary }}>
                Start at <strong>{formatClock(pendingTime)}</strong>
                <span style={{ color: colors.textSecondary }}> ({agoLabel(Date.now() - pendingTime)})</span>
                <span style={{ display: 'block', fontSize: '0.82rem', color: colors.textSecondary, marginTop: '0.2rem' }}>
                  A manager will need to approve this.
                </span>
              </div>
              <input
                value={earlierReason}
                onChange={(e) => setEarlierReason(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && doClockIn(pendingTime, earlierReason)}
                placeholder="Reason (required)"
                autoFocus
                style={{ padding: '0.6rem', fontSize: '0.95rem', borderRadius: '8px', border: `1px solid ${colors.border}`, backgroundColor: colors.bgCard, color: colors.textPrimary }}
              />
              <button
                onClick={() => doClockIn(pendingTime, earlierReason)}
                disabled={!earlierReason.trim() || busy}
                style={{ ...bigBtn(colors.success), opacity: !earlierReason.trim() || busy ? 0.6 : 1 }}
              >
                Clock in at {formatClock(pendingTime)}
              </button>
              <button onClick={() => setPendingTime(null)} style={cancelLink}>Pick a different time</button>
            </div>
          ) : picker === 'in' ? (
            // "Now" plus earlier 15-minute marks (up to 6h back), Punch-style.
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              <button onClick={() => doClockIn(null)} style={bigBtn(colors.success)}>Now</button>
              {timeList(Date.now() - EARLIER_CAP_HRS * 3600 * 1000, (t) => setPendingTime(t))}
              <button onClick={resetPicker} style={cancelLink}>Cancel</button>
            </div>
          ) : (
            <button
              onClick={() => chosenStation && setPicker('in')}
              disabled={!chosenStation || busy}
              style={{ ...bigBtn(colors.success), opacity: !chosenStation || busy ? 0.6 : 1 }}
            >
              Clock in{fixedStation ? ` — ${stationLabel(fixedStation)}` : chosenStation ? ` — ${stationLabel(chosenStation)}` : ''}
            </button>
          )}
        </div>
      )}

      {/* Recent shifts */}
      {recent.length > 0 && (
        <div>
          <h2 style={{ fontSize: '1rem', color: colors.textPrimary, margin: '0 0 0.5rem' }}>Recent shifts</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {recent.map((s) => {
              const start = effectiveClockIn(s);
              const out = toMs(s.clockOut);
              return (
                <div key={s.id} style={{ border: `1px solid ${colors.borderLight}`, borderRadius: '10px', padding: '0.55rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.85rem', flexWrap: 'wrap' }}>
                  <span style={{ flex: '1 1 11rem', minWidth: 0, color: colors.textPrimary }}>
                    {formatDayShort(start)} · {formatClock(start)}–{formatClock(out)} · {stationLabel(s.station)}
                  </span>
                  <span style={{ color: colors.textSecondary, fontWeight: 700, flexShrink: 0 }}>{formatDuration(start, out)}</span>
                  {s.approvalStatus === 'pending' && <span style={{ color: colors.warning, fontSize: '0.75rem', fontWeight: 700, flexShrink: 0 }}>PENDING</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default Clock;
