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
import { logDelivery, subscribeToDeliveryLog, deleteDeliveryEntry, setStockItemCasePack, bulkSetCasePacks, subscribeToDeliveryNotes, deleteDeliveryNote, getDeliveryNoteDocument,
  getSupplierProducts, deleteSupplierProduct } from '../services/apiService';
import { useStockData } from '../contexts/StockDataContext';
import { deliveryUnitsFor, computeDeliveryQuantity, summariseDeliveryUnits } from '../utils/deliveryUnits';
import { formatItemDescription } from '../utils/stockUnitUtils';
import DeliveryEntry from '../components/DeliveryEntry';
import DeliveryNoteScan from '../components/DeliveryNoteScan';
import SupplierProfiles from '../components/SupplierProfiles';
import { getThemeColors } from '../utils/theme';
import useTheme from '../hooks/useTheme';
import { compareCategories } from '../utils/categoryName';

const sectionOf = (it) => (it.section === 'kitchen' ? 'kitchen' : 'bar');

const isoToday = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** Midday local, so a timezone shift can't drop the date onto the day before. */
const arrivalDate = (iso) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
};

// Human summary of a delivery entry from its stored purchase-unit breakdown.
function deliverySummary(e) {
  if (Array.isArray(e.units) && e.units.length) {
    return summariseDeliveryUnits(e.units);
  }
  return `${e.quantity || 0}${e.baseLabel ? ` ${e.baseLabel}` : ''}`;
}

function Deliveries() {
  const navigate = useNavigate();
  const { currentUser, userProfile, selectedPub, isAdmin } = useAuth();
  const admin = !!(isAdmin && isAdmin());
  const { isDark } = useTheme();
  const colors = getThemeColors(isDark);
  const accent = colors.delivery;

  const { items } = useStockData();
  const [recent, setRecent] = useState([]);
  const [notes, setNotes] = useState([]);        // scanned delivery notes
  const [learned, setLearned] = useState([]);    // learned supplier → item mappings
  const [scanOpen, setScanOpen] = useState(false);
  const [viewNote, setViewNote] = useState(null); // note whose document is open
  const [confirmDeleteNote, setConfirmDeleteNote] = useState(null);
  const [section, setSection] = useState('bar');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [selectedId, setSelectedId] = useState(null);

  const [values, setValues] = useState({}); // purchase-unit counts keyed by row.key
  const [supplier, setSupplier] = useState('');
  const [cost, setCost] = useState('');
  const [note, setNote] = useState('');
  // When the goods ARRIVED. Defaults to today, because most of the time
  // someone is logging a delivery as it comes off the van — but every stock
  // period is windowed on this, so catching up on Monday for Thursday's drop
  // has to be able to say so, or the delivery lands in the wrong period and
  // the variance report invents a shortfall.
  const [arrivedOn, setArrivedOn] = useState(isoToday());
  const setValue = (key, val) => setValues((v) => ({ ...v, [key]: val }));

  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [confirmUndo, setConfirmUndo] = useState(null); // entry id

  // AI case-size suggestions (admin): null | 'loading' | { rows: [{id,name,desc,value}] }
  const [caseSuggest, setCaseSuggest] = useState(null);
  const [applyingSizes, setApplyingSizes] = useState(false);
  // Kegs/loose items never get a case size, so "missing" never hits zero —
  // let the banner be waved away (and hide it after an apply) for the session.
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2200); };

  // Who to credit for anything learned here — pack facts, confirmed matches.
  const byName = userProfile?.displayName || currentUser?.email || '';

  useEffect(() => {
    if (!selectedPub) return;
    const unsubLog = subscribeToDeliveryLog(selectedPub.path, (list) => setRecent(list || []));
    const unsubNotes = subscribeToDeliveryNotes(selectedPub.path, (list) => setNotes(list || []));
    return () => { unsubLog(); unsubNotes(); };
  }, [selectedPub]);

  // Learned mappings are small and change only on scan — a one-shot read,
  // refreshed when a note is logged or a mapping is forgotten.
  const refreshLearned = React.useCallback(() => {
    if (!selectedPub) return;
    getSupplierProducts(selectedPub.path).then((res) => setLearned(res.data || []));
  }, [selectedPub]);
  useEffect(() => { refreshLearned(); }, [refreshLearned]);

  const handleForgetLearned = async (record) => {
    const res = await deleteSupplierProduct(selectedPub.path, record.id);
    if (res.success) { refreshLearned(); showToast(`Forgot ${record.itemName}`); }
    else showToast('Could not forget: ' + res.error);
  };

  const resetEntry = () => {
    setSelectedId(null);
    setValues({}); setSupplier(''); setCost(''); setNote(''); setArrivedOn(isoToday());
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
    () => [...new Set(sectionItems.map((i) => i.category).filter(Boolean))].sort(compareCategories),
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
      receivedBy: byName,
      receivedAt: arrivalDate(arrivedOn),
    });
    setSaving(false);
    if (res.success) { showToast(`Logged delivery: ${selectedItem.name}`); resetEntry(); }
    else showToast('Could not log: ' + res.error);
  };

  // Persist a captured case size onto the item. Not awaited — the offline-first
  // cache write re-renders the entry with its Cases row immediately.
  const handleSetCasePack = (item, n) => {
    setStockItemCasePack(selectedPub.path, item.id, n, byName).then((res) => {
      if (!res.success) showToast('Could not save case size: ' + res.error);
    });
  };

  // Items (both sections) that could take a case size but don't have one yet.
  const missingCase = useMemo(
    () => items.filter((i) => !i.archived && deliveryUnitsFor(i).canAddCasePack),
    [items]
  );

  // Ask Gemini for case sizes based on what the stock list already knows about
  // each item (name, one-unit size, category), then open the review modal.
  const handleSuggestSizes = async () => {
    setCaseSuggest('loading');
    try {
      const { inferCaseSizes } = await import('../services/aiInference');
      const { map, source } = await inferCaseSizes(missingCase.map((i) => ({
        name: i.name,
        size: formatItemDescription(i),
        category: i.category || '',
      })));
      const rows = missingCase
        .filter((i) => map[i.name])
        .map((i) => ({ id: i.id, name: i.name, desc: formatItemDescription(i), value: String(map[i.name]) }));
      if (source !== 'ai' || rows.length === 0) {
        setCaseSuggest(null);
        showToast(source !== 'ai' ? 'Suggestions unavailable right now' : 'No case sizes to suggest');
        return;
      }
      setCaseSuggest({ rows });
    } catch (err) {
      setCaseSuggest(null);
      showToast('Suggestions unavailable right now');
      console.error('Case-size suggestion failed:', err);
    }
  };

  const setSuggestValue = (id, val) => {
    setCaseSuggest((s) => (s && s.rows
      ? { rows: s.rows.map((r) => (r.id === id ? { ...r, value: val.replace(/[^0-9]/g, '') } : r)) }
      : s));
  };

  const handleApplySizes = async () => {
    if (!caseSuggest?.rows || applyingSizes) return;
    const entries = caseSuggest.rows
      .map((r) => ({ id: r.id, casePack: parseInt(r.value, 10) || 0 }))
      .filter((e) => e.casePack > 0);
    if (entries.length === 0) { setCaseSuggest(null); return; }
    setApplyingSizes(true);
    const res = await bulkSetCasePacks(selectedPub.path, entries, byName);
    setApplyingSizes(false);
    setCaseSuggest(null);
    if (res.success) setBannerDismissed(true);
    showToast(res.success ? `Case sizes set for ${res.count} items` : 'Could not save: ' + res.error);
  };

  // The document lives in a subdoc so the note list stays light — fetch it only
  // when someone actually wants to look at the paperwork.
  const openNote = async (note) => {
    if (!note.imageStored) return;
    const res = await getDeliveryNoteDocument(selectedPub.path, note.id);
    if (!res.success) { showToast(res.error); return; }
    const { data, mimeType } = res.data;
    if ((mimeType || '').startsWith('image/')) { setViewNote({ ...note, src: data, revoke: null }); return; }
    // PDFs: Chrome won't render a data: URL in an iframe, but a blob: one is fine.
    const blob = await (await fetch(data)).blob();
    const src = URL.createObjectURL(blob);
    setViewNote({ ...note, src, revoke: src });
  };

  const closeNote = () => {
    if (viewNote?.revoke) URL.revokeObjectURL(viewNote.revoke);
    setViewNote(null);
  };

  // Removes the paperwork only — the stock movements it created stand, and are
  // still individually undoable from the recent list.
  const handleDeleteNote = async (note) => {
    const res = await deleteDeliveryNote(selectedPub.path, note.id);
    setConfirmDeleteNote(null);
    showToast(res.success ? 'Delivery note deleted' : 'Could not delete: ' + res.error);
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
        <button onClick={() => navigate('/stock')} style={{ padding: '0.5rem 0.75rem', backgroundColor: colors.bgLight, color: colors.textPrimary, border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.9rem' }}>← Back</button>
        <h1 style={{ margin: 0, fontSize: '1.5rem', color: accent }}>Deliveries</h1>
      </div>

      {/* Scan the paperwork instead of keying it in item by item */}
      <button
        onClick={() => setScanOpen(true)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '0.85rem', marginBottom: '0.75rem', border: `2px dashed ${accent}`, borderRadius: '10px', backgroundColor: colors.deliverySoft, color: colors.textPrimary, fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer' }}
      >
        📄 Scan a delivery note
      </button>

      {/* Who delivers what, how often, and how reliably — all derived.
          Above the item list because it answers the question you arrive with;
          below it, nobody would ever scroll far enough to find out. */}
      <SupplierProfiles
        notes={notes}
        learned={learned}
        colors={colors}
        accent={accent}
        onForget={handleForgetLearned}
      />

      {/* Scanned delivery notes — the proof behind the entries above */}
      {notes.length > 0 && (
        <div style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.05rem', color: colors.textPrimary, margin: '0 0 0.75rem' }}>Delivery notes</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {notes.map((n) => {
              const when = n.uploadedAt?.toDate ? n.uploadedAt.toDate().toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
              const logged = Array.isArray(n.entryIds) ? n.entryIds.length : 0;
              const confirming = confirmDeleteNote === n.id;
              return (
                <div key={n.id} style={{ border: `1px solid ${colors.borderLight}`, borderRadius: '10px', padding: '0.6rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <button
                    onClick={() => openNote(n)}
                    disabled={!n.imageStored}
                    title={n.imageStored ? 'View the document' : 'No copy of this document was kept'}
                    style={{ flexShrink: 0, width: '44px', height: '44px', padding: 0, border: `1px solid ${colors.borderLight}`, borderRadius: '8px', overflow: 'hidden', backgroundColor: colors.bgLight, cursor: n.imageStored ? 'zoom-in' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    {n.thumb
                      ? <img src={n.thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <span style={{ fontSize: '1.2rem' }}>📄</span>}
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: colors.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {n.supplier || n.fileName || 'Delivery note'}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: colors.textSecondary }}>
                      {[n.reference && `Ref ${n.reference}`, `${logged} logged`, `${n.lineCount || 0} lines`].filter(Boolean).join(' · ')}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: colors.textMuted }}>{[n.uploadedBy, when].filter(Boolean).join(' · ')}</div>
                  </div>
                  {confirming ? (
                    <button onClick={() => handleDeleteNote(n)} style={{ flexShrink: 0, padding: '0.5rem 0.75rem', backgroundColor: accent, color: colors.onDelivery, border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem' }}>Confirm</button>
                  ) : (
                    <button onClick={() => setConfirmDeleteNote(n.id)} style={{ flexShrink: 0, padding: '0.5rem 0.75rem', backgroundColor: 'transparent', color: colors.textSecondary, border: `1px solid ${colors.border}`, borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem' }}>Delete</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Admin: learn case sizes from the existing stock list */}
      {admin && !bannerDismissed && missingCase.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.65rem 0.85rem', marginBottom: '0.75rem', backgroundColor: colors.deliverySoft, border: `1px solid ${colors.borderLight}`, borderRadius: '10px' }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: '0.85rem', color: colors.textPrimary }}>
            {missingCase.length} item{missingCase.length === 1 ? '' : 's'} have no case size yet.
          </span>
          <button
            onClick={handleSuggestSizes}
            disabled={caseSuggest === 'loading'}
            style={{ flexShrink: 0, padding: '0.5rem 0.85rem', border: 'none', borderRadius: '8px', backgroundColor: accent, color: colors.onDelivery, fontWeight: 700, fontSize: '0.85rem', cursor: caseSuggest === 'loading' ? 'wait' : 'pointer', opacity: caseSuggest === 'loading' ? 0.6 : 1 }}
          >{caseSuggest === 'loading' ? 'Working…' : 'Suggest sizes'}</button>
          <button
            onClick={() => setBannerDismissed(true)}
            aria-label="Dismiss"
            style={{ flexShrink: 0, width: '28px', height: '28px', border: 'none', borderRadius: '50%', backgroundColor: 'transparent', color: colors.textSecondary, fontSize: '1.1rem', cursor: 'pointer', lineHeight: 1 }}
          >×</button>
        </div>
      )}

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

                  {/* Supplier, arrival date, cost. Wraps on a narrow screen. */}
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <input
                      value={supplier}
                      onChange={(e) => setSupplier(e.target.value)}
                      placeholder="Supplier (optional)"
                      list="delivery-suppliers"
                      style={{ ...input, flex: '2 1 150px' }}
                    />
                    <input
                      type="date"
                      value={arrivedOn}
                      max={isoToday()}
                      onChange={(e) => setArrivedOn(e.target.value)}
                      title="When the delivery arrived"
                      style={{ ...input, flex: '1 1 140px' }}
                    />
                    <input
                      value={cost}
                      onChange={(e) => setCost(e.target.value.replace(/[^0-9.]/g, ''))}
                      placeholder="Cost £"
                      inputMode="decimal"
                      style={{ ...input, flex: '1 1 90px', minWidth: 0 }}
                    />
                  </div>
                  {arrivedOn !== isoToday() && (
                    <div style={{ fontSize: '0.75rem', color: colors.textSecondary, marginTop: '-0.35rem' }}>
                      Dated {arrivalDate(arrivedOn)?.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} — it'll count towards that day's stock period, not today's.
                    </div>
                  )}
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

      {/* Capture → read → review → log */}
      {scanOpen && (
        <DeliveryNoteScan
          venuePath={selectedPub.path}
          items={items}
          existingNotes={notes}
          colors={colors}
          accent={accent}
          onAccent={colors.onDelivery}
          receivedBy={byName}
          onClose={() => setScanOpen(false)}
          onDone={(logged, failed) => {
            setScanOpen(false);
            refreshLearned();
            showToast(failed
              ? `Logged ${logged}, ${failed} failed`
              : `Logged ${logged} deliver${logged === 1 ? 'y' : 'ies'} from the note`);
          }}
        />
      )}

      {/* The kept document, full size */}
      {viewNote && (
        <div
          onClick={closeNote}
          style={{ position: 'fixed', inset: 0, zIndex: 5000, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
        >
          {(viewNote.mimeType || '').startsWith('image/') ? (
            <img src={viewNote.src} alt={viewNote.fileName || 'Delivery note'} style={{ maxWidth: '100%', maxHeight: '92vh', objectFit: 'contain', borderRadius: '8px' }} />
          ) : (
            <iframe title="Delivery note" src={viewNote.src} onClick={(e) => e.stopPropagation()} style={{ width: '100%', height: '92vh', border: 'none', borderRadius: '8px', backgroundColor: '#fff' }} />
          )}
        </div>
      )}

      {/* Review modal: AI-suggested case sizes, editable before applying */}
      {caseSuggest && caseSuggest !== 'loading' && (
        <div
          onClick={() => !applyingSizes && setCaseSuggest(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 5000, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: colors.bgCard, borderRadius: '14px', boxShadow: `0 12px 40px ${colors.shadow}`, padding: '1.25rem', maxWidth: '480px', width: '100%', display: 'flex', flexDirection: 'column', maxHeight: '85vh' }}>
            <div style={{ fontWeight: 700, fontSize: '1.05rem', color: colors.textPrimary, marginBottom: '0.25rem' }}>Suggested case sizes</div>
            <div style={{ fontSize: '0.82rem', color: colors.textSecondary, marginBottom: '0.85rem' }}>
              Learned from each item's size and category. Adjust any that are wrong, clear to skip, then apply.
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.35rem', paddingRight: '0.25rem' }}>
              {caseSuggest.rows.map((r) => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.4rem 0.5rem', border: `1px solid ${colors.borderLight}`, borderRadius: '8px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.88rem', color: colors.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                    {r.desc && <div style={{ fontSize: '0.72rem', color: colors.textSecondary }}>{r.desc}</div>}
                  </div>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={r.value}
                    onChange={(e) => setSuggestValue(r.id, e.target.value)}
                    style={{ width: '52px', flexShrink: 0, padding: '0.45rem', fontSize: '0.95rem', fontWeight: 'bold', textAlign: 'center', border: `2px solid ${colors.border}`, borderRadius: '8px', backgroundColor: colors.bgCard, color: colors.textPrimary }}
                  />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1rem' }}>
              <button
                onClick={() => setCaseSuggest(null)}
                disabled={applyingSizes}
                style={{ flexShrink: 0, padding: '0.8rem 1.1rem', backgroundColor: colors.bgLight, color: colors.textPrimary, border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}
              >Cancel</button>
              <button
                onClick={handleApplySizes}
                disabled={applyingSizes}
                style={{ flex: 1, padding: '0.8rem', backgroundColor: accent, color: colors.onDelivery, border: 'none', borderRadius: '10px', fontWeight: 700, fontSize: '1rem', cursor: applyingSizes ? 'wait' : 'pointer', opacity: applyingSizes ? 0.6 : 1 }}
              >{applyingSizes ? 'Applying…' : `Apply ${caseSuggest.rows.filter((r) => parseInt(r.value, 10) > 0).length} case sizes`}</button>
            </div>
          </div>
        </div>
      )}

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
