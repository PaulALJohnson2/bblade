/**
 * RotaFullscreen — a read-only, whole-screen view of the week's rota.
 *
 * The grid fills the entire screen — day columns stretch across the width and
 * staff rows share the height. On a portrait screen (a phone held upright) it's
 * laid out in a landscape box and rotated a quarter turn so it still fills the
 * screen; turn the phone sideways and it reads naturally. On any landscape
 * screen (a laptop, or a phone turned sideways) it fills directly, upright.
 *
 * Read-only by default (staff): tap anywhere, press Escape, or the close button
 * dismisses it. When editable (admin) cells are tappable to edit and only the
 * close button / Escape dismiss it.
 */

import React, { useEffect } from 'react';
import { getThemeColors } from '../utils/theme';
import useTheme from '../hooks/useTheme';
import RotaGrid from './RotaGrid';

function RotaFullscreen({ days, rows, highlightMemberId = null, onClose, readOnly = true, onCellClick, timeFormat = '12h', focusDayKey = null }) {
  const { isDark } = useTheme();
  const colors = getThemeColors(isDark);

  useEffect(() => {
    // Escape closes it; don't let the page behind scroll while it's up.
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  // An upright, edge-to-edge sheet holding the same grid as everywhere else —
  // it fills the screen on a laptop and scrolls sideways (Staff column pinned,
  // auto-scrolled to today) on a phone. No rotation: it reads the same on every
  // device. A persistent ✕ closes it (scrolling rules out tap-to-close).
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Rota full screen"
      style={{ position: 'fixed', inset: 0, zIndex: 6000, backgroundColor: colors.bg, display: 'flex', flexDirection: 'column' }}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close full screen"
        style={{
          position: 'fixed', zIndex: 6001,
          top: 'max(0.75rem, env(safe-area-inset-top))',
          right: 'max(0.75rem, env(safe-area-inset-right))',
          width: '40px', height: '40px', borderRadius: '50%', border: 'none',
          backgroundColor: colors.bgCard, color: colors.textPrimary,
          boxShadow: `0 2px 10px ${colors.shadow}`, fontSize: '1.2rem',
          lineHeight: 1, cursor: 'pointer',
        }}
      >
        ✕
      </button>

      <div style={{ flex: 1, minHeight: 0, padding: '0.5rem' }}>
        <RotaGrid
          days={days}
          rows={rows}
          readOnly={readOnly}
          scroll
          highlightMemberId={highlightMemberId}
          onCellClick={onCellClick}
          timeFormat={timeFormat}
          focusDayKey={focusDayKey}
        />
      </div>
    </div>
  );
}

export default RotaFullscreen;
