/**
 * RotaFullscreen — a read-only, whole-screen view of the week's rota.
 *
 * The grid is rendered at its natural (full) size, then scaled to fill the
 * screen as large as it can. On a tall/portrait phone it's rotated a quarter
 * turn (so a wide week uses the long edge of the screen) whenever that yields a
 * bigger result — turn the phone sideways and it reads naturally. Tap anywhere,
 * press Escape, or hit the close button to dismiss. Nothing here is editable.
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getThemeColors } from '../utils/theme';
import useTheme from '../hooks/useTheme';
import RotaGrid from './RotaGrid';

function RotaFullscreen({ days, rows, highlightMemberId = null, onClose }) {
  const { isDark } = useTheme();
  const colors = getThemeColors(isDark);
  const innerRef = useRef(null);
  const [t, setT] = useState({ scale: 1, rotate: false });

  // Measure the grid at natural size and pick the transform (rotate?/scale)
  // that makes it fill the screen. Re-run on resize/orientation changes.
  useLayoutEffect(() => {
    const fit = () => {
      const el = innerRef.current;
      if (!el) return;
      const natW = el.offsetWidth;
      const natH = el.offsetHeight;
      if (!natW || !natH) return;
      const pad = 20; // breathing room around the edges
      const availW = Math.max(1, window.innerWidth - pad);
      const availH = Math.max(1, window.innerHeight - pad);
      const upright = Math.min(availW / natW, availH / natH);
      const turned = Math.min(availW / natH, availH / natW);
      const rotate = turned > upright;
      setT({ scale: rotate ? turned : upright, rotate });
    };
    fit();
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', fit);
    // Don't let the page behind scroll while the overlay is up.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('resize', fit);
      window.removeEventListener('orientationchange', fit);
      document.body.style.overflow = prevOverflow;
    };
  }, [days, rows]);

  // Escape closes it.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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

      <div style={{ flexShrink: 0, transform: `rotate(${t.rotate ? 90 : 0}deg) scale(${t.scale})`, transformOrigin: 'center center' }}>
        <div ref={innerRef} style={{ display: 'inline-block' }}>
          <RotaGrid days={days} rows={rows} readOnly highlightMemberId={highlightMemberId} />
        </div>
      </div>
    </div>
  );
}

export default RotaFullscreen;
