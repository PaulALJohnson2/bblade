/**
 * WastageEntry — tap-to-count entry for wasting an item in the units it's SOLD
 * in. Each sale unit (Single, Double, Bottle, glasses, pints…) is a big rounded
 * tile: tap to add one, tap the corner − to remove one, and the tile shows a
 * running ×count. Units flagged `counter` (e.g. Tenths, kg/g) get a numeric
 * +/- field instead. The parent owns the values map and the Submit/maths.
 *
 * Props: item, colors, accent, values (object keyed by row.key), setValue(key, val)
 */

import React from 'react';
import { wastageUnitsFor } from '../utils/wastageUnits';

function WastageEntry({ item, colors, accent, values, setValue }) {
  const { rows } = wastageUnitsFor(item);
  const tiles = rows.filter((r) => !r.counter);
  const counters = rows.filter((r) => r.counter);

  const countOf = (key) => parseFloat(values?.[key]) || 0;

  const bump = (r, delta) => {
    const next = Math.max(0, countOf(r.key) + delta);
    setValue(r.key, next === 0 ? '' : (r.integer ? String(Math.round(next)) : String(next)));
  };

  const tile = (r) => {
    const count = countOf(r.key);
    const active = count > 0;
    return (
      <button
        key={r.key}
        type="button"
        onClick={() => bump(r, 1)}
        style={{
          position: 'relative',
          minHeight: '92px',
          padding: '0.6rem 0.5rem',
          borderRadius: '14px',
          border: `2px solid ${active ? accent : colors.border}`,
          backgroundColor: active ? colors.wastageSoft : colors.bgCard,
          color: colors.textPrimary,
          cursor: 'pointer',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.15rem',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <span style={{ fontWeight: 700, fontSize: '1rem', textAlign: 'center', lineHeight: 1.1 }}>{r.label}</span>
        {r.hint && <span style={{ fontSize: '0.72rem', color: colors.textSecondary }}>{r.hint}</span>}
        {active && (
          <span style={{ marginTop: '0.15rem', fontSize: '1.05rem', fontWeight: 800, color: accent }}>×{count}</span>
        )}
        {active && (
          <span
            role="button"
            tabIndex={-1}
            onClick={(e) => { e.stopPropagation(); bump(r, -1); }}
            style={{
              position: 'absolute', top: '-8px', right: '-8px',
              width: '26px', height: '26px', borderRadius: '50%',
              backgroundColor: accent, color: colors.onWastage || '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '1.1rem', fontWeight: 800, lineHeight: 1,
              boxShadow: `0 1px 4px ${colors.shadow}`,
            }}
          >−</span>
        )}
      </button>
    );
  };

  const counterRow = (r) => {
    const stepBtn = (delta, label) => (
      <button
        type="button" onClick={() => bump(r, delta)} tabIndex={-1}
        style={{ width: '48px', height: '48px', border: 'none', borderRadius: '8px', backgroundColor: accent, color: colors.onWastage || '#fff', fontSize: '1.5rem', fontWeight: 'bold', cursor: 'pointer', padding: 0, lineHeight: '48px', flexShrink: 0 }}
      >{label}</button>
    );
    return (
      <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        {stepBtn(-1, '−')}
        <input
          type="text"
          inputMode={r.integer ? 'numeric' : 'decimal'}
          value={values?.[r.key] ?? ''}
          onChange={(e) => setValue(r.key, e.target.value.replace(r.integer ? /[^0-9]/g : /[^0-9.]/g, ''))}
          placeholder="0"
          style={{ flex: 1, minWidth: 0, padding: '0.75rem', fontSize: '1.5rem', fontWeight: 'bold', textAlign: 'center', border: `2px solid ${colors.border}`, borderRadius: '8px', backgroundColor: colors.bgCard, color: colors.textPrimary }}
        />
        {stepBtn(1, '+')}
        <span style={{ width: '90px', flexShrink: 0, fontWeight: 500, fontSize: '0.9rem', color: colors.textPrimary }}>{r.label}</span>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {tiles.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: '0.6rem' }}>
          {tiles.map(tile)}
        </div>
      )}
      {counters.map(counterRow)}
    </div>
  );
}

export default WastageEntry;
