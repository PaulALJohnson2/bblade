/**
 * CountCategoryPrompt — shown inside a stock-count card when the item has an
 * AI-suggested category (from import inference) but no confirmed one.
 *
 * The counter accepts the suggestion, taps an existing category, or types one.
 * On confirm we save `category` to the item (and clear the suggestion), so the
 * filter pill for that category builds and can be used. Shown before the size
 * prompt on first count.
 *
 * Props:
 *   item               - the stock item being counted (has .categorySuggested)
 *   colors             - theme colours
 *   saving             - boolean
 *   existingCategories - string[] of categories already in use (for quick-pick)
 *   onConfirm          - (category: string) => void
 */

import React, { useState } from 'react';

function CountCategoryPrompt({ item, colors, saving = false, existingCategories = [], onConfirm }) {
  const suggestion = (item.categorySuggested || '').trim();
  const [value, setValue] = useState(suggestion);

  const input = {
    width: '100%', padding: '0.7rem', fontSize: '1rem',
    border: `2px solid ${colors.border}`, borderRadius: '8px',
    backgroundColor: colors.bgCard, color: colors.textPrimary,
  };
  const chip = (active) => ({
    flexShrink: 0, padding: '0.4rem 0.75rem', borderRadius: '9999px',
    border: `1px solid ${active ? colors.primary : colors.border}`,
    backgroundColor: active ? colors.primarySoft : colors.bgCard,
    color: active ? colors.primary : colors.textPrimary,
    fontWeight: active ? 700 : 500, fontSize: '0.8rem', cursor: 'pointer', whiteSpace: 'nowrap',
  });

  return (
    <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: `1px solid ${colors.border}`, display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      <div style={{ fontSize: '0.9rem', fontWeight: 600, color: colors.textPrimary }}>
        Confirm category
      </div>
      <div style={{ fontSize: '0.8rem', color: colors.textSecondary, marginTop: '-0.35rem' }}>
        {suggestion ? <>Suggested by AI: <strong style={{ color: colors.textPrimary }}>{suggestion}</strong>. </> : null}
        Sets the filter pill for this item.
      </div>

      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Category (e.g. Lager, Red Wine, Mains)"
        style={input}
        disabled={saving}
      />

      {existingCategories.length > 0 && (
        <div style={{ display: 'flex', gap: '0.4rem', overflowX: 'auto', paddingBottom: '0.25rem', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' }}>
          {existingCategories.slice(0, 14).map(c => (
            <button type="button" key={c} onClick={() => setValue(c)} style={chip(c === value)} disabled={saving}>
              {c}
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        disabled={saving || !value.trim()}
        onClick={() => onConfirm(value.trim())}
        style={{
          padding: '0.8rem', backgroundColor: colors.primary, color: colors.onPrimary,
          border: 'none', borderRadius: '8px', fontWeight: 700, fontSize: '1rem',
          cursor: (saving || !value.trim()) ? 'not-allowed' : 'pointer',
          opacity: (saving || !value.trim()) ? 0.6 : 1,
        }}
      >
        {saving ? 'Saving…' : 'Confirm category'}
      </button>
    </div>
  );
}

export default CountCategoryPrompt;
