/**
 * StockManager — admin editing for the stock list.
 *
 *  - Edit an item's name, category, and section (Bar / Kitchen / Ignore), or delete it.
 *  - Category tools: rename a category (the filter "pill") across all its items,
 *    or move a whole category between Bar and Kitchen.
 *
 * Props: venuePath, canEdit
 */

import React, { useEffect, useState } from 'react';
import { getAllStockItems, saveOrUpdateStockItem, deleteStockItem, bulkPatchStockItems } from '../services/apiService';
import UnitPicker from './UnitPicker';
import { getThemeColors } from '../utils/theme';
import useTheme from '../hooks/useTheme';

const sectionOf = (it) => (it.archived ? 'ignore' : (it.section || 'bar'));

function StockManager({ venuePath, canEdit = true }) {
  const { isDark } = useTheme();
  const colors = getThemeColors(isDark);

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all'); // all | bar | kitchen | ignore
  const [expandedId, setExpandedId] = useState(null);
  const [draft, setDraft] = useState(null);     // editing draft for expandedId
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(null); // item id
  const [showCats, setShowCats] = useState(false);
  const [catDrafts, setCatDrafts] = useState({}); // category -> edited name

  const load = async () => {
    setLoading(true);
    const res = await getAllStockItems(venuePath);
    setItems(res?.success && Array.isArray(res.data) ? res.data : []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [venuePath]);

  const categories = [...new Set(items.map(i => i.category).filter(Boolean))].sort();
  const itemsInCat = (c) => items.filter(i => i.category === c);

  const q = search.trim().toLowerCase();
  const visible = items.filter(i => {
    if (filter !== 'all' && sectionOf(i) !== filter) return false;
    if (q && !((i.name || '').toLowerCase().includes(q) || (i.category || '').toLowerCase().includes(q))) return false;
    return true;
  });

  // ---- item editing ----
  const openEdit = (it) => {
    if (expandedId === it.id) { setExpandedId(null); setDraft(null); return; }
    setExpandedId(it.id);
    setDraft({
      name: it.name || '', category: it.category || '', section: sectionOf(it),
      wholeUnit: it.wholeUnit || '', partUnit: it.partUnit || '', unit: it.unit || '', casePack: it.casePack || 0,
    });
  };

  const saveItem = async (it) => {
    setBusy(true);
    const patch = {
      name: draft.name.trim() || it.name,
      category: draft.category.trim(),
      section: draft.section === 'ignore' ? (it.section || 'bar') : draft.section,
      archived: draft.section === 'ignore',
      wholeUnit: draft.wholeUnit || '',
      partUnit: draft.partUnit || '',
      unit: draft.unit || '',
      casePack: draft.casePack || 0,
    };
    const res = await saveOrUpdateStockItem(venuePath, it.id, patch);
    setBusy(false);
    if (res.success) { setExpandedId(null); setDraft(null); await load(); }
  };

  const removeItem = async (it) => {
    setBusy(true);
    await deleteStockItem(venuePath, it.id);
    setBusy(false);
    setConfirmingDelete(null);
    setExpandedId(null);
    await load();
  };

  // ---- category tools ----
  const renameCategory = async (oldName) => {
    const next = (catDrafts[oldName] ?? oldName).trim();
    if (!next || next === oldName) return;
    setBusy(true);
    await bulkPatchStockItems(venuePath, itemsInCat(oldName).map(i => i.id), { category: next });
    setBusy(false);
    setCatDrafts(d => { const n = { ...d }; delete n[oldName]; return n; });
    await load();
  };

  const moveCategory = async (cat, section) => {
    setBusy(true);
    await bulkPatchStockItems(venuePath, itemsInCat(cat).map(i => i.id), { section, archived: false });
    setBusy(false);
    await load();
  };

  // ---- styles ----
  const card = { backgroundColor: colors.bgCard, border: `1px solid ${colors.borderLight}`, borderRadius: '12px', padding: '1.5rem', marginBottom: '1.5rem', boxShadow: `0 2px 12px ${colors.shadow}` };
  const input = { width: '100%', padding: '0.6rem', fontSize: '0.95rem', border: `2px solid ${colors.border}`, borderRadius: '8px', backgroundColor: colors.bgCard, color: colors.textPrimary, boxSizing: 'border-box' };
  const chip = (active) => ({ flexShrink: 0, padding: '0.4rem 0.85rem', borderRadius: '9999px', border: `1px solid ${active ? colors.primary : colors.border}`, backgroundColor: active ? colors.primarySoft : colors.bgCard, color: active ? colors.primary : colors.textPrimary, fontWeight: active ? 700 : 500, fontSize: '0.85rem', cursor: 'pointer', textTransform: 'capitalize' });
  const segBtn = (active, accent) => ({ flex: 1, padding: '0.55rem', border: 'none', borderRadius: '6px', backgroundColor: active ? accent : colors.bgLight, color: active ? '#fff' : colors.textPrimary, fontWeight: active ? 700 : 500, fontSize: '0.85rem', cursor: 'pointer', textTransform: 'capitalize' });
  const linkBtn = { background: 'none', border: 'none', color: colors.primary, cursor: 'pointer', padding: 0, fontSize: '0.8rem', textDecoration: 'underline' };

  if (!canEdit) return null;

  return (
    <div style={card}>
      <h2 style={{ margin: '0 0 0.25rem', fontSize: '1.1rem', color: colors.textPrimary }}>Manage stock</h2>
      <p style={{ margin: '0 0 1rem', color: colors.textSecondary, fontSize: '0.85rem' }}>
        Edit names, volume/case size, move items between Bar &amp; Kitchen, rename or move categories.
      </p>

      {loading ? (
        <div style={{ color: colors.textSecondary, padding: '1rem', textAlign: 'center' }}>Loading…</div>
      ) : items.length === 0 ? (
        <div style={{ color: colors.textSecondary, padding: '1rem', textAlign: 'center' }}>No stock items yet.</div>
      ) : (
        <>
          {/* Category tools */}
          <button onClick={() => setShowCats(s => !s)} style={{ ...linkBtn, marginBottom: showCats ? '0.75rem' : '1rem', display: 'block' }}>
            {showCats ? '▾ Hide categories' : `▸ Edit categories (${categories.length})`}
          </button>
          {showCats && (
            <div style={{ marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {categories.map(c => {
                const list = itemsInCat(c);
                const sect = sectionOf(list[0] || {});
                const draftName = catDrafts[c] ?? c;
                return (
                  <div key={c} style={{ padding: '0.6rem', backgroundColor: colors.bgLight, borderRadius: '8px' }}>
                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                      <input value={draftName} onChange={(e) => setCatDrafts(d => ({ ...d, [c]: e.target.value }))} style={{ ...input, padding: '0.45rem' }} />
                      <span style={{ fontSize: '0.75rem', color: colors.textSecondary, whiteSpace: 'nowrap' }}>{list.length}</span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      {draftName.trim() && draftName.trim() !== c && (
                        <button onClick={() => renameCategory(c)} disabled={busy} style={{ ...linkBtn, textDecoration: 'none', fontWeight: 700 }}>Rename →</button>
                      )}
                      <span style={{ fontSize: '0.75rem', color: colors.textSecondary, marginLeft: 'auto' }}>Move all to:</span>
                      <button onClick={() => moveCategory(c, 'bar')} disabled={busy} style={{ ...chip(sect === 'bar'), padding: '0.3rem 0.6rem' }}>Bar</button>
                      <button onClick={() => moveCategory(c, 'kitchen')} disabled={busy} style={{ ...chip(sect === 'kitchen'), padding: '0.3rem 0.6rem' }}>Kitchen</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Search + section filter */}
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search items…" style={{ ...input, marginBottom: '0.5rem' }} />
          <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.75rem', overflowX: 'auto', scrollbarWidth: 'none' }}>
            {['all', 'bar', 'kitchen', 'ignore'].map(f => (
              <button key={f} onClick={() => setFilter(f)} style={chip(filter === f)}>{f === 'ignore' ? 'Ignored' : f}</button>
            ))}
          </div>

          {/* Item list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {visible.length === 0 && <div style={{ color: colors.textSecondary, fontSize: '0.85rem', textAlign: 'center', padding: '0.75rem' }}>No matching items.</div>}
            {visible.slice(0, 300).map(it => {
              const open = expandedId === it.id;
              const sect = sectionOf(it);
              return (
                <div key={it.id} style={{ border: `1px solid ${colors.borderLight}`, borderRadius: '8px', overflow: 'hidden' }}>
                  <button onClick={() => openEdit(it)} style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 0.75rem', background: 'none', border: 'none', cursor: 'pointer' }}>
                    <span style={{ flex: 1, minWidth: 0, color: colors.textPrimary, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name}</span>
                    {it.category && <span style={{ fontSize: '0.7rem', color: colors.textSecondary }}>{it.category}</span>}
                    <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '0.1rem 0.4rem', borderRadius: '9999px', color: '#fff', backgroundColor: sect === 'kitchen' ? '#d69e2e' : sect === 'ignore' ? colors.textMuted : colors.primary }}>
                      {sect === 'ignore' ? 'IGN' : sect === 'kitchen' ? 'KIT' : 'BAR'}
                    </span>
                  </button>
                  {open && draft && (
                    <div style={{ padding: '0.75rem', borderTop: `1px solid ${colors.borderLight}`, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <label style={{ fontSize: '0.75rem', color: colors.textSecondary }}>Name</label>
                      <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={input} />
                      <label style={{ fontSize: '0.75rem', color: colors.textSecondary }}>Category</label>
                      <input list="bb-cats" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} placeholder="(none)" style={input} />
                      <label style={{ fontSize: '0.75rem', color: colors.textSecondary }}>Section</label>
                      <div style={{ display: 'flex', gap: '0.4rem' }}>
                        <button onClick={() => setDraft({ ...draft, section: 'bar' })} style={segBtn(draft.section === 'bar', colors.primary)}>Bar</button>
                        <button onClick={() => setDraft({ ...draft, section: 'kitchen' })} style={segBtn(draft.section === 'kitchen', '#d69e2e')}>Kitchen</button>
                        <button onClick={() => setDraft({ ...draft, section: 'ignore' })} style={segBtn(draft.section === 'ignore', colors.textMuted)}>Ignore</button>
                      </div>
                      <label style={{ fontSize: '0.75rem', color: colors.textSecondary }}>Volume / how it's counted</label>
                      <UnitPicker
                        section={draft.section === 'kitchen' ? 'kitchen' : 'bar'}
                        value={{ wholeUnit: draft.wholeUnit, partUnit: draft.partUnit, unit: draft.unit, casePack: draft.casePack }}
                        onChange={(u) => setDraft({ ...draft, ...u })}
                        colors={colors}
                      />
                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                        <button onClick={() => saveItem(it)} disabled={busy} style={{ flex: 1, padding: '0.7rem', backgroundColor: colors.primary, color: colors.onPrimary, border: 'none', borderRadius: '8px', fontWeight: 700, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
                          {busy ? 'Saving…' : 'Save'}
                        </button>
                        {confirmingDelete === it.id ? (
                          <button onClick={() => removeItem(it)} disabled={busy} style={{ padding: '0.7rem 1rem', backgroundColor: colors.error, color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 700, cursor: 'pointer' }}>Confirm</button>
                        ) : (
                          <button onClick={() => setConfirmingDelete(it.id)} style={{ padding: '0.7rem 1rem', backgroundColor: 'transparent', color: colors.error, border: `1px solid ${colors.error}`, borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>Delete</button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {visible.length > 300 && <div style={{ fontSize: '0.75rem', color: colors.textSecondary, textAlign: 'center', padding: '0.5rem' }}>Showing first 300 — search to narrow.</div>}
          </div>
          <datalist id="bb-cats">{categories.map(c => <option key={c} value={c} />)}</datalist>
        </>
      )}
    </div>
  );
}

export default StockManager;
