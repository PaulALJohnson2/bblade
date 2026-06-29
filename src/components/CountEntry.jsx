/**
 * CountEntry — the unit steppers for entering an amount of one stock item.
 *
 * Presentational: it renders a Cases row (when the item has a case size), a
 * whole-unit row, and the tenths-or-part rows (mutually exclusive, same as the
 * stock-count screen). It reads the item's counting shape from parseUnitInfo and
 * leaves the maths + submit to the parent (use computeCount on the same values).
 *
 * Props:
 *   item    - stock item (wholeUnit/partUnit/casePack)
 *   colors  - theme colours from getThemeColors(isDark)
 *   accent  - accent colour for the +/- buttons
 *   values  - { caseQuantity, wholeQuantity, partQuantity, tenthsQuantity } (strings)
 *   set     - { setCaseQuantity, setWholeQuantity, setPartQuantity, setTenthsQuantity }
 *   onEnter - optional, called when Enter is pressed in a field
 */

import React from 'react';
import { parseUnitInfo } from '../utils/stockUnitUtils';

function CountEntry({ item, colors, accent, values, set, onEnter }) {
  const unitInfo = parseUnitInfo(item);
  const { caseQuantity, wholeQuantity, partQuantity, tenthsQuantity } = values;
  const { setCaseQuantity, setWholeQuantity, setPartQuantity, setTenthsQuantity } = set;

  const tenthsDisabled = !!partQuantity;
  const partDisabled = !!tenthsQuantity;
  const partMax = unitInfo.partLabel === 'Tenths' ? 9 : undefined;

  const stepValue = (val, setter, delta, disabled, max) => {
    if (disabled) return;
    const current = parseFloat(val) || 0;
    let next = Math.max(0, current + delta);
    if (max != null) next = Math.min(max, next);
    setter(next === 0 ? '' : next.toString());
  };

  const onKeyDown = (e) => { if (e.key === 'Enter' && onEnter) { e.preventDefault(); onEnter(); } };

  const stepBtn = (onClick, label, disabled) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      tabIndex={-1}
      style={{
        width: '48px', height: '48px', border: 'none', borderRadius: '8px',
        backgroundColor: disabled ? colors.bgLight : accent,
        color: disabled ? colors.textSecondary : colors.onWastage || '#fff',
        fontSize: '1.5rem', fontWeight: 'bold',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1, padding: 0, lineHeight: '48px',
        WebkitAppearance: 'none', flexShrink: 0,
      }}
    >{label}</button>
  );

  const numInput = (value, setter, disabled, max, integer) => (
    <input
      type="text"
      inputMode={integer ? 'numeric' : 'decimal'}
      value={value}
      onChange={(e) => {
        let v = e.target.value.replace(integer ? /[^0-9]/g : /[^0-9.]/g, '');
        if (max != null && v !== '' && parseFloat(v) > max) v = String(max);
        setter(v);
      }}
      onKeyDown={onKeyDown}
      disabled={disabled}
      placeholder="0"
      style={{
        flex: 1, minWidth: 0, padding: '0.75rem', fontSize: '1.5rem',
        fontWeight: 'bold', textAlign: 'center',
        border: `2px solid ${disabled ? 'transparent' : colors.border}`,
        borderRadius: '8px',
        backgroundColor: disabled ? colors.bgLight : colors.bgCard,
        color: disabled ? colors.textSecondary : colors.textPrimary,
        opacity: disabled ? 0.4 : 1,
      }}
    />
  );

  const row = (label, value, setter, disabled, max, integer) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      {stepBtn(() => stepValue(value, setter, -1, disabled, max), '−', disabled)}
      {numInput(value, setter, disabled, max, integer)}
      {stepBtn(() => stepValue(value, setter, 1, disabled, max), '+', disabled)}
      <span style={{ width: '64px', flexShrink: 0, fontWeight: 500, fontSize: '0.9rem', color: disabled ? colors.textSecondary : colors.textPrimary, opacity: disabled ? 0.4 : 1 }}>{label}</span>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      {unitInfo.casePack > 0 && row(`Cases (×${unitInfo.casePack})`, caseQuantity, setCaseQuantity, false, undefined, true)}
      {row(unitInfo.wholeLabel, wholeQuantity, setWholeQuantity, false)}
      {unitInfo.hasPartUnit && unitInfo.hasTenthsOption && (
        <>
          {row('Tenths', tenthsQuantity, setTenthsQuantity, tenthsDisabled, 9)}
          <div style={{ textAlign: 'center', color: colors.textSecondary, fontSize: '0.8rem', fontStyle: 'italic' }}>or</div>
          {row(unitInfo.partLabel, partQuantity, setPartQuantity, partDisabled, partMax)}
        </>
      )}
      {unitInfo.hasPartUnit && !unitInfo.hasTenthsOption &&
        row(unitInfo.partLabel, partQuantity, setPartQuantity, false, partMax)
      }
    </div>
  );
}

export default CountEntry;
