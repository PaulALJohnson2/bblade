/**
 * Home — the post-login dashboard. A 2-column grid of square tiles that route to
 * each area of the app (Stock Count, Wastage today; more to come like Rotas).
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getThemeColors } from '../utils/theme';
import useTheme from '../hooks/useTheme';
import Tile from '../components/Tile';

function Home() {
  const navigate = useNavigate();
  const { pubName, isPlatformAdmin } = useAuth();
  const { isDark } = useTheme();
  const colors = getThemeColors(isDark);

  const tiles = [
    {
      key: 'stock', label: 'Stock Count', desc: 'Count bar & kitchen stock',
      to: '/stock', accent: colors.primary,
      icon: ['M9 3h6a1 1 0 0 1 1 1v1h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2V4a1 1 0 0 1 1-1z', 'M9 5h6', 'M8 11h8', 'M8 15h8'],
    },
    {
      key: 'wastage', label: 'Wastage', desc: 'Log spillage & breakages',
      to: '/wastage', accent: colors.wastage,
      icon: ['M3 6h18', 'M8 6V4h8v2', 'M6 6l1 14h10l1-14', 'M10 10v6', 'M14 10v6'],
    },
    {
      key: 'rotas', label: 'Rotas', desc: 'Coming soon', soon: true,
      accent: colors.textMuted,
      icon: ['M8 2v4', 'M16 2v4', 'M3 10h18', 'M5 6h14v14H5z'],
    },
    isPlatformAdmin && {
      key: 'super', label: 'Platform', desc: 'Manage accounts',
      to: '/super', accent: colors.success,
      icon: ['M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z', 'M9 12l2 2 4-4'],
    },
  ].filter(Boolean);

  return (
    <div style={{ maxWidth: '560px', margin: '0 auto' }}>
      <h1 style={{ margin: '0.25rem 0 0.25rem', fontSize: '1.6rem', color: colors.textPrimary }}>
        {pubName || 'Home'}
      </h1>
      <p style={{ margin: '0 0 1.5rem', color: colors.textSecondary, fontSize: '0.9rem' }}>
        What would you like to do?
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        {tiles.map((t) => (
          <Tile
            key={t.key}
            label={t.label}
            desc={t.desc}
            icon={t.icon}
            accent={t.accent}
            badge={t.soon ? 'SOON' : undefined}
            disabled={!!t.soon}
            onClick={() => navigate(t.to)}
          />
        ))}
      </div>
    </div>
  );
}

export default Home;
