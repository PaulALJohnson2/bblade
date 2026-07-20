/**
 * Login — email + password only.
 *
 * Accounts are provisioned from the members list with an admin-issued initial
 * password (see functions/syncMemberAuth); on first sign-in the user is forced
 * to set their own password in-app (ChangePassword). There is no self-service
 * email flow — forgotten passwords are reset by a manager in Admin (email
 * delivery, especially to iCloud, is unreliable). Password sign-in also works
 * inside the installed PWA, where an email link would not.
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getThemeColors } from '../utils/theme';
import useTheme from '../hooks/useTheme';

function Login() {
  const { loginWithPassword, currentUser, authorized, authError } = useAuth();
  const { isDark } = useTheme();
  const colors = getThemeColors(isDark);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState(null);

  // Once signed in + authorized, leave the login page.
  useEffect(() => {
    if (currentUser && authorized) navigate('/', { replace: true });
  }, [currentUser, authorized, navigate]);

  // If sign-in fails downstream (authorization/claims), drop the loader.
  useEffect(() => {
    if (authError) setBusy(false);
  }, [authError]);

  const handlePasswordLogin = async () => {
    const addr = email.trim();
    if (!addr || !password) return;
    setSigningIn(true);
    setError(null);
    const res = await loginWithPassword(addr, password);
    setSigningIn(false);
    if (res?.success) setBusy(true); // hold the loader through the claims check + redirect
    else setError(res?.error || 'Wrong email or password. Please try again.');
  };

  // While signing in / verifying access, show a loader instead of the form so it
  // doesn't bounce back before the app loads.
  if (busy && !authError) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: '1rem',
        background: 'linear-gradient(135deg, #1F3D73 0%, #2C56A4 100%)',
      }}>
        <div style={{
          width: '46px', height: '46px', border: '4px solid rgba(255,255,255,0.3)',
          borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 1s linear infinite',
        }} />
        <div style={{ color: '#fff', fontWeight: 500 }}>Signing in…</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  const field = {
    width: '100%', padding: '0.85rem', fontSize: '1rem', boxSizing: 'border-box',
    border: `1px solid ${colors.border}`, borderRadius: '8px',
    backgroundColor: colors.bgCard, color: colors.textPrimary,
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
      background: 'linear-gradient(135deg, #1F3D73 0%, #2C56A4 100%)',
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    }}>
      <div style={{
        backgroundColor: colors.bgCard, borderRadius: '16px', padding: '2.5rem 2rem',
        maxWidth: '380px', width: '100%', textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
      }}>
        <h1 style={{ margin: '0 0 0.25rem', color: colors.textPrimary, fontSize: '1.8rem' }}>BBlade</h1>
        <p style={{ margin: '0 0 1.75rem', color: colors.textSecondary, fontSize: '0.95rem' }}>
          Sign in to manage your stock
        </p>

        {authError && (
          <div style={{ backgroundColor: '#fed7d7', color: '#9b2c2c', padding: '0.75rem 1rem', borderRadius: '8px', marginBottom: '1.25rem', fontSize: '0.85rem', textAlign: 'left' }}>
            {authError}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
            autoComplete="email"
            style={field}
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handlePasswordLogin()}
            placeholder="Password"
            autoComplete="current-password"
            style={field}
          />
          {error && <div style={{ fontSize: '0.82rem', color: colors.error, textAlign: 'left' }}>{error}</div>}
          <button
            onClick={handlePasswordLogin}
            disabled={signingIn || !email.trim() || !password}
            style={{
              width: '100%', padding: '0.85rem', fontSize: '1rem', fontWeight: 600, borderRadius: '8px', border: 'none',
              cursor: signingIn || !email.trim() || !password ? 'default' : 'pointer',
              backgroundColor: colors.primary, color: colors.onPrimary,
              opacity: signingIn || !email.trim() || !password ? 0.6 : 1,
            }}
          >
            {signingIn ? 'Signing in…' : 'Sign in'}
          </button>
          <p style={{ margin: '0.5rem 0 0', fontSize: '0.8rem', color: colors.textMuted, textAlign: 'center' }}>
            First time, or forgotten your password? Ask a manager to set one up for you.
          </p>
        </div>
      </div>
    </div>
  );
}

export default Login;
