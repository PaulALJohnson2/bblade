/**
 * StockPosition — "what's left, and what do I need?", answered as early as the
 * data allows.
 *
 * The arithmetic is in utils/stockPosition.js; this is the presentation, and
 * the presentation is most of the point. A venue two counts in has one real
 * measurement of one week. Shown as a bare table of numbers that reads exactly
 * like a venue with two years of history, it would be trusted exactly as much —
 * and be wrong. So the screen is built around three questions in the order a
 * manager actually asks them:
 *
 *   Order these      — cover is short. Act on this.
 *   Go and look      — no figure can be produced. Your eyes are the sensor.
 *   Doesn't add up   — the counts contradict themselves. Fix before trusting.
 *
 * and a standing line at the top saying how thin the evidence is, because "one
 * period, seven days" is the single most important number on the page.
 *
 * COMPUTES ITS OWN RATES. Deliberately. The rates live in itemStats, but a
 * venue that has never opened the Sales screen has none, and a stock report
 * that shows a new customer an empty page because a button elsewhere was never
 * pressed has failed at the only moment it mattered. Stored rates are used when
 * present and refreshed on demand; when absent they're derived on open and
 * saved, so the next visit is instant.
 *
 * Props: venuePath, items, colors, accent, onAccent
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  getItemStats, saveItemStats, subscribeToStockSessions,
  getDeliveriesBetween, getWastageBetween,
} from '../services/apiService';
import { deriveUsageRates } from '../services/stockAnalysis';
import {
  buildPositions, summarise, nextBestAction, formatCover, formatWholes,
  countingHabits, GROUP_TITLES, LOW_COVER_DAYS, TARGET_COVER_DAYS, CONFIDENCE_NOTE,
} from '../utils/stockPosition';
import { parseUnitInfo, formatBaseQuantity } from '../utils/stockUnitUtils';
import { formatUsage, usagePeriods } from '../utils/usageRate';

const DAY = 86400000;
/** How far back to sweep the logs. Anchors older than this are ancient anyway. */
const LOG_WINDOW_DAYS = 180;

const shortDate = (ms) => (ms ? new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
const agoText = (days) => {
  if (days === null || days === undefined) return 'never counted';
  if (days < 1) return 'counted today';
  if (days < 2) return 'counted yesterday';
  return `counted ${Math.round(days)} days ago`;
};

function StockPosition({ venuePath, items, colors, accent, onAccent }) {
  const [sessions, setSessions] = useState(null);
  const [logs, setLogs] = useState(null);       // { deliveries, wastage }
  const [rates, setRates] = useState(null);     // stored or derived rows
  const [working, setWorking] = useState(false);
  const [error, setError] = useState(null);
  const [openGroup, setOpenGroup] = useState({ order: true, look: true, check: false, settled: false });
  const [openRow, setOpenRow] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2800); };

  useEffect(() => {
    if (!venuePath) return undefined;
    const unsub = subscribeToStockSessions(venuePath, (list) => setSessions(list || []));
    return () => unsub();
  }, [venuePath]);

  // The movement logs, over a window wide enough to cover any anchor worth
  // trusting. One pair of queries rather than one per item.
  useEffect(() => {
    if (!venuePath) return;
    let alive = true;
    const from = new Date(Date.now() - LOG_WINDOW_DAYS * DAY);
    const to = new Date();
    Promise.all([getDeliveriesBetween(venuePath, from, to), getWastageBetween(venuePath, from, to)])
      .then(([d, w]) => { if (alive) setLogs({ deliveries: d.data || [], wastage: w.data || [] }); })
      .catch((err) => { if (alive) setError(err?.message || 'Could not load the delivery and wastage logs'); });
    return () => { alive = false; };
  }, [venuePath]);

  // Stored rates first; derive only if there are none. See the header note.
  useEffect(() => {
    if (!venuePath) return;
    let alive = true;
    getItemStats(venuePath).then(async (res) => {
      if (!alive) return;
      const stored = res.data || [];
      if (stored.length) { setRates(stored); return; }
      await refresh(true);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venuePath]);

  const refresh = async (silent = false) => {
    if (working) return;
    setWorking(true);
    setError(null);
    try {
      const { rates: fresh, periods: walked } = await deriveUsageRates(venuePath);
      setRates(fresh);
      // Saving is not a side effect worth hiding: it's the same derivation the
      // Usage rates panel writes, and leaving it unsaved would make every visit
      // re-walk the history.
      if (fresh.length) await saveItemStats(venuePath, fresh);
      if (!silent) {
        showToast(walked.length
          ? `Reworked from ${walked.length} period${walked.length === 1 ? '' : 's'} of counts`
          : 'No pair of counts yet — estimated from deliveries alone');
      }
    } catch (err) {
      console.error('Stock position refresh failed:', err);
      setError(err?.message || 'Could not work out the position');
    } finally {
      setWorking(false);
    }
  };

  const rows = useMemo(() => {
    if (!sessions || !logs || !rates) return null;
    return buildPositions({
      items, sessions, deliveries: logs.deliveries, wastage: logs.wastage,
      rates, unitInfoFor: parseUnitInfo,
    });
  }, [items, sessions, logs, rates]);

  /**
   * How much history the rates rest on, read off the counts themselves rather
   * than off whichever call happened to produce the rates. Stored rates carry
   * no record of the periods behind them, and a page that said "no pair of
   * counts yet" purely because it loaded from cache would undersell the venue
   * its own data.
   */
  const periods = useMemo(() => {
    if (!sessions) return [];
    return usagePeriods(sessions.filter((s) => !s.hiddenFromVariance)).map(({ opening, closing }) => ({
      days: (closing.completedAt.toMillis() - opening.completedAt.toMillis()) / DAY,
    }));
  }, [sessions]);

  const summary = useMemo(() => (rows ? summarise(rows, periods) : null), [rows, periods]);
  const habits = useMemo(() => countingHabits(sessions || []), [sessions]);

  // ---- styles ----
  const card = { backgroundColor: colors.bgCard, border: `1px solid ${colors.borderLight}`, borderRadius: '12px', padding: '1.25rem', marginBottom: '1rem', boxShadow: `0 2px 12px ${colors.shadow}` };
  const toneColor = { error: colors.error, warning: colors.warning, info: colors.textSecondary, muted: colors.textMuted };
  const chip = (tone) => ({ flexShrink: 0, fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.03em', textTransform: 'uppercase', padding: '0.15rem 0.45rem', borderRadius: '9999px', color: toneColor[tone] || colors.textSecondary, border: `1px solid ${toneColor[tone] || colors.border}` });

  if (error && !rows) {
    return <div style={card}><div style={{ color: colors.error, fontSize: '0.9rem' }}>{error}</div></div>;
  }
  if (!rows || !summary) {
    return <div style={{ ...card, textAlign: 'center', color: colors.textSecondary }}>Working out where your stock stands…</div>;
  }

  const groups = ['order', 'look', 'check', 'settled'];
  const rowsIn = (g) => rows.filter((r) => r.group === g);

  // What the whole page rests on, said before any number is shown.
  const evidence = summary.periods > 0
    ? `${summary.periods} period${summary.periods === 1 ? '' : 's'} measured over ${summary.measuredDays} days · ${summary.measured} item${summary.measured === 1 ? '' : 's'} with a rate`
    : summary.estimated > 0
      ? `No pair of counts yet · ${summary.estimated} rate${summary.estimated === 1 ? '' : 's'} estimated from deliveries alone`
      : 'No usage rates yet — one more stock take turns this page on';

  const groupCaption = {
    order: `Cover is under ${LOW_COVER_DAYS} days, or the count says empty. Suggested amounts fill you to about ${TARGET_COVER_DAYS} days.`,
    look: habits.everRecordsZero
      ? 'These were left out of the latest count, or have never been counted at all, so there is no rate to project from. The figure shown is the most anyone last counted plus whatever has arrived since — an upper limit, not a reading.'
      : `Left out of the latest count, which here is ambiguous: across ${habits.takes} take${habits.takes === 1 ? '' : 's'} and ${habits.counted} counted lines not one zero has been recorded, so a blank is as likely to mean "there was none" as "nobody got to it". The figures below are upper limits on that basis. Each row carries the usage it would imply if the item were empty — if that number looks like you, it's empty.`,
    check: summary.still > 0
      ? `${summary.still} item${summary.still === 1 ? '' : 's'} came out of two counts completely unchanged, which a trading week rarely does — usually a count that was copied rather than made.${summary.suspect > 0 ? ` ${summary.suspect} more closed higher than everything available, meaning a miscount or a delivery that never got logged.` : ''}`
      : 'The counts contradict each other here — closing higher than everything that was available. A miscount, or a delivery nobody logged.',
    // "Settled" has to earn the word. A venue one count in has no rates at
    // all, so every quiet item is quiet only because there's nothing yet to
    // compare it against — which is a different thing from being fine.
    settled: (() => {
      const quiet = rowsIn('settled');
      const rated = quiet.filter((r) => r.perWeek > 0).length;
      if (rated === quiet.length) return 'Enough cover, counted recently, nothing odd.';
      if (rated === 0) return 'Counted, and nothing looks wrong — but there is no usage rate behind any of these yet, so "enough" is an assumption. A second count of the same items is what turns it into a figure.';
      return `${rated} of these have cover to spare. The other ${quiet.length - rated} are simply counted with no rate behind them yet — nothing looks wrong, but nothing has been measured either.`;
    })(),
  };

  return (
    <div>
      {/* ---- Headline: what this rests on, and the one thing to do next ---- */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: '0 0 0.15rem', fontSize: '1.1rem', color: colors.textPrimary }}>Where your stock stands</h2>
            <div style={{ fontSize: '0.78rem', color: colors.textSecondary }}>{evidence}</div>
          </div>
          <button
            onClick={() => refresh(false)}
            disabled={working}
            style={{ flexShrink: 0, padding: '0.5rem 0.8rem', border: 'none', borderRadius: '8px', backgroundColor: accent, color: onAccent, fontWeight: 700, fontSize: '0.8rem', cursor: working ? 'wait' : 'pointer', opacity: working ? 0.6 : 1 }}
          >{working ? 'Working…' : 'Rework'}</button>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.9rem', flexWrap: 'wrap' }}>
          {[['Order', summary.order, colors.warning], ['Go and look', summary.look, colors.textSecondary], ["Doesn't add up", summary.check, colors.textSecondary], ['Settled', rows.length - summary.order - summary.look - summary.check, colors.textMuted]].map(([label, n, tone]) => (
            <div key={label} style={{ flex: '1 1 70px', padding: '0.5rem 0.6rem', borderRadius: '9px', backgroundColor: colors.bgLight }}>
              <div style={{ fontSize: '1.2rem', fontWeight: 700, color: tone }}>{n}</div>
              <div style={{ fontSize: '0.68rem', color: colors.textSecondary }}>{label}</div>
            </div>
          ))}
        </div>

        {/* One instruction, not a list of caveats. */}
        <div style={{ marginTop: '0.9rem', padding: '0.7rem 0.8rem', borderRadius: '9px', border: `1px dashed ${colors.border}`, fontSize: '0.82rem', color: colors.textPrimary, lineHeight: 1.45 }}>
          <strong style={{ color: accent }}>Next: </strong>{nextBestAction(summary, rows, habits)}
        </div>
        {error && <div style={{ marginTop: '0.6rem', fontSize: '0.8rem', color: colors.error }}>{error}</div>}
      </div>

      {/* ---- The three lists ---- */}
      {groups.map((g) => {
        const list = rowsIn(g);
        if (!list.length) return null;
        const open = openGroup[g];
        return (
          <div key={g} style={card}>
            <button
              onClick={() => setOpenGroup((s) => ({ ...s, [g]: !s[g] }))}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
            >
              <h3 style={{ flex: 1, margin: 0, fontSize: '1rem', color: colors.textPrimary }}>{GROUP_TITLES[g]}</h3>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: colors.textSecondary }}>{list.length}</span>
              <span style={{ color: colors.textSecondary, fontSize: '0.8rem' }}>{open ? '▾' : '▸'}</span>
            </button>

            {open && (
              <>
                <p style={{ margin: '0.4rem 0 0.8rem', fontSize: '0.76rem', color: colors.textSecondary, lineHeight: 1.45 }}>{groupCaption[g]}</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                  {list.map((r) => {
                    const isOpen = openRow === r.itemId;
                    const cover = formatCover(r.coverDays);
                    return (
                      <div key={r.itemId} style={{ border: `1px solid ${colors.borderLight}`, borderRadius: '9px', overflow: 'hidden' }}>
                        <button
                          onClick={() => setOpenRow(isOpen ? null : r.itemId)}
                          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '0.55rem', padding: '0.55rem 0.65rem', background: isOpen ? colors.bgLight : 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '0.87rem', fontWeight: 600, color: colors.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                            {/* The position and how old it is, together — one is
                                meaningless without the other. */}
                            <div style={{ fontSize: '0.7rem', color: colors.textMuted }}>
                              {r.positionIsCeiling ? 'up to ' : ''}{formatBaseQuantity(r.position, r.unitInfo)}
                              {cover ? ` · ${cover} left` : ''}
                              {` · ${agoText(r.daysSinceCount)}`}
                            </div>
                          </div>
                          {r.suggestWholes > 0 && (
                            <div style={{ flexShrink: 0, textAlign: 'right' }}>
                              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: accent }}>{formatWholes(r.suggestWholes, r.unitInfo)}</div>
                              <div style={{ fontSize: '0.65rem', color: colors.textSecondary }}>suggested</div>
                            </div>
                          )}
                          {r.signal && <span style={chip(r.signal.tone)}>{r.signal.label}</span>}
                        </button>

                        {isOpen && (
                          <div style={{ padding: '0.1rem 0.7rem 0.65rem', fontSize: '0.76rem', color: colors.textSecondary, lineHeight: 1.55 }}>
                            {/* The full working, so a manager can disagree with
                                it on the evidence rather than on instinct. */}
                            <div><strong style={{ color: colors.textPrimary }}>{r.basis.label}</strong> — {r.basis.note}</div>
                            {r.anchorAt && (
                              <div>
                                Counted {formatBaseQuantity(r.anchorQty, r.unitInfo)} on {shortDate(r.anchorAt)}
                                {r.delivered > 0 && `, ${formatBaseQuantity(r.delivered, r.unitInfo)} delivered since`}
                                {r.wasted > 0 && `, ${formatBaseQuantity(r.wasted, r.unitInfo)} wasted`}
                                {r.depletion > 0 && `, about ${formatBaseQuantity(r.depletion, r.unitInfo)} sold since`}
                              </div>
                            )}
                            {!r.anchorAt && (
                              <div>
                                Never counted.{r.delivered > 0 ? ` ${formatBaseQuantity(r.delivered, r.unitInfo)} delivered${r.lastDeliveryAt ? ` (last ${shortDate(r.lastDeliveryAt)})` : ''}, and nothing since to check it against.` : ' No deliveries logged either — if you don\'t stock it, archive it.'}
                              </div>
                            )}
                            {/* The question that settles it, asked in the terms
                                the person can actually answer. */}
                            {r.positionIsCeiling && (
                              <div style={{ marginTop: '0.3rem', padding: '0.45rem 0.55rem', borderRadius: '7px', backgroundColor: colors.bgLight }}>
                                Left out of the last count. If that's because it was <strong style={{ color: colors.textPrimary }}>empty</strong>, you got through{' '}
                                <strong style={{ color: colors.textPrimary }}>{formatUsage(r.ifEmptyPerWeek, r.unitInfo)} a week</strong> — does that sound like you?
                                {' '}If it's because nobody got to it, there could still be {formatBaseQuantity(r.position, r.unitInfo)} down there.
                              </div>
                            )}
                            {r.perWeek > 0 ? (
                              <div>
                                Uses {formatUsage(r.perWeek, r.unitInfo)} a week —{' '}
                                {r.perWeekSource === 'counts' ? 'measured between counts' : 'estimated from deliveries'}
                                {` (${CONFIDENCE_NOTE[r.confidence] || r.confidence})`}
                              </div>
                            ) : (
                              <div>No usage rate — {r.skipped ? 'it was skipped in the last count, so there is no period to measure across.' : 'not counted at both ends of any period yet.'}</div>
                            )}
                            {r.signals.length > 1 && (
                              <div style={{ marginTop: '0.3rem', display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                                {r.signals.map((s) => <span key={s.key} style={chip(s.tone)}>{s.label}</span>)}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        );
      })}

      {toast && (
        <div style={{ position: 'fixed', bottom: '1.25rem', left: '50%', transform: 'translateX(-50%)', backgroundColor: colors.textPrimary, color: colors.bgCard, padding: '0.7rem 1.1rem', borderRadius: '9px', fontSize: '0.85rem', zIndex: 60, maxWidth: '90vw', textAlign: 'center' }}>
          {toast}
        </div>
      )}
    </div>
  );
}

export default StockPosition;
