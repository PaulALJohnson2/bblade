/**
 * UsageRates — how fast each product actually moves, derived from the gaps
 * between completed stock takes.
 *
 * Nothing new is captured. Every period between two completed counts is walked
 * (see utils/usageRate.js), the deliveries and wastage inside it are windowed,
 * and what's left is consumption. Periods where supply capped consumption — a
 * short delivery on an item that ran down — are excluded rather than averaged
 * in, and said so out loud, because that's the bias that would otherwise teach
 * the system to keep under-ordering.
 *
 * The result is stored to itemStats so later stages (par levels, ordering)
 * read a number rather than recompute the history.
 *
 * Props: venuePath, items, colors, accent, onAccent, showToast
 */

import React, { useEffect, useMemo, useState } from 'react';
import { getItemStats, saveItemStats } from '../services/apiService';
import { deriveUsageRates } from '../services/stockAnalysis';
import { formatUsage, CONFIDENCE_LABEL } from '../utils/usageRate';
import { parseUnitInfo } from '../utils/stockUnitUtils';

const shortDate = (ms) => (ms
  ? new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  : '');

function UsageRates({ venuePath, items, colors, accent, onAccent, showToast }) {
  const [stats, setStats] = useState(null);       // stored rows, or null until loaded
  const [computed, setComputed] = useState(null); // freshly derived this session
  const [periods, setPeriods] = useState(null);   // period summaries for context
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const itemsById = useMemo(() => Object.fromEntries(items.map((i) => [i.id, i])), [items]);

  useEffect(() => {
    let alive = true;
    getItemStats(venuePath).then((res) => { if (alive) setStats(res.data || []); });
    return () => { alive = false; };
  }, [venuePath]);

  const recompute = async () => {
    if (running) return;
    setRunning(true);
    try {
      const { rates, periods: walked } = await deriveUsageRates(venuePath);
      setPeriods(walked);
      setComputed(rates);
      if (!walked.length) {
        showToast(rates.length
          ? `Estimated ${rates.length} rates from deliveries — a second stock take will measure them properly`
          : 'Not enough deliveries yet to estimate how fast anything moves');
      }
    } catch (err) {
      console.error('Usage calculation failed:', err);
      showToast('Could not work out usage: ' + (err?.message || 'unknown error'));
    } finally {
      setRunning(false);
    }
  };

  const persist = async () => {
    if (!computed?.length || saving) return;
    setSaving(true);
    const res = await saveItemStats(venuePath, computed);
    setSaving(false);
    if (res.success) {
      setStats(computed.map((r) => ({ id: r.itemId, ...r })));
      showToast(`Saved usage rates for ${res.count} items`);
    } else showToast('Could not save: ' + res.error);
  };

  const rows = computed || (stats || []).slice().sort((a, b) => b.usagePerWeek - a.usagePerWeek);
  const visible = expanded ? rows : rows.slice(0, 12);

  const totals = useMemo(() => ({
    rated: rows.filter((r) => r.usagePerWeek > 0).length,
    measured: rows.filter((r) => r.source === 'counts').length,
    estimated: rows.filter((r) => r.source === 'deliveries').length,
    censored: rows.reduce((t, r) => t + (r.censoredPeriods || 0), 0),
    implausible: rows.reduce((t, r) => t + (r.implausiblePeriods || 0), 0),
  }), [rows]);

  const toneFor = (c) => ({
    good: accent, fair: colors.textPrimary, low: colors.warning, none: colors.textMuted,
  }[c] || colors.textSecondary);

  return (
    <div style={{ marginTop: '2rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.25rem' }}>
        <h2 style={{ flex: 1, fontSize: '1.05rem', color: colors.textPrimary, margin: 0 }}>Usage rates</h2>
        <button
          onClick={recompute} disabled={running}
          style={{ flexShrink: 0, padding: '0.5rem 0.85rem', border: 'none', borderRadius: '8px', backgroundColor: accent, color: onAccent, fontWeight: 700, fontSize: '0.82rem', cursor: running ? 'wait' : 'pointer', opacity: running ? 0.6 : 1 }}
        >{running ? 'Working…' : 'Work out usage'}</button>
      </div>
      <div style={{ fontSize: '0.75rem', color: colors.textSecondary, marginBottom: '0.75rem' }}>
        How much of each item leaves the cellar in a week — measured between completed stock takes where
        there are two, estimated from your delivery pattern until then.
      </div>

      {rows.length === 0 && (
        <div style={{ fontSize: '0.85rem', color: colors.textSecondary, padding: '0.9rem', border: `1px dashed ${colors.border}`, borderRadius: '10px' }}>
          {computed
            ? 'Not enough history yet. Two deliveries of the same product will estimate a rate; two completed stock takes will measure one properly.'
            : 'Nothing worked out yet. Tap “Work out usage” to derive it from your stock takes and deliveries.'}
        </div>
      )}

      {computed && rows.length > 0 && (
        <div style={{ fontSize: '0.75rem', color: colors.textSecondary, marginBottom: '0.6rem' }}>
          {totals.measured > 0 && `${totals.measured} measured across ${periods?.length || 0} period${periods?.length === 1 ? '' : 's'}`}
          {totals.measured > 0 && totals.estimated > 0 && ' · '}
          {totals.estimated > 0 && `${totals.estimated} estimated from deliveries`}
          {totals.censored > 0 && ` · ${totals.censored} period${totals.censored === 1 ? '' : 's'} excluded for short supply`}
          {totals.implausible > 0 && ` · ${totals.implausible} excluded as miscounts`}
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          {visible.map((r) => {
            const item = itemsById[r.itemId];
            const info = item ? parseUnitInfo(item) : null;
            return (
              <div key={r.itemId} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.5rem 0.65rem', border: `1px solid ${colors.borderLight}`, borderRadius: '9px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.86rem', fontWeight: 600, color: colors.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item?.name || r.itemName || 'Item'}
                  </div>
                  {/* Where the number came from matters more than the number:
                      one is measured, the other rests on an assumption. */}
                  <div style={{ fontSize: '0.7rem', color: colors.textMuted }}>
                    {r.source === 'deliveries' ? (
                      <>
                        From {r.deliveries} deliveries over {Math.round(r.spanDays)} days
                        {r.lowerBound && ' · at least (short-supplied)'}
                        {r.lastDelivery ? ` · last ${shortDate(r.lastDelivery)}` : ''}
                      </>
                    ) : (
                      <>
                        {r.observations} period{r.observations === 1 ? '' : 's'} counted
                        {r.censoredPeriods > 0 && ` · ${r.censoredPeriods} short-supplied`}
                        {r.ranOutPeriods > 0 && ` · ran out ${r.ranOutPeriods}×`}
                        {r.lastPeriodEnd ? ` · to ${shortDate(r.lastPeriodEnd)}` : ''}
                      </>
                    )}
                  </div>
                </div>
                <div style={{ flexShrink: 0, textAlign: 'right' }}>
                  <div style={{ fontSize: '0.88rem', fontWeight: 700, color: colors.textPrimary }}>
                    {info ? formatUsage(r.usagePerWeek, info) : r.usagePerWeek}
                  </div>
                  <div style={{ fontSize: '0.68rem', color: colors.textSecondary }}>per week</div>
                </div>
                <div
                  title={r.spread !== null ? `Spread across periods: ${Math.round(r.spread * 100)}%` : 'Only one period measured'}
                  style={{ flexShrink: 0, width: '46px', textAlign: 'center', fontSize: '0.66rem', fontWeight: 700, color: toneFor(r.confidence) }}
                >
                  {CONFIDENCE_LABEL[r.confidence] || ''}
                </div>
              </div>
            );
          })}

          {rows.length > 12 && (
            <button
              onClick={() => setExpanded((v) => !v)}
              style={{ alignSelf: 'flex-start', marginTop: '0.3rem', padding: '0.4rem 0.7rem', border: `1px solid ${colors.border}`, borderRadius: '7px', backgroundColor: 'transparent', color: colors.textSecondary, fontSize: '0.78rem', cursor: 'pointer' }}
            >{expanded ? 'Show fewer' : `Show all ${rows.length}`}</button>
          )}

          {computed && (
            <button
              onClick={persist} disabled={saving}
              style={{ marginTop: '0.6rem', padding: '0.7rem', border: 'none', borderRadius: '10px', backgroundColor: accent, color: onAccent, fontWeight: 700, fontSize: '0.9rem', cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.6 : 1 }}
            >{saving ? 'Saving…' : `Save these rates (${computed.length} items)`}</button>
          )}
        </div>
      )}
    </div>
  );
}

export default UsageRates;
