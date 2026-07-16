/**
 * Requests — the manager's one queue for everything staff ask for: annual
 * leave, shift give-aways (offers) and shift swaps. Replaces the leave-only
 * LeaveRequests component.
 *
 * Three groups:
 *   Pending          — needs a decision now: leave requests, claimed offers,
 *                      peer-accepted swaps. Approve applies the change to the
 *                      rota (leave → A/L days; offers/swaps → shifts move);
 *                      approval re-validates against the live rota first and
 *                      shows why when it no longer fits.
 *   Waiting on staff — offers nobody has taken and swaps the colleague hasn't
 *                      answered. Nothing to decide, but visible (and
 *                      cancellable) so requests never vanish into a void.
 *   Recent decisions — the last 20 across both kinds, with Clear.
 */

import React, { useMemo, useState } from 'react';
import {
  approveLeaveRequest, declineLeaveRequest, deleteLeaveRequest,
  approveShiftRequest, declineShiftRequest, deleteShiftRequest,
  cancelShiftRequest,
} from '../services/apiService';
import { shiftRangeLabel, requestDayISO } from '../utils/rota';

const fmtDate = (iso) => (iso
  ? new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  : '');
const rangeLabel = (a, b) => (a === b || !b ? fmtDate(a) : `${fmtDate(a)} – ${fmtDate(b)}`);
// Inclusive whole-day span, for a quick "(3 days)" hint.
const dayCount = (a, b) => {
  if (!a) return 0;
  const start = new Date(`${a}T12:00:00`);
  const end = new Date(`${b || a}T12:00:00`);
  return Math.max(1, Math.round((end - start) / 86400000) + 1);
};
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

// Purely presentational over the two request lists — Admin owns the
// subscriptions (it needs the same data for its tile badge, so subscribing
// here too would double every listener and risk the badge disagreeing with
// the queue).
function Requests({ venuePath, deciderName, colors, showToast, members, leave, shift }) {
  const [busy, setBusy] = useState(null); // { id, action }
  const [staleById, setStaleById] = useState({}); // id → why approval no longer fits

  // A member who's been deactivated or taken off the rota can't receive
  // shifts — a row written for them would be invisible on the grid. Pre-flag
  // those requests rather than letting approval write into the void.
  const memberGone = (m) => {
    if (!m) return false;
    const rec = (members || []).find((x) => x.id === m.memberId);
    return !rec || rec.active === false || rec.onRota === false;
  };

  const today = todayISO();
  const isPast = (r) => requestDayISO(r.weekId, r.from.dayKey) < today;

  const pendingLeave = useMemo(() => (leave || []).filter((r) => r.status === 'pending'), [leave]);
  const pendingShift = useMemo(() => (shift || []).filter((r) => r.status === 'claimed' || r.status === 'accepted'), [shift]);
  const waitingShift = useMemo(() => (shift || []).filter((r) => r.status === 'open' || r.status === 'pending_peer'), [shift]);

  // One decided history across both kinds, newest decision first.
  const decided = useMemo(() => {
    const l = (leave || []).filter((r) => r.status !== 'pending').map((r) => ({ type: 'leave', r }));
    const s = (shift || []).filter((r) => !['open', 'claimed', 'pending_peer', 'accepted'].includes(r.status)).map((r) => ({ type: 'shift', r }));
    const at = ({ r }) => (r.decidedAt?.toMillis ? r.decidedAt.toMillis() : r.createdAt?.toMillis ? r.createdAt.toMillis() : 0);
    return [...l, ...s].sort((a, b) => at(b) - at(a)).slice(0, 20);
  }, [leave, shift]);

  const pendingCount = pendingLeave.length + pendingShift.length;

  const approveLeave = async (r) => {
    setBusy({ id: r.id, action: 'approve' });
    const res = await approveLeaveRequest(venuePath, r, deciderName);
    setBusy(null);
    showToast(res.success ? `Approved — A/L added to the rota for ${r.memberName}` : 'Failed: ' + res.error);
  };
  const declineLeave = async (r) => {
    setBusy({ id: r.id, action: 'decline' });
    const res = await declineLeaveRequest(venuePath, r.id, deciderName);
    setBusy(null);
    showToast(res.success ? 'Declined' : 'Failed: ' + res.error);
  };
  const approveShift = async (r) => {
    setBusy({ id: r.id, action: 'approve' });
    const res = await approveShiftRequest(venuePath, r, deciderName);
    setBusy(null);
    if (res.success) showToast('Approved — the rota has been updated');
    else if (res.stale) setStaleById((m) => ({ ...m, [r.id]: res.error }));
    else showToast('Failed: ' + res.error);
  };
  const declineShift = async (r) => {
    setBusy({ id: r.id, action: 'decline' });
    const res = await declineShiftRequest(venuePath, r.id, deciderName);
    setBusy(null);
    showToast(res.success ? 'Declined' : 'Failed: ' + res.error);
  };
  const cancelShift = async (r) => {
    if (!window.confirm('Cancel this request? The staff member will see it as cancelled.')) return;
    setBusy({ id: r.id, action: 'cancel' });
    const res = await cancelShiftRequest(venuePath, r.id, deciderName);
    setBusy(null);
    showToast(res.success ? 'Cancelled' : 'Failed: ' + res.error);
  };
  const remove = async (type, r) => {
    const res = type === 'leave' ? await deleteLeaveRequest(venuePath, r.id) : await deleteShiftRequest(venuePath, r.id);
    showToast(res.success ? 'Removed' : 'Failed: ' + res.error);
  };

  const card = { backgroundColor: colors.bgCard, border: `1px solid ${colors.borderLight}`, borderRadius: '12px', padding: '1rem', marginBottom: '1rem' };
  const smallBtn = (bg, fg = '#fff', dim = false) => ({ padding: '0.45rem 0.7rem', backgroundColor: bg, color: fg, border: 'none', borderRadius: '6px', cursor: dim ? 'progress' : 'pointer', fontSize: '0.8rem', fontWeight: 700, flexShrink: 0, opacity: dim ? 0.55 : 1, transition: 'opacity 0.15s' });
  const rowStyle = { display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.5rem 0', borderTop: `1px solid ${colors.borderLight}`, fontSize: '0.88rem', flexWrap: 'wrap' };
  const chip = (color, label) => (
    <span style={{ fontSize: '0.68rem', fontWeight: 800, letterSpacing: '0.03em', color, border: `1px solid ${color}`, borderRadius: '9999px', padding: '0.05rem 0.45rem', whiteSpace: 'nowrap', flexShrink: 0 }}>{label}</span>
  );
  const kindChip = (r) => (r.kind === 'swap' ? chip(colors.primary, 'SWAP') : chip(colors.success, 'OFFER'));
  const pastTag = <span style={{ color: colors.textMuted, fontSize: '0.78rem' }}> (past)</span>;

  // What a shift request reads as in one line, with the day + times.
  const shiftSummary = (r) => {
    const fromTimes = r.from.shifts.map((s) => shiftRangeLabel(s, '12h')).join(' & ');
    if (r.kind === 'swap') {
      const toTimes = r.target.shifts.map((s) => shiftRangeLabel(s, '12h')).join(' & ');
      return (
        <>
          <strong>{r.from.name}</strong> ⇄ <strong>{r.target.name}</strong>: {fmtDate(requestDayISO(r.weekId, r.from.dayKey))} ({fromTimes}) for {fmtDate(requestDayISO(r.target.weekId || r.weekId, r.target.dayKey))} ({toTimes})
        </>
      );
    }
    return (
      <>
        <strong>{r.from.name}</strong>'s {fmtDate(requestDayISO(r.weekId, r.from.dayKey))} ({fromTimes})
        {r.claimedBy && <> → <strong>{r.claimedBy.name}</strong></>}
      </>
    );
  };

  if (!leave || !shift) return <div style={{ color: colors.textSecondary, fontSize: '0.9rem' }}>Loading requests…</div>;

  return (
    <div>
      <div style={{ ...card, ...(pendingCount ? { borderColor: colors.warning } : {}) }}>
        <h2 style={{ margin: '0 0 0.5rem', fontSize: '1rem', color: pendingCount ? colors.warning : colors.textPrimary }}>
          Pending{pendingCount ? ` (${pendingCount})` : ''}
        </h2>
        {pendingCount === 0 ? (
          <div style={{ color: colors.textSecondary, fontSize: '0.85rem' }}>No requests waiting.</div>
        ) : (
          <>
            {pendingLeave.map((r) => (
              <div key={r.id} style={rowStyle}>
                {chip(colors.warning, 'A/L')}
                <span style={{ flex: '1 1 10rem', minWidth: 0, color: colors.textPrimary }}>
                  <strong>{r.memberName}</strong> · {rangeLabel(r.startDate, r.endDate)}
                  <span style={{ color: colors.textSecondary }}> ({dayCount(r.startDate, r.endDate)}d)</span>
                  {r.note && <span style={{ display: 'block', color: colors.textSecondary, fontSize: '0.8rem' }}>“{r.note}”</span>}
                </span>
                <button disabled={!!busy} onClick={() => approveLeave(r)} style={smallBtn(colors.success, '#fff', !!busy)}>
                  <BtnLabel idle="Approve" busyLabel="Approving…" busy={busy?.id === r.id && busy.action === 'approve'} />
                </button>
                <button disabled={!!busy} onClick={() => declineLeave(r)} style={smallBtn(colors.error, '#fff', !!busy)}>
                  <BtnLabel idle="Decline" busyLabel="Declining…" busy={busy?.id === r.id && busy.action === 'decline'} />
                </button>
              </div>
            ))}
            {pendingShift.map((r) => {
              const gone = memberGone(r.claimedBy) || memberGone(r.kind === 'swap' ? r.target : null) || memberGone(r.from);
              const stale = staleById[r.id] || (gone ? 'Someone in this request is no longer on the rota' : null);
              return (
                <div key={r.id} style={rowStyle}>
                  {kindChip(r)}
                  <span style={{ flex: '1 1 12rem', minWidth: 0, color: colors.textPrimary }}>
                    {shiftSummary(r)}{isPast(r) && pastTag}
                    {stale && (
                      <span style={{ display: 'block', color: colors.error, fontSize: '0.8rem', fontWeight: 600 }}>
                        {stale} — decline it, or ask them to request again.
                      </span>
                    )}
                  </span>
                  {!stale && (
                    <button disabled={!!busy} onClick={() => approveShift(r)} style={smallBtn(colors.success, '#fff', !!busy)}>
                      <BtnLabel idle="Approve" busyLabel="Approving…" busy={busy?.id === r.id && busy.action === 'approve'} />
                    </button>
                  )}
                  <button disabled={!!busy} onClick={() => declineShift(r)} style={smallBtn(colors.error, '#fff', !!busy)}>
                    <BtnLabel idle="Decline" busyLabel="Declining…" busy={busy?.id === r.id && busy.action === 'decline'} />
                  </button>
                </div>
              );
            })}
          </>
        )}
      </div>

      {waitingShift.length > 0 && (
        <div style={card}>
          <h2 style={{ margin: '0 0 0.5rem', fontSize: '1rem', color: colors.textPrimary }}>Waiting on staff</h2>
          {waitingShift.map((r) => (
            <div key={r.id} style={rowStyle}>
              {kindChip(r)}
              <span style={{ flex: '1 1 12rem', minWidth: 0, color: colors.textPrimary }}>
                {r.kind === 'swap'
                  ? <><strong>{r.from.name}</strong> asked <strong>{r.target.name}</strong> to swap — no answer yet</>
                  : <><strong>{r.from.name}</strong>'s {fmtDate(requestDayISO(r.weekId, r.from.dayKey))} — no one has taken it yet</>}
                {isPast(r) && pastTag}
              </span>
              <button disabled={!!busy} onClick={() => cancelShift(r)} style={{ ...smallBtn('transparent', colors.error, !!busy), border: `1px solid ${colors.error}` }}>
                <BtnLabel idle="Cancel" busyLabel="Cancelling…" busy={busy?.id === r.id && busy.action === 'cancel'} />
              </button>
            </div>
          ))}
        </div>
      )}

      {decided.length > 0 && (
        <div style={card}>
          <h2 style={{ margin: '0 0 0.5rem', fontSize: '1rem', color: colors.textPrimary }}>Recent decisions</h2>
          {decided.map(({ type, r }) => (
            <div key={`${type}-${r.id}`} style={{ ...rowStyle, padding: '0.45rem 0', fontSize: '0.85rem' }}>
              {type === 'leave' ? chip(colors.warning, 'A/L') : kindChip(r)}
              <span style={{ flex: '1 1 12rem', minWidth: 0, color: colors.textPrimary }}>
                {type === 'leave'
                  ? <><strong>{r.memberName}</strong> · {rangeLabel(r.startDate, r.endDate)}</>
                  : shiftSummary(r)}
                <span style={{
                  color: r.status === 'approved' ? colors.success : r.status === 'cancelled' ? colors.textSecondary : colors.error,
                  fontWeight: 700,
                }}> · {r.status === 'peer_declined' ? 'declined by staff' : r.status}</span>
                {r.decidedBy && <span style={{ color: colors.textMuted }}> · by {r.decidedBy}</span>}
              </span>
              <button onClick={() => remove(type, r)} style={{ background: 'none', border: 'none', color: colors.textSecondary, cursor: 'pointer', fontSize: '0.8rem', textDecoration: 'underline', padding: 0, flexShrink: 0 }}>Clear</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default Requests;
