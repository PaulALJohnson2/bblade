/**
 * TillMapping — map till products (from uploaded sales reports) to the stock
 * items they deplete, in the measure sold.
 *
 * Every till product ever seen in a report is listed with its mapping status.
 * Tap a product to map it: search the stock list, pick the item, then tap the
 * sale measure (Pint, 175ml Glass, Double, …) — measures and their base-unit
 * conversions come from wastageUnits, the same maths counts and wastage use.
 * "Suggest mappings" batches the unmapped products through Gemini and opens a
 * review list (editable measures, skippable rows) before anything is saved.
 *
 * Props:
 *   venuePath, items (stock items), tillProducts (mapping docs),
 *   products ([{key, productId, name, size, qty, value}] from report lines),
 *   colors, accent, onAccent, showToast, mappedBy
 */

import React, { useMemo, useState } from 'react';
import { saveTillProduct, deleteTillProduct, bulkSaveTillProducts } from '../services/apiService';
import { saleUnitOptions, resolveUnitRow, normName } from '../utils/tillMapping';
import { formatItemDescription } from '../utils/stockUnitUtils';

const FILTERS = ['unmapped', 'mapped', 'ignored', 'all'];

function TillMapping({ venuePath, items, tillProducts, products, colors, accent, onAccent, showToast, mappedBy }) {
  const [filter, setFilter] = useState('unmapped');
  const [search, setSearch] = useState('');
  const [openKey, setOpenKey] = useState(null);
  const [itemSearch, setItemSearch] = useState('');
  const [pickedItemId, setPickedItemId] = useState(null);

  // AI review: null | 'loading' | { rows: [{key, tillName, itemId, itemName, unitKey, unitLabel, perBase, baseLabel, ignore, skip}] }
  const [aiReview, setAiReview] = useState(null);
  const [applying, setApplying] = useState(false);

  const mappingsByKey = useMemo(
    () => Object.fromEntries(tillProducts.map((d) => [d.id, d])),
    [tillProducts]
  );
  const activeItems = useMemo(() => items.filter((i) => !i.archived), [items]);

  const statusOf = (p) => {
    const m = mappingsByKey[p.key];
    if (!m) return 'unmapped';
    if (m.ignore) return 'ignored';
    return m.itemId ? 'mapped' : 'unmapped';
  };

  const q = search.trim().toLowerCase();
  const visible = products
    .filter((p) => filter === 'all' || statusOf(p) === filter)
    .filter((p) => !q || p.name.toLowerCase().includes(q));
  const counts = useMemo(() => {
    const c = { unmapped: 0, mapped: 0, ignored: 0, all: products.length };
    for (const p of products) c[statusOf(p)]++;
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, mappingsByKey]);

  const openEditor = (p) => {
    if (openKey === p.key) { setOpenKey(null); return; }
    setOpenKey(p.key);
    setItemSearch('');
    setPickedItemId(mappingsByKey[p.key]?.itemId || null);
  };

  const saveMapping = async (p, item, unit) => {
    const res = await saveTillProduct(venuePath, p.key, {
      productId: p.productId, name: p.name, size: p.size || '',
      itemId: item.id, itemName: item.name,
      unitKey: unit.key, unitLabel: unit.label, perBase: unit.perBase,
      baseLabel: saleUnitOptions(item).baseLabel,
      ignore: false, mappedBy,
    });
    if (res.success) { showToast(`${p.name} → ${item.name}`); setOpenKey(null); }
    else showToast('Could not save: ' + res.error);
  };

  const ignoreProduct = async (p) => {
    const res = await saveTillProduct(venuePath, p.key, {
      productId: p.productId, name: p.name, size: p.size || '',
      itemId: null, itemName: '', unitKey: '', unitLabel: '', perBase: 0, baseLabel: '',
      ignore: true, mappedBy,
    });
    if (res.success) { showToast(`Ignoring ${p.name}`); setOpenKey(null); }
    else showToast('Could not save: ' + res.error);
  };

  const clearMapping = async (p) => {
    const res = await deleteTillProduct(venuePath, p.key);
    if (res.success) { showToast(`Cleared ${p.name}`); setOpenKey(null); }
    else showToast('Could not clear: ' + res.error);
  };

  // ---- AI suggestions over the unmapped products ----
  const handleSuggest = async () => {
    const unmapped = products.filter((p) => statusOf(p) === 'unmapped');
    if (unmapped.length === 0) return;
    setAiReview('loading');
    try {
      const { suggestTillMappings } = await import('../services/aiInference');
      const { map, source } = await suggestTillMappings(
        unmapped.map((p) => ({ name: p.name, size: p.size || '' })),
        activeItems.map((i) => ({ name: i.name, category: i.category || '', size: formatItemDescription(i) }))
      );
      if (source !== 'ai') {
        setAiReview(null);
        showToast('Suggestions unavailable right now');
        return;
      }
      const itemsByName = new Map(activeItems.map((i) => [normName(i.name), i]));
      const rows = [];
      for (const p of unmapped) {
        const s = map[p.name];
        if (!s) continue;
        if (s.unit === 'ignore') {
          rows.push({ key: p.key, product: p, ignore: true, skip: false });
          continue;
        }
        const item = itemsByName.get(normName(s.itemName));
        if (!item) continue; // no confident match — stays unmapped
        const row = resolveUnitRow(item, s.unit);
        if (!row) continue;
        rows.push({
          key: p.key, product: p, ignore: false, skip: false,
          itemId: item.id, itemName: item.name,
          unitKey: row.key, perBase: row.perBase,
          unitOptions: saleUnitOptions(item).options,
          baseLabel: saleUnitOptions(item).baseLabel,
        });
      }
      if (rows.length === 0) { setAiReview(null); showToast('No confident suggestions'); return; }
      setAiReview({ rows });
    } catch (err) {
      setAiReview(null);
      showToast('Suggestions unavailable right now');
      console.error('Till mapping suggestion failed:', err);
    }
  };

  const setReviewUnit = (key, unitKey) => {
    setAiReview((s) => (s && s.rows ? {
      rows: s.rows.map((r) => {
        if (r.key !== key) return r;
        const u = r.unitOptions.find((o) => o.key === unitKey);
        return u ? { ...r, unitKey: u.key, perBase: u.perBase } : r;
      }),
    } : s));
  };

  const toggleSkip = (key) => {
    setAiReview((s) => (s && s.rows ? { rows: s.rows.map((r) => (r.key === key ? { ...r, skip: !r.skip } : r)) } : s));
  };

  const applyReview = async () => {
    if (!aiReview?.rows || applying) return;
    const entries = aiReview.rows.filter((r) => !r.skip).map((r) => ({
      key: r.key,
      data: r.ignore
        ? { productId: r.product.productId, name: r.product.name, size: r.product.size || '', itemId: null, itemName: '', unitKey: '', unitLabel: '', perBase: 0, baseLabel: '', ignore: true, mappedBy }
        : {
            productId: r.product.productId, name: r.product.name, size: r.product.size || '',
            itemId: r.itemId, itemName: r.itemName,
            unitKey: r.unitKey,
            unitLabel: r.unitOptions.find((o) => o.key === r.unitKey)?.label || '',
            perBase: r.perBase, baseLabel: r.baseLabel,
            ignore: false, mappedBy,
          },
    }));
    if (entries.length === 0) { setAiReview(null); return; }
    setApplying(true);
    const res = await bulkSaveTillProducts(venuePath, entries);
    setApplying(false);
    setAiReview(null);
    showToast(res.success ? `Mapped ${res.count} till products` : 'Could not save: ' + res.error);
  };

  // ---- styles ----
  const input = { width: '100%', padding: '0.7rem', fontSize: '0.95rem', border: `2px solid ${colors.border}`, borderRadius: '8px', backgroundColor: colors.bgCard, color: colors.textPrimary, boxSizing: 'border-box' };
  const chip = (active) => ({ flexShrink: 0, padding: '0.45rem 0.85rem', borderRadius: '9999px', border: 'none', backgroundColor: active ? accent : colors.bgLight, color: active ? onAccent : colors.textPrimary, fontWeight: active ? 700 : 500, fontSize: '0.82rem', cursor: 'pointer', whiteSpace: 'nowrap' });
  const unitChip = { padding: '0.45rem 0.8rem', borderRadius: '9999px', border: `1px solid ${colors.border}`, backgroundColor: colors.bgCard, color: colors.textPrimary, fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer' };

  const statusBadge = (p) => {
    const m = mappingsByKey[p.key];
    const s = statusOf(p);
    if (s === 'mapped') return <span style={{ fontSize: '0.75rem', color: colors.success }}>→ {m.itemName}{m.unitLabel ? ` · ${m.unitLabel}` : ''}</span>;
    if (s === 'ignored') return <span style={{ fontSize: '0.75rem', color: colors.textMuted }}>Ignored</span>;
    return <span style={{ fontSize: '0.75rem', color: colors.warning }}>Unmapped</span>;
  };

  if (products.length === 0) {
    return <div style={{ color: colors.textSecondary, fontSize: '0.9rem' }}>Upload a sales report first — its products appear here for mapping.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {/* AI banner */}
      {counts.unmapped > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.65rem 0.85rem', backgroundColor: colors.primarySoft, border: `1px solid ${colors.borderLight}`, borderRadius: '10px' }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: '0.85rem', color: colors.textPrimary }}>
            {counts.unmapped} till product{counts.unmapped === 1 ? '' : 's'} not mapped to stock yet.
          </span>
          <button
            onClick={handleSuggest}
            disabled={aiReview === 'loading'}
            style={{ flexShrink: 0, padding: '0.5rem 0.85rem', border: 'none', borderRadius: '8px', backgroundColor: accent, color: onAccent, fontWeight: 700, fontSize: '0.85rem', cursor: aiReview === 'loading' ? 'wait' : 'pointer', opacity: aiReview === 'loading' ? 0.6 : 1 }}
          >{aiReview === 'loading' ? 'Working…' : 'Suggest mappings'}</button>
        </div>
      )}

      {/* Search + filters */}
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search till products…" style={input} />
      <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', paddingBottom: '0.25rem', scrollbarWidth: 'none' }}>
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)} style={chip(filter === f)}>
            {f[0].toUpperCase() + f.slice(1)} ({counts[f]})
          </button>
        ))}
      </div>

      {/* Product list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {visible.length === 0 && <div style={{ color: colors.textSecondary, fontSize: '0.9rem', textAlign: 'center', padding: '1rem' }}>Nothing here.</div>}
        {visible.slice(0, 300).map((p) => {
          const open = openKey === p.key;
          const pickedItem = activeItems.find((i) => i.id === pickedItemId) || null;
          const iq = itemSearch.trim().toLowerCase();
          const itemResults = iq
            ? activeItems.filter((i) => (i.name || '').toLowerCase().includes(iq)).slice(0, 20)
            : [];
          return (
            <div key={p.key} style={{ border: `1px solid ${open ? accent : colors.borderLight}`, borderRadius: '10px', overflow: 'hidden' }}>
              <button onClick={() => openEditor(p)} style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.7rem 0.85rem', background: open ? colors.primarySoft : colors.bgCard, border: 'none', cursor: 'pointer' }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', color: colors.textPrimary, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {p.name}{p.size ? <span style={{ fontWeight: 400, color: colors.textSecondary }}> · {p.size}</span> : null}
                  </span>
                  {statusBadge(p)}
                </span>
                <span style={{ flexShrink: 0, fontSize: '0.72rem', color: colors.textMuted }}>×{Math.round(p.qty)}</span>
              </button>

              {open && (
                <div style={{ padding: '0.85rem', borderTop: `1px solid ${colors.borderLight}`, display: 'flex', flexDirection: 'column', gap: '0.75rem', backgroundColor: colors.bgCard }}>
                  {/* Pick the stock item */}
                  {!pickedItem ? (
                    <>
                      <input
                        autoFocus
                        value={itemSearch}
                        onChange={(e) => setItemSearch(e.target.value)}
                        placeholder="Search stock items…"
                        style={input}
                      />
                      {itemResults.map((i) => (
                        <button key={i.id} onClick={() => setPickedItemId(i.id)} style={{ textAlign: 'left', padding: '0.55rem 0.7rem', border: `1px solid ${colors.borderLight}`, borderRadius: '8px', backgroundColor: colors.bgCard, color: colors.textPrimary, cursor: 'pointer', display: 'flex', gap: '0.5rem', alignItems: 'baseline' }}>
                          <span style={{ flex: 1, minWidth: 0, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.name}</span>
                          <span style={{ flexShrink: 0, fontSize: '0.72rem', color: colors.textSecondary }}>{formatItemDescription(i)}</span>
                        </button>
                      ))}
                    </>
                  ) : (
                    <>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                        <span style={{ flex: 1, minWidth: 0, fontWeight: 700, color: colors.textPrimary }}>{pickedItem.name}</span>
                        <button onClick={() => { setPickedItemId(null); setItemSearch(''); }} style={{ flexShrink: 0, background: 'none', border: 'none', color: colors.textSecondary, cursor: 'pointer', fontSize: '0.8rem', textDecoration: 'underline' }}>change item</button>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: colors.textSecondary, marginTop: '-0.4rem' }}>Sold as…</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                        {saleUnitOptions(pickedItem).options.map((u) => (
                          <button key={u.key} onClick={() => saveMapping(p, pickedItem, u)} style={unitChip}>{u.label}</button>
                        ))}
                      </div>
                    </>
                  )}

                  {/* Ignore / clear */}
                  <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                    {mappingsByKey[p.key] && (
                      <button onClick={() => clearMapping(p)} style={{ padding: '0.5rem 0.85rem', backgroundColor: 'transparent', color: colors.textSecondary, border: `1px solid ${colors.border}`, borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem' }}>Clear mapping</button>
                    )}
                    <button onClick={() => ignoreProduct(p)} style={{ padding: '0.5rem 0.85rem', backgroundColor: colors.bgLight, color: colors.textPrimary, border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}>Not stock — ignore</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* AI review modal */}
      {aiReview && aiReview !== 'loading' && (
        <div
          onClick={() => !applying && setAiReview(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 5000, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: colors.bgCard, borderRadius: '14px', boxShadow: `0 12px 40px ${colors.shadow}`, padding: '1.25rem', maxWidth: '520px', width: '100%', display: 'flex', flexDirection: 'column', maxHeight: '85vh' }}>
            <div style={{ fontWeight: 700, fontSize: '1.05rem', color: colors.textPrimary, marginBottom: '0.25rem' }}>Suggested mappings</div>
            <div style={{ fontSize: '0.82rem', color: colors.textSecondary, marginBottom: '0.85rem' }}>
              Check each till product's stock item and measure. Adjust the measure, tap ✕ to skip a row, then apply.
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.35rem', paddingRight: '0.25rem' }}>
              {aiReview.rows.map((r) => (
                <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.45rem 0.5rem', border: `1px solid ${colors.borderLight}`, borderRadius: '8px', opacity: r.skip ? 0.4 : 1 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.85rem', color: colors.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.product.name}</div>
                    <div style={{ fontSize: '0.74rem', color: r.ignore ? colors.textMuted : colors.success, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {r.ignore ? 'Not stock — ignore' : `→ ${r.itemName}`}
                    </div>
                  </div>
                  {!r.ignore && (
                    <select
                      value={r.unitKey}
                      onChange={(e) => setReviewUnit(r.key, e.target.value)}
                      style={{ flexShrink: 0, maxWidth: '140px', padding: '0.4rem', fontSize: '0.8rem', border: `1px solid ${colors.border}`, borderRadius: '6px', backgroundColor: colors.bgCard, color: colors.textPrimary }}
                    >
                      {r.unitOptions.map((u) => <option key={u.key} value={u.key}>{u.label}</option>)}
                    </select>
                  )}
                  <button onClick={() => toggleSkip(r.key)} aria-label={r.skip ? 'Include' : 'Skip'} style={{ flexShrink: 0, width: '28px', height: '28px', border: 'none', borderRadius: '50%', backgroundColor: 'transparent', color: colors.textSecondary, fontSize: '1rem', cursor: 'pointer', lineHeight: 1 }}>
                    {r.skip ? '↺' : '✕'}
                  </button>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1rem' }}>
              <button onClick={() => setAiReview(null)} disabled={applying} style={{ flexShrink: 0, padding: '0.8rem 1.1rem', backgroundColor: colors.bgLight, color: colors.textPrimary, border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              <button
                onClick={applyReview}
                disabled={applying}
                style={{ flex: 1, padding: '0.8rem', backgroundColor: accent, color: onAccent, border: 'none', borderRadius: '10px', fontWeight: 700, fontSize: '1rem', cursor: applying ? 'wait' : 'pointer', opacity: applying ? 0.6 : 1 }}
              >{applying ? 'Applying…' : `Apply ${aiReview.rows.filter((r) => !r.skip).length} mappings`}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default TillMapping;
