/**
 * ShiftBoard — the staff member's shift-trading surface, mounted under the
 * rota grid. There is no push/email in this app, so this board (plus the Home
 * tile badge) IS how staff find out something needs them:
 *
 *   Needs your answer — swaps a colleague has directed at you.
 *   Open shifts       — colleagues' days up for grabs ("Take this shift").
 *   Your requests     — everything you've asked for or claimed, with status,
 *                       cancellable until the manager decides.
 *
 * All sections span ALL weeks (a swap for next Saturday must surface no
 * matter which week is on screen). STARTING a request happens on the grid
 * itself — staff tap one of their own shifts (see Rota.jsx / RotaGrid's
 * onMyDayClick), so the board only carries things to react to or watch.
 */

import React, { useMemo, useState } from 'react';
import { isFreeDay, shiftRangeLabel, requestDayISO, isActionableForMember } from '../utils/rota';
import { claimGiveaway, respondToSwap, cancelShiftRequest } from '../services/apiService';

const PENDING_SET = ['open', 'claimed', 'pending_peer', 'accepted'];

// 'Thu 17 Jul' from a weekId + dayKey — for items outside the visible week.
const dayDateLabel = (weekId, dayKey) => new Date(`${requestDayISO(weekId, dayKey)}T12:00:00`)
  .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

const todayISO = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// A button label that never resizes when it flips to its busy text.
function BtnLabel({ idle, busyLabel, busy }) {
  return (
    <span style={{ display: 'grid', placeItems: 'center' }}>
      <span style={{ gridArea: '1 / 1', visibility: busy ? 'hidden' : 'visible' }}>{idle}</span>
      <span style={{ gridArea: '1 / 1', visibility: busy ? 'visible' : 'hidden' }}>{busyLabel}</span>
    </span>
  );
}

const STATUS_LABELS = {
  open: { label: 'Waiting for a taker', key: 'warning' },
  claimed: { label: 'Waiting for your manager', key: 'warning' },
  pending_peer: { label: 'Waiting for their answer', key: 'warning' },
  accepted: { label: 'Waiting for your manager', key: 'warning' },
  approved: { label: 'Approved', key: 'success' },
  declined: { label: 'Declined', key: 'error' },
  peer_declined: { label: 'They said no', key: 'error' },
  cancelled: { label: 'Cancelled', key: 'muted' },
};

function ShiftBoard({ venuePath, weekId, rows, requests, myMemberId, myName, timeFormat, colors }) {
  const [busy, setBusy] = useState(null); // { id, action }
  const [notice, setNotice] = useState(''); // transient inline feedback

  const today = todayISO();
  const myRow = rows.find((r) => r.memberId === myMemberId);

  const flash = (msg) => {
    setNotice(msg);
    setTimeout(() => setNotice(''), 3000);
  };

  const pendingReqs = useMemo(() => (requests || []).filter((r) => PENDING_SET.includes(r.status)), [requests]);

  // Swaps waiting for MY yes/no, and open give-aways I could take (any week,
  // future days only) — the same test the Home tile badge uses, so the badge
  // number always matches what's listed here.
  const needsAnswer = useMemo(
    () => pendingReqs.filter((r) => r.kind === 'swap' && isActionableForMember(r, myMemberId, today)),
    [pendingReqs, myMemberId, today],
  );
  const openShifts = useMemo(
    () => pendingReqs.filter((r) => r.kind === 'giveaway' && isActionableForMember(r, myMemberId, today)),
    [pendingReqs, myMemberId, today],
  );

  // Mine: requests I made, plus give-aways I've claimed (waiting on the manager).
  const mine = useMemo(() => (requests || [])
    .filter((r) => r.from.memberId === myMemberId || r.claimedBy?.memberId === myMemberId), [requests, myMemberId]);
  const minePending = mine.filter((r) => PENDING_SET.includes(r.status));
  const mineDecided = mine.filter((r) => !PENDING_SET.includes(r.status)).slice(0, 5);

  const take = async (r) => {
    setBusy({ id: r.id, action: 'take' });
    const res = await claimGiveaway(venuePath, r.id, { memberId: myMemberId, name: myName });
    setBusy(null);
    flash(res.success ? 'Yours if the manager agrees — sent for approval.' : res.error);
  };

  const answer = async (r, accept) => {
    setBusy({ id: r.id, action: accept ? 'accept' : 'decline' });
    const res = await respondToSwap(venuePath, r.id, accept, myName);
    setBusy(null);
    flash(res.success ? (accept ? 'Accepted — sent to your manager.' : 'Declined.') : res.error);
  };

  const cancel = async (r) => {
    if (!window.confirm('Cancel this request?')) return;
    setBusy({ id: r.id, action: 'cancel' });
    const res = await cancelShiftRequest(venuePath, r.id, myName);
    setBusy(null);
    flash(res.success ? 'Request cancelled.' : res.error);
  };

  const card = { backgroundColor: colors.bgCard, border: `1px solid ${colors.borderLight}`, borderRadius: '12px', padding: '1rem', marginBottom: '1rem' };
  const heading = (color) => ({ margin: '0 0 0.5rem', fontSize: '1rem', color });
  const rowStyle = { display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.5rem 0', borderTop: `1px solid ${colors.borderLight}`, fontSize: '0.88rem', flexWrap: 'wrap' };
  const smallBtn = (bg, fg = '#fff', dim = false) => ({ padding: '0.45rem 0.7rem', backgroundColor: bg, color: fg, border: 'none', borderRadius: '6px', cursor: dim ? 'progress' : 'pointer', fontSize: '0.8rem', fontWeight: 700, flexShrink: 0, opacity: dim ? 0.55 : 1, transition: 'opacity 0.15s' });
  const pill = (key) => {
    const color = key === 'success' ? colors.success : key === 'error' ? colors.error : key === 'muted' ? colors.textMuted : colors.warning;
    return { fontSize: '0.72rem', fontWeight: 700, color, border: `1px solid ${color}`, borderRadius: '9999px', padding: '0.05rem 0.5rem', whiteSpace: 'nowrap', flexShrink: 0 };
  };
  const timesOf = (side) => side.shifts.map((s) => shiftRangeLabel(s, timeFormat)).join(' & ');

  // Free-ness for "Take this shift" is only knowable for the week on screen
  // (other weeks' rotas aren't loaded here) — elsewhere the claim goes through
  // and the manager's approval re-validates, which is the real gate anyway.
  const cantTake = (r) => r.weekId === weekId && myRow && !isFreeDay(myRow.shifts?.[r.from.dayKey]);

  if (!myMemberId) return null;

  return (
    <div style={{ marginTop: '1rem' }}>
      {notice && (
        <div style={{ marginBottom: '0.75rem', padding: '0.5rem 0.75rem', borderRadius: '8px', backgroundColor: colors.bgLight, color: colors.textPrimary, fontSize: '0.85rem', fontWeight: 600 }}>
          {notice}
        </div>
      )}

      {needsAnswer.length > 0 && (
        <div style={{ ...card, borderColor: colors.warning }}>
          <h2 style={heading(colors.warning)}>Needs your answer</h2>
          {needsAnswer.map((r) => (
            <div key={r.id} style={rowStyle}>
              <span style={{ flex: '1 1 12rem', minWidth: 0, color: colors.textPrimary }}>
                <strong>{r.from.name}</strong> wants to swap their {dayDateLabel(r.weekId, r.from.dayKey)} ({timesOf(r.from)}) for your {dayDateLabel(r.weekId, r.target.dayKey)} ({timesOf(r.target)})
              </span>
              <button disabled={!!busy} onClick={() => answer(r, true)} style={smallBtn(colors.success, '#fff', !!busy)}>
                <BtnLabel idle="Accept" busyLabel="Accepting…" busy={busy?.id === r.id && busy.action === 'accept'} />
              </button>
              <button disabled={!!busy} onClick={() => answer(r, false)} style={smallBtn(colors.error, '#fff', !!busy)}>
                <BtnLabel idle="No thanks" busyLabel="Declining…" busy={busy?.id === r.id && busy.action === 'decline'} />
              </button>
            </div>
          ))}
        </div>
      )}

      {openShifts.length > 0 && (
        <div style={card}>
          <h2 style={heading(colors.textPrimary)}>Open shifts</h2>
          {openShifts.map((r) => {
            const blocked = cantTake(r);
            return (
              <div key={r.id} style={rowStyle}>
                <span style={{ flex: '1 1 12rem', minWidth: 0, color: colors.textPrimary }}>
                  <strong>{r.from.name}</strong> can't work {dayDateLabel(r.weekId, r.from.dayKey)} · {timesOf(r.from)}
                  {blocked && <span style={{ display: 'block', color: colors.textSecondary, fontSize: '0.8rem' }}>You're already on that day.</span>}
                </span>
                <button disabled={!!busy || blocked} onClick={() => take(r)} style={smallBtn(colors.success, '#fff', !!busy || blocked)}>
                  <BtnLabel idle="Take this shift" busyLabel="Claiming…" busy={busy?.id === r.id && busy.action === 'take'} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {(minePending.length > 0 || mineDecided.length > 0) && (
        <div style={card}>
          <h2 style={heading(colors.textPrimary)}>Your requests</h2>
          {[...minePending, ...mineDecided].map((r) => {
            const mineAsClaim = r.claimedBy?.memberId === myMemberId && r.from.memberId !== myMemberId;
            const st = STATUS_LABELS[r.status] || { label: r.status, key: 'muted' };
            return (
              <div key={r.id} style={rowStyle}>
                <span style={{ flex: '1 1 11rem', minWidth: 0, color: colors.textPrimary }}>
                  {mineAsClaim
                    ? <>Taking <strong>{r.from.name}</strong>'s {dayDateLabel(r.weekId, r.from.dayKey)} · {timesOf(r.from)}</>
                    : r.kind === 'swap'
                      ? <>Swap {dayDateLabel(r.weekId, r.from.dayKey)} with <strong>{r.target.name}</strong></>
                      : <>Offering up {dayDateLabel(r.weekId, r.from.dayKey)} · {timesOf(r.from)}</>}
                </span>
                <span style={pill(st.key)}>{st.label}</span>
                {PENDING_SET.includes(r.status) && !mineAsClaim && (
                  <button disabled={!!busy} onClick={() => cancel(r)} style={{ background: 'none', border: 'none', color: colors.textSecondary, cursor: 'pointer', fontSize: '0.8rem', textDecoration: 'underline', padding: 0, flexShrink: 0 }}>
                    <BtnLabel idle="Cancel" busyLabel="Cancelling…" busy={busy?.id === r.id && busy.action === 'cancel'} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}

export default ShiftBoard;
