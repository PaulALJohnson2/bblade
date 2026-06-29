/**
 * WastageEntry — steppers for wasting an item in the units it's SOLD in
 * (e.g. spirit Single/Double/Bottle/Tenths, draught Pints/Half pints).
 *
 * Presentational: rows come from wastageUnitsFor(item); the parent owns the
 * values map (keyed by row.key) and the submit/maths (computeWastageQuantity).
 *
 * Props: item, colors, accent, values (object), setValue(key, val), onEnter
 */

import React from 'react';
import { wastageUnitsFor } from '../utils/wastageUnits';

function WastageEntry({ item, colors, accent, values, setValue, onEnter }) {
  const { rows } = wastageUnitsFor(item);

  const onKeyDown = (e) => { if (e.key === 'Enter' && onEnter) { e.preventDefault(); onEnter(); } };

  const step = (key, delta, integer) => {
    const current = parseFloat(values?.[key]) || 0;
    const next = Math.max(0, current + delta);
    setValue(key, next === 0 ? '' : (integer ? String(Math.round(next)) : String(next)));
  };

  const stepBtn = (onClick, label) => (
    <button
      type="button" onClick={onClick} tabIndex={-1}
      style={{
        width: '48px', height: '48px', border: 'none', borderRadius: '8px',
        backgroundColor: accent, color: colors.onWastage || '#fff',
        fontSize: '1.5rem', fontWeight: 'bold', cursor: 'pointer',
        padding: 0, lineHeight: '48px', WebkitAppearance: 'none', flexShrink: 0,
      }}
    >{label}</button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      {rows.map((r) => (
        <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {stepBtn(() => step(r.key, -1, r.integer), '−')}
          <input
            type="text"
            inputMode={r.integer ? 'numeric' : 'decimal'}
            value={values?.[r.key] ?? ''}
            onChange={(e) => {
              const v = e.target.value.replace(r.integer ? /[^0-9]/g : /[^0-9.]/g, '');
              setValue(r.key, v);
            }}
            onKeyDown={onKeyDown}
            placeholder="0"
            style={{
              flex: 1, minWidth: 0, padding: '0.75rem', fontSize: '1.5rem',
              fontWeight: 'bold', textAlign: 'center',
              border: `2px solid ${colors.border}`, borderRadius: '8px',
              backgroundColor: colors.bgCard, color: colors.textPrimary,
            }}
          />
          {stepBtn(() => step(r.key, 1, r.integer), '+')}
          <span style={{ width: '90px', flexShrink: 0, fontWeight: 500, fontSize: '0.9rem', color: colors.textPrimary }}>{r.label}</span>
        </div>
      ))}
    </div>
  );
}

export default WastageEntry;
