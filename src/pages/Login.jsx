/**
 * Login — Google, email+password, or one-time email link.
 *
 * Password is the primary email method: it signs in inside the current
 * context (crucially, inside the installed PWA — an email link always opens
 * in the system browser instead, leaving the app signed out). First-time
 * staff set a password via the "Set / reset my password" email; accounts are
 * provisioned from the members list so there's nothing to register.
 *
 * After a successful sign-in, AuthContext authorizes from the token claims
 * stamped by the server gate and redirects (or shows "access denied" here).
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getThemeColors } from '../utils/theme';
import useTheme from '../hooks/useTheme';

function Login() {
  const { loginWithGoogle, loginWithPassword, sendPasswordSetEmail, sendEmailLink, completingEmailLink, currentUser, authorized, authError } = useAuth();
  const { isDark } = useTheme();
  const colors = getThemeColors(isDark);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const [sendingLink, setSendingLink] = useState(false);
  const [linkSentTo, setLinkSentTo] = useState(null); // { kind: 'password' | 'signin', to }
  const [linkError, setLinkError] = useState(null);

  // Once signed in + authorized, leave the login page.
  useEffect(() => {
    if (currentUser && authorized) navigate('/', { replace: true });
  }, [currentUser, authorized, navigate]);

  // If sign-in succeeds, stay in the "busy" loader through the membership check
  // and redirect — don't flash the form back. Only clear busy on failure/denial.
  useEffect(() => {
    if (authError) setBusy(false);
  }, [authError]);

  const handleLogin = async () => {
    setBusy(true);
    const res = await loginWithGoogle();
    if (!res?.success) setBusy(false);
  };

  const handlePasswordLogin = async () => {
    const addr = email.trim();
    if (!addr || !password) return;
    setSigningIn(true);
    setLinkError(null);
    const res = await loginWithPassword(addr, password);
    setSigningIn(false);
    if (res?.success) setBusy(true); // hold the loader through the claims check + redirect
    else setLinkError(res?.error || 'Sign-in failed. Please try again.');
  };

  const handleSendPasswordEmail = async () => {
    const addr = email.trim();
    if (!addr) { setLinkError('Enter your email above first.'); return; }
    setSendingLink(true);
    setLinkError(null);
    const res = await sendPasswordSetEmail(addr);
    setSendingLink(false);
    if (res?.success) setLinkSentTo({ kind: 'password', to: addr });
    else setLinkError("Couldn't send the email. Please check the address and try again.");
  };

  const handleSendLink = async () => {
    const addr = email.trim();
    if (!addr) { setLinkError('Enter your email above first.'); return; }
    setSendingLink(true);
    setLinkError(null);
    const res = await sendEmailLink(addr);
    setSendingLink(false);
    if (res?.success) setLinkSentTo({ kind: 'signin', to: addr });
    else setLinkError("Couldn't send a sign-in link. Please check the address and try again.");
  };

  // While signing in / verifying access (incl. completing an email link), show a
  // loader instead of the form so it doesn't bounce back before the app loads.
  if ((busy || completingEmailLink) && !authError) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: '1rem',
        background: 'linear-gradient(135deg, #14110A 0%, #3A2E14 100%)',
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

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1rem',
      background: 'linear-gradient(135deg, #14110A 0%, #3A2E14 100%)',
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

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: '1.25rem 0' }}>
          <div style={{ flex: 1, height: '1px', backgroundColor: colors.borderLight }} />
          <span style={{ color: colors.textMuted, fontSize: '0.8rem' }}>or</span>
          <div style={{ flex: 1, height: '1px', backgroundColor: colors.borderLight }} />
        </div>

        {/* Email + password (works inside the installed app too — the session
            is created right here, unlike an email link which opens in the
            browser). First-time staff set their password via the email below. */}
        {linkSentTo ? (
          <div style={{ textAlign: 'left', fontSize: '0.88rem', color: colors.textPrimary }}>
            <p style={{ margin: '0 0 0.5rem' }}>
              {linkSentTo.kind === 'password' ? (
                <>We've emailed <strong>{linkSentTo.to}</strong> a link to set your password.
                Once it's set, come back here and sign in. (Check junk if it doesn't arrive.)</>
              ) : (
                <>We've emailed a sign-in link to <strong>{linkSentTo.to}</strong>. Open it on this
                device to finish signing in. (Check junk if it doesn't arrive.)</>
              )}
            </p>
            <button
              onClick={() => { setLinkSentTo(null); setPassword(''); }}
              style={{ background: 'none', border: 'none', color: colors.primary, cursor: 'pointer', fontSize: '0.85rem', textDecoration: 'underline', padding: 0 }}
            >
              Back to sign in
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              autoComplete="email"
              style={{
                width: '100%', padding: '0.85rem', fontSize: '1rem', boxSizing: 'border-box',
                border: `1px solid ${colors.border}`, borderRadius: '8px',
                backgroundColor: colors.bgCard, color: colors.textPrimary,
              }}
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handlePasswordLogin()}
              placeholder="Password"
              autoComplete="current-password"
              style={{
                width: '100%', padding: '0.85rem', fontSize: '1rem', boxSizing: 'border-box',
                border: `1px solid ${colors.border}`, borderRadius: '8px',
                backgroundColor: colors.bgCard, color: colors.textPrimary,
              }}
            />
            {linkError && (
              <div style={{ fontSize: '0.82rem', color: colors.error, textAlign: 'left' }}>{linkError}</div>
            )}
            <button
              onClick={handlePasswordLogin}
              disabled={signingIn || !email.trim() || !password}
              style={{
                width: '100%', padding: '0.85rem', fontSize: '1rem', fontWeight: 600,
                borderRadius: '8px', border: 'none', cursor: signingIn || !email.trim() || !password ? 'default' : 'pointer',
                backgroundColor: colors.primary, color: colors.onPrimary,
                opacity: signingIn || !email.trim() || !password ? 0.6 : 1,
              }}
            >
              {signingIn ? 'Signing in…' : 'Sign in'}
            </button>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', marginTop: '0.15rem' }}>
              <button
                onClick={handleSendPasswordEmail}
                disabled={sendingLink}
                style={{ background: 'none', border: 'none', color: colors.primary, cursor: 'pointer', fontSize: '0.82rem', textDecoration: 'underline', padding: 0 }}
              >
                Set / reset my password
              </button>
              <button
                onClick={handleSendLink}
                disabled={sendingLink}
                style={{ background: 'none', border: 'none', color: colors.textSecondary, cursor: 'pointer', fontSize: '0.82rem', textDecoration: 'underline', padding: 0 }}
              >
                Email me a one-time link
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Login;
