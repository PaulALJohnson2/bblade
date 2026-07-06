/**
 * DeliveryEntry — stepper rows for receiving an item in the units it's BOUGHT
 * in (cases, kegs, bottles, loose…). Deliveries arrive in bulk quantities, so
 * every unit gets a numeric +/- field rather than wastage's tap-tiles. The
 * parent owns the values map and the Submit/maths.
 *
 * If the item has no case size yet (casePack), a one-time capture row lets the
 * user set "N per case" — persisted to the item via onSetCasePack, after which
 * the Cases row appears here and on the stock-count screen alike.
 *
 * Props: item, colors, accent, onAccent, values (object keyed by row.key),
 *        setValue(key, val), onSetCasePack(n)
 */

import React, { useState } from 'react';
import { deliveryUnitsFor } from '../utils/deliveryUnits';

const round2 = (n) => Math.round(n * 100) / 100;

function DeliveryEntry({ item, colors, accent, onAccent, values, setValue, onSetCasePack }) {
  const { rows, wholeLabel, canAddCasePack } = deliveryUnitsFor(item);
  const [caseSize, setCaseSize] = useState('');
  const caseSizeNum = parseInt(caseSize, 10) || 0;

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

      {/* One-time case-size capture: "Bottles per case: 12 → Set" */}
      {canAddCasePack && onSetCasePack && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.55rem 0.65rem', border: `1px dashed ${colors.border}`, borderRadius: '8px' }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: '0.85rem', color: colors.textSecondary }}>
            Delivered in cases? {wholeLabel} per case:
          </span>
          <input
            type="text"
            inputMode="numeric"
            value={caseSize}
            onChange={(e) => setCaseSize(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="12"
            style={{ width: '56px', padding: '0.5rem', fontSize: '1rem', fontWeight: 'bold', textAlign: 'center', border: `2px solid ${colors.border}`, borderRadius: '8px', backgroundColor: colors.bgCard, color: colors.textPrimary }}
          />
          <button
            type="button"
            disabled={caseSizeNum <= 0}
            onClick={() => onSetCasePack(caseSizeNum)}
            style={{ flexShrink: 0, padding: '0.5rem 0.85rem', border: 'none', borderRadius: '8px', backgroundColor: accent, color: onAccent || '#fff', fontWeight: 700, fontSize: '0.85rem', cursor: caseSizeNum > 0 ? 'pointer' : 'not-allowed', opacity: caseSizeNum > 0 ? 1 : 0.5 }}
          >Set</button>
        </div>
      )}
    </div>
  );
}

export default DeliveryEntry;
