/**
 * StockBuilder — build a stock list from scratch, one card at a time, and
 * (optionally) count it as you go.
 *
 * No AI, no upload: the user picks a section, names the item, and chooses its
 * volume/unit with the same picker as a stock count. They can also enter a count
 * (whole + tenths/part, same as a real count) — leave it blank to just add the
 * item to the list. Each save persists the item immediately (for reuse) and, if a
 * count was entered, records it into a live Bar/Kitchen stock take created on
 * demand. So one walk of the cellar builds the list AND does the first count.
 *
 * Props:
 *   venuePath
 *   existingCategories - string[] (for quick-pick / consistency)
 *   existingItems      - [{ name, wholeUnit, partUnit }] (duplicate guard)
 *   userId, userName   - who's counting (for the stock-take session)
 *   onClose()
 */

import React, { useRef, useState } from 'react';
import { saveOrUpdateStockItem, saveStockCount } from '../services/apiService';
import UnitPicker from './UnitPicker';
import { dupKey } from '../utils/stockDedup';
import { parseUnitInfo } from '../utils/stockUnitUtils';
import { computeCount } from '../utils/countMath';
import { getThemeColors } from '../utils/theme';
import useTheme from '../hooks/useTheme';

function StockBuilder({ venuePath, existingCategories = [], existingItems = [], userName, initialSection = 'bar', getSessionId, onClose }) {
  const { isDark } = useTheme();
  const colors = getThemeColors(isDark);
  const nameRef = useRef(null);

  const [section, setSection] = useState(initialSection);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [unit, setUnit] = useState({ wholeUnit: '', partUnit: '', unit: '', casePack: 0 });
  const [cases, setCases] = useState('');
  const [whole, setWhole] = useState('');
  const [tenths, setTenths] = useState('');
  const [part, setPart] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [added, setAdded] = useState([]); // recent { name, wholeUnit, partUnit, counted }, newest first
  const [cats, setCats] = useState(existingCategories);

  const unitInfo = parseUnitInfo({ wholeUnit: unit.wholeUnit, partUnit: unit.partUnit });
  const useTenths = unitInfo.hasPartUnit && unitInfo.hasTenthsOption;
  const usePart = unitInfo.hasPartUnit && !unitInfo.hasTenthsOption;
  const hasCount = !computeCount(unitInfo, { cases, whole, tenths, part }).empty;

  // Name+volume already in the saved list or added this session?
  const taken = new Set([
    ...existingItems.map((i) => dupKey(i.name, i.wholeUnit, i.partUnit)),
    ...added.map((a) => dupKey(a.name, a.wholeUnit, a.partUnit)),
  ]);
  // Skip the check mid-save: the parent's live listener adds the just-saved item
  // to existingItems while the name field still holds it, which would otherwise
  // flash a false "already in your list" warning for a frame before name resets.
  const isDuplicate = !saving && name.trim() && taken.has(dupKey(name, unit.wholeUnit, unit.partUnit));

  const resetEntry = () => {
    setName('');           // keep section / category / unit for fast repeat
    setCases(''); setWhole(''); setTenths(''); setPart('');
    nameRef.current?.focus();
  };

  const save = async () => {
    const nm = name.trim();
    if (!nm || saving) return;
    if (isDuplicate) { setError(`"${nm}" with that volume is already in your stock list.`); return; }
    setSaving(true);
    setError(null);

    const res = await saveOrUpdateStockItem(venuePath, null, {
      name: nm,
      section,
      category: category.trim(),
      wholeUnit: unit.wholeUnit || '',
      partUnit: unit.partUnit || '',
      unit: unit.unit || '',
      casePack: unit.casePack || 0,
      quantity: 0,
      archived: false,
      categorySuggested: '',
    });

    if (!res.success) {
      setSaving(false);
      setError('Could not save: ' + res.error);
      return;
    }

    // Optional count → record it into this section's stock take (create on demand).
    const c = computeCount(unitInfo, { cases, whole, tenths, part });
    let counted = false;
    if (!c.empty) {
      try {
        const sid = await getSessionId(section);
        if (!sid) throw new Error('no stock take session');
        await saveStockCount(venuePath, sid, res.id, {
          caseCount: c.caseCount,
          caseLabel: unitInfo.caseLabel,
          wholeCount: c.wholeCount,
          partCount: c.partCount,
          quantity: c.quantity,
          itemName: nm,
          wholeLabel: unitInfo.wholeLabel,
          partLabel: c.partLabel,
          countedBy: userName || '',
        });
        counted = true;
      } catch (e) {
        // Item is saved; the count didn't stick — tell them so it isn't silently lost.
        setSaving(false);
        setError(`Added "${nm}" to the list, but its count didn't save (${e.message}). Count it again on the stock page.`);
        setAdded((a) => [{ name: nm, wholeUnit: unit.wholeUnit || '', partUnit: unit.partUnit || '', counted: false }, ...a].slice(0, 50));
        resetEntry();
        return;
      }
    }

    setSaving(false);
    setAdded((a) => [{ name: nm, wholeUnit: unit.wholeUnit || '', partUnit: unit.partUnit || '', counted }, ...a].slice(0, 50));
    if (category.trim() && !cats.includes(category.trim())) setCats([...cats, category.trim()]);
    resetEntry();
  };

  const input = {
    width: '100%', padding: '0.7rem', fontSize: '1rem', boxSizing: 'border-box',
    border: `2px solid ${colors.border}`, borderRadius: '8px',
    backgroundColor: colors.bgCard, color: colors.textPrimary,
  };
  const segBtn = (active, accent) => ({
    flex: 1, padding: '0.6rem', border: 'none', borderRadius: '8px',
    backgroundColor: active ? accent : colors.bgLight, color: active ? '#fff' : colors.textPrimary,
    fontWeight: active ? 700 : 500, cursor: 'pointer',
  });
  const qtyField = {
    width: '100%', padding: '0.7rem', fontSize: '1.15rem', textAlign: 'center', boxSizing: 'border-box',
    border: `2px solid ${colors.border}`, borderRadius: '8px', backgroundColor: colors.bgCard, color: colors.textPrimary,
  };

  const countedCount = added.filter((a) => a.counted).length;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 3000, backgroundColor: colors.bgPage,
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{ padding: 'max(1rem, env(safe-area-inset-top)) 1.25rem 1rem', borderBottom: `1px solid ${colors.borderLight}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.bgCard }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '1.1rem', color: colors.textPrimary }}>Build your stock list</div>
          <div style={{ fontSize: '0.8rem', color: colors.textSecondary }}>
            {added.length === 0 ? 'Add your first item — count it now or later' : `${added.length} added${countedCount ? ` · ${countedCount} counted` : ''}`}
          </div>
        </div>
        <button onClick={onClose} style={{ padding: '0.5rem 1rem', backgroundColor: colors.primary, color: colors.onPrimary, border: 'none', borderRadius: '8px', fontWeight: 700, cursor: 'pointer' }}>Done</button>
      </div>

      {/* Form */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem', maxWidth: '480px', width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
        {error && <div style={{ color: colors.errorDark, marginBottom: '0.75rem', fontSize: '0.9rem' }}>{error}</div>}

        <label style={{ fontSize: '0.8rem', fontWeight: 600, color: colors.textSecondary }}>Section</label>
        <div style={{ display: 'flex', gap: '0.5rem', margin: '0.3rem 0 1rem' }}>
          <button onClick={() => setSection('bar')} style={segBtn(section === 'bar', colors.primary)}>Bar</button>
          <button onClick={() => setSection('kitchen')} style={segBtn(section === 'kitchen', '#d69e2e')}>Kitchen</button>
        </div>

        <label style={{ fontSize: '0.8rem', fontWeight: 600, color: colors.textSecondary }}>Item name</label>
        <input
          ref={nameRef} value={name} autoFocus
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Beavertown Neck Oil"
          style={{ ...input, margin: '0.3rem 0 0.3rem', borderColor: isDuplicate ? colors.error : colors.border }}
        />
        <div style={{ minHeight: '1.1rem', margin: '0 0 0.75rem', fontSize: '0.78rem', color: colors.error }}>
          {isDuplicate ? 'Already in your list at this volume — change the name or the volume.' : ''}
        </div>

        <label style={{ fontSize: '0.8rem', fontWeight: 600, color: colors.textSecondary }}>Category (optional)</label>
        <input
          list="sb-cats" value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="e.g. Draught Ale"
          style={{ ...input, margin: '0.3rem 0 1rem' }}
        />
        <datalist id="sb-cats">{cats.map((c) => <option key={c} value={c} />)}</datalist>

        <label style={{ fontSize: '0.8rem', fontWeight: 600, color: colors.textSecondary }}>Volume / how it's counted</label>
        <div style={{ marginTop: '0.4rem' }}>
          <UnitPicker section={section} value={{ wholeUnit: unit.wholeUnit, partUnit: unit.partUnit, unit: unit.unit, casePack: unit.casePack }} onChange={setUnit} colors={colors} />
        </div>

        {/* Optional count */}
        <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: `1px solid ${colors.borderLight}` }}>
          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: colors.textSecondary }}>
            Count now <span style={{ fontWeight: 400 }}>(optional — leave blank to just add it)</span>
          </label>
          <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.5rem' }}>
            {unitInfo.casePack > 0 && (
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.72rem', color: colors.textSecondary, marginBottom: '0.2rem', textAlign: 'center' }}>Cases (×{unitInfo.casePack})</div>
                <input type="number" inputMode="numeric" min="0" value={cases} onChange={(e) => setCases(e.target.value)} placeholder="0" style={qtyField} />
              </div>
            )}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.72rem', color: colors.textSecondary, marginBottom: '0.2rem', textAlign: 'center' }}>{unitInfo.wholeLabel}</div>
              <input type="number" inputMode="decimal" min="0" value={whole} onChange={(e) => setWhole(e.target.value)} placeholder="0" style={qtyField} />
            </div>
            {useTenths && (
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.72rem', color: colors.textSecondary, marginBottom: '0.2rem', textAlign: 'center' }}>Tenths (0–9)</div>
                <input type="number" inputMode="numeric" min="0" max="9" value={tenths}
                  onChange={(e) => { const v = e.target.value; if (v === '' || parseFloat(v) <= 9) setTenths(v); }}
                  placeholder="0" style={qtyField} />
              </div>
            )}
            {usePart && (
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.72rem', color: colors.textSecondary, marginBottom: '0.2rem', textAlign: 'center' }}>{unitInfo.partLabel}</div>
                <input type="number" inputMode="decimal" min="0" value={part} onChange={(e) => setPart(e.target.value)} placeholder="0" style={qtyField} />
              </div>
            )}
          </div>
        </div>

        {/* Recently added */}
        {added.length > 0 && (
          <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: `1px solid ${colors.borderLight}` }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: colors.textSecondary, marginBottom: '0.5rem' }}>Added so far</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
              {added.map((a, i) => (
                <span key={i} style={{ fontSize: '0.78rem', padding: '0.2rem 0.55rem', borderRadius: '9999px', backgroundColor: colors.bgLight, color: colors.textPrimary, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                  {a.counted && <span style={{ color: colors.success || '#2f855a' }}>✓</span>}{a.name}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Save bar */}
      <div style={{ padding: '0.85rem 1.25rem max(0.85rem, env(safe-area-inset-bottom))', borderTop: `1px solid ${colors.borderLight}`, backgroundColor: colors.bgCard }}>
        <button
          onClick={save}
          disabled={!name.trim() || saving || isDuplicate}
          style={{
            width: '100%', maxWidth: '480px', margin: '0 auto', display: 'block',
            padding: '0.9rem', backgroundColor: colors.primary, color: colors.onPrimary,
            border: 'none', borderRadius: '10px', fontWeight: 700, fontSize: '1.05rem',
            cursor: (!name.trim() || saving || isDuplicate) ? 'not-allowed' : 'pointer',
            opacity: (!name.trim() || saving || isDuplicate) ? 0.6 : 1,
          }}
        >
          {saving ? 'Saving…' : isDuplicate ? 'Already added' : hasCount ? 'Save & count next →' : 'Save & add another →'}
        </button>
      </div>
    </div>
  );
}

export default StockBuilder;
