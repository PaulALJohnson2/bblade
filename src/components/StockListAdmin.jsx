/**
 * StockListAdmin — manage a venue's stock list from the Settings page.
 *
 *  - Upload one or more CSV/JSON files; their items are parsed client-side,
 *    merged, previewed, then APPENDED to the existing list (addStockItems).
 *  - A temporary "Delete stock list" button wipes every item (deleteAllStockItems),
 *    behind an inline confirm.
 *
 * Props:
 *   venuePath - accounts/{accountId}/venues/{venueId}
 *   canEdit   - whether the user may modify the list
 */

import React, { useEffect, useRef, useState } from 'react';
import { addStockItems, deleteAllStockItems, getAllStockItems } from '../services/apiService';
import { enrichItemsWithInference, splitMealsIntoComponents } from '../services/aiInference';
import { buildMealReviewList, applyMealSplits } from '../utils/mealSplit';
import MealSplitReview from './MealSplitReview';
import { parseStockList, STOCK_CSV_TEMPLATE } from '../utils/parseStockList';
import { getThemeColors } from '../utils/theme';
import useTheme from '../hooks/useTheme';

function StockListAdmin({ venuePath, canEdit = true }) {
  const { isDark } = useTheme();
  const colors = getThemeColors(isDark);
  const fileInputRef = useRef(null);

  const [currentCount, setCurrentCount] = useState(null);
  const [parsed, setParsed] = useState(null);   // { items, skipped, fileNames, summary, source }
  const [error, setError] = useState(null);
  const [analysing, setAnalysing] = useState(false);
  const [busy, setBusy] = useState(null);       // 'adding' | 'deleting' | null
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [reviewing, setReviewing] = useState(false); // meal-split wizard open

  const refreshCount = async () => {
    const res = await getAllStockItems(venuePath);
    setCurrentCount(res?.success && Array.isArray(res.data) ? res.data.length : 0);
  };

  useEffect(() => { refreshCount(); }, [venuePath]);

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setError(null);
    setParsed(null);

    const allItems = [];
    let skipped = 0;
    const fileNames = [];
    const fileErrors = [];

    for (const file of files) {
      try {
        const text = await file.text();
        const result = parseStockList(text, file.name);
        if (result.error) { fileErrors.push(`${file.name}: ${result.error}`); continue; }
        if (!result.items.length) { fileErrors.push(`${file.name}: no items found`); continue; }
        allItems.push(...result.items);
        skipped += result.skipped || 0;
        fileNames.push(file.name);
      } catch {
        fileErrors.push(`${file.name}: could not be read`);
      }
    }

    if (fileErrors.length) setError(fileErrors.join(' · '));
    // reset the input so re-selecting the same file fires onChange again
    if (fileInputRef.current) fileInputRef.current.value = '';

    if (allItems.length) {
      // Gemini sorts bar/kitchen/ignore + suggests categories, then breaks kitchen
      // "meals" (till menu lines) into ingredient components. Keyword fallback if AI off.
      setAnalysing(true);
      const enriched = await enrichItemsWithInference(allItems);
      const kitchenNames = enriched.items
        .filter((i) => !i.archived && (i.section || 'bar') === 'kitchen')
        .map((i) => i.name);
      const split = await splitMealsIntoComponents(kitchenNames);
      const meals = buildMealReviewList(enriched.items, split.map);
      setAnalysing(false);
      setParsed({ items: enriched.items, skipped, fileNames, summary: enriched.summary, source: enriched.source, meals });
    }
  };

  // Commit a finished item list to Firestore.
  const doImport = async (items) => {
    setBusy('adding');
    setError(null);
    const result = await addStockItems(venuePath, items);
    setBusy(null);
    setReviewing(false);
    if (result.success) {
      setParsed(null);
      await refreshCount();
    } else {
      setError('Import failed: ' + result.error);
    }
  };

  const handleAdd = async () => {
    if (!parsed || busy) return;
    // If the AI found meals to break down, review them one at a time first.
    if (parsed.meals && parsed.meals.length > 0) {
      setReviewing(true);
      return;
    }
    await doImport(parsed.items);
  };

  const handleReviewComplete = async (decisions) => {
    const finalItems = applyMealSplits(parsed.items, decisions);
    await doImport(finalItems);
  };

  const handleDeleteAll = async () => {
    if (busy) return;
    setBusy('deleting');
    setError(null);
    const result = await deleteAllStockItems(venuePath);
    setBusy(null);
    setConfirmingDelete(false);
    if (result.success) {
      await refreshCount();
    } else {
      setError('Delete failed: ' + result.error);
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob([STOCK_CSV_TEMPLATE], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bblade-stock-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const card = {
    backgroundColor: colors.bgCard,
    border: `1px solid ${colors.borderLight}`,
    borderRadius: '12px',
    padding: '1.5rem',
    marginBottom: '1.5rem',
    boxShadow: `0 2px 12px ${colors.shadow}`,
  };
  const primaryBtn = {
    padding: '0.85rem 1.25rem', backgroundColor: colors.primary, color: colors.onPrimary,
    border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '1rem', fontWeight: 600,
    flexShrink: 0, whiteSpace: 'nowrap',
  };
  const subtleBtn = {
    padding: '0.85rem 1.25rem', backgroundColor: colors.bgLight, color: colors.textPrimary,
    border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '1rem',
  };

  if (!canEdit) return null;

  return (
    <div style={card}>
      <h2 style={{ margin: '0 0 0.25rem', fontSize: '1.1rem', color: colors.textPrimary }}>Stock list</h2>
      <p style={{ margin: '0 0 1rem', color: colors.textSecondary, fontSize: '0.85rem' }}>
        {currentCount === null ? 'Loading…' : `${currentCount} item${currentCount === 1 ? '' : 's'} in this pub's stock list.`}
        {' '}Upload one or more CSV/JSON files to add to it.
      </p>

      {error && (
        <div style={{ color: colors.errorDark, marginBottom: '1rem', fontSize: '0.9rem' }}>{error}</div>
      )}

      {reviewing && parsed?.meals?.length > 0 && (
        <MealSplitReview
          meals={parsed.meals}
          colors={colors}
          onComplete={handleReviewComplete}
          onCancel={() => setReviewing(false)}
        />
      )}

      {/* Upload + preview */}
      {analysing ? (
        <div style={{
          padding: '0.85rem 1rem', backgroundColor: colors.bgLight, borderRadius: '8px',
          marginBottom: '0.75rem', color: colors.textSecondary, fontSize: '0.9rem',
          display: 'flex', alignItems: 'center', gap: '0.6rem',
        }}>
          <div style={{ width: '18px', height: '18px', border: `3px solid ${colors.bgCard}`, borderTopColor: colors.primary, borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
          Sorting food vs drink &amp; breaking down meals…
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      ) : parsed ? (
        <div style={{ marginBottom: '1rem' }}>
          <div style={{
            padding: '0.85rem 1rem', backgroundColor: colors.bgLight, borderRadius: '8px',
            marginBottom: '0.75rem', color: colors.textPrimary, fontSize: '0.9rem',
          }}>
            <strong>{parsed.items.length}</strong> item{parsed.items.length === 1 ? '' : 's'} from{' '}
            {parsed.fileNames.length} file{parsed.fileNames.length === 1 ? '' : 's'} ({parsed.fileNames.join(', ')})
            {parsed.skipped > 0 && (
              <span style={{ color: colors.warning }}> · {parsed.skipped} row(s) skipped</span>
            )}
          </div>
          {parsed.summary && (
            <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.5rem' }}>
              {[['Bar', parsed.summary.bar, colors.primary], ['Kitchen', parsed.summary.kitchen, '#d69e2e'], ['Ignore', parsed.summary.ignore, colors.textMuted]].map(([label, n, c]) => (
                <div key={label} style={{ flex: 1, textAlign: 'center', padding: '0.5rem', backgroundColor: colors.bgLight, borderRadius: '8px' }}>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: c }}>{n || 0}</div>
                  <div style={{ fontSize: '0.75rem', color: colors.textSecondary }}>{label}</div>
                </div>
              ))}
            </div>
          )}
          <div style={{ fontSize: '0.75rem', color: colors.textSecondary, marginBottom: '0.75rem' }}>
            {parsed.source === 'ai'
              ? '✨ Sorted by AI — check the split before importing.'
              : 'Sorted by keyword rules (AI off) — check the split before importing.'}
          </div>
          {parsed.meals && parsed.meals.length > 0 && (
            <div style={{ fontSize: '0.8rem', color: colors.textPrimary, backgroundColor: colors.primarySoft, padding: '0.6rem 0.75rem', borderRadius: '8px', marginBottom: '0.75rem' }}>
              🍽 <strong>{parsed.meals.length} meal{parsed.meals.length === 1 ? '' : 's'}</strong> can be broken into ingredients — you'll confirm each one before importing.
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={handleAdd} disabled={busy === 'adding'} style={{ ...primaryBtn, flex: 1, opacity: busy === 'adding' ? 0.6 : 1 }}>
              {busy === 'adding'
                ? 'Adding…'
                : parsed.meals && parsed.meals.length > 0
                  ? `Review ${parsed.meals.length} meals & add`
                  : `Add ${parsed.items.length} items to stock`}
            </button>
            <button onClick={() => { setParsed(null); setError(null); }} style={subtleBtn}>Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => fileInputRef.current?.click()} style={{ ...primaryBtn, width: '100%', marginBottom: '0.75rem' }}>
          Upload CSV / JSON file(s)
        </button>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.json,.txt,text/csv,application/json"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => handleFiles(e.target.files)}
      />

      <button onClick={downloadTemplate} style={{
        background: 'none', border: 'none', color: colors.primary, cursor: 'pointer',
        padding: 0, fontSize: '0.85rem', textDecoration: 'underline',
      }}>
        Download CSV template
      </button>

      {/* Temporary: delete the whole stock list */}
      <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: `1px solid ${colors.borderLight}` }}>
        {confirmingDelete ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ color: colors.textPrimary, fontSize: '0.9rem', flex: 1, minWidth: '180px' }}>
              Delete all {currentCount ?? ''} items? This can't be undone.
            </span>
            <button onClick={handleDeleteAll} disabled={busy === 'deleting'} style={{
              padding: '0.6rem 1rem', backgroundColor: colors.error, color: '#fff', border: 'none',
              borderRadius: '8px', cursor: 'pointer', fontWeight: 600, opacity: busy === 'deleting' ? 0.6 : 1,
            }}>
              {busy === 'deleting' ? 'Deleting…' : 'Yes, delete all'}
            </button>
            <button onClick={() => setConfirmingDelete(false)} style={subtleBtn}>Cancel</button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmingDelete(true)}
            disabled={!currentCount}
            style={{
              padding: '0.6rem 1rem', backgroundColor: 'transparent', color: colors.error,
              border: `1px solid ${colors.error}`, borderRadius: '8px',
              cursor: currentCount ? 'pointer' : 'not-allowed', fontWeight: 600, fontSize: '0.9rem',
              opacity: currentCount ? 1 : 0.5,
            }}
          >
            🗑 Delete stock list (temporary)
          </button>
        )}
      </div>
    </div>
  );
}

export default StockListAdmin;
