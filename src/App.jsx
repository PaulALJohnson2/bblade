/**
 * App.jsx — Bar Blade shell.
 *
 * /login is public (Google sign-in); everything else is gated by ProtectedRoute.
 * Header: brand + live pub name, settings gear, dark-mode toggle, and a user
 * menu (sign out).
 */

import React, { Suspense, lazy, useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { StockDataProvider } from './contexts/StockDataContext';
import ProtectedRoute from './components/ProtectedRoute';
import AccountSwitcher from './components/AccountSwitcher';
import useTheme from './hooks/useTheme';
import { getThemeColors } from './utils/theme';
import Home from './pages/Home';
import './App.css';

// Keep the import factories so we can both lazy-render and preload the chunks.
const importStock = () => import('./pages/StockTaking');
const importWastage = () => import('./pages/Wastage');
const importAdmin = () => import('./pages/Admin');
const importSuper = () => import('./pages/SuperAdmin');

// Home is the landing hub — eager (in the main bundle) so it never shows a
// loading fallback. The heavier feature pages stay code-split + preloaded.
const Login = lazy(() => import('./pages/Login'));
const StockTaking = lazy(importStock);
const Wastage = lazy(importWastage);
const Admin = lazy(importAdmin);
const SuperAdmin = lazy(importSuper);

const PageLoader = () => (
  <div
    className="loading"
    style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '200px' }}
  >
    Loading...
  </div>
);

function UserMenu() {
  const { currentUser, logout } = useAuth();
  const { isDark } = useTheme();
  const colors = getThemeColors(isDark);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const name = currentUser?.displayName || currentUser?.email || 'User';
  const initial = name.charAt(0).toUpperCase();

  return (
    <div style={{ position: 'relative' }}>
      {currentUser?.photoURL ? (
        <img
          // Force HTTPS: Firebase Auth can hand back an http:// photoURL, and that
          // one insecure image downgrades the whole page to "Not Secure" (mixed content).
          src={currentUser.photoURL.replace(/^http:\/\//i, 'https://')}
          alt=""
          referrerPolicy="no-referrer"
          onClick={() => setOpen((o) => !o)}
          style={{ width: '36px', height: '36px', borderRadius: '50%', cursor: 'pointer', border: '2px solid rgba(255,255,255,0.5)' }}
        />
      ) : (
        <button
          onClick={() => setOpen((o) => !o)}
          style={{
            width: '36px', height: '36px', borderRadius: '50%', cursor: 'pointer',
            border: '2px solid rgba(255,255,255,0.5)', background: 'rgba(255,255,255,0.2)',
            color: '#fff', fontWeight: 700, fontSize: '1rem',
          }}
          aria-label="Account"
        >
          {initial}
        </button>
      )}
      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 99 }}
          />
          <div style={{
            position: 'absolute', right: 0, top: '46px', zIndex: 100,
            backgroundColor: colors.bgCard, border: `1px solid ${colors.borderLight}`,
            borderRadius: '10px', boxShadow: `0 8px 28px ${colors.shadow}`, minWidth: '200px',
            overflow: 'hidden',
          }}>
            <div style={{ padding: '0.85rem 1rem', borderBottom: `1px solid ${colors.borderLight}` }}>
              <div style={{ fontWeight: 600, color: colors.textPrimary, fontSize: '0.9rem' }}>{name}</div>
              {currentUser?.email && (
                <div style={{ color: colors.textSecondary, fontSize: '0.78rem' }}>{currentUser.email}</div>
              )}
            </div>
            <button
              onClick={() => { setOpen(false); navigate('/admin'); }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '0.75rem 1rem',
                background: 'none', border: 'none', cursor: 'pointer', color: colors.textPrimary, fontSize: '0.9rem',
                borderBottom: `1px solid ${colors.borderLight}`,
              }}
            >
              Admin
            </button>
            <button
              onClick={() => { setOpen(false); setConfirmLogout(true); }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '0.75rem 1rem',
                background: 'none', border: 'none', cursor: 'pointer', color: colors.error, fontSize: '0.9rem', fontWeight: 600,
              }}
            >
              Logout
            </button>
          </div>
        </>
      )}

      {confirmLogout && (
        <div
          onClick={() => setConfirmLogout(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 5000, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: colors.bgCard, borderRadius: '14px', boxShadow: `0 12px 40px ${colors.shadow}`, padding: '1.5rem', maxWidth: '320px', width: '100%', textAlign: 'center' }}>
            <div style={{ fontWeight: 700, fontSize: '1.1rem', color: colors.textPrimary, marginBottom: '0.35rem' }}>Log out?</div>
            <div style={{ fontSize: '0.9rem', color: colors.textSecondary, marginBottom: '1.25rem' }}>You'll need to sign in again to use the app.</div>
            <div style={{ display: 'flex', gap: '0.6rem' }}>
              <button
                onClick={() => setConfirmLogout(false)}
                style={{ flex: 1, padding: '0.8rem', backgroundColor: colors.bgLight, color: colors.textPrimary, border: 'none', borderRadius: '10px', fontWeight: 600, fontSize: '1rem', cursor: 'pointer' }}
              >Cancel</button>
              <button
                onClick={() => { setConfirmLogout(false); logout(); }}
                style={{ flex: 1, padding: '0.8rem', backgroundColor: colors.error, color: '#fff', border: 'none', borderRadius: '10px', fontWeight: 700, fontSize: '1rem', cursor: 'pointer' }}
              >Logout</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Shell() {
  const { pubName, isPlatformAdmin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const onHome = location.pathname === '/';

  // Warm the route chunks once the shell is up, so the first tap into Stock
  // Count / Wastage / Settings doesn't wait on a JS download.
  useEffect(() => {
    const preload = () => { importStock(); importWastage(); importAdmin(); };
    const ric = window.requestIdleCallback;
    if (ric) { const id = ric(preload); return () => window.cancelIdleCallback?.(id); }
    const t = setTimeout(preload, 1200);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-content">
          <div className={`header-left${isPlatformAdmin ? ' header-left--admin' : ''}`} style={{ display: 'flex', alignItems: 'center', gap: '1rem', minWidth: 0, flex: '1 1 auto' }}>
            {isPlatformAdmin && <AccountSwitcher />}
            <div
              className="header-title"
              onClick={() => navigate('/')}
              style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', cursor: 'pointer', minWidth: 0, overflow: 'hidden' }}
              title="Home"
            >
              <h1>BBlade</h1>
              <span className="header-venue" style={{ fontSize: '0.95rem', fontWeight: 500, opacity: 0.85, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {pubName || 'Stock'}
              </span>
            </div>
          </div>
          <div className="header-controls">
            {!onHome && (
              <button onClick={() => navigate('/')} className="theme-toggle" aria-label="Home" title="Home">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 11l9-8 9 8" />
                  <path d="M5 10v10a1 1 0 0 0 1 1h3v-6h6v6h3a1 1 0 0 0 1-1V10" />
                </svg>
              </button>
            )}
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="app-main">
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/stock" element={<StockTaking />} />
            <Route path="/wastage" element={<Wastage />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/super" element={<SuperAdmin />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}

function App() {
  return (
    <Router>
      <AuthProvider>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/*"
              element={
                <ProtectedRoute>
                  <StockDataProvider>
                    <Shell />
                  </StockDataProvider>
                </ProtectedRoute>
              }
            />
          </Routes>
        </Suspense>
      </AuthProvider>
    </Router>
  );
}

export default App;
