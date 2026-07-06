/**
 * Sales — till sales reports (admin only; margins are visible here).
 *
 * Phase 1 of the sales pipeline: upload the till's daily sales CSV, confirm
 * the date parsed from the filename, and save it under salesReports (one doc
 * per day; re-uploading a day replaces it after a warning). Saved reports are
 * listed newest-first; a report expands into totals + its lines, sortable by
 * value or quantity and searchable.
 *
 * Later phases: map till products to stock items (expected depletion), the
 * variance report between stocktakes, AI layout detection for other tills,
 * and direct till APIs.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { saveSalesReport, subscribeToSalesReports, deleteSalesReport } from '../services/apiService';
import { parseSalesReport, grossProfitPct } from '../utils/parseSalesReport';
import { getThemeColors } from '../utils/theme';
import useTheme from '../hooks/useTheme';

const gbp = (n) => '£' + (Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (p) => (p == null ? '—' : `${(p * 100).toFixed(1)}%`);

function prettyDate(iso) {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function Sales() {
  const navigate = useNavigate();
  const { currentUser, userProfile, selectedPub, isAdmin } = useAuth();
  const admin = !!(isAdmin && isAdmin());
  const { isDark } = useTheme();
  const colors = getThemeColors(isDark);
  const accent = colors.primary;

  const fileInputRef = useRef(null);
  const [reports, setReports] = useState([]);
  const [parsed, setParsed] = useState(null); // { lines, totals, reportDate, skipped, fileName } | { error }
  const [reportDate, setReportDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [toast, setToast] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null); // report id
  const [sortBy, setSortBy] = useState('valueIncVAT'); // 'valueIncVAT' | 'qty'
  const [search, setSearch] = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2400); };

  useEffect(() => {
    if (!selectedPub) return;
    const unsub = subscribeToSalesReports(selectedPub.path, (list) => setReports(list || []));
    return () => unsub();
  }, [selectedPub]);

  const openReport = reports.find((r) => r.id === openId) || null;
  const openLines = useMemo(() => {
    if (!openReport) return [];
    const q = search.trim().toLowerCase();
    return [...(openReport.lines || [])]
      .filter((l) => !q || (l.name || '').toLowerCase().includes(q))
      .sort((a, b) => (b[sortBy] || 0) - (a[sortBy] || 0));
  }, [openReport, sortBy, search]);

  if (!admin) return <Navigate to="/" replace />;

  const handleFile = async (file) => {
    if (!file) return;
    const text = await file.text();
    const res = parseSalesReport(text, file.name);
    setParsed({ ...res, fileName: file.name });
    setReportDate(res.reportDate || '');
  };

  const resetUpload = () => { setParsed(null); setReportDate(''); if (fileInputRef.current) fileInputRef.current.value = ''; };

  const existsForDate = reportDate && reports.some((r) => r.reportDate === reportDate);
  const canSave = parsed && !parsed.error && /^\d{4}-\d{2}-\d{2}$/.test(reportDate) && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    const res = await saveSalesReport(selectedPub.path, {
      reportDate,
      fileName: parsed.fileName,
      source: 'csv',
      lines: parsed.lines,
      totals: parsed.totals,
      uploadedBy: userProfile?.displayName || currentUser?.email || '',
    });
    setSaving(false);
    if (res.success) {
      showToast(existsForDate ? `Replaced report for ${prettyDate(reportDate)}` : `Saved report for ${prettyDate(reportDate)}`);
      resetUpload();
    } else {
      showToast('Could not save: ' + res.error);
    }
  };

  const handleDelete = async (id) => {
    const res = await deleteSalesReport(selectedPub.path, id);
    setConfirmDelete(null);
    if (openId === id) setOpenId(null);
    showToast(res.success ? 'Report deleted' : 'Could not delete: ' + res.error);
  };

  // ---- styles ----
  const card = { border: `1px solid ${colors.borderLight}`, borderRadius: '12px', backgroundColor: colors.bgCard, padding: '1rem' };
  const input = { padding: '0.6rem', fontSize: '0.95rem', border: `2px solid ${colors.border}`, borderRadius: '8px', backgroundColor: colors.bgCard, color: colors.textPrimary, boxSizing: 'border-box' };
  const statBox = (label, value, sub) => (
    <div key={label} style={{ flex: '1 1 100px', minWidth: 0 }}>
      <div style={{ fontSize: '0.7rem', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</div>
      <div style={{ fontSize: '1.05rem', fontWeight: 700, color: colors.textPrimary, whiteSpace: 'nowrap' }}>{value}</div>
      {sub && <div style={{ fontSize: '0.7rem', color: colors.textMuted }}>{sub}</div>}
    </div>
  );

  const totalsRow = (totals) => {
    const gp = grossProfitPct(totals);
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
        {statBox('Take (inc VAT)', gbp(totals.valueIncVAT))}
        {statBox('Net (exc VAT)', gbp(totals.valueExcVAT))}
        {statBox('Cost', gbp(totals.cost))}
        {statBox('GP', gbp(totals.margin), pct(gp))}
        {statBox('Items sold', String(Math.round(totals.qty)))}
      </div>
    );
  };

  return (
    <div style={{ maxWidth: '640px', margin: '0 auto', position: 'relative' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <button onClick={() => navigate('/admin')} style={{ padding: '0.5rem 0.75rem', backgroundColor: colors.bgLight, color: colors.textPrimary, border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.9rem' }}>← Back</button>
        <h1 style={{ margin: 0, fontSize: '1.5rem', color: accent }}>Sales</h1>
      </div>

      {/* Upload */}
      {!parsed ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]); }}
          style={{ ...card, borderStyle: 'dashed', borderColor: dragOver ? accent : colors.border, textAlign: 'center', padding: '1.5rem 1rem', marginBottom: '1.5rem' }}
        >
          <div style={{ fontWeight: 600, color: colors.textPrimary, marginBottom: '0.25rem' }}>Upload a till sales report</div>
          <div style={{ fontSize: '0.82rem', color: colors.textSecondary, marginBottom: '0.85rem' }}>
            The daily sales CSV exported from your till. Drop it here or choose the file.
          </div>
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={(e) => handleFile(e.target.files?.[0])} />
          <button onClick={() => fileInputRef.current?.click()} style={{ padding: '0.7rem 1.3rem', backgroundColor: accent, color: colors.onPrimary, border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}>
            Choose CSV
          </button>
        </div>
      ) : parsed.error ? (
        <div style={{ ...card, marginBottom: '1.5rem', borderColor: colors.error }}>
          <div style={{ fontWeight: 600, color: colors.error, marginBottom: '0.3rem' }}>Couldn't read that file</div>
          <div style={{ fontSize: '0.85rem', color: colors.textSecondary, marginBottom: '0.85rem' }}>{parsed.error}</div>
          <button onClick={resetUpload} style={{ padding: '0.6rem 1.1rem', backgroundColor: colors.bgLight, color: colors.textPrimary, border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>Try another file</button>
        </div>
      ) : (
        <div style={{ ...card, marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          <div>
            <div style={{ fontWeight: 700, color: colors.textPrimary }}>{parsed.fileName}</div>
            <div style={{ fontSize: '0.8rem', color: colors.textSecondary }}>
              {parsed.lines.length} sales lines{parsed.skipped > 0 ? ` · ${parsed.skipped} non-sales rows skipped` : ''}
              {parsed.totals.costedLines < parsed.lines.length &&
                ` · ${parsed.lines.length - parsed.totals.costedLines} lines have no cost set in the till`}
            </div>
          </div>

          {totalsRow(parsed.totals)}

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            <label style={{ fontSize: '0.85rem', color: colors.textSecondary }}>Trading date</label>
            <input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} style={input} />
            {!parsed.reportDate && <span style={{ fontSize: '0.78rem', color: colors.warning }}>Couldn't read a date from the filename — set it here.</span>}
          </div>

          {existsForDate && (
            <div style={{ fontSize: '0.85rem', color: colors.warning, backgroundColor: colors.warningSoft, borderRadius: '8px', padding: '0.5rem 0.75rem' }}>
              A report for {prettyDate(reportDate)} already exists — saving will replace it.
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={resetUpload} style={{ flexShrink: 0, padding: '0.85rem 1.25rem', backgroundColor: colors.bgLight, color: colors.textPrimary, border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>Cancel</button>
            <button
              onClick={handleSave}
              disabled={!canSave}
              style={{ flex: 1, padding: '0.85rem', backgroundColor: accent, color: colors.onPrimary, border: 'none', borderRadius: '8px', cursor: canSave ? 'pointer' : 'not-allowed', fontWeight: 700, fontSize: '1.05rem', opacity: canSave ? 1 : 0.5 }}
            >{saving ? 'Saving…' : existsForDate ? 'Replace report' : 'Save report'}</button>
          </div>
        </div>
      )}

      {/* Saved reports */}
      <h2 style={{ fontSize: '1.05rem', color: colors.textPrimary, margin: '0 0 0.75rem' }}>Reports</h2>
      {reports.length === 0 ? (
        <div style={{ color: colors.textSecondary, fontSize: '0.9rem' }}>No sales reports yet — upload the first one above.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {reports.map((r) => {
            const open = openId === r.id;
            const gp = grossProfitPct(r.totals);
            return (
              <div key={r.id} style={{ border: `1px solid ${open ? accent : colors.borderLight}`, borderRadius: '10px', overflow: 'hidden' }}>
                <button
                  onClick={() => { setOpenId(open ? null : r.id); setSearch(''); setConfirmDelete(null); }}
                  style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.7rem 0.85rem', background: open ? colors.primarySoft : colors.bgCard, border: 'none', cursor: 'pointer' }}
                >
                  <span style={{ flex: 1, minWidth: 0, color: colors.textPrimary, fontWeight: 600 }}>{prettyDate(r.reportDate)}</span>
                  <span style={{ fontSize: '0.85rem', color: colors.textPrimary, fontWeight: 600 }}>{gbp(r.totals?.valueIncVAT)}</span>
                  <span style={{ fontSize: '0.75rem', color: colors.textSecondary }}>GP {pct(gp)}</span>
                </button>
                {open && (
                  <div style={{ padding: '0.85rem', borderTop: `1px solid ${colors.borderLight}`, display: 'flex', flexDirection: 'column', gap: '0.85rem', backgroundColor: colors.bgCard }}>
                    {totalsRow(r.totals || {})}
                    <div style={{ fontSize: '0.72rem', color: colors.textMuted }}>
                      {[r.fileName, r.uploadedBy, r.uploadedAt?.toDate ? r.uploadedAt.toDate().toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''].filter(Boolean).join(' · ')}
                    </div>

                    {/* Line explorer */}
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products…" style={{ ...input, flex: 1, minWidth: 0 }} />
                      <button
                        onClick={() => setSortBy(sortBy === 'qty' ? 'valueIncVAT' : 'qty')}
                        style={{ flexShrink: 0, padding: '0.5rem 0.85rem', backgroundColor: colors.bgLight, color: colors.textPrimary, border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 }}
                      >by {sortBy === 'qty' ? 'qty ↓' : 'value ↓'}</button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      {openLines.slice(0, 300).map((l, i) => {
                        const lineGp = l.valueExcVAT > 0 && l.cost > 0 ? (l.margin / l.valueExcVAT) : null;
                        return (
                          <div key={`${l.productId || l.name}-${i}`} style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', padding: '0.4rem 0.1rem', borderBottom: `1px solid ${colors.borderLight}` }}>
                            <span style={{ flex: 1, minWidth: 0, fontSize: '0.88rem', color: colors.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.name}</span>
                            <span style={{ flexShrink: 0, fontSize: '0.82rem', color: colors.textSecondary, width: '48px', textAlign: 'right' }}>×{l.qty}</span>
                            <span style={{ flexShrink: 0, fontSize: '0.85rem', fontWeight: 600, color: colors.textPrimary, width: '76px', textAlign: 'right' }}>{gbp(l.valueIncVAT)}</span>
                            <span style={{ flexShrink: 0, fontSize: '0.72rem', color: colors.textMuted, width: '52px', textAlign: 'right' }}>{lineGp == null ? '—' : pct(lineGp)}</span>
                          </div>
                        );
                      })}
                      {openLines.length === 0 && <div style={{ fontSize: '0.85rem', color: colors.textSecondary, padding: '0.5rem 0' }}>No matching lines.</div>}
                    </div>

                    {/* Delete */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      {confirmDelete === r.id ? (
                        <button onClick={() => handleDelete(r.id)} style={{ padding: '0.5rem 0.85rem', backgroundColor: colors.error, color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem' }}>Confirm delete</button>
                      ) : (
                        <button onClick={() => setConfirmDelete(r.id)} style={{ padding: '0.5rem 0.85rem', backgroundColor: 'transparent', color: colors.textSecondary, border: `1px solid ${colors.border}`, borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem' }}>Delete report</button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
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

export default Sales;
