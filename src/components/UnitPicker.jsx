/**
 * UnitPicker — choose HOW an item is counted (template) and WHAT SIZE it is (size chip).
 *
 * Independents get different stock at different times, so the goal is one-tap setup:
 * pick a count method, tap a size, done. The picker emits the canonical
 * wholeUnit/partUnit strings that parseUnitInfo() already understands — no new
 * counting engine. A "Custom" escape hatch covers the long tail.
 *
 * Props:
 *   value    - { wholeUnit, partUnit }
 *   onChange - (next: { wholeUnit, partUnit, unit }) => void
 *   colors   - theme colours from getThemeColors(isDark)
 */

import React, { useState } from 'react';
import { parseUnitInfo, formatItemDescription } from '../utils/stockUnitUtils';
import { UNIT_TEMPLATES as TEMPLATES, findUnitSelection as findSelection } from '../utils/unitTemplates';

function UnitPicker({ value = {}, onChange, colors }) {
  const initial = findSelection(value.wholeUnit, value.partUnit);
  const [templateKey, setTemplateKey] = useState(initial.templateKey);
  // Custom mode when there's a value we don't recognise, or the user opts in.
  const [custom, setCustom] = useState(
    !initial.templateKey && !!value.wholeUnit
  );

  const template = TEMPLATES.find(t => t.key === templateKey) || null;
  const selection = findSelection(value.wholeUnit, value.partUnit);

  const pickTemplate = (t) => {
    setCustom(false);
    setTemplateKey(t.key);
    // Auto-select the first size so a tap on the template already counts.
    const s = t.sizes[0];
    onChange({ wholeUnit: s.wholeUnit, partUnit: s.partUnit, unit: `${t.label.replace(/^\S+\s/, '')} ${s.label}`.trim() });
  };

  const pickSize = (s) => {
    onChange({ wholeUnit: s.wholeUnit, partUnit: s.partUnit, unit: s.label });
  };

  const chip = (active) => ({
    flexShrink: 0,
    padding: '0.5rem 0.85rem',
    borderRadius: '9999px',
    border: `1px solid ${active ? colors.primary : colors.border}`,
    backgroundColor: active ? colors.primarySoft : colors.bgCard,
    color: active ? colors.primary : colors.textPrimary,
    fontWeight: active ? 700 : 500,
    fontSize: '0.85rem',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  });

  // Live preview of how it'll count.
  const preview = value.wholeUnit ? (() => {
    const info = parseUnitInfo(value);
    const desc = formatItemDescription(value);
    const counts = info.hasPartUnit
      ? `${info.wholeLabel} + ${info.hasTenthsOption && info.partLabel !== 'Tenths' ? 'Tenths' : info.partLabel}`
      : info.wholeLabel;
    return { counts, desc };
  })() : null;

  return (
    <div>
      {/* Template chips */}
      <div style={{ display: 'flex', gap: '0.4rem', overflowX: 'auto', paddingBottom: '0.35rem', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' }}>
        {TEMPLATES.map(t => (
          <button type="button" key={t.key} onClick={() => pickTemplate(t)} style={chip(!custom && templateKey === t.key)}>
            {t.label}
          </button>
        ))}
        <button type="button" onClick={() => { setCustom(true); setTemplateKey(null); }} style={chip(custom)}>
          ✎ Custom
        </button>
      </div>

      {/* Size chips for the chosen template */}
      {!custom && template && (
        <div style={{ display: 'flex', gap: '0.4rem', overflowX: 'auto', marginTop: '0.5rem', paddingBottom: '0.35rem', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' }}>
          {template.sizes.map(s => (
            <button type="button" key={s.label} onClick={() => pickSize(s)} style={chip(selection.sizeLabel === s.label)}>
              {s.label}
            </button>
          ))}
        </div>
      )}

      {/* Custom free-text fallback */}
      {custom && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.5rem' }}>
          <input
            type="text"
            value={value.wholeUnit || ''}
            onChange={(e) => onChange({ wholeUnit: e.target.value, partUnit: value.partUnit || '', unit: e.target.value })}
            placeholder="Whole unit e.g. Keg 1*50ltr"
            style={{ padding: '0.6rem', border: `1px solid ${colors.border}`, borderRadius: '6px', backgroundColor: colors.bgCard, color: colors.textPrimary, fontSize: '0.85rem' }}
          />
          <input
            type="text"
            value={value.partUnit || ''}
            onChange={(e) => onChange({ wholeUnit: value.wholeUnit || '', partUnit: e.target.value, unit: value.wholeUnit || '' })}
            placeholder="Part unit e.g. Litre"
            style={{ padding: '0.6rem', border: `1px solid ${colors.border}`, borderRadius: '6px', backgroundColor: colors.bgCard, color: colors.textPrimary, fontSize: '0.85rem' }}
          />
        </div>
      )}

      {/* Live preview */}
      {preview && (
        <div style={{ marginTop: '0.6rem', padding: '0.5rem 0.75rem', backgroundColor: colors.bgLight, borderRadius: '6px', fontSize: '0.8rem', color: colors.textSecondary }}>
          Counts as <strong style={{ color: colors.textPrimary }}>{preview.counts}</strong>
          {preview.desc && <> · {preview.desc}</>}
        </div>
      )}
    </div>
  );
}

export default UnitPicker;
