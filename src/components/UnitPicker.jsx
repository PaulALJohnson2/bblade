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
import { templatesForSection, findUnitSelection as findSelection, templateAcceptsCustomSize, customSizeMeta, customSizeFor } from '../utils/unitTemplates';

function UnitPicker({ value = {}, onChange, colors, section }) {
  const initial = findSelection(value.wholeUnit, value.partUnit);
  const [templateKey, setTemplateKey] = useState(initial.templateKey);
  // Custom mode when there's a value we don't recognise, or the user opts in.
  const [custom, setCustom] = useState(
    !initial.templateKey && !!value.wholeUnit
  );
  const [customSizeOpen, setCustomSizeOpen] = useState(false);
  const [customSize, setCustomSize] = useState('');

  // Only offer measures that fit the section (no kegs for food, etc.).
  const TEMPLATES = templatesForSection(section);
  const template = TEMPLATES.find(t => t.key === templateKey) || null;
  const selection = findSelection(value.wholeUnit, value.partUnit);

  const pickTemplate = (t) => {
    setCustom(false);
    setCustomSizeOpen(false);
    setCustomSize('');
    setTemplateKey(t.key);
    // Auto-select the first size so a tap on the template already counts.
    const s = t.sizes[0];
    onChange({ wholeUnit: s.wholeUnit, partUnit: s.partUnit, unit: `${t.label.replace(/^\S+\s/, '')} ${s.label}`.trim(), casePack: value.casePack || 0 });
  };

  const pickSize = (s) => {
    setCustomSizeOpen(false);
    onChange({ wholeUnit: s.wholeUnit, partUnit: s.partUnit, unit: s.label, casePack: value.casePack || 0 });
  };

  const applyCustomSize = () => {
    const u = template ? customSizeFor(template.key, customSize) : null;
    if (u) onChange({ ...u, casePack: value.casePack || 0 });
  };

  // The orthogonal "comes in a case of N" size — preserves the chosen unit/label.
  const setCasePack = (v) => {
    const n = parseInt(v, 10);
    onChange({ wholeUnit: value.wholeUnit || '', partUnit: value.partUnit || '', unit: value.unit || '', casePack: n > 0 ? n : 0 });
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
        <>
          <div style={{ display: 'flex', gap: '0.4rem', overflowX: 'auto', marginTop: '0.5rem', paddingBottom: '0.35rem', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' }}>
            {template.sizes.map(s => (
              <button type="button" key={s.label} onClick={() => pickSize(s)} style={chip(!customSizeOpen && selection.sizeLabel === s.label)}>
                {s.label}
              </button>
            ))}
            {templateAcceptsCustomSize(template.key) && (
              <button type="button" onClick={() => setCustomSizeOpen(true)} style={chip(customSizeOpen)}>
                ✎ Other
              </button>
            )}
          </div>
          {customSizeOpen && customSizeMeta(template.key) && (
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginTop: '0.4rem' }}>
              <input
                type="number" inputMode="decimal" min="0" step="any"
                value={customSize}
                onChange={(e) => setCustomSize(e.target.value)}
                placeholder={customSizeMeta(template.key).hint}
                style={{ flex: 1, minWidth: 0, padding: '0.5rem', fontSize: '0.9rem', border: `1px solid ${colors.border}`, borderRadius: '6px', backgroundColor: colors.bgCard, color: colors.textPrimary }}
                autoFocus
              />
              {customSizeMeta(template.key).suffix && (
                <span style={{ color: colors.textSecondary, fontWeight: 600, fontSize: '0.85rem' }}>{customSizeMeta(template.key).suffix}</span>
              )}
              <button
                type="button"
                disabled={!(parseFloat(customSize) > 0)}
                onClick={applyCustomSize}
                style={{ flexShrink: 0, padding: '0.5rem 0.9rem', backgroundColor: colors.primary, color: colors.onPrimary, border: 'none', borderRadius: '6px', fontWeight: 600, fontSize: '0.85rem', cursor: parseFloat(customSize) > 0 ? 'pointer' : 'not-allowed', opacity: parseFloat(customSize) > 0 ? 1 : 0.6 }}
              >Set</button>
            </div>
          )}
        </>
      )}

      {/* Custom free-text fallback */}
      {custom && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.5rem' }}>
          <input
            type="text"
            value={value.wholeUnit || ''}
            onChange={(e) => onChange({ wholeUnit: e.target.value, partUnit: value.partUnit || '', unit: e.target.value, casePack: value.casePack || 0 })}
            placeholder="Whole unit e.g. Keg 1*50ltr"
            style={{ padding: '0.6rem', border: `1px solid ${colors.border}`, borderRadius: '6px', backgroundColor: colors.bgCard, color: colors.textPrimary, fontSize: '0.85rem' }}
          />
          <input
            type="text"
            value={value.partUnit || ''}
            onChange={(e) => onChange({ wholeUnit: value.wholeUnit || '', partUnit: e.target.value, unit: value.wholeUnit || '', casePack: value.casePack || 0 })}
            placeholder="Part unit e.g. Litre"
            style={{ padding: '0.6rem', border: `1px solid ${colors.border}`, borderRadius: '6px', backgroundColor: colors.bgCard, color: colors.textPrimary, fontSize: '0.85rem' }}
          />
        </div>
      )}

      {/* Optional "comes in a case of N" — adds a Cases dimension when counting */}
      {value.wholeUnit && (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.6rem' }}>
          <span style={{ fontSize: '0.82rem', color: colors.textSecondary, whiteSpace: 'nowrap' }}>Comes in a case of</span>
          <input
            type="number" inputMode="numeric" min="0" step="1"
            value={value.casePack ? String(value.casePack) : ''}
            onChange={(e) => setCasePack(e.target.value)}
            placeholder="optional"
            style={{ width: '6rem', padding: '0.45rem 0.5rem', fontSize: '0.9rem', border: `1px solid ${colors.border}`, borderRadius: '6px', backgroundColor: colors.bgCard, color: colors.textPrimary }}
          />
          <span style={{ fontSize: '0.82rem', color: colors.textSecondary }}>singles</span>
        </div>
      )}

      {/* Live preview */}
      {preview && (
        <div style={{ marginTop: '0.6rem', padding: '0.5rem 0.75rem', backgroundColor: colors.bgLight, borderRadius: '6px', fontSize: '0.8rem', color: colors.textSecondary }}>
          Counts as <strong style={{ color: colors.textPrimary }}>{value.casePack > 0 ? `Cases + ${preview.counts}` : preview.counts}</strong>
          {preview.desc && <> · {preview.desc}</>}
          {value.casePack > 0 && <> · case of {value.casePack}</>}
        </div>
      )}
    </div>
  );
}

export default UnitPicker;
