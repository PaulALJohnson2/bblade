/**
 * RotaFullscreen — a read-only, whole-screen view of the week's rota.
 *
 * The grid fills the entire screen — day columns stretch across the width and
 * staff rows share the height. On a portrait screen (a phone held upright) it's
 * laid out in a landscape box and rotated a quarter turn so it still fills the
 * screen; turn the phone sideways and it reads naturally. On any landscape
 * screen (a laptop, or a phone turned sideways) it fills directly, upright. Tap
 * anywhere, press Escape, or hit the close button to dismiss. Not editable.
 */

import React, { useEffect, useState } from 'react';
import { getThemeColors } from '../utils/theme';
import useTheme from '../hooks/useTheme';
import RotaGrid from './RotaGrid';

function RotaFullscreen({ days, rows, highlightMemberId = null, onClose }) {
  const { isDark } = useTheme();
  const colors = getThemeColors(isDark);
  const [portrait, setPortrait] = useState(
    () => typeof window !== 'undefined' && window.innerHeight > window.innerWidth,
  );

  useEffect(() => {
    const update = () => setPortrait(window.innerHeight > window.innerWidth);
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    // Don't let the page behind scroll while the overlay is up.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  // Escape closes it.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Portrait: give the grid a landscape box (as wide as the screen is tall) and
  // rotate it a quarter turn — its rotated bounding box then equals the screen.
  // Landscape: fill the overlay directly.
  const box = portrait
    ? { width: '100vh', height: '100vw', transform: 'rotate(90deg)', transformOrigin: 'center center' }
    : { width: '100%', height: '100%' };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Rota full screen"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 6000,
        backgroundColor: colors.bg, overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
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

      <div style={{ ...box, flexShrink: 0 }}>
        <RotaGrid days={days} rows={rows} readOnly fill highlightMemberId={highlightMemberId} />
      </div>
    </div>
  );
}

export default RotaFullscreen;
