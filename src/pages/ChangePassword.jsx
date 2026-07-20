/**
 * ChangePassword — forced on first sign-in after an admin-issued initial
 * password (gated by mustChangePassword in ProtectedRoute). The user picks
 * their own password in-app (no email link). On success the server clears the
 * flag, the live member subscription updates, and the app appears.
 */

import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getThemeColors } from '../utils/theme';
import useTheme from '../hooks/useTheme';

function ChangePassword() {
  const { changeMyPassword, userProfile, logout } = useAuth();
  const { isDark } = useTheme();
  const colors = getThemeColors(isDark);
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async () => {
    setError(null);
    if (pw.length < 8) { setError('Use at least 8 characters.'); return; }
    if (pw !== confirm) { setError("The passwords don't match."); return; }
    setBusy(true);
    const res = await changeMyPassword(pw);
    setBusy(false);
    // On success ProtectedRoute swaps this screen out once the member doc's
    // mustChangePassword flag clears (live). Only surface a failure.
    if (!res.success) setError(res.error || 'Could not set your password. Please try again.');
  };

  const field = {
    width: '100%', padding: '0.85rem', fontSize: '1rem', boxSizing: 'border-box',
    border: `1px solid ${colors.border}`, borderRadius: '8px',
    backgroundColor: colors.bgCard, color: colors.textPrimary,
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
      background: 'linear-gradient(135deg, #101828 0%, #1B2A4A 100%)',
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    }}>
      <div style={{ backgroundColor: colors.bgCard, borderRadius: '16px', padding: '2.25rem 2rem', maxWidth: '380px', width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
        <h1 style={{ margin: '0 0 0.25rem', color: colors.textPrimary, fontSize: '1.5rem' }}>Set your password</h1>
        <p style={{ margin: '0 0 1.5rem', color: colors.textSecondary, fontSize: '0.9rem' }}>
          Welcome{userProfile?.displayName ? `, ${userProfile.displayName}` : ''}. Choose a password
          to replace the temporary one you were given.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password" autoComplete="new-password" autoFocus style={field} />
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder="Confirm new password" autoComplete="new-password" style={field} />
          {error && <div style={{ fontSize: '0.82rem', color: colors.error }}>{error}</div>}
          <button
            onClick={submit}
            disabled={busy || !pw || !confirm}
            style={{ width: '100%', padding: '0.85rem', fontSize: '1rem', fontWeight: 700, borderRadius: '8px', border: 'none', cursor: busy || !pw || !confirm ? 'default' : 'pointer', backgroundColor: colors.primary, color: colors.onPrimary, opacity: busy || !pw || !confirm ? 0.6 : 1 }}
          >
            {busy ? 'Saving…' : 'Save password'}
          </button>
          <button onClick={logout} style={{ background: 'none', border: 'none', color: colors.textSecondary, cursor: 'pointer', fontSize: '0.82rem', textDecoration: 'underline', padding: '0.25rem', alignSelf: 'center' }}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

export default ChangePassword;
