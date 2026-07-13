/**
 * Home — the post-login dashboard. A 2-column grid of square tiles that route to
 * each area of the app.
 *
 * Owners/managers see every tile. Normal staff only see day-to-day features:
 * Wastage, and Rota once at least one week has been published (before that
 * there's nothing for them to look at).
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { hasPublishedRota } from '../services/apiService';
import { getThemeColors } from '../utils/theme';
import useTheme from '../hooks/useTheme';
import Tile from '../components/Tile';

// Home is the staff-facing hub: only day-to-day staff features live here.
// Owner/manager features (sales, reports, settings) belong on /admin.
function Home() {
  const navigate = useNavigate();
  const { pubName, isAdmin, selectedPub, currentMember } = useAuth();
  const admin = !!(isAdmin && isAdmin());
  // Strict (no loading-grace) so the tile pops in rather than flashing away.
  const stockAccess = admin || !!currentMember?.withStock;
  const { isDark } = useTheme();
  const colors = getThemeColors(isDark);

  // Staff only get the Rota tile once a rota has actually been published.
  const [rotaLive, setRotaLive] = useState(false);
  useEffect(() => {
    if (admin || !selectedPub?.path) return;
    let alive = true;
    hasPublishedRota(selectedPub.path).then((res) => {
      if (alive && res.success) setRotaLive(res.data);
    });
    return () => { alive = false; };
  }, [admin, selectedPub?.path]);

  // Clocking in needs a staff record on the rota (shifts are stored per
  // member). Admins always see the tile — the Clock page explains how to add
  // themselves to staff if they lack a member record.
  const canClock = admin || (!!currentMember && currentMember.onRota !== false);

  const tiles = [
    {
      key: 'clock', label: 'Clock In', desc: 'Punch in & out of shifts',
      to: '/clock', accent: colors.success, needsRotaMember: true,
      icon: ['M12 22a10 10 0 1 0 0-20a10 10 0 0 0 0 20', 'M12 6v6l4 2'],
    },
    {
      key: 'stock', label: 'Stock Count', desc: 'Count bar & kitchen stock',
      to: '/stock', accent: colors.primary, needsStockAccess: true,
      icon: ['M9 3h6a1 1 0 0 1 1 1v1h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2V4a1 1 0 0 1 1-1z', 'M9 5h6', 'M8 11h8', 'M8 15h8'],
    },
    {
      key: 'wastage', label: 'Wastage', desc: 'Log spillage & breakages',
      to: '/wastage', accent: colors.wastage,
      icon: ['M3 6h18', 'M8 6V4h8v2', 'M6 6l1 14h10l1-14', 'M10 10v6', 'M14 10v6'],
    },
    {
      key: 'deliveries', label: 'Deliveries', desc: 'Log stock coming in',
      to: '/deliveries', accent: colors.delivery, adminOnly: true,
      icon: ['M2 6h11v9H2z', 'M13 9h4l3.5 3.5V15H13', 'M5 17a2 2 0 1 0 4 0a2 2 0 1 0-4 0', 'M14 17a2 2 0 1 0 4 0a2 2 0 1 0-4 0'],
    },
    {
      key: 'rota', label: 'Rota', desc: 'See your shifts',
      to: '/rota', accent: colors.primary, staffNeedsPublishedRota: true,
      icon: ['M8 2v4', 'M16 2v4', 'M3 10h18', 'M5 6h14v14H5z'],
    },
    {
      key: 'leave', label: 'Annual Leave', desc: 'Request time off',
      to: '/leave', accent: colors.warning, needsMember: true,
      icon: ['M12 3v2', 'M12 19v2', 'M4.2 4.2l1.4 1.4', 'M18.4 18.4l1.4 1.4', 'M3 12h2', 'M19 12h2', 'M4.2 19.8l1.4-1.4', 'M18.4 5.6l1.4-1.4', 'M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8z'],
    },
  ];

  const visibleTiles = tiles.filter((t) => {
    if (t.needsRotaMember) return canClock;
    if (t.needsStockAccess) return stockAccess;
    if (t.needsMember) return !!currentMember;
    if (admin) return true;
    if (t.adminOnly) return false;
    if (t.staffNeedsPublishedRota) return rotaLive;
    return true;
  });

  return (
    <div style={{ maxWidth: '560px', margin: '0 auto' }}>
      <h1 style={{ margin: '0.25rem 0 0.25rem', fontSize: '1.6rem', color: colors.textPrimary }}>
        {pubName || 'Home'}
      </h1>
      <p style={{ margin: '0 0 1.5rem', color: colors.textSecondary, fontSize: '0.9rem' }}>
        What would you like to do?
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        {visibleTiles.map((t) => (
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
