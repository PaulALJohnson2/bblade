/**
 * CaseSizeSuggestions — fill in the "comes in a case of N" that most stock
 * lists arrive without.
 *
 * The case size is what lets a delivery line reading "1 CA" become a number of
 * bottles, so it's worth having — but chasing it is list-tidying, and it sat on
 * the Add Stock screen telling anyone booking in a delivery that forty-eight
 * items needed attention. Wrong moment, wrong person. It belongs with the other
 * stock-list housekeeping.
 *
 * Suggestions come from what the list already knows about each item — its name,
 * one-unit size and category — and are editable before anything is applied.
 * Nothing is written until a human has looked: the model is guessing at trade
 * conventions, and it can only ever be a starting point.
 *
 * Self-contained, including its own confirmation. Depending on the host page
 * to surface a message means it silently swallows one wherever that page has
 * no toast — which is exactly what happened on first wiring it into Admin.
 *
 * Props: venuePath, items, colors, accent, onAccent, byName
 */

import React, { useMemo, useState } from 'react';
import { bulkSetCasePacks } from '../services/apiService';
import { deliveryUnitsFor } from '../utils/deliveryUnits';
import { formatItemDescription } from '../utils/stockUnitUtils';

function CaseSizeSuggestions({ venuePath, items, colors, accent, onAccent, byName = '' }) {
  const [toast, setToast] = useState(null);
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2600); };
  // null | 'loading' | { rows: [{ id, name, desc, value }] }
  const [suggest, setSuggest] = useState(null);
  const [applying, setApplying] = useState(false);

  // Items that could take a case size but haven't got one. Kegs and loose
  // goods never can, so this never reaches zero — it isn't a to-do list.
  const missing = useMemo(
    () => (items || []).filter((i) => !i.archived && deliveryUnitsFor(i).canAddCasePack),
    [items],
  );

  const suggestSizes = async () => {
    setSuggest('loading');
    try {
      const { inferCaseSizes } = await import('../services/aiInference');
      const { map, source } = await inferCaseSizes(missing.map((i) => ({
        name: i.name,
        size: formatItemDescription(i),
        category: i.category || '',
      })));
      const rows = missing
        .filter((i) => map[i.name])
        .map((i) => ({ id: i.id, name: i.name, desc: formatItemDescription(i), value: String(map[i.name]) }));
      if (source !== 'ai' || rows.length === 0) {
        setSuggest(null);
        showToast(source !== 'ai' ? 'Suggestions unavailable right now' : 'No case sizes to suggest');
        return;
      }
      setSuggest({ rows });
    } catch (err) {
      setSuggest(null);
      showToast('Suggestions unavailable right now');
      console.error('Case-size suggestion failed:', err);
    }
  };

  const setValue = (id, val) => setSuggest((s) => (s && s.rows
    ? { rows: s.rows.map((r) => (r.id === id ? { ...r, value: val.replace(/[^0-9]/g, '') } : r)) }
    : s));

  const apply = async () => {
    if (!suggest?.rows || applying) return;
    const entries = suggest.rows
      .map((r) => ({ id: r.id, casePack: parseInt(r.value, 10) || 0 }))
      .filter((e) => e.casePack > 0);
    if (entries.length === 0) { setSuggest(null); return; }
    setApplying(true);
    const res = await bulkSetCasePacks(venuePath, entries, byName);
    setApplying(false);
    setSuggest(null);
    showToast(res.success ? `Case sizes set for ${res.count} items` : 'Could not save: ' + res.error);
  };

  if (missing.length === 0) return null;

  return (
    <div style={{ marginTop: '1.5rem' }}>
      <h2 style={{ fontSize: '1.05rem', color: colors.textPrimary, margin: '0 0 0.25rem' }}>Case sizes</h2>
      <div style={{ fontSize: '0.78rem', color: colors.textSecondary, marginBottom: '0.6rem' }}>
        A case size lets a delivery line reading “1 CA” become a number of bottles.
        Kegs and loose goods never have one, so this list won’t reach zero.
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.7rem 0.85rem', backgroundColor: colors.bgLight, border: `1px solid ${colors.borderLight}`, borderRadius: '10px' }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: '0.85rem', color: colors.textPrimary }}>
          {missing.length} item{missing.length === 1 ? '' : 's'} could take one.
        </span>
        <button
          onClick={suggestSizes}
          disabled={suggest === 'loading'}
          style={{ flexShrink: 0, padding: '0.5rem 0.85rem', border: 'none', borderRadius: '8px', backgroundColor: accent, color: onAccent, fontWeight: 700, fontSize: '0.85rem', cursor: suggest === 'loading' ? 'wait' : 'pointer', opacity: suggest === 'loading' ? 0.6 : 1 }}
        >{suggest === 'loading' ? 'Working…' : 'Suggest sizes'}</button>
      </div>

      {toast && (
        <div style={{ position: 'fixed', bottom: 'max(1.25rem, env(safe-area-inset-bottom))', left: '50%', transform: 'translateX(-50%)', backgroundColor: colors.textPrimary, color: colors.bgCard, padding: '0.7rem 1.1rem', borderRadius: '9999px', fontSize: '0.9rem', fontWeight: 600, boxShadow: `0 6px 20px ${colors.shadow}`, zIndex: 5100 }}>
          {toast}
        </div>
      )}

      {/* Editable before applying — the model is guessing at trade conventions */}
      {suggest && suggest !== 'loading' && (
        <div
          onClick={() => !applying && setSuggest(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 5000, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: colors.bgCard, borderRadius: '14px', boxShadow: `0 12px 40px ${colors.shadow}`, padding: '1.25rem', maxWidth: '480px', width: '100%', display: 'flex', flexDirection: 'column', maxHeight: '85vh' }}>
            <div style={{ fontWeight: 700, fontSize: '1.05rem', color: colors.textPrimary, marginBottom: '0.25rem' }}>Suggested case sizes</div>
            <div style={{ fontSize: '0.82rem', color: colors.textSecondary, marginBottom: '0.85rem' }}>
              Learnt from each item's size and category. Adjust any that are wrong, clear to skip, then apply.
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.35rem', paddingRight: '0.25rem' }}>
              {suggest.rows.map((r) => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.4rem 0.5rem', border: `1px solid ${colors.borderLight}`, borderRadius: '8px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.88rem', color: colors.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                    {r.desc && <div style={{ fontSize: '0.72rem', color: colors.textSecondary }}>{r.desc}</div>}
                  </div>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={r.value}
                    onChange={(e) => setValue(r.id, e.target.value)}
                    style={{ width: '52px', flexShrink: 0, padding: '0.45rem', fontSize: '0.95rem', fontWeight: 'bold', textAlign: 'center', border: `2px solid ${colors.border}`, borderRadius: '8px', backgroundColor: colors.bgCard, color: colors.textPrimary }}
                  />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1rem' }}>
              <button
                onClick={() => setSuggest(null)}
                disabled={applying}
                style={{ flexShrink: 0, padding: '0.8rem 1.1rem', backgroundColor: colors.bgLight, color: colors.textPrimary, border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}
              >Cancel</button>
              <button
                onClick={apply}
                disabled={applying}
                style={{ flex: 1, padding: '0.8rem', backgroundColor: accent, color: onAccent, border: 'none', borderRadius: '10px', fontWeight: 700, fontSize: '1rem', cursor: applying ? 'wait' : 'pointer', opacity: applying ? 0.6 : 1 }}
              >{applying ? 'Applying…' : `Apply ${suggest.rows.filter((r) => parseInt(r.value, 10) > 0).length} case sizes`}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default CaseSizeSuggestions;
