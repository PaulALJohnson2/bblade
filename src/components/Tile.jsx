/**
 * Tile — a square, rounded navigation button with a large faded icon watermark
 * behind a bottom-left label. Used for the Home and Settings hub grids.
 *
 * Props:
 *   label, desc   - foreground text
 *   icon          - array of SVG path `d` strings (the watermark)
 *   accent        - colour for the watermark (and a top accent bar)
 *   variant       - 'admin' renders gold-tinted, gold-bordered tiles so the
 *                   admin hub can't be mistaken for the staff home grid
 *   onClick, disabled, badge
 */

import React from 'react';
import { getThemeColors } from '../utils/theme';
import useTheme from '../hooks/useTheme';

function Tile({ label, desc, icon = [], accent, onClick, disabled = false, badge, variant }) {
  const { isDark } = useTheme();
  const colors = getThemeColors(isDark);
  const admin = variant === 'admin';

  return (
    <button
      type="button"
      onClick={() => !disabled && onClick && onClick()}
      disabled={disabled}
      style={{
        position: 'relative',
        overflow: 'hidden',
        aspectRatio: '1 / 1',
        width: '100%',
        borderRadius: '18px',
        border: admin ? `1px solid ${colors.primary}` : `1px solid ${colors.borderLight}`,
        backgroundColor: admin ? colors.primarySoft : colors.bgCard,
        boxShadow: `0 2px 12px ${colors.shadow}`,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        alignItems: 'flex-start',
        textAlign: 'left',
        padding: '1.1rem',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {/* Faded background icon */}
      <svg
        viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="1.6"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
        style={{
          position: 'absolute', right: '-12%', bottom: '-12%',
          width: '66%', height: '66%', opacity: isDark ? 0.18 : 0.12, pointerEvents: 'none',
        }}
      >
        {icon.map((d, i) => <path key={i} d={d} />)}
      </svg>

      {/* Accent bar */}
      <div style={{ position: 'absolute', top: '1.1rem', left: '1.1rem', width: '34px', height: '7px', borderRadius: '9999px', backgroundColor: accent }} />

      {/* Foreground label */}
      <div style={{ position: 'relative' }}>
        <div style={{ fontWeight: 700, fontSize: '1.1rem', color: colors.textPrimary, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          {label}
          {badge && <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '0.1rem 0.4rem', borderRadius: '9999px', backgroundColor: colors.bgLight, color: colors.textSecondary }}>{badge}</span>}
        </div>
        {desc && <div style={{ fontSize: '0.8rem', color: colors.textSecondary, marginTop: '0.15rem' }}>{desc}</div>}
      </div>
    </button>
  );
}

export default Tile;
