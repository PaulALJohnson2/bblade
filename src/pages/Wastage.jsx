/**
 * Wastage — a quick rolling log of wasted stock.
 *
 * Not a session like a stock take: pick an item, enter the amount (same unit
 * steppers as a count), choose a reason (+ optional note), and "Log wastage".
 * Each entry saves instantly, decrements that item's stock, and appears in the
 * recent-wastage list (where it can be undone). Bar/Kitchen tabs mirror counts.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { subscribeToStockItems, logWastage, subscribeToWastageLog, deleteWastageEntry } from '../services/apiService';
import { wastageUnitsFor, computeWastageQuantity } from '../utils/wastageUnits';
import { WASTAGE_REASONS } from '../utils/wastageReasons';
import WastageEntry from '../components/WastageEntry';
import { getThemeColors } from '../utils/theme';
import useTheme from '../hooks/useTheme';

const sectionOf = (it) => (it.section === 'kitchen' ? 'kitchen' : 'bar');

// Human summary of a wastage entry from its stored sale-unit breakdown.
function wasteSummary(e) {
  if (Array.isArray(e.units) && e.units.length) {
    return e.units.map((u) => `${u.count} ${u.label}`).join(', ');
  }
  return `${e.quantity || 0}`;
}

function Wastage() {
  const navigate = useNavigate();
  const { currentUser, userProfile, selectedPub } = useAuth();
  const { isDark } = useTheme();
  const colors = getThemeColors(isDark);
  const accent = colors.wastage;

  const [items, setItems] = useState([]);
  const [recent, setRecent] = useState([]);
  const [section, setSection] = useState('bar');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);

  const [values, setValues] = useState({}); // sale-unit counts keyed by row.key
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const setValue = (key, val) => setValues((v) => ({ ...v, [key]: val }));

  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [confirmUndo, setConfirmUndo] = useState(null); // entry id

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2200); };

  useEffect(() => {
    if (!selectedPub) return;
    const unsubItems = subscribeToStockItems(selectedPub.path, (list) => setItems(list || []));
    const unsubLog = subscribeToWastageLog(selectedPub.path, (list) => setRecent(list || []));
    return () => { unsubItems(); unsubLog(); };
  }, [selectedPub]);

  const resetEntry = () => {
    setSelectedId(null);
    setValues({}); setReason(''); setNote('');
  };

  const selectItem = (it) => {
    if (selectedId === it.id) { resetEntry(); return; }
    setSelectedId(it.id);
    setValues({}); setReason(''); setNote('');
  };

  const q = search.trim().toLowerCase();
  const visible = useMemo(() => items
    .filter((i) => !i.archived && sectionOf(i) === section)
    .filter((i) => !q || (i.name || '').toLowerCase().includes(q) || (i.category || '').toLowerCase().includes(q)),
    [items, section, q]);

  const selectedItem = items.find((i) => i.id === selectedId) || null;
  const wUnits = selectedItem ? wastageUnitsFor(selectedItem) : null;
  const quantity = wUnits ? computeWastageQuantity(wUnits.rows, values) : 0;
  const canLog = !!selectedItem && quantity > 0 && !!reason && !saving;

  const handleLog = async () => {
    if (!canLog) return;
    setSaving(true);
    const units = wUnits.rows
      .filter((r) => (parseFloat(values[r.key]) || 0) > 0)
      .map((r) => ({ label: r.label, count: Number(values[r.key]) }));
    const res = await logWastage(selectedPub.path, selectedItem.id, {
      itemName: selectedItem.name,
      section: sectionOf(selectedItem),
      units,
      quantity,
      baseLabel: wUnits.baseLabel,
      reason,
      note: note.trim(),
      wastedBy: userProfile?.displayName || currentUser?.email || '',
    });
    setSaving(false);
    if (res.success) { showToast(`Logged wastage: ${selectedItem.name}`); resetEntry(); }
    else showToast('Could not log: ' + res.error);
  };

  const handleUndo = async (entry) => {
    const res = await deleteWastageEntry(selectedPub.path, entry.id);
    setConfirmUndo(null);
    showToast(res.success ? `Undone: ${entry.itemName}` : 'Could not undo: ' + res.error);
  };

  // ---- styles ----
  const input = { width: '100%', padding: '0.7rem', fontSize: '0.95rem', border: `2px solid ${colors.border}`, borderRadius: '8px', backgroundColor: colors.bgCard, color: colors.textPrimary, boxSizing: 'border-box' };
  const tab = (active) => ({ flex: 1, padding: '0.6rem', border: 'none', borderRadius: '8px', backgroundColor: active ? accent : colors.bgLight, color: active ? colors.onWastage : colors.textPrimary, fontWeight: active ? 700 : 500, cursor: 'pointer' });
  const reasonChip = (active) => ({ padding: '0.4rem 0.75rem', borderRadius: '9999px', border: `1px solid ${active ? accent : colors.border}`, backgroundColor: active ? colors.wastageSoft : colors.bgCard, color: active ? accent : colors.textPrimary, fontWeight: active ? 700 : 500, fontSize: '0.85rem', cursor: 'pointer' });

  return (
    <div style={{ maxWidth: '640px', margin: '0 auto', position: 'relative' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <button onClick={() => navigate('/')} style={{ padding: '0.5rem 0.75rem', backgroundColor: colors.bgLight, color: colors.textPrimary, border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.9rem' }}>← Back</button>
        <h1 style={{ margin: 0, fontSize: '1.5rem', color: accent }}>Wastage</h1>
      </div>

      {/* Section tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <button onClick={() => { setSection('bar'); resetEntry(); }} style={tab(section === 'bar')}>Bar</button>
        <button onClick={() => { setSection('kitchen'); resetEntry(); }} style={tab(section === 'kitchen')}>Kitchen</button>
      </div>

      {/* Search */}
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search items…" style={{ ...input, marginBottom: '0.75rem' }} />

      {/* Item list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {visible.length === 0 && <div style={{ color: colors.textSecondary, fontSize: '0.9rem', textAlign: 'center', padding: '1rem' }}>No items.</div>}
        {visible.slice(0, 300).map((it) => {
          const open = selectedId === it.id;
          return (
            <div key={it.id} style={{ border: `1px solid ${open ? accent : colors.borderLight}`, borderRadius: '10px', overflow: 'hidden' }}>
              <button onClick={() => selectItem(it)} style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.7rem 0.85rem', background: open ? colors.wastageSoft : colors.bgCard, border: 'none', cursor: 'pointer' }}>
                <span style={{ flex: 1, minWidth: 0, color: colors.textPrimary, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name}</span>
                {it.category && <span style={{ fontSize: '0.7rem', color: colors.textSecondary }}>{it.category}</span>}
              </button>
              {open && (
                <div style={{ padding: '0.85rem', borderTop: `1px solid ${colors.borderLight}`, display: 'flex', flexDirection: 'column', gap: '0.85rem', backgroundColor: colors.bgCard }}>
                  <WastageEntry
                    item={it}
                    colors={colors}
                    accent={accent}
                    values={values}
                    setValue={setValue}
                    onEnter={handleLog}
                  />

                  {/* Reason */}
                  <div>
                    <div style={{ fontSize: '0.75rem', color: colors.textSecondary, marginBottom: '0.4rem' }}>Reason</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                      {WASTAGE_REASONS.map((r) => (
                        <button key={r} onClick={() => setReason(r)} style={reasonChip(reason === r)}>{r}</button>
                      ))}
                    </div>
                  </div>

                  {/* Note */}
                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" style={input} />

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button onClick={resetEntry} style={{ flexShrink: 0, padding: '0.85rem 1.25rem', backgroundColor: colors.bgLight, color: colors.textPrimary, border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>Cancel</button>
                    <button
                      onClick={handleLog}
                      disabled={!canLog}
                      style={{ flex: 1, padding: '0.85rem', backgroundColor: accent, color: colors.onWastage, border: 'none', borderRadius: '8px', cursor: canLog ? 'pointer' : 'not-allowed', fontWeight: 700, fontSize: '1.05rem', opacity: canLog ? 1 : 0.5 }}
                    >{saving ? 'Logging…' : !reason ? 'Pick a reason' : 'Log wastage'}</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Recent wastage */}
      <div style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: '1.05rem', color: colors.textPrimary, margin: '0 0 0.75rem' }}>Recent wastage</h2>
        {recent.length === 0 ? (
          <div style={{ color: colors.textSecondary, fontSize: '0.9rem' }}>Nothing logged yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {recent.map((e) => {
              const when = e.wastedAt?.toDate ? e.wastedAt.toDate().toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
              const confirming = confirmUndo === e.id;
              return (
                <div key={e.id} style={{ border: `1px solid ${colors.borderLight}`, borderRadius: '10px', padding: '0.6rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: colors.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.itemName}</div>
                    <div style={{ fontSize: '0.78rem', color: colors.textSecondary }}>
                      {wasteSummary(e)}{e.reason ? ` · ${e.reason}` : ''}{e.note ? ` · ${e.note}` : ''}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: colors.textMuted }}>{[e.wastedBy, when].filter(Boolean).join(' · ')}</div>
                  </div>
                  {confirming ? (
                    <button onClick={() => handleUndo(e)} style={{ flexShrink: 0, padding: '0.5rem 0.75rem', backgroundColor: accent, color: colors.onWastage, border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem' }}>Confirm undo</button>
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

export default Wastage;
