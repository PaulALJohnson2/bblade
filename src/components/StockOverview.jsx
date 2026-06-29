/**
 * StockOverview — admin record of stock takes (sessions).
 *
 * Filter/search the history, drill into a take's per-item counts, export it as
 * PDF or CSV, and compare a completed take against the previous one of the same
 * section (variance / usage). Read-only over the live sessions subscription.
 *
 * Props: venuePath, canEdit
 */

import React, { useEffect, useMemo, useState } from 'react';
import { subscribeToStockSessions } from '../services/apiService';
import { useStockData } from '../contexts/StockDataContext';
import { useAuth } from '../contexts/AuthContext';
import { parseUnitInfo, formatCountOverview } from '../utils/stockUnitUtils';
import { printSessionReport, downloadSessionCSV } from '../utils/sessionReport';
import { getThemeColors } from '../utils/theme';
import useTheme from '../hooks/useTheme';

const sectionColor = (section, colors) => (section === 'kitchen' ? '#d69e2e' : colors.primary);
const ts = (t) => (t?.toDate ? t.toDate().getTime() : 0);
const oneDp = (n) => String(Number(n.toFixed(1)));
const RANGES = [{ key: '30', label: '30 days', days: 30 }, { key: '90', label: '90 days', days: 90 }, { key: 'all', label: 'All', days: null }];

const unitInfoFor = (item, count) => (item ? parseUnitInfo(item)
  : { hasPartUnit: !!count.partLabel, hasTenthsOption: false, partLabel: count.partLabel, wholeLabel: count.wholeLabel, unitsPerWhole: 1 });

// Signed change between two base-unit quantities, in the item's display terms.
function formatDelta(fromQty, toQty, unitInfo) {
  const dq = Math.round(((toQty || 0) - (fromQty || 0)) * 100) / 100;
  if (!dq) return null;
  const sign = dq > 0 ? '+' : '−';
  const abs = Math.abs(dq);
  const upw = (unitInfo && unitInfo.hasPartUnit && unitInfo.unitsPerWhole) || 1;
  let text;
  if (unitInfo && unitInfo.partLabel === 'Tenths' && !unitInfo.hasTenthsOption) {
    text = `${oneDp(abs / upw)} ${unitInfo.wholeLabel || 'Bottles'}`; // spirits → decimal bottles
  } else if (upw > 1) {
    const whole = Math.trunc(abs / upw);
    const rem = Math.round((abs - whole * upw) * 100) / 100;
    const parts = [];
    if (whole) parts.push(`${whole} ${unitInfo.wholeLabel}`);
    if (rem) parts.push(`${rem} ${unitInfo.partLabel}`);
    text = parts.join(', ') || `${abs}`;
  } else {
    text = `${abs} ${(unitInfo && unitInfo.wholeLabel) || ''}`.trim();
  }
  return { positive: dq > 0, text: `${sign}${text}` };
}

function StockOverview({ venuePath, canEdit = true }) {
  const { isDark } = useTheme();
  const colors = getThemeColors(isDark);
  const { items } = useStockData();
  const { pubName } = useAuth();

  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [showVariance, setShowVariance] = useState(false);
  const [sectionFilter, setSectionFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [rangeKey, setRangeKey] = useState('30');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!venuePath) return;
    setLoading(true);
    const unsub = subscribeToStockSessions(venuePath, (list) => { setSessions(list || []); setLoading(false); });
    return () => unsub();
  }, [venuePath]);

  const itemsById = useMemo(() => {
    const m = {};
    items.forEach((i) => { m[i.id] = i; });
    return m;
  }, [items]);

  const toggle = (id) => { setExpanded(expanded === id ? null : id); setShowVariance(false); };

  const q = search.trim().toLowerCase();
  const rangeDays = RANGES.find((r) => r.key === rangeKey)?.days;
  const cutoff = rangeDays ? Date.now() - rangeDays * 86400000 : 0;
  const itemFilterActive = !!q || !!categoryFilter;

  // Categories present in the items of the selected section.
  const categories = useMemo(() => {
    const inSection = items.filter((i) => !i.archived && (sectionFilter === 'all' || (i.section === 'kitchen' ? 'kitchen' : 'bar') === sectionFilter));
    return [...new Set(inSection.map((i) => i.category).filter(Boolean))].sort();
  }, [items, sectionFilter]);

  // Does this counted item match the active stock-item search / category filter?
  const matchItem = (itemId, count) => {
    const item = itemsById[itemId];
    const name = (count?.itemName || item?.name || '').toLowerCase();
    if (q && !name.includes(q)) return false;
    if (categoryFilter && (item?.category || '') !== categoryFilter) return false;
    return true;
  };

  const visible = useMemo(() => sessions
    .filter((s) => sectionFilter === 'all' || (s.section === 'kitchen' ? 'kitchen' : 'bar') === sectionFilter)
    .filter((s) => !rangeDays || (ts(s.completedAt) || ts(s.createdAt)) >= cutoff)
    .filter((s) => !itemFilterActive || Object.entries(s.counts || {}).some(([id, c]) => matchItem(id, c)))
    .sort((a, b) => {
      const ap = a.status === 'completed' ? 1 : 0;
      const bp = b.status === 'completed' ? 1 : 0;
      if (ap !== bp) return ap - bp;
      return (ts(b.completedAt) || ts(b.createdAt)) - (ts(a.completedAt) || ts(a.createdAt));
    }), [sessions, sectionFilter, rangeKey, q, categoryFilter, itemsById]);

  const lastCompleted = useMemo(() => {
    const done = sessions.filter((s) => s.status === 'completed');
    if (!done.length) return null;
    return done.reduce((a, b) => ((ts(b.completedAt) || ts(b.createdAt)) > (ts(a.completedAt) || ts(a.createdAt)) ? b : a));
  }, [sessions]);

  // Previous completed take of the same section, immediately before `s`.
  const prevCompleted = (s) => {
    const t = ts(s.completedAt) || ts(s.createdAt);
    return sessions
      .filter((o) => o.id !== s.id && o.status === 'completed' && o.section === s.section && (ts(o.completedAt) || ts(o.createdAt)) < t)
      .sort((a, b) => (ts(b.completedAt) || ts(b.createdAt)) - (ts(a.completedAt) || ts(a.createdAt)))[0] || null;
  };

  const varianceRows = (s) => {
    const prev = prevCompleted(s);
    if (!prev) return null;
    const ids = new Set([...Object.keys(s.counts || {}), ...Object.keys(prev.counts || {})]);
    const rows = [];
    ids.forEach((id) => {
      const cur = s.counts?.[id];
      const old = prev.counts?.[id];
      if (itemFilterActive && !matchItem(id, cur || old)) return;
      const curQ = cur?.quantity || 0;
      const oldQ = old?.quantity || 0;
      const item = itemsById[id];
      const unitInfo = unitInfoFor(item, cur || old || {});
      const delta = formatDelta(oldQ, curQ, unitInfo);
      if (!delta) return;
      rows.push({
        id, name: cur?.itemName || old?.itemName || item?.name || 'Item',
        prev: old ? formatCountOverview(old, unitInfo) : '—',
        cur: cur ? formatCountOverview(cur, unitInfo) : '—',
        delta, raw: curQ - oldQ,
      });
    });
    return { prev, rows: rows.sort((a, b) => a.raw - b.raw) };
  };

  const card = { backgroundColor: colors.bgCard, border: `1px solid ${colors.borderLight}`, borderRadius: '12px', padding: '1.5rem', marginBottom: '1.5rem', boxShadow: `0 2px 12px ${colors.shadow}` };
  const input = { width: '100%', padding: '0.6rem', fontSize: '0.95rem', border: `2px solid ${colors.border}`, borderRadius: '8px', backgroundColor: colors.bgCard, color: colors.textPrimary, boxSizing: 'border-box' };
  const pill = (active, accent = colors.primary) => ({ flexShrink: 0, padding: '0.45rem 0.9rem', borderRadius: '9999px', border: 'none', backgroundColor: active ? accent : colors.bgLight, color: active ? '#fff' : colors.textPrimary, fontWeight: active ? 700 : 500, fontSize: '0.85rem', cursor: 'pointer', whiteSpace: 'nowrap', textTransform: 'capitalize' });
  const exportBtn = { flex: 1, padding: '0.55rem', borderRadius: '8px', border: `1px solid ${colors.border}`, backgroundColor: colors.bgCard, color: colors.textPrimary, fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' };
  const fmtDate = (t) => (t?.toDate ? t.toDate().toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

  if (!canEdit) return null;

  return (
    <div style={card}>
      <h2 style={{ margin: '0 0 0.25rem', fontSize: '1.1rem', color: colors.textPrimary }}>Stock takes</h2>
      <p style={{ margin: '0 0 1rem', color: colors.textSecondary, fontSize: '0.85rem' }}>
        Your record of counts — filter, open one to see details, export it, or compare to the previous take.
      </p>

      {/* Section + range filters */}
      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.6rem', overflowX: 'auto', scrollbarWidth: 'none' }}>
        {['all', 'bar', 'kitchen'].map((s) => (
          <button key={s} onClick={() => { setSectionFilter(s); setCategoryFilter(''); }} style={pill(sectionFilter === s, sectionColor(s, colors))}>{s}</button>
        ))}
        <span style={{ width: '1px', background: colors.borderLight, margin: '0 0.25rem' }} />
        {RANGES.map((r) => (
          <button key={r.key} onClick={() => setRangeKey(r.key)} style={pill(rangeKey === r.key)}>{r.label}</button>
        ))}
      </div>

      {/* Category filters */}
      {categories.length > 0 && (
        <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.6rem', overflowX: 'auto', scrollbarWidth: 'none' }}>
          <button onClick={() => setCategoryFilter('')} style={pill(categoryFilter === '')}>All</button>
          {categories.map((c) => (
            <button key={c} onClick={() => setCategoryFilter(c)} style={{ ...pill(categoryFilter === c), textTransform: 'none' }}>{c}</button>
          ))}
        </div>
      )}

      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search stock item…" style={{ ...input, marginBottom: '0.6rem' }} />

      {/* Headline stats */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', fontSize: '0.8rem', color: colors.textSecondary }}>
        <span><strong style={{ color: colors.textPrimary }}>{visible.length}</strong> take{visible.length === 1 ? '' : 's'} shown</span>
        {lastCompleted && <span>· Last completed <strong style={{ color: colors.textPrimary }}>{fmtDate(lastCompleted.completedAt || lastCompleted.createdAt)}</strong></span>}
      </div>

      {loading ? (
        <div style={{ color: colors.textSecondary, padding: '1rem', textAlign: 'center' }}>Loading…</div>
      ) : visible.length === 0 ? (
        <div style={{ color: colors.textSecondary, padding: '1rem', textAlign: 'center' }}>No stock takes match.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {visible.map((s) => {
            const open = expanded === s.id;
            const counts = s.counts || {};
            const itemCount = Object.keys(counts).length;
            const inProgress = s.status !== 'completed';
            const accent = sectionColor(s.section, colors);
            const variance = open && showVariance ? varianceRows(s) : null;
            return (
              <div key={s.id} style={{ border: `1px solid ${colors.borderLight}`, borderRadius: '8px', overflow: 'hidden' }}>
                <button
                  onClick={() => toggle(s.id)}
                  style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 0.75rem', background: open ? colors.bgLight : 'none', border: 'none', cursor: 'pointer' }}
                >
                  <span style={{ fontSize: '0.62rem', fontWeight: 700, padding: '0.1rem 0.45rem', borderRadius: '9999px', color: '#fff', backgroundColor: accent, textTransform: 'uppercase' }}>
                    {s.section === 'kitchen' ? 'Kitchen' : 'Bar'}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: colors.textPrimary }}>{fmtDate(s.completedAt || s.createdAt)}</div>
                    <div style={{ fontSize: '0.75rem', color: colors.textSecondary }}>
                      {itemCount} item{itemCount === 1 ? '' : 's'}{s.createdByName ? ` · ${s.createdByName}` : ''}
                    </div>
                  </div>
                  <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: '9999px', backgroundColor: inProgress ? colors.warningSoft : colors.successSoft, color: inProgress ? colors.warning : colors.success }}>
                    {inProgress ? 'In progress' : 'Completed'}
                  </span>
                  <span style={{ color: colors.textSecondary, fontSize: '0.8rem' }}>{open ? '▾' : '▸'}</span>
                </button>

                {open && (
                  <div style={{ borderTop: `1px solid ${colors.borderLight}` }}>
                    {/* Actions */}
                    <div style={{ display: 'flex', gap: '0.5rem', padding: '0.6rem 0.75rem' }}>
                      <button style={exportBtn} onClick={() => printSessionReport(s, itemsById, pubName)}>Export PDF</button>
                      <button style={exportBtn} onClick={() => downloadSessionCSV(s, itemsById, pubName)}>Export CSV</button>
                      {prevCompleted(s) && (
                        <button style={{ ...exportBtn, backgroundColor: showVariance ? colors.primarySoft : colors.bgCard, color: showVariance ? colors.primary : colors.textPrimary, fontWeight: 700 }} onClick={() => setShowVariance((v) => !v)}>
                          {showVariance ? 'Hide variance' : 'Variance'}
                        </button>
                      )}
                    </div>

                    {/* Variance vs previous */}
                    {variance && (
                      <div style={{ borderTop: `1px solid ${colors.borderLight}`, backgroundColor: colors.bgLight }}>
                        <div style={{ padding: '0.5rem 0.75rem', fontSize: '0.78rem', color: colors.textSecondary }}>
                          vs previous {s.section === 'kitchen' ? 'kitchen' : 'bar'} take ({fmtDate(variance.prev.completedAt || variance.prev.createdAt)})
                        </div>
                        {variance.rows.length === 0 ? (
                          <div style={{ padding: '0 0.75rem 0.6rem', fontSize: '0.82rem', color: colors.textSecondary }}>No changes.</div>
                        ) : variance.rows.map((r) => (
                          <div key={r.id} style={{ padding: '0.45rem 0.75rem', borderTop: `1px solid ${colors.borderLight}`, display: 'flex', gap: '0.6rem', alignItems: 'baseline' }}>
                            <span style={{ flex: 1, minWidth: 0, fontSize: '0.85rem', color: colors.textPrimary }}>{r.name}</span>
                            <span style={{ fontSize: '0.74rem', color: colors.textMuted }}>{r.prev} → {r.cur}</span>
                            <span style={{ flexShrink: 0, fontSize: '0.82rem', fontWeight: 700, color: r.delta.positive ? colors.success : colors.error, minWidth: '70px', textAlign: 'right' }}>{r.delta.text}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Counts */}
                    {itemCount === 0 ? (
                      <div style={{ padding: '0.6rem 0.75rem', fontSize: '0.85rem', color: colors.textSecondary }}>Nothing counted yet.</div>
                    ) : (
                      Object.entries(counts)
                        .filter(([itemId, count]) => !itemFilterActive || matchItem(itemId, count))
                        .map(([itemId, count]) => (
                        <div key={itemId} style={{ padding: '0.5rem 0.75rem', borderTop: `1px solid ${colors.borderLight}`, display: 'flex', gap: '0.6rem', alignItems: 'baseline' }}>
                          <span style={{ flex: 1, minWidth: 0, fontSize: '0.85rem', color: colors.textPrimary }}>{count.itemName || itemsById[itemId]?.name || 'Item'}</span>
                          {(() => {
                            const s = formatCountOverview(count, unitInfoFor(itemsById[itemId], count));
                            const m = s.match(/^([\d.]+)(.*)$/);
                            return (
                              <span style={{ fontSize: '0.85rem', color: colors.textSecondary, textAlign: 'right' }}>
                                {m ? <><strong style={{ color: colors.textPrimary }}>{m[1]}</strong>{m[2]}</> : s}
                              </span>
                            );
                          })()}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default StockOverview;
