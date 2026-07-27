/**
 * DeliveryNoteScan — photograph or upload a supplier's delivery note, read it,
 * and log everything that arrived in one pass.
 *
 * Flow: capture → the model transcribes the document → each line is reconciled
 * against this venue's stock list (container class first, see deliveryDoc.js) →
 * a human reviews → the included lines become delivery-log entries and the
 * note itself is kept as proof.
 *
 * The review step is not a formality. Three things on a real note can't be
 * settled by reading it alone, and each is surfaced rather than guessed:
 *   - lines with no matching stock item (the pub doesn't stock that product);
 *   - returns going the other way (empty kegs collected), excluded and locked;
 *   - short deliveries, where what was signed for is less than what was sent.
 *
 * Props: venuePath, items, colors, accent, onAccent, receivedBy, onClose, onDone
 */

import React, { useMemo, useRef, useState } from 'react';
import { prepareDocument, ACCEPTED_TYPES, supportsCameraCapture } from '../utils/documentCapture';
import { extractDeliveryNote, matchDeliveryLines } from '../services/aiInference';
import {
  reconcileLines, withItem, unitsForLine,
  containerClassOfLine, containerClassOfItem, containersCompatible,
} from '../utils/deliveryDoc';
import { formatItemDescription } from '../utils/stockUnitUtils';
import {
  logDelivery, saveDeliveryNote, setDeliveryNoteEntries, setStockItemCasePack,
} from '../services/apiService';

const prettyDate = (iso) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return '';
  const [y, m, d] = iso.split('-');
  return new Date(Number(y), Number(m) - 1, Number(d))
    .toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};

const qtyLabel = (row) => `${row.qty}${row.line.unitCode ? ` ${row.line.unitCode}` : ''}`;

/** "1 Cases (×6)" reads wrong on a review screen — singularise the container. */
const unitPhrase = (u) => `${u.count} ${u.count === 1 ? u.label.replace(/^(\w+?)s\b/, '$1') : u.label}`;

function DeliveryNoteScan({ venuePath, items, colors, accent, onAccent, receivedBy, onClose, onDone }) {
  const fileRef = useRef(null);
  const cameraRef = useRef(null);

  const [stage, setStage] = useState('pick'); // pick | working | review | saving
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [docFile, setDocFile] = useState(null); // prepared document
  const [note, setNote] = useState(null); // extracted header
  const [rows, setRows] = useState([]);
  const [pickerFor, setPickerFor] = useState(null); // row index with the item picker open
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerAll, setPickerAll] = useState(false);
  const [caseSizes, setCaseSizes] = useState({}); // row index → typed case size
  const [progress, setProgress] = useState(null); // { done, total }

  const live = useMemo(() => items.filter((i) => !i.archived), [items]);

  // ---- capture + read ------------------------------------------------------

  const handleFile = async (file) => {
    if (!file) return;
    setError('');
    setStage('working');
    try {
      setStatus('Preparing the document…');
      const prepared = await prepareDocument(file);
      setDocFile(prepared);

      setStatus('Reading the delivery note…');
      const { note: read, error: readError } = await extractDeliveryNote(prepared.base64, prepared.mimeType);
      if (!read) {
        setError(readError || 'Could not read that document');
        setStage('pick');
        return;
      }

      setStatus('Matching against your stock list…');
      let reconciled = reconcileLines(read.lines, live);

      // Second pass: only the lines the offline matcher wouldn't commit to,
      // each with its candidates already narrowed to the right container.
      const leftovers = reconciled.filter((r) => r.status === 'unmatched');
      if (leftovers.length) {
        const payload = leftovers.map((r) => {
          const cls = containerClassOfLine(r.line);
          return {
            index: r.index,
            text: `${r.line.packSize} ${r.line.description}`.trim(),
            container: cls,
            candidates: live
              .filter((i) => containersCompatible(cls, containerClassOfItem(i)))
              .map((i) => i.name),
          };
        });
        const { map } = await matchDeliveryLines(payload);
        reconciled = reconciled.map((r) => {
          const name = map[r.index];
          if (!name || r.status !== 'unmatched') return r;
          // Re-check the model's answer against the container-filtered list —
          // a name it invented, or one from the wrong container, is discarded.
          const cls = containerClassOfLine(r.line);
          const item = live.find((i) => i.name === name && containersCompatible(cls, containerClassOfItem(i)));
          return item ? withItem(r, item) : r;
        });
      }

      setNote(read);
      setRows(reconciled);
      setStage('review');
    } catch (err) {
      console.error('Delivery note scan failed:', err);
      setError(err?.message || 'Something went wrong reading that document');
      setStage('pick');
    }
  };

  // ---- review edits --------------------------------------------------------

  const toggleInclude = (index) => setRows((rs) => rs.map((r) => (
    r.index === index && r.status !== 'return' && !r.needsCasePack && r.item
      ? { ...r, include: !r.include } : r)));

  const chooseItem = (index, item) => {
    setRows((rs) => rs.map((r) => (r.index === index ? withItem(r, item) : r)));
    setPickerFor(null);
    setPickerQuery('');
    setPickerAll(false);
  };

  const clearItem = (index) => {
    setRows((rs) => rs.map((r) => (r.index === index ? withItem(r, null) : r)));
    setPickerFor(null);
  };

  // Capture a missing case size the same way the manual entry screen does —
  // persisted onto the item, so the next delivery of it needs no asking.
  const applyCaseSize = (row) => {
    const n = parseInt(caseSizes[row.index], 10) || 0;
    if (n <= 0 || !row.item) return;
    setStockItemCasePack(venuePath, row.item.id, n);
    setRows((rs) => rs.map((r) => (r.index === row.index ? withItem(r, { ...r.item, casePack: n }) : r)));
  };

  // ---- log -----------------------------------------------------------------

  const included = rows.filter((r) => r.include && r.item);

  const handleLogAll = async () => {
    if (!included.length || stage === 'saving') return;
    setStage('saving');
    setError('');
    setProgress({ done: 0, total: included.length });

    const saved = await saveDeliveryNote(venuePath, {
      ...note,
      fileName: docFile.fileName,
      mimeType: docFile.mimeType,
      image: docFile.dataUrl,
      thumb: docFile.thumbDataUrl || '',
      imageStored: docFile.storable,
      uploadedBy: receivedBy,
      lines: rows.map((r) => ({
        ...r.line,
        status: r.status,
        included: r.include,
        itemId: r.itemId || '',
        itemName: r.item?.name || '',
      })),
    });
    if (!saved.success) {
      setError('Could not save the delivery note: ' + saved.error);
      setStage('review');
      setProgress(null);
      return;
    }

    const entryIds = [];
    let failed = 0;
    for (const row of included) {
      const { units, quantity, baseLabel } = unitsForLine(row.line, row.item);
      const res = await logDelivery(venuePath, row.item.id, {
        itemName: row.item.name,
        section: row.item.section === 'kitchen' ? 'kitchen' : 'bar',
        units,
        quantity,
        baseLabel,
        supplier: note.supplier || '',
        cost: null,
        note: note.reference ? `Delivery note ${note.reference}` : 'Scanned delivery note',
        noteId: saved.id,
        receivedBy,
      });
      if (res.success) entryIds.push(res.id);
      else failed += 1;
      setProgress((p) => ({ ...p, done: p.done + 1 }));
    }

    await setDeliveryNoteEntries(venuePath, saved.id, entryIds);
    onDone(entryIds.length, failed);
  };

  // ---- styles --------------------------------------------------------------

  const sheet = {
    backgroundColor: colors.bgCard, borderRadius: '14px', width: '100%', maxWidth: '640px',
    maxHeight: '92vh', display: 'flex', flexDirection: 'column',
    boxShadow: `0 12px 40px ${colors.shadow}`, overflow: 'hidden',
  };
  const primaryBtn = (enabled = true) => ({
    flex: 1, padding: '0.85rem', border: 'none', borderRadius: '10px',
    backgroundColor: accent, color: onAccent, fontWeight: 700, fontSize: '1rem',
    cursor: enabled ? 'pointer' : 'not-allowed', opacity: enabled ? 1 : 0.5,
  });
  const quietBtn = {
    flexShrink: 0, padding: '0.85rem 1.1rem', border: 'none', borderRadius: '10px',
    backgroundColor: colors.bgLight, color: colors.textPrimary, fontWeight: 600, cursor: 'pointer',
  };
  const chip = (bg, fg) => ({
    display: 'inline-block', padding: '0.1rem 0.45rem', borderRadius: '9999px',
    fontSize: '0.68rem', fontWeight: 700, backgroundColor: bg, color: fg, whiteSpace: 'nowrap',
  });

  // ---- panes ---------------------------------------------------------------

  const pickPane = (
    <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
      <div style={{ fontSize: '0.88rem', color: colors.textSecondary }}>
        Photograph the delivery note or upload a copy. Everything on it is matched to your
        stock list for you to check before anything is logged.
      </div>

      {supportsCameraCapture() && (
        <button onClick={() => cameraRef.current?.click()} style={{ ...primaryBtn(), padding: '1rem' }}>
          📷 Take a photo
        </button>
      )}
      <button
        onClick={() => fileRef.current?.click()}
        style={supportsCameraCapture()
          ? { ...quietBtn, padding: '1rem', width: '100%' }
          : { ...primaryBtn(), padding: '1rem' }}
      >
        Choose a photo or PDF
      </button>

      <input
        ref={cameraRef} type="file" accept="image/*" capture="environment"
        onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ''; }}
        style={{ display: 'none' }}
      />
      <input
        ref={fileRef} type="file" accept={ACCEPTED_TYPES}
        onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ''; }}
        style={{ display: 'none' }}
      />

      {error && (
        <div style={{ fontSize: '0.85rem', color: colors.error, fontWeight: 600 }}>{error}</div>
      )}
    </div>
  );

  const workingPane = (
    <div style={{ padding: '2.5rem 1.25rem', textAlign: 'center', color: colors.textSecondary }}>
      <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>📄</div>
      <div style={{ fontWeight: 600, color: colors.textPrimary }}>{status}</div>
      <div style={{ fontSize: '0.82rem', marginTop: '0.35rem' }}>This takes a few seconds.</div>
    </div>
  );

  const itemPicker = (row) => {
    const cls = containerClassOfLine(row.line);
    const q = pickerQuery.trim().toLowerCase();
    const pool = pickerAll
      ? live
      : live.filter((i) => containersCompatible(cls, containerClassOfItem(i)));
    const results = pool
      .filter((i) => !q || i.name.toLowerCase().includes(q) || (i.category || '').toLowerCase().includes(q))
      .slice(0, 40);
    return (
      <div style={{ marginTop: '0.5rem', padding: '0.6rem', border: `1px solid ${colors.borderLight}`, borderRadius: '8px', backgroundColor: colors.bgLight }}>
        <input
          autoFocus value={pickerQuery} onChange={(e) => setPickerQuery(e.target.value)}
          placeholder="Search stock items…"
          style={{ width: '100%', padding: '0.55rem', fontSize: '0.9rem', border: `2px solid ${colors.border}`, borderRadius: '8px', backgroundColor: colors.bgCard, color: colors.textPrimary, boxSizing: 'border-box' }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', margin: '0.5rem 0', fontSize: '0.78rem', color: colors.textSecondary }}>
          <input type="checkbox" checked={pickerAll} onChange={(e) => setPickerAll(e.target.checked)} />
          Show items of every container type (this line looks like a {cls === 'other' ? 'unknown container' : cls})
        </label>
        <div style={{ maxHeight: '190px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          {results.length === 0 && (
            <div style={{ fontSize: '0.8rem', color: colors.textMuted, padding: '0.4rem' }}>No items found.</div>
          )}
          {results.map((i) => (
            <button
              key={i.id} onClick={() => chooseItem(row.index, i)}
              style={{ textAlign: 'left', padding: '0.45rem 0.55rem', border: 'none', borderRadius: '6px', backgroundColor: colors.bgCard, color: colors.textPrimary, cursor: 'pointer', fontSize: '0.85rem' }}
            >
              <span style={{ fontWeight: 600 }}>{i.name}</span>
              <span style={{ color: colors.textSecondary, fontSize: '0.75rem' }}>
                {i.category ? ` · ${i.category}` : ''}{formatItemDescription(i) ? ` · ${formatItemDescription(i)}` : ''}
              </span>
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}>
          <button onClick={() => setPickerFor(null)} style={{ ...quietBtn, padding: '0.5rem 0.8rem', fontSize: '0.8rem' }}>Close</button>
          {row.item && (
            <button onClick={() => clearItem(row.index)} style={{ ...quietBtn, padding: '0.5rem 0.8rem', fontSize: '0.8rem' }}>Skip this line</button>
          )}
        </div>
      </div>
    );
  };

  const lineRow = (row) => {
    const isReturn = row.status === 'return';
    const unmatched = row.status === 'unmatched';
    const units = row.item && !row.needsCasePack ? unitsForLine(row.line, row.item) : null;
    return (
      <div
        key={row.index}
        style={{
          border: `1px solid ${row.include ? accent : colors.borderLight}`,
          borderRadius: '10px', padding: '0.6rem 0.7rem',
          backgroundColor: isReturn ? colors.bgLight : colors.bgCard,
          opacity: isReturn ? 0.75 : 1,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
          <input
            type="checkbox" checked={row.include} disabled={isReturn || unmatched || row.needsCasePack}
            onChange={() => toggleInclude(row.index)}
            style={{ marginTop: '0.2rem', width: '20px', height: '20px', flexShrink: 0, accentColor: accent }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline' }}>
              <div style={{ flex: 1, minWidth: 0, fontSize: '0.85rem', fontWeight: 600, color: colors.textPrimary }}>
                {row.line.packSize ? `${row.line.packSize} ` : ''}{row.line.description}
              </div>
              <div style={{ flexShrink: 0, fontSize: '0.85rem', fontWeight: 700, color: colors.textPrimary }}>
                {qtyLabel(row)}
              </div>
            </div>

            {/* What it was matched to, and what that means in stock terms */}
            <div style={{ marginTop: '0.25rem', fontSize: '0.78rem', color: colors.textSecondary }}>
              {isReturn && <span style={chip(colors.bgLight, colors.textSecondary)}>RETURN — going back, not stock in</span>}
              {unmatched && <span style={chip(colors.bgLight, colors.textSecondary)}>No matching stock item</span>}
              {row.item && (
                <span>
                  → <strong style={{ color: colors.textPrimary }}>{row.item.name}</strong>
                  {units && units.units.length > 0 && (
                    <> · adds {units.units.map(unitPhrase).join(', ')}</>
                  )}
                </span>
              )}
            </div>

            {/* Anything the document says that a manager needs to act on */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginTop: '0.3rem' }}>
              {row.shortDelivery && (
                <span style={chip(colors.dangerSoft, colors.error)}>
                  SHORT — {row.line.qtyDelivered} delivered of {row.line.qtyDespatched} despatched
                </span>
              )}
              {row.shortDespatch && (
                <span style={chip(colors.bgLight, colors.textSecondary)}>
                  {row.line.qtyDespatched} sent of {row.line.qtyOrdered} ordered
                </span>
              )}
            </div>

            {/* A "1 CA" line against an item with no case size can't be converted */}
            {row.needsCasePack && row.item && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.4rem', padding: '0.45rem 0.55rem', border: `1px dashed ${colors.border}`, borderRadius: '8px' }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: '0.78rem', color: colors.textSecondary }}>
                  Case of how many? Needed to convert {qtyLabel(row)}.
                </span>
                <input
                  type="text" inputMode="numeric" placeholder="24"
                  value={caseSizes[row.index] || ''}
                  onChange={(e) => setCaseSizes((c) => ({ ...c, [row.index]: e.target.value.replace(/[^0-9]/g, '') }))}
                  style={{ width: '52px', padding: '0.4rem', textAlign: 'center', fontWeight: 700, border: `2px solid ${colors.border}`, borderRadius: '8px', backgroundColor: colors.bgCard, color: colors.textPrimary }}
                />
                <button onClick={() => applyCaseSize(row)} style={{ flexShrink: 0, padding: '0.4rem 0.7rem', border: 'none', borderRadius: '8px', backgroundColor: accent, color: onAccent, fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer' }}>Set</button>
              </div>
            )}

            {!isReturn && (
              <button
                onClick={() => { setPickerFor(pickerFor === row.index ? null : row.index); setPickerQuery(''); setPickerAll(false); }}
                style={{ marginTop: '0.35rem', padding: '0.3rem 0.6rem', border: `1px solid ${colors.border}`, borderRadius: '6px', backgroundColor: 'transparent', color: colors.textSecondary, fontSize: '0.75rem', cursor: 'pointer' }}
              >
                {row.item ? 'Change item' : 'Choose item'}
              </button>
            )}

            {pickerFor === row.index && itemPicker(row)}
          </div>
        </div>
      </div>
    );
  };

  const counts = {
    matched: rows.filter((r) => r.status === 'matched').length,
    unmatched: rows.filter((r) => r.status === 'unmatched').length,
    returns: rows.filter((r) => r.status === 'return').length,
    short: rows.filter((r) => r.shortDelivery).length,
  };

  const reviewPane = (
    <>
      <div style={{ padding: '0.85rem 1rem', borderBottom: `1px solid ${colors.borderLight}` }}>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
          {docFile?.mimeType?.startsWith('image/') ? (
            <img
              src={docFile.dataUrl} alt="Delivery note"
              style={{ width: '68px', height: '68px', objectFit: 'cover', borderRadius: '8px', border: `1px solid ${colors.borderLight}`, flexShrink: 0 }}
            />
          ) : (
            <div style={{ width: '68px', height: '68px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', backgroundColor: colors.bgLight, fontSize: '1.6rem', flexShrink: 0 }}>📄</div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, color: colors.textPrimary }}>{note?.supplier || 'Delivery note'}</div>
            <div style={{ fontSize: '0.8rem', color: colors.textSecondary }}>
              {[note?.documentType, prettyDate(note?.deliveryDate)].filter(Boolean).join(' · ')}
            </div>
            {note?.reference && (
              <div style={{ fontSize: '0.75rem', color: colors.textMuted }}>Ref {note.reference}</div>
            )}
            <div style={{ fontSize: '0.75rem', color: colors.textSecondary, marginTop: '0.25rem' }}>
              {counts.matched} matched
              {counts.unmatched > 0 && ` · ${counts.unmatched} not in your stock list`}
              {counts.returns > 0 && ` · ${counts.returns} return`}
              {counts.short > 0 && ` · ${counts.short} short`}
            </div>
          </div>
        </div>

        {!docFile?.storable && (
          <div style={{ marginTop: '0.6rem', fontSize: '0.75rem', color: colors.textSecondary }}>
            The document is too large to keep a copy of — the lines below will still be saved.
          </div>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
        {rows.map(lineRow)}
      </div>

      <div style={{ padding: '0.85rem 1rem', borderTop: `1px solid ${colors.borderLight}` }}>
        {error && <div style={{ fontSize: '0.82rem', color: colors.error, marginBottom: '0.5rem', fontWeight: 600 }}>{error}</div>}
        <div style={{ display: 'flex', gap: '0.6rem' }}>
          <button onClick={onClose} disabled={stage === 'saving'} style={quietBtn}>Cancel</button>
          <button onClick={handleLogAll} disabled={!included.length || stage === 'saving'} style={primaryBtn(!!included.length && stage !== 'saving')}>
            {stage === 'saving'
              ? `Logging… ${progress?.done || 0}/${progress?.total || 0}`
              : `Log ${included.length} deliver${included.length === 1 ? 'y' : 'ies'}`}
          </button>
        </div>
      </div>
    </>
  );

  return (
    <div
      /* Only the empty capture screen dismisses on a backdrop tap — a stray
         tap shouldn't throw away a reviewed note. */
      onClick={() => stage === 'pick' && onClose()}
      style={{ position: 'fixed', inset: 0, zIndex: 5000, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
    >
      <div onClick={(e) => e.stopPropagation()} style={sheet}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.85rem 1rem', borderBottom: `1px solid ${colors.borderLight}` }}>
          <div style={{ flex: 1, fontWeight: 700, fontSize: '1.05rem', color: colors.textPrimary }}>Scan delivery note</div>
          {stage !== 'saving' && stage !== 'working' && (
            <button onClick={onClose} aria-label="Close" style={{ width: '30px', height: '30px', border: 'none', borderRadius: '50%', backgroundColor: 'transparent', color: colors.textSecondary, fontSize: '1.2rem', cursor: 'pointer', lineHeight: 1 }}>×</button>
          )}
        </div>

        {stage === 'pick' && pickPane}
        {stage === 'working' && workingPane}
        {(stage === 'review' || stage === 'saving') && reviewPane}
      </div>
    </div>
  );
}

export default DeliveryNoteScan;
