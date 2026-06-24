/**
 * Login — Google sign-in for Bar Blade.
 *
 * After a successful sign-in, AuthContext authorizes the account against the
 * member allowlist and redirects (or shows "access denied" here).
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getThemeColors } from '../utils/theme';
import useTheme from '../hooks/useTheme';

function Login() {
  const { loginWithGoogle, currentUser, authorized, authError } = useAuth();
  const { isDark } = useTheme();
  const colors = getThemeColors(isDark);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  // Once signed in + authorized, leave the login page.
  useEffect(() => {
    if (currentUser && authorized) navigate('/', { replace: true });
  }, [currentUser, authorized, navigate]);

  const handleLogin = async () => {
    setBusy(true);
    await loginWithGoogle();
    setBusy(false);
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1rem',
      background: 'linear-gradient(135deg, #2563EB 0%, #1E40AF 100%)',
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    }}>
      <div style={{
        backgroundColor: colors.bgCard,
        borderRadius: '16px',
        padding: '2.5rem 2rem',
        maxWidth: '380px',
        width: '100%',
        textAlign: 'center',
        boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
      }}>
        <h1 style={{ margin: '0 0 0.25rem', color: colors.textPrimary, fontSize: '1.8rem' }}>
          BBlade
        </h1>
        <p style={{ margin: '0 0 1.75rem', color: colors.textSecondary, fontSize: '0.95rem' }}>
          Sign in to manage your stock
        </p>

        {authError && (
          <div style={{
            backgroundColor: '#fed7d7',
            color: '#9b2c2c',
            padding: '0.75rem 1rem',
            borderRadius: '8px',
            marginBottom: '1.25rem',
            fontSize: '0.85rem',
            textAlign: 'left',
          }}>
            {authError}
          </div>
        )}

        <button
          onClick={handleLogin}
          disabled={busy}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            width: '100%',
            padding: '0.85rem',
            backgroundColor: '#fff',
            color: '#3c4043',
            border: '1px solid #dadce0',
            borderRadius: '8px',
            cursor: busy ? 'default' : 'pointer',
            fontSize: '1rem',
            fontWeight: 500,
            opacity: busy ? 0.7 : 1,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" />
            <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" />
            <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" />
            <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
          </svg>
          {busy ? 'Signing in…' : 'Sign in with Google'}
        </button>
      </div>
    </div>
  );
}

export default Login;
