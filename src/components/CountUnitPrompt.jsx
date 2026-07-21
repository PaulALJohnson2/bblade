/**
 * CountUnitPrompt — shown inside a stock-count card when the item has no size
 * captured yet (e.g. it came from a till/CSV import with no unit info).
 *
 * The counter picks "how is it counted?" and the size via dropdowns; on choosing
 * a size we persist wholeUnit/partUnit back to the item (so it's captured for
 * next time) and the card flips to the normal count steppers.
 *
 * Props:
 *   item     - the stock item being counted
 *   colors   - theme colours
 *   saving   - boolean, true while the assignment is being saved
 *   onAssign - ({ wholeUnit, partUnit, unit }) => void
 */

import React, { useState } from 'react';
import { templatesForSection, templateAcceptsCustomSize, customSizeMeta, customSizeFor } from '../utils/unitTemplates';
import { parseUnitInfo, formatItemDescription } from '../utils/stockUnitUtils';

function CountUnitPrompt({ item, colors, saving = false, onAssign }) {
  const [templateKey, setTemplateKey] = useState('');
  const [custom, setCustom] = useState({ wholeUnit: '', partUnit: '' });
  const [customSizeMode, setCustomSizeMode] = useState(false);
  const [customSize, setCustomSize] = useState('');
  // Selected unit for multi-unit custom sizes (e.g. weight: kg vs g).
  const [customUnit, setCustomUnit] = useState('');
  const [casePack, setCasePack] = useState('');

  // Only show measures that fit the item's section (no kegs for food, etc.).
  const TEMPLATES = templatesForSection(item.section);
  const template = TEMPLATES.find(t => t.key === templateKey) || null;
  const isCustom = templateKey === '__custom';
  const sizeMeta = template ? customSizeMeta(template.key) : null;
  // Kegs and casks are the container — "comes in a case of" only makes sense
  // for singles, so hide the row and drop any value typed before switching.
  const isBulkContainer = template && (template.key === 'keg' || template.key === 'cask' || template.key === 'postmix');
  const cp = () => { if (isBulkContainer) return 0; const n = parseInt(casePack, 10); return n > 0 ? n : 0; };

  const select = {
    width: '100%',
    padding: '0.7rem',
    fontSize: '1rem',
    border: `2px solid ${colors.border}`,
    borderRadius: '8px',
    backgroundColor: colors.bgCard,
    color: colors.textPrimary,
  };

  const previewFor = (wholeUnit, partUnit) => {
    if (!wholeUnit) return null;
    const info = parseUnitInfo({ wholeUnit, partUnit });
    const counts = info.hasPartUnit
      ? `${info.wholeLabel} + ${info.hasTenthsOption && info.partLabel !== 'Tenths' ? 'Tenths' : info.partLabel}`
      : info.wholeLabel;
    return { counts, desc: formatItemDescription({ wholeUnit, partUnit }) };
  };

  return (
    <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: `1px solid ${colors.border}`, display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      <div style={{ fontSize: '0.9rem', fontWeight: 600, color: colors.textPrimary }}>
        How is this counted?
      </div>
      <div style={{ fontSize: '0.8rem', color: colors.textSecondary, marginTop: '-0.35rem' }}>
        No size set for this item yet — pick one to count it.
      </div>

      {/* Count method */}
      <select
        value={templateKey}
        onChange={(e) => { setTemplateKey(e.target.value); setCustomSizeMode(false); setCustomSize(''); }}
        style={select}
        disabled={saving}
      >
        <option value="">Count method…</option>
        {TEMPLATES.map(t => (
          <option key={t.key} value={t.key}>{t.label}</option>
        ))}
        <option value="__custom">✎ Custom…</option>
      </select>

      {/* Optional "comes in a case of N" — set before picking a size */}
      {((template && !isBulkContainer) || isCustom) && (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.85rem', color: colors.textSecondary, whiteSpace: 'nowrap' }}>Comes in a case of</span>
          <input
            type="number" inputMode="numeric" min="0" step="1"
            value={casePack}
            onChange={(e) => setCasePack(e.target.value)}
            placeholder="optional"
            style={{ ...select, flex: 1 }}
            disabled={saving}
          />
          <span style={{ fontSize: '0.85rem', color: colors.textSecondary }}>singles</span>
        </div>
      )}

      {/* Size — appears once a method is chosen */}
      {template && (
        <select
          value={customSizeMode ? '__customsize' : ''}
          onChange={(e) => {
            if (e.target.value === '__customsize') {
              setCustomUnit(sizeMeta?.units?.[0]?.key || '');
              setCustomSizeMode(true);
              return;
            }
            setCustomSizeMode(false);
            const s = template.sizes.find(x => x.label === e.target.value);
            if (s) onAssign({ wholeUnit: s.wholeUnit, partUnit: s.partUnit, unit: s.label, casePack: cp() });
          }}
          style={select}
          disabled={saving}
        >
          <option value="" disabled>Select size…</option>
          {template.sizes.map(s => (
            <option key={s.label} value={s.label}>
              {s.label}{previewFor(s.wholeUnit, s.partUnit) ? ` — ${previewFor(s.wholeUnit, s.partUnit).counts}` : ''}
            </option>
          ))}
          {templateAcceptsCustomSize(template.key) && (
            <option value="__customsize">✎ Other size…</option>
          )}
        </select>
      )}

      {/* Typed custom size for the chosen method */}
      {template && customSizeMode && sizeMeta && (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <input
            type="number" inputMode="decimal" min="0" step="any"
            value={customSize}
            onChange={(e) => setCustomSize(e.target.value)}
            placeholder={sizeMeta.hint}
            style={{ ...select, flex: 1 }}
            disabled={saving}
            autoFocus
          />
          {sizeMeta.units ? (
            <div style={{ display: 'flex', gap: '0.3rem', flexShrink: 0 }}>
              {sizeMeta.units.map(u => {
                const active = (customUnit || sizeMeta.units[0].key) === u.key;
                return (
                  <button
                    type="button" key={u.key} onClick={() => setCustomUnit(u.key)} disabled={saving}
                    style={{
                      padding: '0.55rem 0.8rem', borderRadius: '8px',
                      border: `2px solid ${active ? colors.primary : colors.border}`,
                      backgroundColor: active ? colors.primarySoft : colors.bgCard,
                      color: active ? colors.primary : colors.textPrimary,
                      fontWeight: active ? 700 : 500, cursor: saving ? 'not-allowed' : 'pointer',
                    }}
                  >{u.label}</button>
                );
              })}
            </div>
          ) : sizeMeta.suffix ? (
            <span style={{ color: colors.textSecondary, fontWeight: 600 }}>{sizeMeta.suffix}</span>
          ) : null}
          <button
            type="button"
            disabled={saving || !(parseFloat(customSize) > 0)}
            onClick={() => {
              const u = customSizeFor(template.key, customSize, customUnit);
              if (u) onAssign({ ...u, casePack: cp() });
            }}
            style={{
              padding: '0.7rem 1rem', backgroundColor: colors.primary, color: colors.onPrimary,
              border: 'none', borderRadius: '8px', fontWeight: 600,
              cursor: (saving || !(parseFloat(customSize) > 0)) ? 'not-allowed' : 'pointer',
              opacity: (saving || !(parseFloat(customSize) > 0)) ? 0.6 : 1,
            }}
          >Set</button>
        </div>
      )}

      {/* Custom free-text */}
      {isCustom && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
            <input
              type="text" value={custom.wholeUnit}
              onChange={(e) => setCustom({ ...custom, wholeUnit: e.target.value })}
              placeholder="Whole e.g. Keg 1*50ltr"
              style={{ ...select, fontSize: '0.85rem' }}
            />
            <input
              type="text" value={custom.partUnit}
              onChange={(e) => setCustom({ ...custom, partUnit: e.target.value })}
              placeholder="Part e.g. Litre"
              style={{ ...select, fontSize: '0.85rem' }}
            />
          </div>
          <button
            type="button"
            disabled={saving || !custom.wholeUnit.trim()}
            onClick={() => onAssign({ wholeUnit: custom.wholeUnit.trim(), partUnit: custom.partUnit.trim(), unit: custom.wholeUnit.trim(), casePack: cp() })}
            style={{
              padding: '0.7rem', backgroundColor: colors.primary, color: colors.onPrimary,
              border: 'none', borderRadius: '8px', fontWeight: 600,
              cursor: (saving || !custom.wholeUnit.trim()) ? 'not-allowed' : 'pointer',
              opacity: (saving || !custom.wholeUnit.trim()) ? 0.6 : 1,
            }}
          >
            {saving ? 'Saving…' : 'Set unit'}
          </button>
        </div>
      )}

      {saving && !isCustom && (
        <div style={{ fontSize: '0.8rem', color: colors.textSecondary }}>Saving…</div>
      )}
    </div>
  );
}

export default CountUnitPrompt;
