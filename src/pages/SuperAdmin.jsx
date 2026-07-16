/**
 * SuperAdmin — platform console (BBlade staff only).
 *
 * List every customer account, create a new one (account + first venue + one
 * owner), switch into any account to operate it, and delete one outright.
 * Gated to platform admins (the platformAdmin token claim, set server-side).
 */

import React, { useEffect, useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { subscribeToAccounts, getVenues, createAccountWithOwner } from '../services/apiService';
import { ACCOUNT_ID } from '../config/app';
import { getThemeColors } from '../utils/theme';
import useTheme from '../hooks/useTheme';

function SuperAdmin() {
  const navigate = useNavigate();
  const { isPlatformAdmin, switchTenant, activeAccountId, deleteAccount } = useAuth();
  const { isDark } = useTheme();
  const colors = getThemeColors(isDark);

  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ accountName: '', venueName: 'Main bar', ownerName: '', ownerEmail: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [opening, setOpening] = useState(null);
  // The account queued for deletion, plus what's been typed to confirm it.
  const [deleting, setDeleting] = useState(null);
  const [confirmText, setConfirmText] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    if (!isPlatformAdmin) return;
    const unsub = subscribeToAccounts((list) => { setAccounts(list || []); setLoading(false); }, () => setLoading(false));
    return () => unsub();
  }, [isPlatformAdmin]);

  if (!isPlatformAdmin) return <Navigate to="/" replace />;

  const card = { backgroundColor: colors.bgCard, border: `1px solid ${colors.borderLight}`, borderRadius: '12px', padding: '1.5rem', marginBottom: '1.5rem', boxShadow: `0 2px 12px ${colors.shadow}` };
  const input = { width: '100%', padding: '0.7rem', fontSize: '1rem', border: `2px solid ${colors.border}`, borderRadius: '8px', backgroundColor: colors.bgCard, color: colors.textPrimary, boxSizing: 'border-box', marginTop: '0.4rem' };
  const label = { fontSize: '0.78rem', fontWeight: 600, color: colors.textSecondary };
  const primaryBtn = (disabled) => ({ padding: '0.8rem 1.25rem', backgroundColor: colors.primary, color: colors.onPrimary, border: 'none', borderRadius: '8px', cursor: disabled ? 'not-allowed' : 'pointer', fontWeight: 700, opacity: disabled ? 0.6 : 1 });

  const confirmDelete = async () => {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true);
    const res = await deleteAccount(deleting.id);
    setDeleteBusy(false);
    if (!res.success) { setMsg('Could not delete: ' + res.error); return; }
    setMsg(`Deleted "${deleting.name || deleting.id}"${res.revoked ? ` — ${res.revoked} sign-in(s) revoked` : ''}.`);
    setDeleting(null);
    setConfirmText('');
  };

  const open = async (account) => {
    setOpening(account.id);
    const res = await getVenues(account.id);
    setOpening(null);
    const venues = res.success ? res.data : [];
    if (!venues.length) { setMsg(`"${account.name}" has no venue yet — recreate it via the form.`); return; }
    switchTenant(account.id, venues[0].id);
    navigate('/');
  };

  const create = async () => {
    if (!form.accountName.trim() || busy) return;
    setBusy(true); setMsg(null);
    const res = await createAccountWithOwner(form);
    setBusy(false);
    if (!res.success) { setMsg('Could not create account: ' + res.error); return; }
    setMsg(`Created "${form.accountName.trim()}". Open it to set it up.`);
    setForm({ accountName: '', venueName: 'Main bar', ownerName: '', ownerEmail: '' });
  };

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <button onClick={() => navigate('/')} style={{ padding: '0.5rem 0.75rem', backgroundColor: colors.bgLight, color: colors.textPrimary, border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.9rem' }}>← Back</button>
        <h1 style={{ margin: 0, fontSize: '1.5rem', color: colors.textPrimary }}>Platform admin</h1>
      </div>

      {msg && <div style={{ padding: '0.75rem 1rem', backgroundColor: colors.primarySoft, color: colors.primary, borderRadius: '8px', marginBottom: '1rem', fontSize: '0.9rem' }}>{msg}</div>}

      {/* Create account */}
      <div style={card}>
        <h2 style={{ margin: '0 0 0.25rem', fontSize: '1.1rem', color: colors.textPrimary }}>New account</h2>
        <p style={{ margin: '0 0 0.75rem', color: colors.textSecondary, fontSize: '0.85rem' }}>
          Creates the account, its first venue, and one owner who can then add their own staff.
        </p>
        <div style={{ display: 'grid', gap: '0.6rem' }}>
          <div><span style={label}>Account / company name</span>
            <input style={input} value={form.accountName} onChange={(e) => setForm({ ...form, accountName: e.target.value })} placeholder="e.g. The Duke and Rye" /></div>
          <div><span style={label}>First venue name</span>
            <input style={input} value={form.venueName} onChange={(e) => setForm({ ...form, venueName: e.target.value })} placeholder="e.g. Main bar" /></div>
          <div className="field-pair" style={{ display: 'grid', gap: '0.6rem' }}>
            <div><span style={label}>Owner name</span>
              <input style={input} value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} placeholder="Owner's name" /></div>
            <div><span style={label}>Owner email</span>
              <input style={input} type="email" value={form.ownerEmail} onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })} placeholder="owner@pub.com" /></div>
          </div>
          <button onClick={create} disabled={!form.accountName.trim() || busy} style={primaryBtn(!form.accountName.trim() || busy)}>
            {busy ? 'Creating…' : 'Create account'}
          </button>
        </div>
      </div>

      {/* All accounts */}
      <div style={card}>
        <h2 style={{ margin: '0 0 0.75rem', fontSize: '1.1rem', color: colors.textPrimary }}>All accounts ({accounts.length})</h2>
        {loading ? (
          <div style={{ color: colors.textSecondary, padding: '1rem', textAlign: 'center' }}>Loading…</div>
        ) : accounts.length === 0 ? (
          <div style={{ color: colors.textSecondary, padding: '1rem', textAlign: 'center' }}>No accounts yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {accounts.map((a) => {
              const active = a.id === activeAccountId;
              return (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.7rem 0.85rem', border: `1px solid ${active ? colors.primary : colors.borderLight}`, borderRadius: '8px', backgroundColor: active ? colors.primarySoft : colors.bgCard }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: colors.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name || '(unnamed account)'}</div>
                    <div style={{ fontSize: '0.72rem', color: colors.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.id}</div>
                  </div>
                  {active && <span style={{ fontSize: '0.65rem', fontWeight: 700, color: colors.primary, flexShrink: 0 }}>ACTIVE</span>}
                  <button onClick={() => open(a)} disabled={opening === a.id} style={{ flexShrink: 0, padding: '0.5rem 0.9rem', backgroundColor: active ? colors.bgCard : colors.primary, color: active ? colors.primary : colors.onPrimary, border: active ? `1px solid ${colors.primary}` : 'none', borderRadius: '8px', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer' }}>
                    {opening === a.id ? 'Opening…' : active ? 'Re-open' : 'Open'}
                  </button>
                  {/* No delete on the platform's own account — the server
                      refuses it, so don't offer it. */}
                  {a.id !== ACCOUNT_ID && (
                    <button
                      onClick={() => { setDeleting(a); setConfirmText(''); }}
                      title="Delete this account and all its data"
                      style={{ flexShrink: 0, padding: '0.5rem 0.7rem', backgroundColor: 'transparent', color: colors.errorDark, border: `1px solid ${colors.border}`, borderRadius: '8px', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Delete confirmation. Typing the name rather than clicking once: this
          wipes a real customer's whole history and there's no restore. */}
      {deleting && (
        <div
          onClick={() => { if (!deleteBusy) { setDeleting(null); setConfirmText(''); } }}
          style={{ position: 'fixed', inset: 0, zIndex: 5000, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: colors.bgCard, borderRadius: '14px', boxShadow: `0 12px 40px ${colors.shadow}`, padding: '1.5rem', maxWidth: '380px', width: '100%' }}>
            <div style={{ fontWeight: 700, fontSize: '1.1rem', color: colors.error, marginBottom: '0.5rem' }}>
              Delete “{deleting.name || deleting.id}”?
            </div>
            <div style={{ fontSize: '0.88rem', color: colors.textSecondary, marginBottom: '0.85rem', lineHeight: 1.45 }}>
              This permanently removes the account, every venue under it, and all
              their stock, rotas, timesheets and staff records. Everyone in it
              loses their sign-in. It cannot be undone.
            </div>
            <label style={{ fontSize: '0.78rem', fontWeight: 600, color: colors.textSecondary }}>
              Type <strong style={{ color: colors.textPrimary }}>{deleting.name || deleting.id}</strong> to confirm
            </label>
            <input
              autoFocus
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              style={{ width: '100%', padding: '0.7rem', fontSize: '1rem', border: `2px solid ${colors.border}`, borderRadius: '8px', backgroundColor: colors.bgCard, color: colors.textPrimary, boxSizing: 'border-box', marginTop: '0.4rem', marginBottom: '1rem' }}
            />
            <div style={{ display: 'flex', gap: '0.6rem' }}>
              <button
                onClick={() => { setDeleting(null); setConfirmText(''); }}
                disabled={deleteBusy}
                style={{ flex: 1, padding: '0.8rem', backgroundColor: colors.bgLight, color: colors.textPrimary, border: 'none', borderRadius: '10px', fontWeight: 600, fontSize: '1rem', cursor: 'pointer' }}
              >Cancel</button>
              <button
                onClick={confirmDelete}
                disabled={deleteBusy || confirmText.trim() !== (deleting.name || deleting.id)}
                style={{
                  flex: 1, padding: '0.8rem', backgroundColor: colors.error, color: '#fff', border: 'none',
                  borderRadius: '10px', fontWeight: 700, fontSize: '1rem',
                  cursor: confirmText.trim() === (deleting.name || deleting.id) && !deleteBusy ? 'pointer' : 'not-allowed',
                  opacity: confirmText.trim() === (deleting.name || deleting.id) && !deleteBusy ? 1 : 0.5,
                }}
              >{deleteBusy ? 'Deleting…' : 'Delete'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SuperAdmin;
