/**
 * Leave — staff request annual leave.
 *
 * A member picks a date range (and an optional note) and submits; the request
 * lands in the manager's Admin dashboard as a pending notification. On approval
 * the days are marked "A/L" on the rota automatically. This page also lists the
 * member's own requests with their current status.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { subscribeToLeaveRequests, requestLeave } from '../services/apiService';
import { getThemeColors } from '../utils/theme';
import useTheme from '../hooks/useTheme';

const pad = (n) => String(n).padStart(2, '0');
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
// 'YYYY-MM-DD' → 'Mon 14 Jul' (noon anchor keeps the weekday correct).
const fmtDate = (iso) => (iso
  ? new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  : '');
const rangeLabel = (a, b) => (a === b || !b ? fmtDate(a) : `${fmtDate(a)} – ${fmtDate(b)}`);

const STATUS = {
  pending: { label: 'Pending', key: 'warning' },
  approved: { label: 'Approved', key: 'success' },
  declined: { label: 'Declined', key: 'error' },
};

function Leave() {
  const navigate = useNavigate();
  const { currentUser, currentMember, selectedPub } = useAuth();
  const { isDark } = useTheme();
  const colors = getThemeColors(isDark);

  const [requests, setRequests] = useState(null);
  const [startDate, setStartDate] = useState(todayISO);
  const [endDate, setEndDate] = useState(todayISO);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2800); };

  useEffect(() => {
    if (!selectedPub?.path) return undefined;
    const unsub = subscribeToLeaveRequests(selectedPub.path, setRequests, (e) => showToast('Could not load: ' + e));
    return () => unsub();
  }, [selectedPub?.path]);

  const mine = useMemo(
    () => (requests || []).filter((r) => currentMember && r.memberId === currentMember.id),
    [requests, currentMember],
  );

  const submit = async () => {
    if (busy || !currentMember) return;
    if (!startDate) { showToast('Pick a start date.'); return; }
    if (endDate && endDate < startDate) { showToast('The end date is before the start date.'); return; }
    setBusy(true);
    const res = await requestLeave(selectedPub.path, {
      memberId: currentMember.id,
      memberName: currentMember.displayName || '',
      startDate,
      endDate: endDate || startDate,
      note: note.trim(),
      byUid: currentUser?.uid || null,
    });
    setBusy(false);
    if (!res.success) { showToast('Could not send: ' + res.error); return; }
    setNote('');
    showToast('Request sent to your manager.');
  };

  const card = { backgroundColor: colors.bgCard, border: `1px solid ${colors.borderLight}`, borderRadius: '12px', padding: '1.25rem' };
  const field = { padding: '0.6rem', fontSize: '1rem', borderRadius: '8px', border: `2px solid ${colors.border}`, backgroundColor: colors.bgCard, color: colors.textPrimary };
  const labelStyle = { fontSize: '0.75rem', fontWeight: 700, color: colors.textSecondary, marginBottom: '0.25rem' };

  const backBtn = (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
      <button onClick={() => navigate('/')} style={{ padding: '0.5rem 0.75rem', backgroundColor: colors.bgLight, color: colors.textPrimary, border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.9rem' }}>← Back</button>
      <h1 style={{ margin: 0, fontSize: '1.5rem', color: colors.primary }}>Annual leave</h1>
    </div>
  );

  if (!currentMember) {
    return (
      <div style={{ maxWidth: '480px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {backBtn}
        <div style={{ color: colors.textSecondary, fontSize: '0.95rem' }}>
          Requesting leave needs a staff record. Your login ({currentUser?.email}) isn't
          linked to one — ask an administrator to add you in Admin → Account → Staff.
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '480px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {backBtn}

      {toast && (
        <div style={{ padding: '0.7rem 1rem', borderRadius: '8px', backgroundColor: colors.bgLight, color: colors.textPrimary, fontSize: '0.9rem' }}>{toast}</div>
      )}

      {/* Request form */}
      <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
        <div style={{ fontSize: '0.95rem', color: colors.textPrimary, fontWeight: 600 }}>Request time off</div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={labelStyle}>From</div>
            <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); if (endDate < e.target.value) setEndDate(e.target.value); }} style={{ ...field, width: '100%' }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={labelStyle}>To</div>
            <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} style={{ ...field, width: '100%' }} />
          </div>
        </div>
        <div>
          <div style={labelStyle}>Note (optional)</div>
          <input value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder="e.g. family holiday" style={{ ...field, width: '100%', boxSizing: 'border-box' }} />
        </div>
        <button
          onClick={submit}
          disabled={busy}
          style={{ padding: '0.9rem', fontSize: '1.05rem', fontWeight: 800, border: 'none', borderRadius: '10px', cursor: busy ? 'default' : 'pointer', backgroundColor: colors.primary, color: colors.onPrimary, opacity: busy ? 0.7 : 1 }}
        >
          Send request
        </button>
      </div>

      {/* My requests */}
      <div>
        <h2 style={{ fontSize: '1rem', color: colors.textPrimary, margin: '0 0 0.5rem' }}>My requests</h2>
        {!requests ? (
          <div style={{ color: colors.textSecondary, fontSize: '0.9rem' }}>Loading…</div>
        ) : mine.length === 0 ? (
          <div style={{ color: colors.textSecondary, fontSize: '0.9rem' }}>No requests yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {mine.map((r) => {
              const st = STATUS[r.status] || STATUS.pending;
              return (
                <div key={r.id} style={{ border: `1px solid ${colors.borderLight}`, borderRadius: '10px', padding: '0.6rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.88rem' }}>
                  <span style={{ flex: 1, minWidth: 0, color: colors.textPrimary }}>
                    {rangeLabel(r.startDate, r.endDate)}
                    {r.note && <span style={{ display: 'block', color: colors.textSecondary, fontSize: '0.8rem' }}>“{r.note}”</span>}
                  </span>
                  <span style={{ flexShrink: 0, fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.03em', color: colors[st.key], border: `1px solid ${colors[st.key]}`, borderRadius: '9999px', padding: '0.1rem 0.5rem' }}>
                    {st.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default Leave;
