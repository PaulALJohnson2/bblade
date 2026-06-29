/**
 * sessionReport — export a stock-take session as a printable PDF (via the
 * browser print dialog) or a CSV download. Self-contained so it can be used from
 * the admin Stock overview without touching the stock-count screen.
 */

import { parseUnitInfo, formatCountSummary } from './stockUnitUtils';

const sectionLabel = (s) => (s === 'kitchen' ? 'Kitchen' : 'Bar');

const fmtDateTime = (t) => {
  const d = t?.toDate ? t.toDate() : (t ? new Date(t) : null);
  return d ? d.toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
};
const fmtFileStamp = (t) => {
  const d = t?.toDate ? t.toDate() : (t ? new Date(t) : new Date());
  return d.toISOString().slice(0, 16).replace('T', '_').replace(/:/g, '-');
};

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// One { name, summary } row per counted item, sorted by name.
function countedRows(session, itemsById) {
  return Object.entries(session.counts || {})
    .map(([itemId, count]) => {
      const item = itemsById[itemId];
      const unitInfo = item ? parseUnitInfo(item)
        : { hasPartUnit: !!count.partLabel, hasTenthsOption: false, partLabel: count.partLabel, wholeLabel: count.wholeLabel, unitsPerWhole: 1 };
      return {
        name: count.itemName || item?.name || 'Item',
        category: item?.category || '',
        summary: formatCountSummary(count, unitInfo),
        quantity: count.quantity ?? 0,
        countedBy: Array.isArray(count.countedBy) ? count.countedBy.join(', ') : (count.countedBy || ''),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Open a printable report for a session (browser print → PDF). */
export function printSessionReport(session, itemsById, pubName) {
  const rows = countedRows(session, itemsById);
  const when = fmtDateTime(session.completedAt || session.createdAt);
  const status = session.status === 'completed' ? 'Completed' : 'In progress';
  const itemsHtml = rows.length
    ? rows.map((r) => `
        <div class="item">
          <div class="item-left">
            <span class="item-name">${esc(r.name)}</span>
            ${r.category ? `<span class="item-cat">${esc(r.category)}</span>` : ''}
          </div>
          <span class="item-total">${esc(r.summary)}</span>
        </div>`).join('')
    : '<div class="empty">Nothing counted.</div>';

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8" />
    <title>${esc(pubName || 'Stock')} — Stock Take ${esc(when)}</title>
    <style>
      * { margin:0; padding:0; box-sizing:border-box; }
      body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; padding:40px; color:#1a202c; max-width:800px; margin:0 auto; }
      .header { text-align:center; margin-bottom:24px; padding-bottom:16px; border-bottom:3px solid #2563EB; }
      .header h1 { font-size:26px; color:#2563EB; margin-bottom:6px; }
      .header .meta { font-size:14px; color:#4a5568; }
      .badge { display:inline-block; font-size:12px; font-weight:700; padding:2px 8px; border-radius:9999px; background:#EAF0FE; color:#2563EB; }
      .item { display:flex; justify-content:space-between; gap:16px; padding:8px 4px; border-bottom:1px solid #e2e8f0; }
      .item-name { font-weight:600; }
      .item-cat { display:block; font-size:12px; color:#718096; }
      .item-total { white-space:nowrap; color:#2d3748; }
      .empty { padding:16px; color:#718096; text-align:center; }
      @media print { body { padding:0; } }
    </style></head><body>
      <div class="header">
        <h1>${esc(pubName || 'Stock')} — ${esc(sectionLabel(session.section))} Stock Take</h1>
        <div class="meta">${esc(when)} &bull; ${rows.length} item${rows.length === 1 ? '' : 's'}${session.createdByName ? ' &bull; ' + esc(session.createdByName) : ''} &bull; <span class="badge">${esc(status)}</span></div>
      </div>
      ${itemsHtml}
      <script>window.onload = function(){ window.print(); }</script>
    </body></html>`;

  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  return true;
}

/** Download a session as a CSV file. */
export function downloadSessionCSV(session, itemsById, pubName) {
  const rows = countedRows(session, itemsById);
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [
    ['Section', 'Item', 'Category', 'Counted', 'Quantity (base)', 'Counted by'].map(cell).join(','),
    ...rows.map((r) => [sectionLabel(session.section), r.name, r.category, r.summary, r.quantity, r.countedBy].map(cell).join(',')),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(pubName || 'stock').replace(/[^\w-]+/g, '-')}_${sectionLabel(session.section)}_${fmtFileStamp(session.completedAt || session.createdAt)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
