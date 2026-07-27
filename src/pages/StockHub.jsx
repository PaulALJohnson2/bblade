/**
 * StockHub — the landing page behind Home's single "Stock" tile.
 *
 * Counting stock and taking a delivery in are the same job seen from two ends,
 * and they were competing for space on the home screen with clocking in and
 * the rota. Folding them behind one tile keeps Home about "what am I doing
 * now" and puts the stock decision one tap further in, where it belongs.
 *
 * Tiles are gated individually rather than by the hub: a staff member with
 * stock access sees Stock Count alone, a manager sees both. If a route the
 * user can't reach were shown here it would only bounce them back to Home.
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getThemeColors } from '../utils/theme';
import useTheme from '../hooks/useTheme';
import Tile from '../components/Tile';

function StockHub() {
  const navigate = useNavigate();
  const { isAdmin, canAccessStock } = useAuth();
  const admin = !!(isAdmin && isAdmin());
  const stockAccess = !!(canAccessStock && canAccessStock());
  const { isDark } = useTheme();
  const colors = getThemeColors(isDark);

  const tiles = [
    {
      key: 'count',
      label: 'Stock Count',
      desc: 'Count bar & kitchen stock',
      to: '/stock/count',
      accent: colors.primary,
      show: stockAccess,
      icon: ['M9 3h6a1 1 0 0 1 1 1v1h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2V4a1 1 0 0 1 1-1z', 'M9 5h6', 'M8 11h8', 'M8 15h8'],
    },
    {
      key: 'add',
      label: 'Add Stock',
      desc: 'Scan a delivery note or log stock in',
      to: '/deliveries',
      accent: colors.delivery,
      show: admin,
      icon: ['M2 6h11v9H2z', 'M13 9h4l3.5 3.5V15H13', 'M5 17a2 2 0 1 0 4 0a2 2 0 1 0-4 0', 'M14 17a2 2 0 1 0 4 0a2 2 0 1 0-4 0'],
    },
  ].filter((t) => t.show);

  return (
    <div style={{ maxWidth: '560px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
        <button
          onClick={() => navigate('/')}
          style={{ padding: '0.5rem 0.75rem', backgroundColor: colors.bgLight, color: colors.textPrimary, border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.9rem' }}
        >← Back</button>
        <h1 style={{ margin: 0, fontSize: '1.6rem', color: colors.textPrimary }}>Stock</h1>
      </div>
      <p style={{ margin: '0 0 1.5rem', color: colors.textSecondary, fontSize: '0.9rem' }}>
        Count what's there, or book in what's arrived.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        {tiles.map((t) => (
          <Tile
            key={t.key}
            label={t.label}
            desc={t.desc}
            icon={t.icon}
            accent={t.accent}
            onClick={() => navigate(t.to)}
          />
        ))}
      </div>
    </div>
  );
}

export default StockHub;
