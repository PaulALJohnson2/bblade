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
 *        onGoToProducts (jump to the mapping tab), canDelete (admins may
 *        remove a count from variance — a hiddenFromVariance flag on the
 *        session, the stock take itself is kept and restorable here)
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  getAllStockSessions, getDeliveriesBetween, getWastageBetween, getSalesReportsBetween,
  setStockSessionVarianceHidden,
} from '../services/apiService';
import { computeVariance, tradingStartDate, tradingDatesBetween } from '../utils/varianceReport';
import { reportRange, addDays, daysInRange } from '../utils/parseSalesReport';
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

function VarianceReport({ venuePath, items, mappingsByKey, colors, accent, onAccent, showToast, onGoToProducts, canDelete }) {
  const [allCompleted, setAllCompleted] = useState(null); // completed, newest first (incl. hidden)
  const [closingId, setClosingId] = useState(null);
  const [period, setPeriod] = useState(null);     // { deliveries, wastage, salesReports } for the chosen pair
  const [loading, setLoading] = useState(false);
  const [showNotCounted, setShowNotCounted] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    let alive = true;
    getAllStockSessions(venuePath).then((res) => {
      if (!alive) return;
      const completed = (res.success ? res.data : [])
        .filter((s) => s.status === 'completed' && s.completedAt)
        .sort((a, b) => b.completedAt.toMillis() - a.completedAt.toMillis());
      setAllCompleted(completed);
      const visible = completed.filter((s) => !s.hiddenFromVariance);
      if (visible.length >= 2) setClosingId(visible[0].id);
    });
    return () => { alive = false; };
  }, [venuePath]);

  // Hidden counts aren't period boundaries — their period merges into the
  // neighbouring one. The stock take itself is untouched (and restorable below).
  const sessions = useMemo(
    () => (allCompleted ? allCompleted.filter((s) => !s.hiddenFromVariance) : null),
    [allCompleted],
  );
  const hidden = useMemo(
    () => (allCompleted ? allCompleted.filter((s) => s.hiddenFromVariance) : []),
    [allCompleted],
  );

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

  // Reports cover date RANGES. Only reports fully inside the stock period can
  // be used — a report straddling the boundary can't be apportioned between
  // periods, so it's excluded and flagged instead of silently skewing figures.
  const splitReports = useMemo(() => {
    if (!period || !salesFrom || !salesTo) return null;
    const inside = [], partial = [];
    for (const r of period.salesReports) {
      const { from, to } = reportRange(r);
      (from >= salesFrom && to < salesTo ? inside : partial).push(r);
    }
    return { inside, partial };
  }, [period, salesFrom, salesTo]);

  const result = useMemo(() => {
    if (!splitReports || !opening || !closing) return null;
    return computeVariance({
      opening, closing,
      deliveries: period.deliveries, wastage: period.wastage,
      salesReports: splitReports.inside,
      mappingsByKey, items,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splitReports, period, opening, closing, mappingsByKey, items]);

  const coverage = useMemo(() => {
    if (!splitReports || !salesFrom || !salesTo) return null;
    const expected = tradingDatesBetween(salesFrom, salesTo);
    // Count how many reports cover each day — >1 means sales are being
    // subtracted twice (e.g. a legacy single-day doc alongside its week doc).
    const coveredCount = {};
    for (const r of splitReports.inside) {
      const { from, to } = reportRange(r);
      for (const d of tradingDatesBetween(from, addDays(to, 1))) coveredCount[d] = (coveredCount[d] || 0) + 1;
    }
    return {
      expected,
      missing: expected.filter((d) => !coveredCount[d]),
      doubled: expected.filter((d) => (coveredCount[d] || 0) > 1),
    };
  }, [splitReports, salesFrom, salesTo]);

  const setHidden = async (session, hide) => {
    const res = await setStockSessionVarianceHidden(venuePath, session.id, hide);
    setConfirmingDelete(false);
    if (!res.success) {
      showToast('Could not update: ' + res.error);
      return;
    }
    showToast(hide
      ? `Removed the ${fmtWhen(session.completedAt)} count from variance — the stock take is kept`
      : `Restored the ${fmtWhen(session.completedAt)} count`);
    setAllCompleted((prev) => prev.map((s) => (s.id === session.id ? { ...s, hiddenFromVariance: hide } : s)));
    if (hide && closingId === session.id) {
      const visible = allCompleted.filter((s) => !s.hiddenFromVariance && s.id !== session.id);
      setClosingId(visible.length >= 2 ? visible[0].id : null);
    }
  };

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
      <div style={{ color: colors.textSecondary, fontSize: '0.9rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <div>
          Variance needs two completed stock takes — the period runs from one count to the next.
          {sessions.length === 1 ? ' One is done; complete the next and the report appears here.' : ' Complete your first two counts and the report appears here.'}
        </div>
        {canDelete && hidden.length > 0 && (
          <div style={{ fontSize: '0.82rem' }}>
            Hidden from variance:{' '}
            {hidden.map((s, i) => (
              <span key={s.id}>
                {i > 0 && ' · '}
                {fmtWhen(s.completedAt)}{' '}
                <button onClick={() => setHidden(s, false)} style={{ background: 'none', border: 'none', color: accent, cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, textDecoration: 'underline', padding: 0 }}>restore</button>
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  const varColor = (v) => (v == null || v === 0 ? colors.textSecondary : v < 0 ? colors.error : colors.success);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
      {/* Period picker */}
      <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <label style={{ fontSize: '0.75rem', color: colors.textSecondary }}>Stock take (period ends at this count)</label>
        <select value={closingId || ''} onChange={(e) => { setClosingId(e.target.value); setConfirmingDelete(false); }} style={select}>
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
        {/* Admins can remove a count from variance (flag only — the stock
            take keeps all its data and can be restored below). */}
        {canDelete && closing && (confirmingDelete ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ flex: 1, fontSize: '0.78rem', color: colors.textSecondary }}>
              Removes the {fmtWhen(closing.completedAt)} count from variance reports; its period merges into the next one. The stock take itself is kept.
            </span>
            <button onClick={() => setHidden(closing, true)} style={{ padding: '0.5rem 0.85rem', backgroundColor: colors.error, color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem', flexShrink: 0 }}>Remove</button>
            <button onClick={() => setConfirmingDelete(false)} style={{ padding: '0.5rem 0.85rem', backgroundColor: 'transparent', color: colors.textSecondary, border: `1px solid ${colors.border}`, borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem', flexShrink: 0 }}>Cancel</button>
          </div>
        ) : (
          <button onClick={() => setConfirmingDelete(true)} style={{ alignSelf: 'flex-start', padding: '0.45rem 0.75rem', backgroundColor: 'transparent', color: colors.textSecondary, border: `1px solid ${colors.border}`, borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem' }}>
            Remove from variance
          </button>
        ))}
        {canDelete && hidden.length > 0 && (
          <div style={{ fontSize: '0.78rem', color: colors.textSecondary }}>
            Hidden from variance:{' '}
            {hidden.map((s, i) => (
              <span key={s.id}>
                {i > 0 && ' · '}
                {fmtWhen(s.completedAt)}{' '}
                <button onClick={() => setHidden(s, false)} style={{ background: 'none', border: 'none', color: accent, cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, textDecoration: 'underline', padding: 0 }}>restore</button>
              </span>
            ))}
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
            {splitReports.inside.length === 0 && (
              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: colors.error, marginTop: '0.25rem' }}>
                No sales data for this period — everything the pub sold will show below as shortage.
                Upload the till report for these dates in the Reports tab, then come back.
              </div>
            )}
            {/* Exactly which reports the maths used — variance is only as honest as this list */}
            {splitReports.inside.length > 0 && (
              <div style={{ fontSize: '0.78rem', color: colors.textSecondary, marginTop: '0.25rem' }}>
                Using {splitReports.inside.map((r) => { const { from, to } = reportRange(r); return `${prettyIso(from)}–${prettyIso(to)} (${gbp(r.totals?.valueIncVAT || 0)})`; }).join(' + ')}
              </div>
            )}
            {coverage.doubled.length > 0 && (
              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: colors.error, marginTop: '0.25rem' }}>
                ⚠ {coverage.doubled.length} day{coverage.doubled.length === 1 ? ' is' : 's are'} covered by more than one report ({coverage.doubled.map(prettyIso).join(', ')}) — those sales are being subtracted twice. Delete the duplicate in the Reports tab.
              </div>
            )}
            {coverage.missing.length > 0 && (
              <div style={{ fontSize: '0.78rem', color: colors.textSecondary, marginTop: '0.25rem' }}>
                Missing {coverage.missing.map(prettyIso).join(', ')} — shortages will look bigger than they are until these are uploaded.
              </div>
            )}
            {splitReports.partial.length > 0 && (
              <div style={{ fontSize: '0.78rem', color: colors.warning, marginTop: '0.25rem' }}>
                {splitReports.partial.map((r) => {
                  const { from, to } = reportRange(r);
                  return `The ${prettyIso(from)}–${prettyIso(to)} report (${daysInRange(from, to)} days) straddles this period's boundary and is excluded — its days can't be split between periods.`;
                }).join(' ')}
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
              {result.totals.unvalued} varying item{result.totals.unvalued === 1 ? ' has' : 's have'} no cost price, so the £ totals understate the true figure — derive costs from the till in the Till products tab.
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
