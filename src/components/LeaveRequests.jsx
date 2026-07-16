/**
 * LeaveRequests — manager view of staff annual-leave requests.
 *
 * Pending requests sit at the top with Approve / Decline. Approving marks those
 * days "A/L" on the rota automatically (see approveLeaveRequest); declining just
 * records the decision. Below, a short history of decided requests.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { subscribeToLeaveRequests, approveLeaveRequest, declineLeaveRequest, deleteLeaveRequest } from '../services/apiService';

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

function LeaveRequests({ venuePath, deciderName, colors, showToast }) {
  const [requests, setRequests] = useState(null);
  // { id, action } while a decision is in flight — approving writes A/L across
  // every week the leave touches, so it can take a moment on a long range.
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    const unsub = subscribeToLeaveRequests(venuePath, setRequests, (e) => showToast('Could not load leave: ' + e));
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venuePath]);

  const pending = useMemo(() => (requests || []).filter((r) => r.status === 'pending'), [requests]);
  const decided = useMemo(() => (requests || []).filter((r) => r.status !== 'pending').slice(0, 20), [requests]);

  const approve = async (r) => {
    setBusy({ id: r.id, action: 'approve' });
    const res = await approveLeaveRequest(venuePath, r, deciderName);
    setBusy(null);
    showToast(res.success ? `Approved — A/L added to the rota for ${r.memberName}` : 'Failed: ' + res.error);
  };
  const decline = async (r) => {
    setBusy({ id: r.id, action: 'decline' });
    const res = await declineLeaveRequest(venuePath, r.id, deciderName);
    setBusy(null);
    showToast(res.success ? 'Declined' : 'Failed: ' + res.error);
  };
  const remove = async (r) => {
    const res = await deleteLeaveRequest(venuePath, r.id);
    showToast(res.success ? 'Removed' : 'Failed: ' + res.error);
  };

  const card = { backgroundColor: colors.bgCard, border: `1px solid ${colors.borderLight}`, borderRadius: '12px', padding: '1rem', marginBottom: '1rem' };
  const smallBtn = (bg, fg = '#fff', dim = false) => ({ padding: '0.45rem 0.7rem', backgroundColor: bg, color: fg, border: 'none', borderRadius: '6px', cursor: dim ? 'progress' : 'pointer', fontSize: '0.8rem', fontWeight: 700, flexShrink: 0, opacity: dim ? 0.55 : 1, transition: 'opacity 0.15s' });

  if (!requests) return <div style={{ color: colors.textSecondary, fontSize: '0.9rem' }}>Loading requests…</div>;

  return (
    <div>
      <div style={{ ...card, ...(pending.length ? { borderColor: colors.warning } : {}) }}>
        <h2 style={{ margin: '0 0 0.5rem', fontSize: '1rem', color: pending.length ? colors.warning : colors.textPrimary }}>
          Pending{pending.length ? ` (${pending.length})` : ''}
        </h2>
        {pending.length === 0 ? (
          <div style={{ color: colors.textSecondary, fontSize: '0.85rem' }}>No requests waiting.</div>
        ) : pending.map((r) => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.5rem 0', borderTop: `1px solid ${colors.borderLight}`, fontSize: '0.88rem', flexWrap: 'wrap' }}>
            <span style={{ flex: 1, minWidth: '160px', color: colors.textPrimary }}>
              <strong>{r.memberName}</strong> · {rangeLabel(r.startDate, r.endDate)}
              <span style={{ color: colors.textSecondary }}> ({dayCount(r.startDate, r.endDate)}d)</span>
              {r.note && <span style={{ display: 'block', color: colors.textSecondary, fontSize: '0.8rem' }}>“{r.note}”</span>}
            </span>
            <button disabled={!!busy} onClick={() => approve(r)} style={smallBtn(colors.success, '#fff', !!busy)}>
              {busy?.id === r.id && busy.action === 'approve' ? 'Approving…' : 'Approve'}
            </button>
            <button disabled={!!busy} onClick={() => decline(r)} style={smallBtn(colors.error, '#fff', !!busy)}>
              {busy?.id === r.id && busy.action === 'decline' ? 'Declining…' : 'Decline'}
            </button>
          </div>
        ))}
      </div>

      {decided.length > 0 && (
        <div style={card}>
          <h2 style={{ margin: '0 0 0.5rem', fontSize: '1rem', color: colors.textPrimary }}>Recent decisions</h2>
          {decided.map((r) => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.45rem 0', borderTop: `1px solid ${colors.borderLight}`, fontSize: '0.85rem' }}>
              <span style={{ flex: 1, minWidth: 0, color: colors.textPrimary }}>
                <strong>{r.memberName}</strong> · {rangeLabel(r.startDate, r.endDate)}
                <span style={{ color: r.status === 'approved' ? colors.success : colors.error, fontWeight: 700 }}> · {r.status}</span>
                {r.decidedBy && <span style={{ color: colors.textMuted }}> · by {r.decidedBy}</span>}
              </span>
              <button onClick={() => remove(r)} style={{ background: 'none', border: 'none', color: colors.textSecondary, cursor: 'pointer', fontSize: '0.8rem', textDecoration: 'underline', padding: 0, flexShrink: 0 }}>Clear</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default LeaveRequests;
