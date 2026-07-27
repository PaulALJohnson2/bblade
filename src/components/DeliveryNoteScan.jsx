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
  reconcileLines, withItem, unitsForLine, lineCost, costPerWholeUnit,
  containerClassOfLine, containerClassOfItem, containersCompatible,
} from '../utils/deliveryDoc';
import {
  indexLearned, lookupLearned, learnedRecordsFrom,
  suggestedCasePack, cleanProductName, unitFromLine,
} from '../utils/supplierLearning';
import { formatItemDescription } from '../utils/stockUnitUtils';
import { loadCatalog, bestCatalogMatch } from '../services/catalogService';
import {
  logDelivery, saveDeliveryNote, setDeliveryNoteEntries, setStockItemCasePack,
  getSupplierProducts, saveSupplierProducts, saveOrUpdateStockItem, bulkSetCostPrices,
} from '../services/apiService';

const money = (n) => `£${Number(n).toFixed(2)}`;

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
  const [addFor, setAddFor] = useState(null);     // row index with the add-item form open
  const [draft, setDraft] = useState(null);       // { name, category, section, unit… }
  const [adding, setAdding] = useState(false);
  const [learnedCount, setLearnedCount] = useState(0); // recognised from memory
  const [updateCosts, setUpdateCosts] = useState(false); // priced documents only
  const [confirmClose, setConfirmClose] = useState(false);
  // Set/added-now-saved changes survive a discard; the prompt has to say so.
  const [keptChanges, setKeptChanges] = useState(false);

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

      // What this venue already learned from earlier notes. A confirmed
      // supplier code beats any name matching, so it's consulted first.
      const { data: learnedRecords } = await getSupplierProducts(venuePath);
      const learnedIndex = indexLearned(learnedRecords);
      const resolve = (line) => {
        const rec = lookupLearned(learnedIndex, read.supplier, line);
        if (!rec) return null;
        // The item may since have been deleted or archived — fall through to
        // name matching rather than pointing at something that isn't there.
        return live.find((i) => i.id === rec.itemId) || null;
      };

      let reconciled = reconcileLines(read.lines, live, { resolve });
      setLearnedCount(reconciled.filter((r) => r.viaLearned).length);

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

      // A credit note reverses a charge — logging its lines would add stock the
      // venue is being refunded for. Kept and readable, never loggable.
      if (read.documentKind === 'credit-note') {
        reconciled = reconciled.map((r) => ({ ...r, include: false }));
      }

      setNote(read);
      setRows(reconciled);
      setUpdateCosts(reconciled.some((r) => r.item && costPerWholeUnit(r.line, r.item) !== null));
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

  // A human picking the item is the strongest signal there is — flagged as a
  // correction so it's persisted as one, overruling whatever was learned.
  const chooseItem = (index, item) => {
    setRows((rs) => rs.map((r) => (r.index === index ? withItem(r, item, { corrected: true }) : r)));
    setPickerFor(null);
    setPickerQuery('');
    setPickerAll(false);
  };

  const clearItem = (index) => {
    setRows((rs) => rs.map((r) => (r.index === index ? withItem(r, null) : r)));
    setPickerFor(null);
  };

  // ---- adding a product the venue buys but doesn't count -------------------

  const openAddForm = async (row) => {
    if (addFor === row.index) { setAddFor(null); return; }
    const cls = row.containerClass;
    const name = cleanProductName(row.line);
    const unit = unitFromLine(row.line, cls);
    const section = cls === 'weight' ? 'kitchen' : 'bar';
    setDraft({ name, category: '', section, ...unit });
    setAddFor(row.index);
    // The shared catalog knows most of the UK trade — fill the category in if
    // it can identify the product unambiguously.
    try {
      const hit = bestCatalogMatch(await loadCatalog(), name, section);
      if (hit?.category) setDraft((d) => (d ? { ...d, category: hit.category } : d));
    } catch { /* the lookup is a nicety, never a blocker */ }
  };

  const addToStockList = async (row) => {
    if (!draft?.name.trim() || adding) return;
    setAdding(true);
    const res = await saveOrUpdateStockItem(venuePath, null, {
      name: draft.name.trim(),
      category: draft.category.trim(),
      section: draft.section,
      unit: draft.unit,
      wholeUnit: draft.wholeUnit,
      partUnit: draft.partUnit,
      casePack: draft.casePack || 0,
      quantity: 0,
      archived: false,
      categorySuggested: '',
    });
    setAdding(false);
    if (!res.success) { setError('Could not add that item: ' + res.error); return; }
    const item = { id: res.id, name: draft.name.trim(), category: draft.category.trim(), section: draft.section, unit: draft.unit, wholeUnit: draft.wholeUnit, partUnit: draft.partUnit, casePack: draft.casePack || 0, archived: false };
    setRows((rs) => rs.map((r) => (r.index === row.index ? withItem(r, item, { corrected: true }) : r)));
    setAddFor(null);
    setDraft(null);
    setKeptChanges(true);
  };

  /**
   * Closing after a review throws away the extraction as well as the matches —
   * a model call and a trip to the cellar with a phone. Worth a question.
   * Nothing captured yet means nothing to lose, so that closes straight away.
   */
  const requestClose = () => {
    if (stage === 'review' && rows.length) setConfirmClose(true);
    else onClose();
  };

  // Capture a missing case size the same way the manual entry screen does —
  // persisted onto the item, so the next delivery of it needs no asking.
  const applyCaseSize = (row) => {
    const n = parseInt(caseSizes[row.index] ?? suggestedCasePack(row.line), 10) || 0;
    if (n <= 0 || !row.item) return;
    setStockItemCasePack(venuePath, row.item.id, n);
    setKeptChanges(true);
    setRows((rs) => rs.map((r) => (r.index === row.index ? withItem(r, { ...r.item, casePack: n }) : r)));
  };

  // ---- log -----------------------------------------------------------------

  const included = rows.filter((r) => r.include && r.item);
  const isCreditNote = note?.documentKind === 'credit-note';

  /**
   * Cost prices this document would change. A delivery note with no prices
   * yields nothing here and the whole affordance stays hidden — most don't
   * print money, and an empty checkbox is just noise.
   */
  const costChanges = useMemo(() => included
    .map((r) => ({ id: r.item.id, name: r.item.name, was: Number(r.item.costPrice) || 0, costPrice: costPerWholeUnit(r.line, r.item) }))
    .filter((c) => c.costPrice !== null && Math.abs(c.costPrice - c.was) >= 0.01),
  [included]);

  const noteValue = useMemo(() => rows.reduce((t, r) => {
    const c = r.include ? lineCost(r.line) : null;
    return t + (c || 0);
  }, 0), [rows]);

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
        cost: lineCost(row.line),
        note: note.reference ? `Delivery note ${note.reference}` : 'Scanned delivery note',
        noteId: saved.id,
        receivedBy,
      });
      if (res.success) entryIds.push(res.id);
      else failed += 1;
      setProgress((p) => ({ ...p, done: p.done + 1 }));
    }

    await setDeliveryNoteEntries(venuePath, saved.id, entryIds);

    // What the venue actually paid beats anything derived from till cost of
    // sales — but only when they've asked for it, since a one-off promotional
    // price shouldn't quietly become the valuation.
    if (updateCosts && costChanges.length) {
      const res = await bulkSetCostPrices(venuePath, costChanges.map((c) => ({ id: c.id, costPrice: c.costPrice })));
      if (!res.success) console.warn('Could not update cost prices:', res.error);
    }

    // Learn from what was confirmed. Deliberately last and unawaited-on-failure:
    // the stock movements are what matter, and a venue that never learns is a
    // slower product, not a broken one.
    const learned = learnedRecordsFrom(rows, note, receivedBy);
    saveSupplierProducts(venuePath, learned)
      .catch((err) => console.warn('Could not save what this note taught us:', err));

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

  /**
   * Add a product the venue buys but has never counted. Name, container and
   * pack size all come off the note; the category comes from the shared
   * catalog when it can identify the product. Everything stays editable — the
   * supplier's "SCAMP FRIE CARD" is a starting point, not a product name.
   */
  const addForm = (row) => {
    const field = { width: '100%', padding: '0.5rem', fontSize: '0.88rem', border: `2px solid ${colors.border}`, borderRadius: '8px', backgroundColor: colors.bgCard, color: colors.textPrimary, boxSizing: 'border-box' };
    const countedAs = formatItemDescription({ wholeUnit: draft.wholeUnit });
    const sectionBtn = (key, label) => (
      <button
        key={key} onClick={() => setDraft((d) => ({ ...d, section: key }))}
        style={{ flex: 1, padding: '0.4rem', border: 'none', borderRadius: '6px', fontSize: '0.8rem', fontWeight: draft.section === key ? 700 : 500, backgroundColor: draft.section === key ? accent : colors.bgCard, color: draft.section === key ? onAccent : colors.textPrimary, cursor: 'pointer' }}
      >{label}</button>
    );
    return (
      <div style={{ marginTop: '0.5rem', padding: '0.6rem', border: `1px solid ${accent}`, borderRadius: '8px', backgroundColor: colors.bgLight, display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
        <div style={{ fontSize: '0.75rem', color: colors.textSecondary }}>
          You buy this but don't count it. Add it to the stock list?
        </div>
        <input
          autoFocus value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          placeholder="Product name" style={field}
        />
        <input
          value={draft.category} onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
          placeholder="Category (e.g. Snacks)" style={field}
        />
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <div style={{ display: 'flex', flex: 1, gap: '0.25rem', padding: '0.2rem', borderRadius: '8px', backgroundColor: colors.bgCard, border: `1px solid ${colors.borderLight}` }}>
            {sectionBtn('bar', 'Bar')}
            {sectionBtn('kitchen', 'Kitchen')}
          </div>
          <div style={{ flex: 1, fontSize: '0.75rem', color: colors.textSecondary }}>
            Counted as <strong style={{ color: colors.textPrimary }}>{countedAs}</strong>
            {draft.casePack > 0 && <> · {draft.casePack} per case</>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button onClick={() => { setAddFor(null); setDraft(null); }} style={{ ...quietBtn, padding: '0.5rem 0.8rem', fontSize: '0.8rem' }}>Cancel</button>
          <button
            onClick={() => addToStockList(row)} disabled={!draft.name.trim() || adding}
            style={{ flex: 1, padding: '0.5rem', border: 'none', borderRadius: '8px', backgroundColor: accent, color: onAccent, fontWeight: 700, fontSize: '0.82rem', cursor: adding ? 'wait' : 'pointer', opacity: draft.name.trim() ? 1 : 0.5 }}
          >{adding ? 'Adding…' : 'Add & match this line'}</button>
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
              <div style={{ flexShrink: 0, textAlign: 'right' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: colors.textPrimary }}>{qtyLabel(row)}</div>
                {lineCost(row.line) !== null && (
                  <div style={{ fontSize: '0.75rem', color: colors.textSecondary }}>{money(lineCost(row.line))}</div>
                )}
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
                  {row.viaLearned && (
                    <span style={{ ...chip(colors.deliverySoft, accent), marginLeft: '0.35rem' }}>REMEMBERED</span>
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
                  value={caseSizes[row.index] ?? (suggestedCasePack(row.line) || '')}
                  onChange={(e) => setCaseSizes((c) => ({ ...c, [row.index]: e.target.value.replace(/[^0-9]/g, '') }))}
                  style={{ width: '52px', padding: '0.4rem', textAlign: 'center', fontWeight: 700, border: `2px solid ${colors.border}`, borderRadius: '8px', backgroundColor: colors.bgCard, color: colors.textPrimary }}
                />
                <button onClick={() => applyCaseSize(row)} style={{ flexShrink: 0, padding: '0.4rem 0.7rem', border: 'none', borderRadius: '8px', backgroundColor: accent, color: onAccent, fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer' }}>Set</button>
              </div>
            )}

            {!isReturn && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.35rem' }}>
                <button
                  onClick={() => { setPickerFor(pickerFor === row.index ? null : row.index); setPickerQuery(''); setPickerAll(false); setAddFor(null); }}
                  style={{ padding: '0.3rem 0.6rem', border: `1px solid ${colors.border}`, borderRadius: '6px', backgroundColor: 'transparent', color: colors.textSecondary, fontSize: '0.75rem', cursor: 'pointer' }}
                >
                  {row.item ? 'Change item' : 'Choose item'}
                </button>
                {/* An unmatched line is evidence: they buy this and don't count it */}
                {unmatched && (
                  <button
                    onClick={() => { setPickerFor(null); openAddForm(row); }}
                    style={{ padding: '0.3rem 0.6rem', border: `1px solid ${accent}`, borderRadius: '6px', backgroundColor: 'transparent', color: accent, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}
                  >
                    + Add to stock list
                  </button>
                )}
              </div>
            )}

            {pickerFor === row.index && itemPicker(row)}
            {addFor === row.index && draft && addForm(row)}
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
              {learnedCount > 0 && ` (${learnedCount} remembered)`}
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

        {isCreditNote && (
          <div style={{ marginTop: '0.6rem', padding: '0.55rem 0.7rem', borderRadius: '8px', backgroundColor: colors.dangerSoft, color: colors.error, fontSize: '0.78rem', fontWeight: 600 }}>
            This is a credit note — it reverses a charge rather than delivering stock. It can be
            kept as a record, but its lines won't be logged as goods in.
          </div>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
        {rows.map(lineRow)}
      </div>

      <div style={{ padding: '0.85rem 1rem', borderTop: `1px solid ${colors.borderLight}` }}>
        {error && <div style={{ fontSize: '0.82rem', color: colors.error, marginBottom: '0.5rem', fontWeight: 600 }}>{error}</div>}

        {/* Only shown for documents that actually carry prices */}
        {costChanges.length > 0 && (
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.6rem', fontSize: '0.78rem', color: colors.textSecondary, cursor: 'pointer' }}>
            <input
              type="checkbox" checked={updateCosts} onChange={(e) => setUpdateCosts(e.target.checked)}
              style={{ marginTop: '0.1rem', width: '18px', height: '18px', flexShrink: 0, accentColor: accent }}
            />
            <span>
              Update cost prices for {costChanges.length} item{costChanges.length === 1 ? '' : 's'} from this document
              {noteValue > 0 && <> · note value {money(noteValue)}</>}
            </span>
          </label>
        )}

        <div style={{ display: 'flex', gap: '0.6rem' }}>
          <button onClick={requestClose} disabled={stage === 'saving'} style={quietBtn}>Cancel</button>
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
            <button onClick={requestClose} aria-label="Close" style={{ width: '30px', height: '30px', border: 'none', borderRadius: '50%', backgroundColor: 'transparent', color: colors.textSecondary, fontSize: '1.2rem', cursor: 'pointer', lineHeight: 1 }}>×</button>
          )}
        </div>

        {stage === 'pick' && pickPane}
        {stage === 'working' && workingPane}
        {(stage === 'review' || stage === 'saving') && reviewPane}
      </div>

      {confirmClose && (
        <div
          /* Backdrop falls back to the safe answer, never the destructive one. */
          onClick={(e) => { e.stopPropagation(); setConfirmClose(false); }}
          style={{ position: 'fixed', inset: 0, zIndex: 5100, backgroundColor: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: colors.bgCard, borderRadius: '14px', padding: '1.15rem', maxWidth: '380px', width: '100%', boxShadow: `0 12px 40px ${colors.shadow}` }}>
            <div style={{ fontWeight: 700, fontSize: '1rem', color: colors.textPrimary, marginBottom: '0.4rem' }}>
              Discard this delivery note?
            </div>
            <div style={{ fontSize: '0.85rem', color: colors.textSecondary, marginBottom: '0.95rem' }}>
              {included.length} line{included.length === 1 ? '' : 's'} ready to log will be lost, and the note will need
              photographing again.
              {keptChanges && ' Any products you added to the stock list, and case sizes you set, are already saved and will stay.'}
            </div>
            <div style={{ display: 'flex', gap: '0.6rem' }}>
              <button onClick={() => setConfirmClose(false)} style={primaryBtn()}>Keep reviewing</button>
              <button onClick={onClose} style={quietBtn}>Discard</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DeliveryNoteScan;
