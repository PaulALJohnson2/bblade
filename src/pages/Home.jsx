/**
 * Home — the post-login dashboard. A grid of feature tiles that route to each
 * area of the app (Stock Count, Wastage today; more to come like Rotas).
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getThemeColors } from '../utils/theme';
import useTheme from '../hooks/useTheme';

function Home() {
  const navigate = useNavigate();
  const { pubName } = useAuth();
  const { isDark } = useTheme();
  const colors = getThemeColors(isDark);

  const tiles = [
    {
      key: 'stock', label: 'Stock Count', desc: 'Count your bar & kitchen stock',
      to: '/stock', accent: colors.primary, on: colors.onPrimary,
      icon: 'M3 3h18v4H3zM5 7v14h14V7M9 11h6',
    },
    {
      key: 'wastage', label: 'Wastage', desc: 'Log spillage, breakages & out-of-date',
      to: '/wastage', accent: colors.wastage, on: colors.onWastage,
      icon: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v6M14 10v6',
    },
    {
      key: 'rotas', label: 'Rotas', desc: 'Coming soon', soon: true,
      accent: colors.textMuted, on: '#fff',
      icon: 'M8 2v4M16 2v4M3 10h18M5 6h14v14H5z',
    },
  ];

  const tile = (t) => {
    const disabled = !!t.soon;
    return (
      <button
        key={t.key}
        onClick={() => !disabled && navigate(t.to)}
        disabled={disabled}
        style={{
          textAlign: 'left',
          display: 'flex', flexDirection: 'column', gap: '0.6rem',
          padding: '1.25rem',
          borderRadius: '14px',
          border: `1px solid ${colors.borderLight}`,
          backgroundColor: colors.bgCard,
          boxShadow: `0 2px 12px ${colors.shadow}`,
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.55 : 1,
          minHeight: '130px',
        }}
      >
        <div style={{
          width: '44px', height: '44px', borderRadius: '10px', flexShrink: 0,
          backgroundColor: t.accent, color: t.on,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d={t.icon} />
          </svg>
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: '1.05rem', color: colors.textPrimary, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            {t.label}
            {t.soon && <span style={{ fontSize: '0.62rem', fontWeight: 700, padding: '0.1rem 0.4rem', borderRadius: '9999px', backgroundColor: colors.bgLight, color: colors.textSecondary }}>SOON</span>}
          </div>
          <div style={{ fontSize: '0.82rem', color: colors.textSecondary, marginTop: '0.15rem' }}>{t.desc}</div>
        </div>
      </button>
    );
  };

  return (
    <div style={{ maxWidth: '640px', margin: '0 auto' }}>
      <h1 style={{ margin: '0.25rem 0 0.25rem', fontSize: '1.6rem', color: colors.textPrimary }}>
        {pubName || 'Home'}
      </h1>
      <p style={{ margin: '0 0 1.5rem', color: colors.textSecondary, fontSize: '0.9rem' }}>
        What would you like to do?
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '1rem' }}>
        {tiles.map(tile)}
      </div>
    </div>
  );
}

export default Home;
