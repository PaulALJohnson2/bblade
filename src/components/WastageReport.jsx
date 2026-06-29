/**
 * WastageReport — admin overview of logged wastage.
 *
 * Totals per item (rolled up by sale unit, e.g. "5 Single, 2 Double") over a
 * chosen period, with a click-through that lists each individual entry: what was
 * wasted, when, by whom, the reason and any note. Admins can remove a mistaken
 * entry (which restores the item's stock).
 *
 * Props: venuePath, canEdit
 */

import React, { useEffect, useMemo, useState } from 'react';
import { subscribeToWastageLog, deleteWastageEntry } from '../services/apiService';
import { getThemeColors } from '../utils/theme';
import useTheme from '../hooks/useTheme';

const RANGES = [
  { key: '7', label: '7 days', days: 7 },
  { key: '30', label: '30 days', days: 30 },
  { key: 'all', label: 'All', days: null },
];

function WastageReport({ venuePath, canEdit = true }) {
  const { isDark } = useTheme();
  const colors = getThemeColors(isDark);
  const accent = colors.wastage;

  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState('30');
  const [expanded, setExpanded] = useState(null); // itemId
  const [confirmDel, setConfirmDel] = useState(null); // entry id

  useEffect(() => {
    if (!venuePath) return;
    setLoading(true);
    const unsub = subscribeToWastageLog(venuePath, (list) => { setEntries(list || []); setLoading(false); }, undefined, 1000);
    return () => unsub();
  }, [venuePath]);

  const inRange = useMemo(() => {
    const days = RANGES.find((r) => r.key === range)?.days;
    if (!days) return entries;
    const cutoff = Date.now() - days * 86400000;
    return entries.filter((e) => {
      const t = e.wastedAt?.toDate ? e.wastedAt.toDate().getTime() : 0;
      return t >= cutoff;
    });
  }, [entries, range]);

  // Group by item, rolling up unit counts by label.
  const groups = useMemo(() => {
    const map = new Map();
    for (const e of inRange) {
      const key = e.itemId || e.itemName;
      if (!map.has(key)) map.set(key, { itemId: key, itemName: e.itemName, section: e.section, count: 0, units: {}, entries: [] });
      const g = map.get(key);
      g.count += 1;
      g.entries.push(e);
      (e.units || []).forEach((u) => { g.units[u.label] = (g.units[u.label] || 0) + (Number(u.count) || 0); });
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [inRange]);

  const handleDelete = async (entry) => {
    await deleteWastageEntry(venuePath, entry.id);
    setConfirmDel(null);
  };

  const card = { backgroundColor: colors.bgCard, border: `1px solid ${colors.borderLight}`, borderRadius: '12px', padding: '1.5rem', marginBottom: '1.5rem', boxShadow: `0 2px 12px ${colors.shadow}` };
  const chip = (active) => ({ padding: '0.35rem 0.8rem', borderRadius: '9999px', border: `1px solid ${active ? accent : colors.border}`, backgroundColor: active ? colors.wastageSoft : colors.bgCard, color: active ? accent : colors.textPrimary, fontWeight: active ? 700 : 500, fontSize: '0.82rem', cursor: 'pointer' });
  const rollup = (units) => Object.entries(units).map(([l, c]) => `${c} ${l}`).join(', ');
  const fmtWhen = (e) => e.wastedAt?.toDate ? e.wastedAt.toDate().toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

  if (!canEdit) return null;

  return (
    <div style={card}>
      <h2 style={{ margin: '0 0 0.25rem', fontSize: '1.1rem', color: colors.textPrimary }}>Wastage</h2>
      <p style={{ margin: '0 0 1rem', color: colors.textSecondary, fontSize: '0.85rem' }}>
        What's been wasted — tap an item to see each entry, when and by whom.
      </p>

      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem' }}>
        {RANGES.map((r) => (
          <button key={r.key} onClick={() => setRange(r.key)} style={chip(range === r.key)}>{r.label}</button>
        ))}
      </div>

      {loading ? (
        <div style={{ color: colors.textSecondary, padding: '1rem', textAlign: 'center' }}>Loading…</div>
      ) : groups.length === 0 ? (
        <div style={{ color: colors.textSecondary, padding: '1rem', textAlign: 'center' }}>No wastage in this period.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {groups.map((g) => {
            const open = expanded === g.itemId;
            return (
              <div key={g.itemId} style={{ border: `1px solid ${colors.borderLight}`, borderRadius: '8px', overflow: 'hidden' }}>
                <button
                  onClick={() => setExpanded(open ? null : g.itemId)}
                  style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 0.75rem', background: open ? colors.wastageSoft : 'none', border: 'none', cursor: 'pointer' }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: colors.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.itemName}</div>
                    <div style={{ fontSize: '0.78rem', color: colors.textSecondary }}>{rollup(g.units) || `${g.count} entr${g.count === 1 ? 'y' : 'ies'}`}</div>
                  </div>
                  <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: '9999px', backgroundColor: colors.wastageSoft, color: accent }}>{g.count}</span>
                  <span style={{ color: colors.textSecondary, fontSize: '0.8rem' }}>{open ? '▾' : '▸'}</span>
                </button>
                {open && (
                  <div style={{ borderTop: `1px solid ${colors.borderLight}`, display: 'flex', flexDirection: 'column' }}>
                    {g.entries.map((e) => (
                      <div key={e.id} style={{ padding: '0.55rem 0.75rem', borderBottom: `1px solid ${colors.borderLight}`, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '0.85rem', color: colors.textPrimary }}>
                            {(e.units || []).map((u) => `${u.count} ${u.label}`).join(', ')}{e.reason ? ` · ${e.reason}` : ''}
                          </div>
                          {e.note && <div style={{ fontSize: '0.76rem', color: colors.textSecondary }}>{e.note}</div>}
                          <div style={{ fontSize: '0.72rem', color: colors.textMuted }}>{[e.wastedBy, fmtWhen(e)].filter(Boolean).join(' · ')}</div>
                        </div>
                        {confirmDel === e.id ? (
                          <button onClick={() => handleDelete(e)} style={{ flexShrink: 0, padding: '0.35rem 0.6rem', backgroundColor: accent, color: colors.onWastage, border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.76rem', fontWeight: 700 }}>Confirm</button>
                        ) : (
                          <button onClick={() => setConfirmDel(e.id)} title="Remove (restores stock)" style={{ flexShrink: 0, padding: '0.35rem 0.6rem', backgroundColor: 'transparent', color: colors.textSecondary, border: `1px solid ${colors.border}`, borderRadius: '6px', cursor: 'pointer', fontSize: '0.76rem' }}>Remove</button>
                        )}
                      </div>
                    ))}
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

export default WastageReport;
