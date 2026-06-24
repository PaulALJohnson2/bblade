/**
 * StockListUpload — empty-state onboarding shown when a pub has no stock items.
 *
 * Asks the customer to upload their stock list (CSV or JSON). Parses it client
 * side, shows a preview (item count + bar/kitchen split), then writes the items
 * via importStockList(). Once items land, the realtime listener in StockTaking
 * repopulates and this component unmounts automatically.
 *
 * Props:
 *   venuePath      - target venue path (accounts/{accountId}/venues/{venueId})
 *   canEdit        - whether the user may import/add (false → read-only message)
 *   onAddManually  - optional callback to open the "add one item" form (or null)
 */

import React, { useRef, useState } from 'react';
import { importStockList } from '../services/apiService';
import { parseStockList, STOCK_CSV_TEMPLATE } from '../utils/parseStockList';
import { getThemeColors } from '../utils/theme';
import useTheme from '../hooks/useTheme';

function StockListUpload({ venuePath, canEdit = true, onAddManually = null }) {
  const { isDark } = useTheme();
  const colors = getThemeColors(isDark);
  const fileInputRef = useRef(null);

  const [dragOver, setDragOver] = useState(false);
  const [parsed, setParsed] = useState(null); // { items, skipped, fileName }
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(null); // { completed, total }

  const handleFile = async (file) => {
    if (!file) return;
    setError(null);
    setParsed(null);
    try {
      const text = await file.text();
      const result = parseStockList(text, file.name);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.items.length === 0) {
        setError('No items were found in that file.');
        return;
      }
      setParsed({ ...result, fileName: file.name });
    } catch {
      setError('Could not read that file. Please try a CSV or JSON file.');
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files?.[0]);
  };

  const handleImport = async () => {
    if (!parsed || importing) return;
    setImporting(true);
    setProgress({ completed: 0, total: parsed.items.length });
    const result = await importStockList(venuePath, parsed.items, (p) => setProgress(p));
    if (!result.success) {
      setError('Import failed: ' + result.error);
      setImporting(false);
      setProgress(null);
    }
    // On success we deliberately leave the spinner up — the realtime listener
    // will repopulate stock items and unmount this component.
  };

  const downloadTemplate = () => {
    const blob = new Blob([STOCK_CSV_TEMPLATE], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bar-blade-stock-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const loadSample = async () => {
    setError(null);
    try {
      const mod = await import('../data/dukeStockList.json');
      const items = mod.default || mod;
      setParsed({ items, skipped: 0, fileName: 'sample stock list' });
    } catch {
      setError('Could not load the sample list.');
    }
  };

  const card = {
    maxWidth: '560px',
    margin: '2rem auto',
    padding: '2rem',
    backgroundColor: colors.bgCard,
    border: `1px solid ${colors.borderLight}`,
    borderRadius: '12px',
    boxShadow: `0 4px 20px ${colors.shadow}`,
  };

  if (!canEdit) {
    return (
      <div style={card}>
        <h2 style={{ margin: '0 0 0.5rem', color: colors.textPrimary }}>No stock yet</h2>
        <p style={{ margin: 0, color: colors.textSecondary }}>
          This pub doesn’t have a stock list yet. Ask an administrator to upload one.
        </p>
      </div>
    );
  }

  // Importing / progress view
  if (importing) {
    const pct = progress && progress.total
      ? Math.round((progress.completed / progress.total) * 100)
      : 0;
    return (
      <div style={{ ...card, textAlign: 'center' }}>
        <div style={{
          width: '40px', height: '40px', margin: '0 auto 1rem',
          border: `3px solid ${colors.bgLight}`, borderTopColor: colors.primary,
          borderRadius: '50%', animation: 'spin 1s linear infinite',
        }} />
        <div style={{ color: colors.textPrimary, fontWeight: 600 }}>
          Importing {progress?.total ?? ''} items…
        </div>
        {progress && (
          <div style={{ marginTop: '0.75rem' }}>
            <div style={{ height: '8px', backgroundColor: colors.bgLight, borderRadius: '9999px', overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', backgroundColor: colors.primary, transition: 'width 0.2s' }} />
            </div>
          </div>
        )}
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // Preview view (file parsed, awaiting confirmation)
  if (parsed) {
    const barCount = parsed.items.filter(i => i.section === 'bar').length;
    const kitchenCount = parsed.items.filter(i => i.section === 'kitchen').length;
    return (
      <div style={card}>
        <h2 style={{ margin: '0 0 0.25rem', color: colors.textPrimary }}>Review your stock list</h2>
        <p style={{ margin: '0 0 1rem', color: colors.textSecondary, fontSize: '0.9rem' }}>
          From <strong>{parsed.fileName}</strong>
        </p>

        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
          {[['Total', parsed.items.length], ['Bar', barCount], ['Kitchen', kitchenCount]].map(([label, n]) => (
            <div key={label} style={{
              flex: 1, padding: '0.75rem', textAlign: 'center',
              backgroundColor: colors.bgLight, borderRadius: '8px',
            }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: colors.textPrimary }}>{n}</div>
              <div style={{ fontSize: '0.8rem', color: colors.textSecondary }}>{label}</div>
            </div>
          ))}
        </div>

        {parsed.skipped > 0 && (
          <p style={{ margin: '0 0 1rem', color: colors.warning, fontSize: '0.85rem' }}>
            {parsed.skipped} row(s) were skipped (no item name).
          </p>
        )}

        <p style={{ margin: '0 0 1rem', color: colors.textSecondary, fontSize: '0.85rem' }}>
          Importing will set up these items ready to count. Existing items (if any) are replaced.
        </p>

        {error && <div style={{ color: colors.errorDark, marginBottom: '1rem' }}>{error}</div>}

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            onClick={handleImport}
            style={{
              flex: 1, padding: '0.85rem', backgroundColor: colors.primary, color: colors.onPrimary,
              border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '1rem', fontWeight: 600,
            }}
          >
            Import {parsed.items.length} items
          </button>
          <button
            onClick={() => { setParsed(null); setError(null); }}
            style={{
              padding: '0.85rem 1.25rem', backgroundColor: colors.bgLight, color: colors.textPrimary,
              border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '1rem',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // Initial upload view
  return (
    <div style={card}>
      <h2 style={{ margin: '0 0 0.5rem', color: colors.textPrimary }}>Add your stock list</h2>
      <p style={{ margin: '0 0 1.25rem', color: colors.textSecondary }}>
        There’s no stock here yet. Upload your stock list to get started — a{' '}
        <strong>CSV</strong> or <strong>JSON</strong> file with your items.
      </p>

      <div
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        style={{
          padding: '2rem 1rem',
          border: `2px dashed ${dragOver ? colors.primary : colors.border}`,
          borderRadius: '10px',
          textAlign: 'center',
          cursor: 'pointer',
          backgroundColor: dragOver ? colors.primaryLight : 'transparent',
          transition: 'all 0.15s',
        }}
      >
        <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📋</div>
        <div style={{ color: colors.textPrimary, fontWeight: 600 }}>
          Tap to choose a file, or drag it here
        </div>
        <div style={{ color: colors.textSecondary, fontSize: '0.85rem', marginTop: '0.25rem' }}>
          .csv or .json
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.json,.txt,text/csv,application/json"
        style={{ display: 'none' }}
        onChange={(e) => handleFile(e.target.files?.[0])}
      />

      {error && <div style={{ color: colors.errorDark, marginTop: '1rem' }}>{error}</div>}

      <div style={{
        marginTop: '1.25rem', paddingTop: '1rem', borderTop: `1px solid ${colors.borderLight}`,
        display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1.25rem', fontSize: '0.85rem',
      }}>
        <button onClick={downloadTemplate} style={linkBtn(colors)}>Download CSV template</button>
        {onAddManually && (
          <button onClick={onAddManually} style={linkBtn(colors)}>Add items manually instead</button>
        )}
        <button onClick={loadSample} style={linkBtn(colors)}>Load sample list (demo)</button>
      </div>
    </div>
  );
}

const linkBtn = (colors) => ({
  background: 'none',
  border: 'none',
  color: colors.primary,
  cursor: 'pointer',
  padding: 0,
  fontSize: '0.85rem',
  textDecoration: 'underline',
});

export default StockListUpload;
