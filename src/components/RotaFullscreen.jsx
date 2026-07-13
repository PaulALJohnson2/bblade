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

import React, { useEffect, useState } from 'react';
import { getThemeColors } from '../utils/theme';
import useTheme from '../hooks/useTheme';
import RotaGrid from './RotaGrid';

function RotaFullscreen({ days, rows, highlightMemberId = null, onClose, readOnly = true, onCellClick, timeFormat = '12h' }) {
  const { isDark } = useTheme();
  const colors = getThemeColors(isDark);
  // Size the grid from the *measured* viewport, not vh/vw units — on mobile
  // those don't match the visible area (browser/PWA toolbars, safe areas) and
  // the rotated grid would spill off-screen.
  const readSize = () => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 0,
    h: typeof window !== 'undefined' ? window.innerHeight : 0,
  });
  const [size, setSize] = useState(readSize);
  // Touch devices (phones/tablets) dismiss by tapping anywhere, so the close
  // button is redundant there — only show it for mouse/desktop users.
  const [coarsePointer] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches,
  );

  useEffect(() => {
    const update = () => setSize(readSize());
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    window.visualViewport?.addEventListener('resize', update);
    // Don't let the page behind scroll while the overlay is up.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      window.visualViewport?.removeEventListener('resize', update);
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
  // Landscape: fill the screen directly. Sizes are exact pixels so nothing is
  // clipped or letterboxed.
  const portrait = size.h > size.w;
  const box = portrait
    ? { width: `${size.h}px`, height: `${size.w}px`, transform: 'rotate(90deg)', transformOrigin: 'center center' }
    : { width: `${size.w}px`, height: `${size.h}px` };

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
      {(!coarsePointer || !readOnly) && (
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
      )}

      {/* In edit mode, keep taps inside the grid from closing the overlay (only
          the close button dismisses); read-only keeps tap-anywhere-to-close. */}
      <div style={{ ...box, flexShrink: 0 }} onClick={readOnly ? undefined : (e) => e.stopPropagation()}>
        <RotaGrid
          days={days}
          rows={rows}
          readOnly={readOnly}
          fill
          highlightMemberId={highlightMemberId}
          onCellClick={onCellClick}
          timeFormat={timeFormat}
        />
      </div>
    </div>
  );
}

export default RotaFullscreen;
