/**
 * StockPosition — "how much have I got?", answered plainly.
 *
 * The arithmetic is in utils/stockPosition.js, and there is deliberately very
 * little of it. This screen shows the venue's own running stock figure with the
 * one thing that decides whether to believe it — how long since somebody
 * physically counted the item — and nothing else. No projection, no days of
 * cover, no suggested order.
 *
 * That restraint is the design, not a gap. Two counts a week apart is one
 * measurement, and a screen that turns one measurement into an order quantity
 * teaches a manager to trust a number it hasn't earned. The learning at this
 * stage is happening in goods-in: every scanned note sharpens the delivery
 * feed, and the usage rates built on it (Sales → Variance) get better on their
 * own. When they're solid, ordering can be built on top of this. Until then the
 * useful thing is an accurate stock list and an honest note of what's stale.
 *
 * Props: venuePath, items, colors, accent, onAccent
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  subscribeToStockSessions, getDeliveriesBetween, getWastageBetween,
} from '../services/apiService';
import {
  buildPositions, summarise, nextBestAction, countedAgo, countingHabits,
  GROUP_TITLES, UNSEEN_DAYS,
} from '../utils/stockPosition';
import { parseUnitInfo, formatBaseQuantity } from '../utils/stockUnitUtils';
import { compareCategories } from '../utils/categoryName';

const DAY = 86400000;
/** How far back to sweep the logs for "what's moved since the count". */
const LOG_WINDOW_DAYS = 180;

const shortDate = (ms) => (ms ? new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');

function StockPosition({ venuePath, items, colors, accent }) {
  const [sessions, setSessions] = useState(null);
  const [logs, setLogs] = useState(null); // { deliveries, wastage }
  const [error, setError] = useState(null);
  const [openGroup, setOpenGroup] = useState({ out: true, check: true, stock: true });
  const [openRow, setOpenRow] = useState(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  useEffect(() => {
    if (!venuePath) return undefined;
    const unsub = subscribeToStockSessions(venuePath, (list) => setSessions(list || []));
    return () => unsub();
  }, [venuePath]);

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

  const allRows = useMemo(() => {
    if (!sessions || !logs) return null;
    return buildPositions({
      items, sessions, deliveries: logs.deliveries, wastage: logs.wastage, unitInfoFor: parseUnitInfo,
    });
  }, [items, sessions, logs]);

  const categories = useMemo(() => (allRows
    ? [...new Set(allRows.map((r) => r.category).filter(Boolean))].sort(compareCategories)
    : []), [allRows]);

  const q = search.trim().toLowerCase();
  const rows = useMemo(() => (allRows || []).filter((r) => {
    if (q && !r.name.toLowerCase().includes(q)) return false;
    if (categoryFilter && r.category !== categoryFilter) return false;
    return true;
  }), [allRows, q, categoryFilter]);

  // Headline counts describe the venue, not the current filter — a search for
  // "gin" shouldn't make it look like the pub only has four items.
  const summary = useMemo(() => (allRows ? summarise(allRows) : null), [allRows]);
  const habits = useMemo(() => countingHabits(sessions || []), [sessions]);

  const card = { backgroundColor: colors.bgCard, border: `1px solid ${colors.borderLight}`, borderRadius: '12px', padding: '1.25rem', marginBottom: '1rem', boxShadow: `0 2px 12px ${colors.shadow}` };
  const toneColor = { error: colors.error, warning: colors.warning, info: colors.textSecondary, muted: colors.textMuted };
  const chip = (tone) => ({ flexShrink: 0, fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.03em', textTransform: 'uppercase', padding: '0.15rem 0.45rem', borderRadius: '9999px', color: toneColor[tone] || colors.textSecondary, border: `1px solid ${toneColor[tone] || colors.border}` });
  const input = { width: '100%', padding: '0.6rem', fontSize: '0.95rem', border: `2px solid ${colors.border}`, borderRadius: '8px', backgroundColor: colors.bgCard, color: colors.textPrimary, boxSizing: 'border-box' };
  const pill = (active) => ({ flexShrink: 0, padding: '0.4rem 0.8rem', borderRadius: '9999px', border: 'none', backgroundColor: active ? accent : colors.bgLight, color: active ? '#fff' : colors.textPrimary, fontWeight: active ? 700 : 500, fontSize: '0.8rem', cursor: 'pointer', whiteSpace: 'nowrap' });

  if (error && !allRows) {
    return <div style={card}><div style={{ color: colors.error, fontSize: '0.9rem' }}>{error}</div></div>;
  }
  if (!allRows || !summary) {
    return <div style={{ ...card, textAlign: 'center', color: colors.textSecondary }}>Loading your stock…</div>;
  }

  const groupCaption = {
    out: 'Counted, and there was none there.',
    check: habits.everRecordsZero
      ? `Left out of the latest count, or never counted at all — so these figures are older than the rest, or are only what was booked in.`
      : `Left out of the latest count, or never counted. Across ${habits.takes} take${habits.takes === 1 ? '' : 's'} not one zero has been recorded here, so a blank may mean "there was none" rather than "nobody got to it" — the figure shown is an upper limit either way.`,
    stock: `Counted recently, with any deliveries and wastage since applied. There is no till feed, so nothing takes stock off these as you trade — expect them to read high, and more so the longer since the count.`,
  };

  return (
    <div>
      <div style={card}>
        <h2 style={{ margin: '0 0 0.15rem', fontSize: '1.1rem', color: colors.textPrimary }}>What's in stock</h2>
        <div style={{ fontSize: '0.78rem', color: colors.textSecondary }}>
          {summary.items} item{summary.items === 1 ? '' : 's'} · {summary.counted} counted
          {summary.uncounted > 0 && ` · ${summary.uncounted} never counted`}
          {summary.lastCountAt ? ` · last count ${shortDate(summary.lastCountAt)}` : ''}
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.9rem', flexWrap: 'wrap' }}>
          {[['In stock', summary.inStock, colors.textPrimary], ['Worth a look', summary.check, colors.warning], ['Nothing left', summary.out, colors.error]].map(([label, n, tone]) => (
            <div key={label} style={{ flex: '1 1 80px', padding: '0.5rem 0.6rem', borderRadius: '9px', backgroundColor: colors.bgLight }}>
              <div style={{ fontSize: '1.2rem', fontWeight: 700, color: tone }}>{n}</div>
              <div style={{ fontSize: '0.68rem', color: colors.textSecondary }}>{label}</div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: '0.9rem', padding: '0.7rem 0.8rem', borderRadius: '9px', border: `1px dashed ${colors.border}`, fontSize: '0.82rem', color: colors.textPrimary, lineHeight: 1.45 }}>
          <strong style={{ color: accent }}>Next: </strong>{nextBestAction(summary, allRows, habits)}
        </div>
        {error && <div style={{ marginTop: '0.6rem', fontSize: '0.8rem', color: colors.error }}>{error}</div>}
      </div>

      {/* Filters */}
      <div style={card}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search stock item…" style={input} />
        {categories.length > 0 && (
          <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.6rem', overflowX: 'auto', scrollbarWidth: 'none' }}>
            <button onClick={() => setCategoryFilter('')} style={pill(categoryFilter === '')}>All</button>
            {categories.map((c) => (
              <button key={c} onClick={() => setCategoryFilter(categoryFilter === c ? '' : c)} style={pill(categoryFilter === c)}>{c}</button>
            ))}
          </div>
        )}
      </div>

      {rows.length === 0 && (
        <div style={{ ...card, textAlign: 'center', color: colors.textSecondary }}>Nothing matches.</div>
      )}

      {['out', 'check', 'stock'].map((g) => {
        const list = rows.filter((r) => r.group === g);
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
                    return (
                      <div key={r.itemId} style={{ border: `1px solid ${colors.borderLight}`, borderRadius: '9px', overflow: 'hidden' }}>
                        <button
                          onClick={() => setOpenRow(isOpen ? null : r.itemId)}
                          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '0.55rem', padding: '0.55rem 0.65rem', background: isOpen ? colors.bgLight : 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '0.87rem', fontWeight: 600, color: colors.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                            <div style={{ fontSize: '0.7rem', color: colors.textMuted }}>{countedAgo(r.daysSinceCount)}</div>
                          </div>
                          <div style={{ flexShrink: 0, fontSize: '0.95rem', fontWeight: 700, color: colors.textPrimary }}>
                            {r.skipped && <span style={{ fontWeight: 400, fontSize: '0.75rem', color: colors.textMuted }}>up to </span>}
                            {formatBaseQuantity(r.quantity, r.unitInfo)}
                          </div>
                          {r.signal && <span style={chip(r.signal.tone)}>{r.signal.label}</span>}
                        </button>

                        {isOpen && (
                          <div style={{ padding: '0.1rem 0.7rem 0.65rem', fontSize: '0.76rem', color: colors.textSecondary, lineHeight: 1.55 }}>
                            <div><strong style={{ color: colors.textPrimary }}>{r.basis.label}</strong> — {r.basis.note}</div>
                            {r.anchorAt ? (
                              <div>
                                Counted {formatBaseQuantity(r.anchorQty, r.unitInfo)} on {shortDate(r.anchorAt)}
                                {r.delivered > 0 && `, ${formatBaseQuantity(r.delivered, r.unitInfo)} delivered since`}
                                {r.wasted > 0 && `, ${formatBaseQuantity(r.wasted, r.unitInfo)} wasted since`}
                              </div>
                            ) : (
                              <div>
                                {r.delivered > 0
                                  ? `${formatBaseQuantity(r.delivered, r.unitInfo)} booked in, never checked against a count.`
                                  : 'Never counted and nothing ever booked in — if you don\'t stock it, archive it.'}
                              </div>
                            )}
                            {r.skipped && (
                              <div style={{ marginTop: '0.3rem', padding: '0.45rem 0.55rem', borderRadius: '7px', backgroundColor: colors.bgLight }}>
                                Left out of the last count, so this is an upper limit — it's either still there, or it was empty and got skipped. Counting it next time settles it.
                              </div>
                            )}
                            {r.signal?.key === 'unseen' && (
                              <div style={{ marginTop: '0.3rem' }}>Over {UNSEEN_DAYS} days since anyone counted this, so it has only moved on deliveries and wastage since.</div>
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
    </div>
  );
}

export default StockPosition;
