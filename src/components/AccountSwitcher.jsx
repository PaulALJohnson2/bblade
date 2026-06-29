/**
 * AccountSwitcher — header dropdown for platform super-admins to switch the
 * active customer account. Lists all accounts; picking one switches the tenant
 * (into that account's first venue) and returns home. Mounted only for
 * platform admins (see Shell in App.jsx).
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { subscribeToAccounts, getVenues } from '../services/apiService';
import { getThemeColors } from '../utils/theme';
import useTheme from '../hooks/useTheme';

function AccountSwitcher() {
  const navigate = useNavigate();
  const { accountName, activeAccountId, switchTenant } = useAuth();
  const { isDark } = useTheme();
  const colors = getThemeColors(isDark);

  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [switching, setSwitching] = useState(null);

  useEffect(() => {
    const unsub = subscribeToAccounts((list) => setAccounts(list || []), () => {});
    return () => unsub();
  }, []);

  const choose = async (a) => {
    if (a.id === activeAccountId) { setOpen(false); return; }
    setSwitching(a.id);
    const res = await getVenues(a.id);
    setSwitching(null);
    const venues = res.success ? res.data : [];
    setOpen(false);
    if (!venues.length) { navigate('/super'); return; } // needs a venue — manage there
    switchTenant(a.id, venues[0].id);
    navigate('/');
  };

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Switch account"
        style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', maxWidth: '190px', padding: '0.35rem 0.6rem', borderRadius: '9999px', border: '1px solid rgba(255,255,255,0.5)', background: 'rgba(255,255,255,0.18)', color: '#fff', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
      >
        <span aria-hidden="true">⚑</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{accountName || 'Accounts'}</span>
        <span aria-hidden="true" style={{ opacity: 0.8 }}>▾</span>
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 99 }} />
          <div style={{ position: 'absolute', left: 0, top: '46px', zIndex: 100, backgroundColor: colors.bgCard, border: `1px solid ${colors.borderLight}`, borderRadius: '10px', boxShadow: `0 8px 28px ${colors.shadow}`, minWidth: '240px', overflow: 'hidden' }}>
            <div style={{ padding: '0.6rem 0.85rem', borderBottom: `1px solid ${colors.borderLight}`, fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: colors.textSecondary }}>
              Switch account
            </div>
            <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
              {accounts.length === 0 ? (
                <div style={{ padding: '0.85rem', color: colors.textSecondary, fontSize: '0.85rem' }}>No accounts.</div>
              ) : accounts.map((a) => {
                const active = a.id === activeAccountId;
                return (
                  <button
                    key={a.id}
                    onClick={() => choose(a)}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', textAlign: 'left', padding: '0.7rem 0.85rem', background: active ? colors.primarySoft : 'none', border: 'none', cursor: 'pointer', color: colors.textPrimary, fontSize: '0.9rem', fontWeight: active ? 700 : 500 }}
                  >
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: active ? colors.primary : colors.textPrimary }}>{a.name || '(unnamed account)'}</span>
                    {switching === a.id ? <span style={{ fontSize: '0.78rem', color: colors.textSecondary }}>…</span> : active ? <span style={{ color: colors.primary }}>✓</span> : null}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => { setOpen(false); navigate('/super'); }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.7rem 0.85rem', borderTop: `1px solid ${colors.borderLight}`, background: 'none', border: 'none', cursor: 'pointer', color: colors.primary, fontSize: '0.85rem', fontWeight: 600 }}
            >
              Manage accounts →
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default AccountSwitcher;
