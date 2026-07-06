/**
 * Deliveries — a quick rolling log of stock coming IN (deliveries & purchases).
 *
 * The mirror of Wastage: pick an item, enter what arrived in the units it's
 * bought in (cases, kegs, bottles, loose…), optionally note the supplier and
 * cost, and "Log delivery". Each entry saves instantly, adds to that item's
 * stock, and appears in the recent-deliveries list (where it can be undone).
 * Bar/Kitchen tabs mirror counts.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { logDelivery, subscribeToDeliveryLog, deleteDeliveryEntry, setStockItemCasePack } from '../services/apiService';
import { useStockData } from '../contexts/StockDataContext';
import { deliveryUnitsFor, computeDeliveryQuantity, summariseDeliveryUnits } from '../utils/deliveryUnits';
import DeliveryEntry from '../components/DeliveryEntry';
import { getThemeColors } from '../utils/theme';
import useTheme from '../hooks/useTheme';

const sectionOf = (it) => (it.section === 'kitchen' ? 'kitchen' : 'bar');

// Human summary of a delivery entry from its stored purchase-unit breakdown.
function deliverySummary(e) {
  if (Array.isArray(e.units) && e.units.length) {
    return summariseDeliveryUnits(e.units);
  }
  return `${e.quantity || 0}${e.baseLabel ? ` ${e.baseLabel}` : ''}`;
}

function Deliveries() {
  const navigate = useNavigate();
  const { currentUser, userProfile, selectedPub } = useAuth();
  const { isDark } = useTheme();
  const colors = getThemeColors(isDark);
  const accent = colors.delivery;

  const { items } = useStockData();
  const [recent, setRecent] = useState([]);
  const [section, setSection] = useState('bar');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [selectedId, setSelectedId] = useState(null);

  const [values, setValues] = useState({}); // purchase-unit counts keyed by row.key
  const [supplier, setSupplier] = useState('');
  const [cost, setCost] = useState('');
  const [note, setNote] = useState('');
  const setValue = (key, val) => setValues((v) => ({ ...v, [key]: val }));

  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [confirmUndo, setConfirmUndo] = useState(null); // entry id

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2200); };

  useEffect(() => {
    if (!selectedPub) return;
    const unsubLog = subscribeToDeliveryLog(selectedPub.path, (list) => setRecent(list || []));
    return () => unsubLog();
  }, [selectedPub]);

  const resetEntry = () => {
    setSelectedId(null);
    setValues({}); setSupplier(''); setCost(''); setNote('');
  };

  const selectItem = (it) => {
    if (selectedId === it.id) { resetEntry(); return; }
    setSelectedId(it.id);
    setValues({}); setCost(''); setNote(''); // keep supplier — same van, many items
  };

  const q = search.trim().toLowerCase();
  // Items in the current section (used for both the category list and the list).
  const sectionItems = useMemo(
    () => items.filter((i) => !i.archived && sectionOf(i) === section),
    [items, section]
  );
  const categories = useMemo(
    () => [...new Set(sectionItems.map((i) => i.category).filter(Boolean))].sort(),
    [sectionItems]
  );
  const visible = useMemo(() => sectionItems
    .filter((i) => !categoryFilter || i.category === categoryFilter)
    .filter((i) => !q || (i.name || '').toLowerCase().includes(q) || (i.category || '').toLowerCase().includes(q)),
    [sectionItems, categoryFilter, q]);

  // Recent suppliers feed the datalist so repeat entry is one tap.
  const knownSuppliers = useMemo(
    () => [...new Set(recent.map((e) => (e.supplier || '').trim()).filter(Boolean))].sort(),
    [recent]
  );

  const selectedItem = items.find((i) => i.id === selectedId) || null;
  const dUnits = selectedItem ? deliveryUnitsFor(selectedItem) : null;
  const quantity = dUnits ? computeDeliveryQuantity(dUnits.rows, values) : 0;
  const capturedSummary = dUnits
    ? dUnits.rows
        .filter((r) => (parseFloat(values[r.key]) || 0) > 0)
        .map((r) => `${values[r.key]} ${r.label}`)
        .join(', ')
    : '';
  const canLog = !!selectedItem && quantity > 0 && !saving;

  const handleLog = async () => {
    if (!canLog) return;
    setSaving(true);
    const units = dUnits.rows
      .filter((r) => (parseFloat(values[r.key]) || 0) > 0)
      .map((r) => ({ label: r.label, count: Number(values[r.key]) }));
    const res = await logDelivery(selectedPub.path, selectedItem.id, {
      itemName: selectedItem.name,
      section: sectionOf(selectedItem),
      units,
      quantity,
      baseLabel: dUnits.baseLabel,
      supplier: supplier.trim(),
      cost: cost === '' ? null : parseFloat(cost),
      note: note.trim(),
      receivedBy: userProfile?.displayName || currentUser?.email || '',
    });
    setSaving(false);
    if (res.success) { showToast(`Logged delivery: ${selectedItem.name}`); resetEntry(); }
    else showToast('Could not log: ' + res.error);
  };

  // Persist a captured case size onto the item. Not awaited — the offline-first
  // cache write re-renders the entry with its Cases row immediately.
  const handleSetCasePack = (item, n) => {
    setStockItemCasePack(selectedPub.path, item.id, n).then((res) => {
      if (!res.success) showToast('Could not save case size: ' + res.error);
    });
  };

  const handleUndo = async (entry) => {
    const res = await deleteDeliveryEntry(selectedPub.path, entry.id);
    setConfirmUndo(null);
    showToast(res.success ? `Undone: ${entry.itemName}` : 'Could not undo: ' + res.error);
  };

  // ---- styles ----
  const input = { width: '100%', padding: '0.7rem', fontSize: '0.95rem', border: `2px solid ${colors.border}`, borderRadius: '8px', backgroundColor: colors.bgCard, color: colors.textPrimary, boxSizing: 'border-box' };
  const tab = (active) => ({ flex: 1, padding: '0.6rem', border: 'none', borderRadius: '8px', backgroundColor: active ? accent : colors.bgLight, color: active ? colors.onDelivery : colors.textPrimary, fontWeight: active ? 700 : 500, cursor: 'pointer' });

  return (
    <div style={{ maxWidth: '640px', margin: '0 auto', position: 'relative' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <button onClick={() => navigate('/')} style={{ padding: '0.5rem 0.75rem', backgroundColor: colors.bgLight, color: colors.textPrimary, border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.9rem' }}>← Back</button>
        <h1 style={{ margin: 0, fontSize: '1.5rem', color: accent }}>Deliveries</h1>
      </div>

      {/* Section tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <button onClick={() => { setSection('bar'); setCategoryFilter(''); resetEntry(); }} style={tab(section === 'bar')}>Bar</button>
        <button onClick={() => { setSection('kitchen'); setCategoryFilter(''); resetEntry(); }} style={tab(section === 'kitchen')}>Kitchen</button>
      </div>

      {/* Search */}
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search items…" style={{ ...input, marginBottom: '0.6rem' }} />

      {/* Category filter pills — same layout as the stock-taking pills */}
      {categories.length > 0 && (
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: '0.25rem', scrollbarWidth: 'none' }}>
          {['all', ...categories].map((c) => {
            const isActive = (c === 'all' && !categoryFilter) || categoryFilter === c;
            const count = c === 'all' ? sectionItems.length : sectionItems.filter((i) => i.category === c).length;
            return (
              <button
                key={c}
                onClick={(e) => {
                  setCategoryFilter(c === 'all' ? '' : c);
                  resetEntry();
                  const el = e.currentTarget, row = el.parentElement;
                  row.scrollBy({ left: el.getBoundingClientRect().left - row.getBoundingClientRect().left, behavior: 'smooth' });
                }}
                style={{
                  flexShrink: 0, padding: '0.5rem 1rem',
                  backgroundColor: isActive ? accent : colors.bgLight,
                  color: isActive ? colors.onDelivery : colors.textPrimary,
                  border: 'none', borderRadius: '9999px', cursor: 'pointer',
                  fontWeight: 500, fontSize: '0.85rem', whiteSpace: 'nowrap',
                }}
              >
                {c === 'all' ? 'All' : c} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Item list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {visible.length === 0 && <div style={{ color: colors.textSecondary, fontSize: '0.9rem', textAlign: 'center', padding: '1rem' }}>No items.</div>}
        {visible.slice(0, 300).map((it) => {
          const open = selectedId === it.id;
          return (
            <div key={it.id} style={{ border: `1px solid ${open ? accent : colors.borderLight}`, borderRadius: '10px', overflow: 'hidden' }}>
              <button onClick={() => selectItem(it)} style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.7rem 0.85rem', background: open ? colors.deliverySoft : colors.bgCard, border: 'none', cursor: 'pointer' }}>
                <span style={{ flex: 1, minWidth: 0, color: colors.textPrimary, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name}</span>
                {it.category && <span style={{ fontSize: '0.7rem', color: colors.textSecondary }}>{it.category}</span>}
              </button>
              {open && (
                <div style={{ padding: '0.85rem', borderTop: `1px solid ${colors.borderLight}`, display: 'flex', flexDirection: 'column', gap: '0.85rem', backgroundColor: colors.bgCard }}>
                  <DeliveryEntry
                    item={it}
                    colors={colors}
                    accent={accent}
                    onAccent={colors.onDelivery}
                    values={values}
                    setValue={setValue}
                    onSetCasePack={(n) => handleSetCasePack(it, n)}
                  />

                  {/* Supplier + cost */}
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input
                      value={supplier}
                      onChange={(e) => setSupplier(e.target.value)}
                      placeholder="Supplier (optional)"
                      list="delivery-suppliers"
                      style={{ ...input, flex: 2 }}
                    />
                    <input
                      value={cost}
                      onChange={(e) => setCost(e.target.value.replace(/[^0-9.]/g, ''))}
                      placeholder="Cost £"
                      inputMode="decimal"
                      style={{ ...input, flex: 1, minWidth: 0 }}
                    />
                  </div>
                  <datalist id="delivery-suppliers">
                    {knownSuppliers.map((s) => <option key={s} value={s} />)}
                  </datalist>

                  {/* Note */}
                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" style={input} />

                  {/* Captured summary */}
                  {capturedSummary && (
                    <div style={{ fontSize: '0.85rem', color: colors.textPrimary, backgroundColor: colors.deliverySoft, borderRadius: '8px', padding: '0.5rem 0.75rem' }}>
                      Receiving: <strong>{capturedSummary}</strong>
                    </div>
                  )}

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button onClick={resetEntry} style={{ flexShrink: 0, padding: '0.85rem 1.25rem', backgroundColor: colors.bgLight, color: colors.textPrimary, border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>Cancel</button>
                    <button
                      onClick={handleLog}
                      disabled={!canLog}
                      style={{ flex: 1, padding: '0.85rem', backgroundColor: accent, color: colors.onDelivery, border: 'none', borderRadius: '8px', cursor: canLog ? 'pointer' : 'not-allowed', fontWeight: 700, fontSize: '1.05rem', opacity: canLog ? 1 : 0.5 }}
                    >{saving ? 'Logging…' : 'Log delivery'}</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Recent deliveries */}
      <div style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: '1.05rem', color: colors.textPrimary, margin: '0 0 0.75rem' }}>Recent deliveries</h2>
        {recent.length === 0 ? (
          <div style={{ color: colors.textSecondary, fontSize: '0.9rem' }}>Nothing logged yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {recent.map((e) => {
              const when = e.receivedAt?.toDate ? e.receivedAt.toDate().toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
              const confirming = confirmUndo === e.id;
              const costStr = typeof e.cost === 'number' ? `£${e.cost.toFixed(2)}` : '';
              return (
                <div key={e.id} style={{ border: `1px solid ${colors.borderLight}`, borderRadius: '10px', padding: '0.6rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: colors.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.itemName}</div>
                    <div style={{ fontSize: '0.78rem', color: colors.textSecondary }}>
                      {deliverySummary(e)}{e.supplier ? ` · ${e.supplier}` : ''}{costStr ? ` · ${costStr}` : ''}{e.note ? ` · ${e.note}` : ''}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: colors.textMuted }}>{[e.receivedBy, when].filter(Boolean).join(' · ')}</div>
                  </div>
                  {confirming ? (
                    <button onClick={() => handleUndo(e)} style={{ flexShrink: 0, padding: '0.5rem 0.75rem', backgroundColor: accent, color: colors.onDelivery, border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem' }}>Confirm undo</button>
                  ) : (
                    <button onClick={() => setConfirmUndo(e.id)} style={{ flexShrink: 0, padding: '0.5rem 0.75rem', backgroundColor: 'transparent', color: colors.textSecondary, border: `1px solid ${colors.border}`, borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem' }}>Undo</button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 'max(1.25rem, env(safe-area-inset-bottom))', left: '50%', transform: 'translateX(-50%)', backgroundColor: colors.textPrimary, color: colors.bgCard, padding: '0.7rem 1.1rem', borderRadius: '9999px', fontSize: '0.9rem', fontWeight: 600, boxShadow: `0 6px 20px ${colors.shadow}`, zIndex: 4000 }}>
          {toast}
        </div>
      )}
    </div>
  );
}

export default Deliveries;
