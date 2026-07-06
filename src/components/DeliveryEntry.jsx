/**
 * DeliveryEntry — stepper rows for receiving an item in the units it's BOUGHT
 * in (cases, kegs, bottles, loose…). Deliveries arrive in bulk quantities, so
 * every unit gets a numeric +/- field rather than wastage's tap-tiles. The
 * parent owns the values map and the Submit/maths.
 *
 * Props: item, colors, accent, onAccent, values (object keyed by row.key), setValue(key, val)
 */

import React from 'react';
import { deliveryUnitsFor } from '../utils/deliveryUnits';

const round2 = (n) => Math.round(n * 100) / 100;

function DeliveryEntry({ item, colors, accent, onAccent, values, setValue }) {
  const { rows } = deliveryUnitsFor(item);

  const countOf = (key) => parseFloat(values?.[key]) || 0;

  const bump = (r, delta) => {
    const next = Math.max(0, countOf(r.key) + delta);
    setValue(r.key, next === 0 ? '' : (r.integer ? String(Math.round(next)) : String(round2(next))));
  };

  const counterRow = (r) => {
    const stepBtn = (delta, label) => (
      <button
        type="button" onClick={() => bump(r, delta)} tabIndex={-1}
        style={{ width: '48px', height: '48px', border: 'none', borderRadius: '8px', backgroundColor: accent, color: onAccent || '#fff', fontSize: '1.5rem', fontWeight: 'bold', cursor: 'pointer', padding: 0, lineHeight: '48px', flexShrink: 0 }}
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
          style={{ flex: 1, minWidth: 0, padding: '0.75rem', fontSize: '1.5rem', fontWeight: 'bold', textAlign: 'center', border: `2px solid ${countOf(r.key) > 0 ? accent : colors.border}`, borderRadius: '8px', backgroundColor: colors.bgCard, color: colors.textPrimary }}
        />
        {stepBtn(1, '+')}
        <span style={{ width: '90px', flexShrink: 0, fontWeight: 500, fontSize: '0.9rem', color: colors.textPrimary }}>{r.label}</span>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {rows.map(counterRow)}
    </div>
  );
}

export default DeliveryEntry;
