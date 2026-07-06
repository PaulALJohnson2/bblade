/**
 * CostDerivation — set stock-item cost prices from the till's own cost data.
 *
 * Uses the uploaded sales reports + till-product mappings (deriveCostPrices)
 * to propose a costPrice per whole unit for every mapped item the till knows
 * the cost of. A review modal shows current vs suggested (editable), flags
 * items whose till lines disagree with each other (usually a mis-mapped
 * measure), and applies in one batch. Re-run any time — fresh uploads refine
 * the numbers.
 *
 * Props: venuePath, items, reports, mappingsByKey, colors, accent, onAccent, showToast
 */

import React, { useMemo, useState } from 'react';
import { bulkSetCostPrices } from '../services/apiService';
import { deriveCostPrices } from '../utils/costDerivation';
import { formatItemDescription } from '../utils/stockUnitUtils';

const gbp = (n) => '£' + (Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function CostDerivation({ venuePath, items, reports, mappingsByKey, colors, accent, onAccent, showToast }) {
  const [review, setReview] = useState(null); // null | { rows: [{...suggestion, value, skip}] }
  const [applying, setApplying] = useState(false);

  const suggestions = useMemo(
    () => deriveCostPrices({ reports, mappingsByKey, items }),
    [reports, mappingsByKey, items]
  );

  if (suggestions.length === 0) return null;

  const openReview = () => {
    setReview({ rows: suggestions.map((s) => ({ ...s, value: String(s.suggested), skip: false })) });
  };

  const setValue = (itemId, val) => {
    setReview((r) => (r ? { rows: r.rows.map((x) => (x.itemId === itemId ? { ...x, value: val.replace(/[^0-9.]/g, '') } : x)) } : r));
  };
  const toggleSkip = (itemId) => {
    setReview((r) => (r ? { rows: r.rows.map((x) => (x.itemId === itemId ? { ...x, skip: !x.skip } : x)) } : r));
  };

  const applyCount = review ? review.rows.filter((x) => !x.skip && parseFloat(x.value) > 0).length : 0;

  const apply = async () => {
    if (!review || applying) return;
    const entries = review.rows
      .filter((x) => !x.skip)
      .map((x) => ({ id: x.itemId, costPrice: parseFloat(x.value) }))
      .filter((e) => e.costPrice > 0);
    if (entries.length === 0) { setReview(null); return; }
    setApplying(true);
    const res = await bulkSetCostPrices(venuePath, entries);
    setApplying(false);
    setReview(null);
    showToast(res.success ? `Cost prices set for ${res.count} items` : 'Could not save: ' + res.error);
  };

  const unpriced = suggestions.filter((s) => !(s.current > 0)).length;

  return (
    <>
      {/* Offer card */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.65rem 0.85rem', backgroundColor: colors.primarySoft, border: `1px solid ${colors.borderLight}`, borderRadius: '10px' }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: '0.85rem', color: colors.textPrimary }}>
          The till's cost data can price {suggestions.length} stock item{suggestions.length === 1 ? '' : 's'}{unpriced > 0 ? ` (${unpriced} currently unpriced)` : ''} — used for £ variance.
        </span>
        <button
          onClick={openReview}
          style={{ flexShrink: 0, padding: '0.5rem 0.85rem', border: 'none', borderRadius: '8px', backgroundColor: accent, color: onAccent, fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer' }}
        >Derive costs</button>
      </div>

      {/* Review modal */}
      {review && (
        <div
          onClick={() => !applying && setReview(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 5000, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: colors.bgCard, borderRadius: '14px', boxShadow: `0 12px 40px ${colors.shadow}`, padding: '1.25rem', maxWidth: '520px', width: '100%', display: 'flex', flexDirection: 'column', maxHeight: '85vh' }}>
            <div style={{ fontWeight: 700, fontSize: '1.05rem', color: colors.textPrimary, marginBottom: '0.25rem' }}>Cost prices from the till</div>
            <div style={{ fontSize: '0.82rem', color: colors.textSecondary, marginBottom: '0.85rem' }}>
              Each price is per whole unit (keg, bottle, case), derived from the till's cost of sales through your mappings. Check anything flagged ⚠ — its till lines disagree, which usually means a wrong measure in the mapping.
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.35rem', paddingRight: '0.25rem' }}>
              {review.rows.map((r) => (
                <div key={r.itemId} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.45rem 0.5rem', border: `1px solid ${colors.borderLight}`, borderRadius: '8px', opacity: r.skip ? 0.4 : 1 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.85rem', color: colors.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {r.name}{r.spread > 0.25 && <span title="Till lines disagree on this item's cost" style={{ color: colors.warning }}> ⚠</span>}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: colors.textSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      per {formatItemDescription(r.item) || 'unit'} · {r.current > 0 ? `now ${gbp(r.current)}` : 'unpriced'} · from {r.lines} till line{r.lines === 1 ? '' : 's'}
                    </div>
                  </div>
                  <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                    <span style={{ fontSize: '0.85rem', color: colors.textSecondary }}>£</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={r.value}
                      onChange={(e) => setValue(r.itemId, e.target.value)}
                      style={{ width: '72px', padding: '0.45rem', fontSize: '0.9rem', fontWeight: 'bold', textAlign: 'right', border: `2px solid ${colors.border}`, borderRadius: '8px', backgroundColor: colors.bgCard, color: colors.textPrimary }}
                    />
                  </div>
                  <button onClick={() => toggleSkip(r.itemId)} aria-label={r.skip ? 'Include' : 'Skip'} style={{ flexShrink: 0, width: '28px', height: '28px', border: 'none', borderRadius: '50%', backgroundColor: 'transparent', color: colors.textSecondary, fontSize: '1rem', cursor: 'pointer', lineHeight: 1 }}>
                    {r.skip ? '↺' : '✕'}
                  </button>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1rem' }}>
              <button onClick={() => setReview(null)} disabled={applying} style={{ flexShrink: 0, padding: '0.8rem 1.1rem', backgroundColor: colors.bgLight, color: colors.textPrimary, border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              <button
                onClick={apply}
                disabled={applying || applyCount === 0}
                style={{ flex: 1, padding: '0.8rem', backgroundColor: accent, color: onAccent, border: 'none', borderRadius: '10px', fontWeight: 700, fontSize: '1rem', cursor: applying ? 'wait' : 'pointer', opacity: applying || applyCount === 0 ? 0.6 : 1 }}
              >{applying ? 'Applying…' : `Set ${applyCount} cost prices`}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default CostDerivation;
