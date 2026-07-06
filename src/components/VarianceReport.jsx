/**
 * VarianceReport — expected vs actual stock for the period between two
 * completed stock takes.
 *
 * Pick the closing count (defaults to the latest); the opening count is the
 * completed one before it. The report fetches the period's deliveries,
 * wastage and sales reports, shows sales-day coverage (missing till uploads
 * make shortages look real — so they're flagged loudly), and lists each item's
 * expected vs actual with the £ impact at cost. Items without both counts sit
 * in their own list rather than pretending a variance.
 *
 * Props: venuePath, items, mappingsByKey, colors, accent, onAccent, showToast,
 *        onGoToProducts (jump to the mapping tab)
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  getAllStockSessions, getDeliveriesBetween, getWastageBetween, getSalesReportsBetween,
} from '../services/apiService';
import { computeVariance, tradingStartDate, tradingDatesBetween } from '../utils/varianceReport';
import { parseUnitInfo, formatCountOverview } from '../utils/stockUnitUtils';

const gbp = (n) => '£' + Math.abs(Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtWhen = (t) => {
  const d = t?.toDate ? t.toDate() : null;
  return d ? d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : '?';
};
const prettyIso = (iso) => {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

function VarianceReport({ venuePath, items, mappingsByKey, colors, accent, onAccent, showToast, onGoToProducts }) {
  const [sessions, setSessions] = useState(null); // completed, newest first
  const [closingId, setClosingId] = useState(null);
  const [period, setPeriod] = useState(null);     // { deliveries, wastage, salesReports } for the chosen pair
  const [loading, setLoading] = useState(false);
  const [showNotCounted, setShowNotCounted] = useState(false);

  useEffect(() => {
    let alive = true;
    getAllStockSessions(venuePath).then((res) => {
      if (!alive) return;
      const completed = (res.success ? res.data : [])
        .filter((s) => s.status === 'completed' && s.completedAt)
        .sort((a, b) => b.completedAt.toMillis() - a.completedAt.toMillis());
      setSessions(completed);
      if (completed.length >= 2) setClosingId(completed[0].id);
    });
    return () => { alive = false; };
  }, [venuePath]);

  const closing = sessions?.find((s) => s.id === closingId) || null;
  const opening = useMemo(() => {
    if (!sessions || !closing) return null;
    return sessions.find((s) => s.completedAt.toMillis() < closing.completedAt.toMillis()) || null;
  }, [sessions, closing]);

  // Trading-day window for sales (see varianceReport.js for the boundary rule).
  const salesFrom = opening ? tradingStartDate(opening.completedAt) : null;
  const salesTo = closing ? tradingStartDate(closing.completedAt) : null;

  useEffect(() => {
    if (!opening || !closing) { setPeriod(null); return; }
    let alive = true;
    setLoading(true);
    Promise.all([
      getDeliveriesBetween(venuePath, opening.completedAt, closing.completedAt),
      getWastageBetween(venuePath, opening.completedAt, closing.completedAt),
      getSalesReportsBetween(venuePath, salesFrom, salesTo),
    ]).then(([d, w, s]) => {
      if (!alive) return;
      setLoading(false);
      if (!d.success || !w.success || !s.success) {
        showToast('Could not load the period: ' + (d.error || w.error || s.error));
        setPeriod(null);
        return;
      }
      setPeriod({ deliveries: d.data, wastage: w.data, salesReports: s.data });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venuePath, opening?.id, closing?.id]);

  const result = useMemo(() => {
    if (!period || !opening || !closing) return null;
    return computeVariance({ opening, closing, ...period, mappingsByKey, items });
  }, [period, opening, closing, mappingsByKey, items]);

  const coverage = useMemo(() => {
    if (!period || !salesFrom || !salesTo) return null;
    const expected = tradingDatesBetween(salesFrom, salesTo);
    const have = new Set(period.salesReports.map((r) => r.reportDate));
    return { expected, missing: expected.filter((d) => !have.has(d)) };
  }, [period, salesFrom, salesTo]);

  const fmtAmt = (row, qty) => {
    const n = Math.round(qty * 100) / 100;
    return row.item ? formatCountOverview({ quantity: n }, parseUnitInfo(row.item)) : String(n);
  };

  // ---- styles ----
  const card = { border: `1px solid ${colors.borderLight}`, borderRadius: '12px', backgroundColor: colors.bgCard, padding: '0.85rem' };
  const select = { width: '100%', padding: '0.6rem', fontSize: '0.95rem', border: `2px solid ${colors.border}`, borderRadius: '8px', backgroundColor: colors.bgCard, color: colors.textPrimary };

  if (!sessions) return <div style={{ color: colors.textSecondary, fontSize: '0.9rem' }}>Loading stock takes…</div>;
  if (sessions.length < 2) {
    return (
      <div style={{ color: colors.textSecondary, fontSize: '0.9rem' }}>
        Variance needs two completed stock takes — the period runs from one count to the next.
        {sessions.length === 1 ? ' One is done; complete the next and the report appears here.' : ' Complete your first two counts and the report appears here.'}
      </div>
    );
  }

  const varColor = (v) => (v == null || v === 0 ? colors.textSecondary : v < 0 ? colors.error : colors.success);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
      {/* Period picker */}
      <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <label style={{ fontSize: '0.75rem', color: colors.textSecondary }}>Stock take (period ends at this count)</label>
        <select value={closingId || ''} onChange={(e) => setClosingId(e.target.value)} style={select}>
          {sessions.slice(0, -1).map((s) => (
            <option key={s.id} value={s.id}>{fmtWhen(s.completedAt)}</option>
          ))}
        </select>
        {opening && closing && (
          <div style={{ fontSize: '0.82rem', color: colors.textPrimary }}>
            {fmtWhen(opening.completedAt)} → {fmtWhen(closing.completedAt)}
            <span style={{ color: colors.textSecondary }}> · trading days {prettyIso(salesFrom)}–{prettyIso(tradingDatesBetween(salesFrom, salesTo).at(-1) || salesFrom)}</span>
          </div>
        )}
      </div>

      {loading && <div style={{ color: colors.textSecondary, fontSize: '0.9rem' }}>Loading period…</div>}

      {!loading && result && coverage && (
        <>
          {/* Sales coverage — the accuracy make-or-break */}
          <div style={{ ...card, borderColor: coverage.missing.length ? colors.warning : colors.borderLight }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: coverage.missing.length ? colors.warning : colors.success }}>
              Sales reports: {coverage.expected.length - coverage.missing.length} of {coverage.expected.length} trading days
            </div>
            {coverage.missing.length > 0 && (
              <div style={{ fontSize: '0.78rem', color: colors.textSecondary, marginTop: '0.25rem' }}>
                Missing {coverage.missing.map(prettyIso).join(', ')} — shortages will look bigger than they are until these are uploaded.
              </div>
            )}
            {result.salesTotals.totalValue > result.salesTotals.mappedValue && (
              <div style={{ fontSize: '0.78rem', color: colors.textSecondary, marginTop: '0.25rem' }}>
                {gbp(result.salesTotals.totalValue - result.salesTotals.mappedValue)} of period sales isn't mapped to stock —{' '}
                <button onClick={onGoToProducts} style={{ background: 'none', border: 'none', color: accent, cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, textDecoration: 'underline', padding: 0 }}>map products</button>
              </div>
            )}
          </div>

          {/* Totals */}
          <div style={{ display: 'flex', gap: '0.6rem' }}>
            {[
              ['Short', result.totals.shortValue, colors.error],
              ['Over', result.totals.overValue, colors.success],
              ['Net', result.totals.netValue, result.totals.netValue < 0 ? colors.error : colors.success],
            ].map(([label, v, colour]) => (
              <div key={label} style={{ ...card, flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: '0.7rem', color: colors.textSecondary, textTransform: 'uppercase' }}>{label}</div>
                <div style={{ fontSize: '1.05rem', fontWeight: 800, color: colour }}>{v < 0 ? '−' : ''}{gbp(v)}</div>
              </div>
            ))}
          </div>
          {result.totals.unvalued > 0 && (
            <div style={{ fontSize: '0.75rem', color: colors.textMuted, marginTop: '-0.35rem' }}>
              {result.totals.unvalued} varying item{result.totals.unvalued === 1 ? ' has' : 's have'} no cost price, so the £ totals understate the true figure.
            </div>
          )}

          {/* Item rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {result.rows.map((r) => (
              <div key={r.itemId} style={{ border: `1px solid ${colors.borderLight}`, borderRadius: '10px', padding: '0.6rem 0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem' }}>
                  <span style={{ flex: 1, minWidth: 0, fontWeight: 600, color: colors.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
                  <span style={{ flexShrink: 0, fontWeight: 800, color: varColor(r.valueVariance ?? r.variance) }}>
                    {r.variance === 0 ? '✓' : `${r.variance < 0 ? '−' : '+'}${r.valueVariance != null ? gbp(r.valueVariance) : fmtAmt(r, Math.abs(r.variance))}`}
                  </span>
                </div>
                <div style={{ fontSize: '0.76rem', color: colors.textSecondary, marginTop: '0.15rem' }}>
                  expected {fmtAmt(r, r.expected)} · counted {fmtAmt(r, r.actual)}
                  {r.variance !== 0 && r.valueVariance != null && ` · ${r.variance < 0 ? 'short' : 'over'} ${fmtAmt(r, Math.abs(r.variance))}`}
                </div>
                <div style={{ fontSize: '0.7rem', color: colors.textMuted, marginTop: '0.1rem' }}>
                  opened {fmtAmt(r, r.opening)}{r.deliveries > 0 && ` · +${fmtAmt(r, r.deliveries)} delivered`}{r.wastage > 0 && ` · −${fmtAmt(r, r.wastage)} wasted`}{r.sales > 0 && ` · −${fmtAmt(r, r.sales)} sold`}
                </div>
              </div>
            ))}
            {result.rows.length === 0 && (
              <div style={{ color: colors.textSecondary, fontSize: '0.9rem' }}>No items were counted in both stock takes.</div>
            )}
          </div>

          {/* Not counted at both ends */}
          {result.notCounted.length > 0 && (
            <div>
              <button onClick={() => setShowNotCounted(!showNotCounted)} style={{ background: 'none', border: 'none', color: colors.textSecondary, cursor: 'pointer', fontSize: '0.82rem', padding: 0, textDecoration: 'underline' }}>
                {showNotCounted ? 'Hide' : 'Show'} {result.notCounted.length} item{result.notCounted.length === 1 ? '' : 's'} without a variance (missing a count)
              </button>
              {showNotCounted && (
                <div style={{ marginTop: '0.4rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  {result.notCounted.map((n) => (
                    <div key={n.itemId} style={{ fontSize: '0.8rem', color: n.hasMovement ? colors.warning : colors.textMuted }}>
                      {n.name} — no {n.missing}{n.hasMovement ? ' (had sales/deliveries/wastage this period)' : ''}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default VarianceReport;
