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
  isMeasured, formatContainers, GROUP_TITLES, UNSEEN_DAYS,
} from '../utils/stockPosition';
import { parseUnitInfo, formatBaseQuantity } from '../utils/stockUnitUtils';
import { compareCategories } from '../utils/categoryName';

const DAY = 86400000;
/** How far back to sweep the logs for "what's moved since the count". */
const LOG_WINDOW_DAYS = 180;

const shortDate = (ms) => (ms ? new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');

/** Kegs for draught, the item's own terms for everything else. */
const qty = (n, unitInfo) => (isMeasured(unitInfo)
  ? formatContainers(n, unitInfo)
  : formatBaseQuantity(n, unitInfo));

/**
 * Break a group's rows into the blocks the screen draws.
 *
 * The in-stock list is already sorted into category order, so consecutive runs
 * of one category are its sections. Everything else is one unsectioned block —
 * those lists are ranked by urgency, and dividing them by category would put a
 * shape on them they don't have.
 */
function segmentsOf(list, group) {
  if (group !== 'stock') return [{ key: group, heading: null, rows: list }];
  const out = [];
  for (const r of list) {
    const heading = r.category || 'Uncategorised';
    const last = out[out.length - 1];
    if (last && last.heading === heading) last.rows.push(r);
    else out.push({ key: heading, heading, rows: [r] });
  }
  return out;
}

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

  /**
   * Takes that are open right now — started, or completed and then reopened.
   *
   * These have to be called out, because an open take is invisible to every
   * figure on this page and its absence is loud. Nothing anchors to an
   * unfinished count, so reopening the most recent one silently rewinds the
   * whole report to the count before it: dates jump back a week, "left out of
   * the last count" empties (there is no last count), and items only ever seen
   * in the reopened take reappear as never counted. All of that is correct and
   * none of it is guessable, so the page says so instead.
   */
  const openTakes = useMemo(() => (sessions || [])
    .filter((s) => s.status !== 'completed')
    .map((s) => {
      const section = s.section === 'kitchen' ? 'kitchen' : 'bar';
      const total = (items || []).filter((i) => !i.archived
        && (i.section === 'kitchen' ? 'kitchen' : 'bar') === section).length;
      return { id: s.id, section, counted: Object.keys(s.counts || {}).length, total };
    }), [sessions, items]);

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
    stock: 'What was counted, plus deliveries and less wastage since. Nothing takes stock off as you trade, so these read high — the longer since the count, the more so.',
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

        {/* Search and categories live in the header rather than a card of
            their own — on a 90-line list they're how you use the thing, and a
            second block of chrome only pushes the stock further down. */}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search stock item…"
          style={{ ...input, marginTop: '0.8rem' }}
        />
        {categories.length > 0 && (
          <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem', overflowX: 'auto', scrollbarWidth: 'none' }}>
            <button onClick={() => setCategoryFilter('')} style={pill(categoryFilter === '')}>All</button>
            {categories.map((c) => (
              <button key={c} onClick={() => setCategoryFilter(categoryFilter === c ? '' : c)} style={pill(categoryFilter === c)}>{c}</button>
            ))}
          </div>
        )}
        {openTakes.map((t) => (
          <div
            key={t.id}
            style={{ marginTop: '0.8rem', padding: '0.7rem 0.8rem', borderRadius: '9px', backgroundColor: colors.warningSoft, border: `1px solid ${colors.warning}`, fontSize: '0.82rem', color: colors.textPrimary, lineHeight: 1.5 }}
          >
            <strong>A {t.section} stock take is open</strong> — {t.counted} of {t.total} counted so far.
            Nothing below uses it yet: an unfinished count isn't a figure, so these are from the last
            completed take{summary.lastCountAt ? ` (${shortDate(summary.lastCountAt)})` : ''}. Finish it and this page catches up.
          </div>
        ))}
        {error && <div style={{ marginTop: '0.6rem', fontSize: '0.8rem', color: colors.error }}>{error}</div>}
      </div>

      {rows.length === 0 && (
        <div style={{ ...card, textAlign: 'center', color: colors.textSecondary }}>Nothing matches.</div>
      )}

      {/* In stock leads. It's the list a manager opens this to read — he
          already knows his cellar, and this is the app learning it alongside
          him. The flagged groups are housekeeping and sit underneath. */}
      {['stock', 'out', 'check'].map((g) => {
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
                {/* Each category sits on its own lightly sunken tray, so where
                    one ends and the next begins is visible at a glance rather
                    than inferred from a small heading in a long column.
                    Only the in-stock list is sectioned — the flagged groups are
                    ranked by urgency, and trays would imply an order they
                    aren't in. */}
                {segmentsOf(list, g).map((seg) => (
                  <div
                    key={seg.key}
                    style={seg.heading
                      ? { backgroundColor: colors.bgLight, borderRadius: '10px', padding: '0.55rem 0.6rem', marginBottom: '0.5rem' }
                      : undefined}
                  >
                    {seg.heading && (
                      <div style={{ margin: '0 0.05rem 0.4rem', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: colors.textSecondary }}>
                        {seg.heading}
                      </div>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                      {seg.rows.map((r) => {
                        const isOpen = openRow === r.itemId;
                        return (
                          <div key={r.itemId} style={{ border: `1px solid ${colors.borderLight}`, borderRadius: '9px', overflow: 'hidden', backgroundColor: seg.heading ? colors.bgCard : 'transparent' }}>
                        <button
                          onClick={() => setOpenRow(isOpen ? null : r.itemId)}
                          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '0.55rem', padding: '0.55rem 0.65rem', background: isOpen ? colors.primarySoft : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '0.87rem', fontWeight: 600, color: colors.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                            {/* Litres stay visible for draught — the keg count
                                is what gets ordered, but a part keg is a real
                                thing and rounding it away would hide it. */}
                            <div style={{ fontSize: '0.7rem', color: colors.textMuted }}>
                              {countedAgo(r.daysSinceCount)}
                              {isMeasured(r.unitInfo) && ` · ${formatBaseQuantity(r.quantity, r.unitInfo)}`}
                            </div>
                          </div>
                          <div style={{ flexShrink: 0, fontSize: '0.95rem', fontWeight: 700, color: colors.textPrimary }}>
                            {r.skipped && <span style={{ fontWeight: 400, fontSize: '0.75rem', color: colors.textMuted }}>up to </span>}
                            {qty(r.quantity, r.unitInfo)}
                          </div>
                          {r.signal && <span style={chip(r.signal.tone)}>{r.signal.label}</span>}
                        </button>

                        {isOpen && (
                          <div style={{ padding: '0.1rem 0.7rem 0.65rem', fontSize: '0.76rem', color: colors.textSecondary, lineHeight: 1.55 }}>
                            <div><strong style={{ color: colors.textPrimary }}>{r.basis.label}</strong> — {r.basis.note}</div>
                            {r.anchorAt ? (
                              <div>
                                Counted {qty(r.anchorQty, r.unitInfo)} on {shortDate(r.anchorAt)}
                                {r.delivered > 0 && `, ${qty(r.delivered, r.unitInfo)} delivered since`}
                                {r.wasted > 0 && `, ${qty(r.wasted, r.unitInfo)} wasted since`}
                              </div>
                            ) : (
                              <div>
                                {r.delivered > 0
                                  ? `${qty(r.delivered, r.unitInfo)} booked in, never checked against a count.`
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
                  </div>
                ))}
              </>
            )}
          </div>
        );
      })}

      {/* The learning nudge sits under the stock, not over it. Oli already
          knows his cellar; this is the app catching up, and it shouldn't
          stand between him and the list he came for. */}
      <div style={{ ...card, marginBottom: 0, borderStyle: 'dashed' }}>
        <div style={{ fontSize: '0.82rem', color: colors.textPrimary, lineHeight: 1.5 }}>
          <strong style={{ color: accent }}>Getting sharper: </strong>
          {nextBestAction(summary, allRows, habits)}
        </div>
      </div>
    </div>
  );
}

export default StockPosition;
