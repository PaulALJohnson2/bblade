/**
 * Login — passwordless email-OTP sign-in for Bar Blade.
 *
 * Two steps: enter email → we send a code → enter the code. After a successful
 * sign-in, AuthContext authorizes the account against the member allowlist and
 * redirects (or shows "access denied" here).
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getThemeColors } from '../utils/theme';
import useTheme from '../hooks/useTheme';

function Login() {
  const { requestLoginCode, confirmLoginCode, currentUser, authorized, authError } = useAuth();
  const { isDark } = useTheme();
  const colors = getThemeColors(isDark);
  const navigate = useNavigate();

  const [step, setStep] = useState('email'); // 'email' | 'code'
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup' (from requestLoginCode)
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState(null);

  // Once signed in + authorized, leave the login page.
  useEffect(() => {
    if (currentUser && authorized) navigate('/', { replace: true });
  }, [currentUser, authorized, navigate]);

  // A failed membership check (surfaced as authError) means stop the loader.
  useEffect(() => {
    if (authError) setBusy(false);
  }, [authError]);

  const handleSendCode = async (e) => {
    e?.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setLocalError(null);
    const res = await requestLoginCode(email);
    setBusy(false);
    if (res?.success) {
      setMode(res.mode);
      setStep('code');
    } else {
      setLocalError(res?.error || 'Could not send a code. Please try again.');
    }
  };

  const handleVerify = async (e) => {
    e?.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setLocalError(null);
    const res = await confirmLoginCode(email, code.trim(), mode);
    // On success, stay in the loader through the membership check + redirect;
    // AuthContext flips authorized and the effect above navigates away.
    if (!res?.success) {
      setBusy(false);
      setLocalError(res?.error || 'Invalid or expired code. Please try again.');
    }
  };

  const resetToEmail = () => {
    setStep('email');
    setCode('');
    setLocalError(null);
  };

  // While verifying / loading the app, show a loader instead of the form so it
  // doesn't briefly bounce back to the login screen before the app loads.
  if (busy && step === 'code' && !authError && !localError) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: '1rem',
        background: 'linear-gradient(135deg, #2563EB 0%, #1E40AF 100%)',
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

  const inputStyle = {
    width: '100%',
    padding: '0.85rem 1rem',
    fontSize: '1rem',
    borderRadius: '8px',
    border: `1px solid ${colors.border || '#dadce0'}`,
    backgroundColor: colors.bgInput || '#fff',
    color: colors.textPrimary,
    boxSizing: 'border-box',
    marginBottom: '0.85rem',
  };

  const buttonStyle = {
    width: '100%',
    padding: '0.85rem',
    backgroundColor: '#2563EB',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    cursor: busy ? 'default' : 'pointer',
    fontSize: '1rem',
    fontWeight: 600,
    opacity: busy ? 0.7 : 1,
  };

  const shownError = authError || localError;

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
          {step === 'email'
            ? 'Enter your email to sign in'
            : `Enter the code we sent to ${email}`}
        </p>

        {shownError && (
          <div style={{
            backgroundColor: '#fed7d7',
            color: '#9b2c2c',
            padding: '0.75rem 1rem',
            borderRadius: '8px',
            marginBottom: '1.25rem',
            fontSize: '0.85rem',
            textAlign: 'left',
          }}>
            {shownError}
          </div>
        )}

        {step === 'email' ? (
          <form onSubmit={handleSendCode}>
            <input
              type="email"
              autoComplete="email"
              autoFocus
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
              style={inputStyle}
            />
            <button type="submit" disabled={busy} style={buttonStyle}>
              {busy ? 'Sending…' : 'Send code'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerify}>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              placeholder="6-digit code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={busy}
              style={{ ...inputStyle, letterSpacing: '0.3em', textAlign: 'center' }}
            />
            <button type="submit" disabled={busy} style={buttonStyle}>
              {busy ? 'Verifying…' : 'Verify & sign in'}
            </button>
            <button
              type="button"
              onClick={resetToEmail}
              disabled={busy}
              style={{
                marginTop: '0.75rem',
                background: 'none',
                border: 'none',
                color: colors.textSecondary,
                cursor: 'pointer',
                fontSize: '0.85rem',
              }}
            >
              ← Use a different email
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default Login;
