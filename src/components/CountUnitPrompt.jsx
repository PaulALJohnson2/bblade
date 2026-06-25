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
import { UNIT_TEMPLATES } from '../utils/unitTemplates';
import { parseUnitInfo, formatItemDescription } from '../utils/stockUnitUtils';

function CountUnitPrompt({ item, colors, saving = false, onAssign }) {
  const [templateKey, setTemplateKey] = useState('');
  const [custom, setCustom] = useState({ wholeUnit: '', partUnit: '' });

  const template = UNIT_TEMPLATES.find(t => t.key === templateKey) || null;
  const isCustom = templateKey === '__custom';

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
        onChange={(e) => setTemplateKey(e.target.value)}
        style={select}
        disabled={saving}
      >
        <option value="">Count method…</option>
        {UNIT_TEMPLATES.map(t => (
          <option key={t.key} value={t.key}>{t.label}</option>
        ))}
        <option value="__custom">✎ Custom…</option>
      </select>

      {/* Size — appears once a method is chosen */}
      {template && (
        <select
          defaultValue=""
          onChange={(e) => {
            const s = template.sizes.find(x => x.label === e.target.value);
            if (s) onAssign({ wholeUnit: s.wholeUnit, partUnit: s.partUnit, unit: s.label });
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
        </select>
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
            onClick={() => onAssign({ wholeUnit: custom.wholeUnit.trim(), partUnit: custom.partUnit.trim(), unit: custom.wholeUnit.trim() })}
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
