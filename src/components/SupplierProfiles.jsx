/**
 * SupplierProfiles — what the scanned notes have taught the venue about who
 * delivers what, and how reliably.
 *
 * Nothing here is captured; it's all derived from delivery notes already
 * saved. Two jobs:
 *   - show the rhythm and the fill rate, so ordering stops being guesswork;
 *   - make the LEARNED supplier-code mappings visible and correctable. A
 *     mapping the venue can't see is magic, and magic that's wrong is worse
 *     than no magic — "Forget" is the escape hatch, after which the next scan
 *     re-matches by name and can be confirmed afresh.
 *
 * Fill rate is a planning signal only: ordered and despatched never move stock.
 *
 * Props: notes, learned, colors, accent, onForget(record)
 */

import React, { useMemo, useState } from 'react';
import { buildSupplierProfiles, formatFillRate, shortDate, supplierGroupKey } from '../utils/supplierProfile';

function SupplierProfiles({ notes, learned, colors, accent, onForget }) {
  const [openFor, setOpenFor] = useState(null);
  const [confirmForget, setConfirmForget] = useState(null);

  const profiles = useMemo(() => buildSupplierProfiles(notes), [notes]);
  const learnedBySupplier = useMemo(() => {
    const map = new Map();
    for (const r of learned || []) {
      const k = supplierGroupKey(r.supplier);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(r);
    }
    return map;
  }, [learned]);

  if (!profiles.length) return null;

  const stat = (label, value, tone) => (
    <div style={{ flex: '1 1 auto', minWidth: '84px' }}>
      <div style={{ fontSize: '0.95rem', fontWeight: 700, color: tone || colors.textPrimary }}>{value}</div>
      <div style={{ fontSize: '0.68rem', color: colors.textSecondary }}>{label}</div>
    </div>
  );

  return (
    <div style={{ marginTop: '0.5rem', marginBottom: '1.5rem' }}>
      <h2 style={{ fontSize: '1.05rem', color: colors.textPrimary, margin: '0 0 0.25rem' }}>Suppliers</h2>
      <div style={{ fontSize: '0.75rem', color: colors.textSecondary, marginBottom: '0.75rem' }}>
        Learnt from your scanned delivery notes.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {profiles.map((p) => {
          const open = openFor === p.supplier;
          const records = learnedBySupplier.get(p.key) || [];
          // Below 100% means they've shorted you; worth colouring, not burying.
          const fillTone = p.fillRate !== null && p.fillRate < 0.99 ? colors.error : colors.textPrimary;
          return (
            <div key={p.supplier} style={{ border: `1px solid ${open ? accent : colors.borderLight}`, borderRadius: '10px', overflow: 'hidden' }}>
              <button
                onClick={() => setOpenFor(open ? null : p.supplier)}
                style={{ width: '100%', textAlign: 'left', padding: '0.7rem 0.85rem', border: 'none', background: open ? colors.deliverySoft : colors.bgCard, cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ flex: 1, minWidth: 0, fontWeight: 700, color: colors.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {p.supplier}
                  </span>
                  <span style={{ flexShrink: 0, fontSize: '0.75rem', color: colors.textSecondary }}>
                    {p.noteCount} note{p.noteCount === 1 ? '' : 's'}
                  </span>
                </div>
                <div style={{ fontSize: '0.78rem', color: colors.textSecondary, marginTop: '0.15rem' }}>
                  {p.cadence.label}
                  {p.lastDelivery && ` · last ${shortDate(p.lastDelivery)}`}
                  {p.nextExpected && ` · next ~${shortDate(p.nextExpected)}`}
                </div>
              </button>

              {open && (
                <div style={{ padding: '0.85rem', borderTop: `1px solid ${colors.borderLight}`, backgroundColor: colors.bgCard, display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
                    {stat('delivered of despatched', formatFillRate(p.fillRate), fillTone)}
                    {stat('despatched of ordered', formatFillRate(p.orderFillRate))}
                    {stat('short lines', p.shortLines)}
                    {p.emptiesReturned > 0 && stat('empties collected', p.emptiesReturned)}
                  </div>

                  {p.comparableLines === 0 && (
                    <div style={{ fontSize: '0.72rem', color: colors.textMuted }}>
                      This supplier's notes don't print a despatched column, so reliability can't be measured.
                    </div>
                  )}

                  {/* The learned mappings, made visible and correctable */}
                  <div>
                    <div style={{ fontSize: '0.8rem', fontWeight: 700, color: colors.textPrimary, marginBottom: '0.35rem' }}>
                      Known products ({records.length})
                    </div>
                    {records.length === 0 ? (
                      <div style={{ fontSize: '0.75rem', color: colors.textMuted }}>
                        Nothing learned yet — confirmed matches from your next scan will appear here.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', maxHeight: '260px', overflowY: 'auto' }}>
                        {records.map((r) => {
                          const prod = p.products.find((x) => x.itemId === r.itemId);
                          const confirming = confirmForget === r.id;
                          return (
                            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.5rem', border: `1px solid ${colors.borderLight}`, borderRadius: '8px' }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: '0.82rem', fontWeight: 600, color: colors.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {r.itemName}
                                </div>
                                <div style={{ fontSize: '0.7rem', color: colors.textSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {r.itemCode ? `${r.itemCode} · ` : ''}{r.description}
                                </div>
                                {prod && (
                                  <div style={{ fontSize: '0.68rem', color: colors.textMuted }}>
                                    {prod.times}× delivered
                                    {prod.typicalQty > 0 && ` · usually ${prod.typicalQty}${r.unitCode ? ` ${r.unitCode}` : ''}`}
                                    {prod.shortTimes > 0 && ` · ${prod.shortTimes} short`}
                                  </div>
                                )}
                              </div>
                              {confirming ? (
                                <button
                                  onClick={() => { onForget(r); setConfirmForget(null); }}
                                  style={{ flexShrink: 0, padding: '0.35rem 0.6rem', border: 'none', borderRadius: '6px', backgroundColor: accent, color: colors.onDelivery, fontWeight: 700, fontSize: '0.72rem', cursor: 'pointer' }}
                                >Confirm</button>
                              ) : (
                                <button
                                  onClick={() => setConfirmForget(r.id)}
                                  title="Stop matching this code automatically"
                                  style={{ flexShrink: 0, padding: '0.35rem 0.6rem', border: `1px solid ${colors.border}`, borderRadius: '6px', backgroundColor: 'transparent', color: colors.textSecondary, fontSize: '0.72rem', cursor: 'pointer' }}
                                >Forget</button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default SupplierProfiles;
