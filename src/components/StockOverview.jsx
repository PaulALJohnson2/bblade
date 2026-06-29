/**
 * StockOverview — admin view of stock takes (sessions): in-progress and
 * completed, newest first, each with a click-through to the per-item counts.
 *
 * Props: venuePath, canEdit
 */

import React, { useEffect, useMemo, useState } from 'react';
import { subscribeToStockSessions } from '../services/apiService';
import { useStockData } from '../contexts/StockDataContext';
import { parseUnitInfo, formatCountSummary } from '../utils/stockUnitUtils';
import { getThemeColors } from '../utils/theme';
import useTheme from '../hooks/useTheme';

const sectionColor = (section, colors) => (section === 'kitchen' ? '#d69e2e' : colors.primary);
const ts = (t) => (t?.toDate ? t.toDate().getTime() : 0);

function StockOverview({ venuePath, canEdit = true }) {
  const { isDark } = useTheme();
  const colors = getThemeColors(isDark);
  const { items } = useStockData();

  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);

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

  // In-progress first, then by completed/created time, newest first.
  const sorted = useMemo(() => [...sessions].sort((a, b) => {
    const ap = a.status === 'completed' ? 1 : 0;
    const bp = b.status === 'completed' ? 1 : 0;
    if (ap !== bp) return ap - bp;
    return (ts(b.completedAt) || ts(b.createdAt)) - (ts(a.completedAt) || ts(a.createdAt));
  }), [sessions]);

  const fmtDate = (t) => (t?.toDate ? t.toDate().toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

  const card = { backgroundColor: colors.bgCard, border: `1px solid ${colors.borderLight}`, borderRadius: '12px', padding: '1.5rem', marginBottom: '1.5rem', boxShadow: `0 2px 12px ${colors.shadow}` };

  if (!canEdit) return null;

  return (
    <div style={card}>
      <h2 style={{ margin: '0 0 0.25rem', fontSize: '1.1rem', color: colors.textPrimary }}>Stock takes</h2>
      <p style={{ margin: '0 0 1rem', color: colors.textSecondary, fontSize: '0.85rem' }}>
        Current and completed counts — tap one to see what was counted.
      </p>

      {loading ? (
        <div style={{ color: colors.textSecondary, padding: '1rem', textAlign: 'center' }}>Loading…</div>
      ) : sorted.length === 0 ? (
        <div style={{ color: colors.textSecondary, padding: '1rem', textAlign: 'center' }}>No stock takes yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {sorted.map((s) => {
            const open = expanded === s.id;
            const counts = s.counts || {};
            const itemCount = Object.keys(counts).length;
            const inProgress = s.status !== 'completed';
            const accent = sectionColor(s.section, colors);
            return (
              <div key={s.id} style={{ border: `1px solid ${colors.borderLight}`, borderRadius: '8px', overflow: 'hidden' }}>
                <button
                  onClick={() => setExpanded(open ? null : s.id)}
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
                    {itemCount === 0 ? (
                      <div style={{ padding: '0.6rem 0.75rem', fontSize: '0.85rem', color: colors.textSecondary }}>Nothing counted yet.</div>
                    ) : (
                      Object.entries(counts).map(([itemId, count]) => {
                        const item = itemsById[itemId];
                        const summary = formatCountSummary(count, item ? parseUnitInfo(item) : { hasPartUnit: !!count.partLabel, hasTenthsOption: false, partLabel: count.partLabel, wholeLabel: count.wholeLabel, unitsPerWhole: 1 });
                        return (
                          <div key={itemId} style={{ padding: '0.5rem 0.75rem', borderBottom: `1px solid ${colors.borderLight}`, display: 'flex', gap: '0.6rem', alignItems: 'baseline' }}>
                            <span style={{ flex: 1, minWidth: 0, fontSize: '0.85rem', color: colors.textPrimary }}>{count.itemName || item?.name || 'Item'}</span>
                            <span style={{ fontSize: '0.82rem', color: colors.textSecondary, textAlign: 'right' }}>{summary}</span>
                          </div>
                        );
                      })
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
