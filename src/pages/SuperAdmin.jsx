/**
 * SuperAdmin — platform console (BBlade staff only).
 *
 * List every customer account, create a new one (account + first venue + one
 * owner), and switch into any account to operate it. Gated to platform admins
 * (hardcoded allowlist resolved in AuthContext).
 */

import React, { useEffect, useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { subscribeToAccounts, getVenues, createAccountWithOwner } from '../services/apiService';
import { getThemeColors } from '../utils/theme';
import useTheme from '../hooks/useTheme';

function SuperAdmin() {
  const navigate = useNavigate();
  const { isPlatformAdmin, switchTenant, activeAccountId } = useAuth();
  const { isDark } = useTheme();
  const colors = getThemeColors(isDark);

  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ accountName: '', venueName: 'Main bar', ownerName: '', ownerEmail: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [opening, setOpening] = useState(null);

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
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default SuperAdmin;
