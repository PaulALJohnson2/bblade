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
  const [open, setOpen] = useState(false);
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
              onClick={() => { setOpen(false); logout(); }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '0.75rem 1rem',
                background: 'none', border: 'none', cursor: 'pointer', color: colors.textPrimary, fontSize: '0.9rem',
              }}
            >
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Shell() {
  const { pubName, isPlatformAdmin, accountName } = useAuth();
  const { isDark, toggleTheme } = useTheme();
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
          <div
            className="header-title"
            onClick={() => navigate('/')}
            style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', cursor: 'pointer' }}
            title="Home"
          >
            <h1>BBlade</h1>
            <span style={{ fontSize: '0.95rem', fontWeight: 500, opacity: 0.85 }}>
              {pubName || 'Stock'}
            </span>
          </div>
          <div className="header-controls">
            {isPlatformAdmin && (
              <button
                onClick={() => navigate('/super')}
                title="Platform admin — switch account"
                style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', maxWidth: '180px', padding: '0.35rem 0.6rem', borderRadius: '9999px', border: '1px solid rgba(255,255,255,0.5)', background: 'rgba(255,255,255,0.18)', color: '#fff', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
              >
                <span aria-hidden="true">⚑</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{accountName || 'Accounts'}</span>
              </button>
            )}
            {!onHome && (
              <button onClick={() => navigate('/')} className="theme-toggle" aria-label="Home" title="Home">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 11l9-8 9 8" />
                  <path d="M5 10v10a1 1 0 0 0 1 1h3v-6h6v6h3a1 1 0 0 0 1-1V10" />
                </svg>
              </button>
            )}
            <button onClick={() => navigate('/admin')} className="theme-toggle" aria-label="Settings" title="Settings">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
            <button
              onClick={toggleTheme}
              className="theme-toggle"
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDark ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="5" />
                  <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                  <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            </button>
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
