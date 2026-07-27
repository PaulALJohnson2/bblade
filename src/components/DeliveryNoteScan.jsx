/**
 * DeliveryNoteScan — photograph or upload a supplier's delivery note, read it,
 * and log everything that arrived in one pass.
 *
 * Flow: capture → the model transcribes the document → each line is reconciled
 * against this venue's stock list (container class first, see deliveryDoc.js) →
 * a human reviews → the included lines become delivery-log entries and the
 * note itself is kept as proof.
 *
 * THE REVIEW SCREEN IS EXCEPTION HANDLING, and it's laid out that way. On a
 * typical note most lines are simply right, and giving all of them equal
 * weight buries the two or three that actually need a decision under a long
 * scroll of things that don't. So lines are grouped by what they ask of you —
 * needs you, delivered short, ready, not stock in — and the ready ones
 * collapse to a single tappable line each.
 *
 * Reading a photographed note takes ten to twenty seconds with nothing to
 * report in between, which reads as a hang. The working screen shows the real
 * steps ticking off with what each one found.
 *
 * Props: venuePath, items, colors, accent, onAccent, receivedBy, onClose, onDone
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { scoreDelta, venueLevel } from '../utils/learningScore';
import { formatItemDescription } from '../utils/stockUnitUtils';
import LearningReward from './LearningReward';
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

/**
 * How a document is identified across scans — its printed reference, falling
 * back to supplier and date. Same key the contribution scoring uses, so a note
 * that can't earn twice can't be logged twice either.
 */
const noteKey = (n) => {
  // Needs something that actually distinguishes one document from another.
  // Falling back to the supplier alone would collapse every note they've ever
  // sent onto one key, so the second note from a supplier whose reference and
  // date the model failed to read would be branded a duplicate — and a warning
  // that cries wolf is worse than no warning.
  const discriminator = String(n?.reference || '').trim() || String(n?.deliveryDate || '').trim();
  if (!discriminator) return '';
  return `${String(n?.supplier || '').trim().toLowerCase()}::${discriminator}`;
};

/**
 * The date the goods arrived, from the note itself. Midday local so a timezone
 * shift can't nudge it onto the day before, which for a note delivered the day
 * of a stock take is the difference between two periods.
 */
const arrivalDate = (iso) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
};

/** "1 Cases (×6)" reads wrong on a review screen — singularise the container. */
const unitPhrase = (u) => `${u.count} ${u.count === 1 ? u.label.replace(/^(\w+?)s\b/, '$1') : u.label}`;

const STEPS = [
  { key: 'prepare', label: 'Preparing the document' },
  { key: 'read', label: 'Reading the delivery note' },
  { key: 'match', label: 'Matching against your stock list' },
];

function DeliveryNoteScan({ venuePath, items, existingNotes = [], colors, accent, onAccent, receivedBy, onClose, onDone }) {
  const fileRef = useRef(null);
  const cameraRef = useRef(null);
  const galleryRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const [stage, setStage] = useState('pick'); // pick | working | review | saving | done
  const [reward, setReward] = useState(null);       // what this note taught
  // Snapshots taken when the scan starts, so the delta afterwards is exact.
  const itemsAtStart = useRef(null);
  const recordsAtStart = useRef([]);
  const [localItems, setLocalItems] = useState([]); // items created/patched here
  const [error, setError] = useState('');
  const [docFile, setDocFile] = useState(null);
  const [note, setNote] = useState(null);
  const [rows, setRows] = useState([]);

  const [stepIndex, setStepIndex] = useState(0);
  const [stepDetail, setStepDetail] = useState({});
  const [elapsed, setElapsed] = useState(0);

  const [expanded, setExpanded] = useState(null);   // row index showing its actions
  const [pickerFor, setPickerFor] = useState(null);
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerAll, setPickerAll] = useState(false);
  const [addFor, setAddFor] = useState(null);
  const [draft, setDraft] = useState(null);
  const [adding, setAdding] = useState(false);
  const [caseSizes, setCaseSizes] = useState({});
  const [showDone, setShowDone] = useState(true);   // "ready to log" group open
  const [showSkipped, setShowSkipped] = useState(false);

  const [progress, setProgress] = useState(null);
  const [learnedCount, setLearnedCount] = useState(0);
  const [alreadyLogged, setAlreadyLogged] = useState(null); // the earlier scan of this same note
  const [learnedIndex, setLearnedIndex] = useState(null); // what was known before this scan
  const [updateCosts, setUpdateCosts] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [keptChanges, setKeptChanges] = useState(false);

  const live = useMemo(() => items.filter((i) => !i.archived), [items]);

  // Elapsed seconds drive the "this is taking a while" reassurance, so a slow
  // model call reads as slow rather than broken.
  useEffect(() => {
    if (stage !== 'working') { setElapsed(0); return undefined; }
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [stage]);

  // Desktop: a delivery note that arrived by email is usually already on the
  // clipboard or draggable straight out of the mail client.
  useEffect(() => {
    if (stage !== 'pick') return undefined;
    const onPaste = (e) => {
      const file = [...(e.clipboardData?.files || [])][0];
      if (file) { e.preventDefault(); handleFile(file); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  // ---- capture + read ------------------------------------------------------

  const handleFile = async (file) => {
    if (!file) return;
    setError('');
    setStage('working');
    setStepIndex(0);
    setStepDetail({});
    try {
      const prepared = await prepareDocument(file);
      setDocFile(prepared);
      setStepDetail((d) => ({
        ...d,
        prepare: `${prepared.mimeType === 'application/pdf' ? 'PDF' : 'Photo'} · ${Math.round(prepared.bytes / 1024)} KB`,
      }));
      setStepIndex(1);

      const { note: read, error: readError } = await extractDeliveryNote(prepared.base64, prepared.mimeType);
      if (!read) {
        setError(readError || 'Could not read that document');
        setStage('pick');
        return;
      }
      setStepDetail((d) => ({ ...d, read: `${read.lines.length} lines · ${read.supplier || 'unknown supplier'}` }));
      setStepIndex(2);

      // What this venue already learned from earlier notes. A confirmed
      // supplier code beats any name matching, so it's consulted first.
      const { data: learnedRecords } = await getSupplierProducts(venuePath);
      itemsAtStart.current = live;
      recordsAtStart.current = learnedRecords || [];
      const learnedIndex = indexLearned(learnedRecords);
      setLearnedIndex(learnedIndex);
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

      // Already scanned? Nothing stops a note being logged twice, and the
      // second time silently doubles the stock — the delivery log has no
      // notion of a document having been seen before. So the duplicate is
      // named, and everything starts UNTICKED: double-counting a delivery
      // should take a deliberate act, not an absent-minded tap.
      const key = noteKey(read);
      const seen = key ? (existingNotes || []).find((n) => noteKey(n) === key) : null;
      setAlreadyLogged(seen || null);
      if (seen) reconciled = reconciled.map((r) => ({ ...r, include: false }));

      setStepDetail((d) => ({
        ...d,
        match: `${reconciled.filter((r) => r.status === 'matched').length} of ${reconciled.length} matched`,
      }));
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

  // Capture a missing case size the same way the manual entry screen does —
  // persisted onto the item, so the next delivery of it needs no asking.
  const applyCaseSize = (row) => {
    const n = parseInt(caseSizes[row.index] ?? suggestedCasePack(row.line), 10) || 0;
    if (n <= 0 || !row.item) return;
    setStockItemCasePack(venuePath, row.item.id, n, receivedBy);
    setKeptChanges(true);
    const patched = { ...row.item, casePack: n, casePackSetBy: receivedBy, casePackSetAt: new Date() };
    setLocalItems((l) => [...l.filter((x) => x.id !== patched.id), patched]);
    setRows((rs) => rs.map((r) => (r.index === row.index ? withItem(r, patched) : r)));
  };

  const openAddForm = async (row) => {
    if (addFor === row.index) { setAddFor(null); return; }
    const cls = row.containerClass;
    const name = cleanProductName(row.line);
    const unit = unitFromLine(row.line, cls);
    const section = cls === 'weight' ? 'kitchen' : 'bar';
    setDraft({ name, category: '', section, ...unit });
    setAddFor(row.index);
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
      createdBy: receivedBy,
    });
    setAdding(false);
    if (!res.success) { setError('Could not add that item: ' + res.error); return; }
    const item = {
      id: res.id, name: draft.name.trim(), category: draft.category.trim(), section: draft.section,
      unit: draft.unit, wholeUnit: draft.wholeUnit, partUnit: draft.partUnit,
      casePack: draft.casePack || 0, archived: false,
    };
    setLocalItems((l) => [...l, { ...item, createdBy: receivedBy, createdAt: new Date() }]);
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

  // ---- grouping: what does each line ask of you? ---------------------------

  const groups = useMemo(() => {
    const needsYou = [];
    const short = [];
    const ready = [];
    const skipped = [];
    for (const r of rows) {
      if (r.status === 'return') skipped.push(r);
      else if (r.status === 'unmatched' || r.needsCasePack) needsYou.push(r);
      else if (r.shortDelivery) short.push(r);
      else ready.push(r);
    }
    return { needsYou, short, ready, skipped };
  }, [rows]);

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

  const noteValue = useMemo(() => rows.reduce((t, r) => t + (r.include ? (lineCost(r.line) || 0) : 0), 0), [rows]);

  // ---- log -----------------------------------------------------------------

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
        // The note's own delivery date, not the moment it was scanned.
        receivedAt: arrivalDate(note.deliveryDate),
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

    // Learn from what was confirmed. Failure here is survivable — the stock
    // movements are what matter, and a venue that never learns is a slower
    // product, not a broken one.
    const written = learnedRecordsFrom(rows, note, receivedBy, learnedIndex);
    await saveSupplierProducts(venuePath, written)
      .catch((err) => console.warn('Could not save what this note taught us:', err));

    setReward(buildReward(written, entryIds.length, failed));
    setStage('done');
  };

  /**
   * What this note taught, as the difference between two states rather than a
   * tally of what just happened — the same derivation the standing score uses,
   * so the moment can never disagree with the running total.
   *
   * Both states carry the venue's EXISTING notes, or every scan would look
   * like a brand-new supplier and pay the discovery bonus again.
   */
  const buildReward = (written, logged, failed) => {
    try {
      const nowDate = new Date();
      const merged = new Map(recordsAtStart.current.map((r) => [r.id, r]));
      for (const w of written) {
        const prev = merged.get(w.id);
        merged.set(w.id, {
          ...prev, ...w,
          firstSeenAt: prev?.firstSeenAt || nowDate,
          firstConfirmedBy: prev?.firstConfirmedBy || w.firstConfirmedBy || receivedBy,
          lastSeenAt: nowDate,
        });
      }

      const byId = new Map((itemsAtStart.current || []).map((i) => [i.id, i]));
      for (const li of localItems) byId.set(li.id, { ...byId.get(li.id), ...li });

      const savedNote = {
        ...note,
        uploadedBy: receivedBy,
        uploadedAt: nowDate,
        lines: rows.map((r) => ({ ...r.line, status: r.status, included: r.include, itemId: r.itemId || '' })),
      };

      const before = {
        items: itemsAtStart.current || [],
        supplierProducts: recordsAtStart.current,
        notes: existingNotes,
        sessions: [],
      };
      const after = {
        items: [...byId.values()],
        supplierProducts: [...merged.values()],
        notes: [...existingNotes, savedNote],
        sessions: [],
      };

      return {
        delta: scoreDelta(before, after),
        levelBefore: venueLevel(before),
        levelAfter: venueLevel(after),
        logged,
        failed,
        // Everything now mapped for this supplier is a line that won't need a
        // human next time. That's the promise the next scan has to keep.
        prediction: {
          supplier: note.supplier || '',
          lines: [...merged.values()].filter((r) => r.supplierKey === written[0]?.supplierKey).length,
          minutes: Math.round(([...merged.values()].filter((r) => r.supplierKey === written[0]?.supplierKey).length * 25) / 60),
        },
      };
    } catch (err) {
      console.warn('Could not work out what this note taught us:', err);
      return { delta: { total: 0, byKind: {}, facts: [] }, logged, failed, prediction: null };
    }
  };

  // ---- styles --------------------------------------------------------------

  const primaryBtn = (enabled = true) => ({
    flex: 1, padding: '0.85rem', border: 'none', borderRadius: '10px',
    backgroundColor: accent, color: onAccent, fontWeight: 700, fontSize: '1rem',
    cursor: enabled ? 'pointer' : 'not-allowed', opacity: enabled ? 1 : 0.5,
  });
  const quietBtn = {
    flexShrink: 0, padding: '0.85rem 1.1rem', border: 'none', borderRadius: '10px',
    backgroundColor: colors.bgLight, color: colors.textPrimary, fontWeight: 600, cursor: 'pointer',
  };
  const smallBtn = (tone) => ({
    padding: '0.35rem 0.7rem', borderRadius: '7px', fontSize: '0.76rem', fontWeight: 600,
    cursor: 'pointer', border: `1px solid ${tone || colors.border}`,
    backgroundColor: 'transparent', color: tone || colors.textSecondary,
  });
  const chip = (bg, fg) => ({
    display: 'inline-block', padding: '0.1rem 0.45rem', borderRadius: '9999px',
    fontSize: '0.66rem', fontWeight: 700, letterSpacing: '0.02em',
    backgroundColor: bg, color: fg, whiteSpace: 'nowrap',
  });
  const field = {
    width: '100%', padding: '0.5rem', fontSize: '0.88rem', border: `2px solid ${colors.border}`,
    borderRadius: '8px', backgroundColor: colors.bgCard, color: colors.textPrimary, boxSizing: 'border-box',
  };

  // ---- capture pane --------------------------------------------------------

  const onPick = (e) => { handleFile(e.target.files?.[0]); e.target.value = ''; };
  const mobile = supportsCameraCapture();

  const pickPane = (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]); }}
      style={{
        padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.7rem',
        outline: dragOver ? `2px dashed ${accent}` : 'none', outlineOffset: '-8px',
        backgroundColor: dragOver ? colors.deliverySoft : 'transparent',
      }}
    >
      <div style={{ fontSize: '0.88rem', color: colors.textSecondary }}>
        Everything on the note is matched to your stock list for you to check before anything
        is logged.
      </div>

      {mobile ? (
        <>
          <button onClick={() => cameraRef.current?.click()} style={{ ...primaryBtn(), padding: '1rem' }}>
            📷 Take a photo
          </button>
          {/* Notes often arrive by email and get screenshotted, so the gallery
              needs to be its own button — buried in a generic file picker,
              nobody finds it. */}
          <button onClick={() => galleryRef.current?.click()} style={{ ...quietBtn, padding: '1rem', width: '100%' }}>
            🖼 Choose from photos
          </button>
          <button onClick={() => fileRef.current?.click()} style={{ ...quietBtn, padding: '1rem', width: '100%' }}>
            📎 Choose a file or PDF
          </button>
        </>
      ) : (
        <>
          <button onClick={() => fileRef.current?.click()} style={{ ...primaryBtn(), padding: '1rem' }}>
            Choose a photo or PDF
          </button>
          <div style={{ fontSize: '0.78rem', color: colors.textMuted, textAlign: 'center' }}>
            …or drag one in, or paste a screenshot
          </div>
        </>
      )}

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={onPick} style={{ display: 'none' }} />
      {/* No `capture` attribute — that's what sends the picker to the gallery
          rather than straight to the camera. */}
      <input ref={galleryRef} type="file" accept="image/*" onChange={onPick} style={{ display: 'none' }} />
      <input ref={fileRef} type="file" accept={ACCEPTED_TYPES} onChange={onPick} style={{ display: 'none' }} />

      {error && <div style={{ fontSize: '0.85rem', color: colors.error, fontWeight: 600 }}>{error}</div>}
    </div>
  );

  // ---- working pane: real steps, real findings -----------------------------

  const workingPane = (
    <div style={{ padding: '1.25rem' }}>
      <div style={{ height: '4px', borderRadius: '2px', backgroundColor: colors.bgLight, overflow: 'hidden', marginBottom: '1.25rem' }}>
        <div className="bb-sweep" style={{ width: '25%', height: '100%', borderRadius: '2px', backgroundColor: accent }} />
      </div>

      <div style={{ display: 'flex', gap: '0.9rem', alignItems: 'flex-start' }}>
        {docFile?.thumbDataUrl && (
          <img
            src={docFile.thumbDataUrl} alt=""
            style={{ width: '72px', height: '72px', objectFit: 'cover', borderRadius: '8px', border: `1px solid ${colors.borderLight}`, flexShrink: 0 }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
          {STEPS.map((s, i) => {
            const done = i < stepIndex;
            const active = i === stepIndex;
            return (
              <div key={s.key} style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', opacity: done || active ? 1 : 0.4 }}>
                <div
                  className={active ? 'bb-pulse' : undefined}
                  style={{
                    flexShrink: 0, width: '18px', height: '18px', marginTop: '0.1rem', borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.7rem', fontWeight: 700,
                    backgroundColor: done ? accent : (active ? accent : colors.bgLight),
                    color: done || active ? onAccent : colors.textMuted,
                    border: done || active ? 'none' : `1px solid ${colors.border}`,
                  }}
                >{done ? '✓' : ''}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.9rem', fontWeight: active ? 700 : 500, color: colors.textPrimary }}>
                    {s.label}
                  </div>
                  {stepDetail[s.key] && (
                    <div style={{ fontSize: '0.75rem', color: colors.textSecondary }}>{stepDetail[s.key]}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Reading is the slow step and the only one with nothing to report while
          it runs — say so rather than let the silence read as a hang. */}
      {elapsed >= 8 && stepIndex === 1 && (
        <div style={{ marginTop: '1.1rem', fontSize: '0.78rem', color: colors.textSecondary }}>
          Still reading — an image note can take up to a minute. {elapsed}s so far.
        </div>
      )}
    </div>
  );

  // ---- review: pickers and forms -------------------------------------------

  const itemPicker = (row) => {
    const cls = containerClassOfLine(row.line);
    const q = pickerQuery.trim().toLowerCase();
    const pool = pickerAll ? live : live.filter((i) => containersCompatible(cls, containerClassOfItem(i)));
    const results = pool
      .filter((i) => !q || i.name.toLowerCase().includes(q) || (i.category || '').toLowerCase().includes(q))
      .slice(0, 40);
    return (
      <div style={{ marginTop: '0.5rem', padding: '0.6rem', border: `1px solid ${colors.borderLight}`, borderRadius: '8px', backgroundColor: colors.bgLight }}>
        <input
          autoFocus value={pickerQuery} onChange={(e) => setPickerQuery(e.target.value)}
          placeholder="Search stock items…" style={field}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', margin: '0.5rem 0', fontSize: '0.75rem', color: colors.textSecondary }}>
          <input type="checkbox" checked={pickerAll} onChange={(e) => setPickerAll(e.target.checked)} />
          Show every container type (this line looks like a {cls === 'other' ? 'unknown container' : cls})
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
          <button onClick={() => setPickerFor(null)} style={smallBtn()}>Close</button>
          {row.item && <button onClick={() => clearItem(row.index)} style={smallBtn()}>Skip this line</button>}
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
    const countedAs = formatItemDescription({ wholeUnit: draft.wholeUnit });
    const sectionBtn = (key, label) => (
      <button
        key={key} onClick={() => setDraft((d) => ({ ...d, section: key }))}
        style={{ flex: 1, padding: '0.4rem', border: 'none', borderRadius: '6px', fontSize: '0.8rem', fontWeight: draft.section === key ? 700 : 500, backgroundColor: draft.section === key ? accent : colors.bgCard, color: draft.section === key ? onAccent : colors.textPrimary, cursor: 'pointer' }}
      >{label}</button>
    );
    return (
      <div style={{ marginTop: '0.5rem', padding: '0.6rem', border: `1px solid ${accent}`, borderRadius: '8px', backgroundColor: colors.bgLight, display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
        <input
          autoFocus value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          placeholder="Product name" style={field}
        />
        <input
          value={draft.category} onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
          placeholder="Category (e.g. Snacks)" style={field}
        />
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
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
          <button onClick={() => { setAddFor(null); setDraft(null); }} style={smallBtn()}>Cancel</button>
          <button
            onClick={() => addToStockList(row)} disabled={!draft.name.trim() || adding}
            style={{ flex: 1, padding: '0.5rem', border: 'none', borderRadius: '8px', backgroundColor: accent, color: onAccent, fontWeight: 700, fontSize: '0.82rem', cursor: adding ? 'wait' : 'pointer', opacity: draft.name.trim() ? 1 : 0.5 }}
          >{adding ? 'Adding…' : 'Add & match this line'}</button>
        </div>
      </div>
    );
  };

  // ---- review: one row --------------------------------------------------

  /**
   * `compact` is the resting state for lines that need nothing: source text on
   * top, what it becomes underneath, quantity on the right, and no buttons at
   * all until the row is tapped. Fifteen of those fit where four used to.
   */
  const lineRow = (row, { compact }) => {
    const isReturn = row.status === 'return';
    const unmatched = row.status === 'unmatched';
    const open = expanded === row.index;
    const units = row.item && !row.needsCasePack ? unitsForLine(row.line, row.item) : null;
    const cost = lineCost(row.line);
    const tone = unmatched || row.needsCasePack ? colors.warning : (row.shortDelivery ? colors.error : accent);

    return (
      <div
        key={row.index}
        style={{
          border: `1px solid ${open ? tone : colors.borderLight}`,
          borderLeft: compact ? `1px solid ${colors.borderLight}` : `3px solid ${tone}`,
          borderRadius: '9px',
          backgroundColor: isReturn ? colors.bgLight : colors.bgCard,
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', padding: compact ? '0.45rem 0.6rem' : '0.6rem 0.7rem' }}>
          {!isReturn && (
            <input
              type="checkbox" checked={row.include} disabled={unmatched || row.needsCasePack}
              onChange={() => toggleInclude(row.index)}
              onClick={(e) => e.stopPropagation()}
              style={{ width: '19px', height: '19px', flexShrink: 0, accentColor: accent, cursor: unmatched ? 'not-allowed' : 'pointer' }}
            />
          )}
          {isReturn && <span style={{ flexShrink: 0, width: '19px', textAlign: 'center', color: colors.textMuted }}>⊘</span>}

          <button
            onClick={() => setExpanded(open ? null : row.index)}
            style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 'none', background: 'transparent', padding: 0, cursor: 'pointer' }}
          >
            {/* Matched: the STOCK ITEM leads, because that's the thing being
                changed. The supplier's text is the evidence, not the answer. */}
            {row.item ? (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: '0.88rem', fontWeight: 700, color: colors.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {row.item.name}
                  </span>
                  <span style={{ flexShrink: 0, fontSize: '0.82rem', fontWeight: 700, color: colors.textPrimary }}>
                    {units && units.units.length ? units.units.map(unitPhrase).join(', ') : qtyLabel(row)}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginTop: '0.1rem' }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: '0.72rem', color: colors.textSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {row.line.packSize} {row.line.description}
                  </span>
                  <span style={{ flexShrink: 0, fontSize: '0.72rem', color: colors.textMuted }}>
                    {qtyLabel(row)}{cost !== null ? ` · ${money(cost)}` : ''}
                  </span>
                </div>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: '0.86rem', fontWeight: 600, color: colors.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {row.line.packSize} {row.line.description}
                  </span>
                  <span style={{ flexShrink: 0, fontSize: '0.82rem', fontWeight: 700, color: colors.textPrimary }}>{qtyLabel(row)}</span>
                </div>
                <div style={{ fontSize: '0.72rem', color: isReturn ? colors.textMuted : colors.warning, marginTop: '0.1rem', fontWeight: 600 }}>
                  {isReturn ? 'Going back to the supplier — not stock in' : 'Not in your stock list'}
                </div>
              </>
            )}
          </button>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.15rem', flexShrink: 0 }}>
            {row.viaLearned && <span style={chip(colors.deliverySoft, accent)}>MATCHED BY CODE</span>}
            {row.shortDelivery && (
              <span style={chip(colors.dangerSoft, colors.error)}>
                {row.line.qtyDelivered} OF {row.line.qtyDespatched}
              </span>
            )}
          </div>
        </div>

        {/* Actions only exist once you ask for them */}
        {(open || row.needsCasePack || unmatched) && !isReturn && (
          <div style={{ padding: '0 0.7rem 0.6rem', borderTop: open ? `1px solid ${colors.borderLight}` : 'none', paddingTop: open ? '0.55rem' : 0 }}>
            {row.needsCasePack && row.item && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.45rem', padding: '0.45rem 0.55rem', border: `1px dashed ${colors.warning}`, borderRadius: '8px' }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: '0.76rem', color: colors.textSecondary }}>
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

            {row.shortDespatch && (
              <div style={{ fontSize: '0.72rem', color: colors.textSecondary, marginBottom: '0.4rem' }}>
                {row.line.qtyDespatched} sent of {row.line.qtyOrdered} ordered.
              </div>
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
              <button
                onClick={() => { setPickerFor(pickerFor === row.index ? null : row.index); setAddFor(null); setPickerQuery(''); setPickerAll(false); }}
                style={smallBtn()}
              >{row.item ? 'Change item' : 'Choose item'}</button>
              {unmatched && (
                <button onClick={() => { setPickerFor(null); openAddForm(row); }} style={smallBtn(accent)}>
                  + Add to stock list
                </button>
              )}
            </div>

            {pickerFor === row.index && itemPicker(row)}
            {addFor === row.index && draft && addForm(row)}
          </div>
        )}
      </div>
    );
  };

  const groupHeader = (label, count, tone, { collapsible, open, onToggle } = {}) => (
    <div
      onClick={collapsible ? onToggle : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: '0.4rem',
        margin: '0.9rem 0 0.4rem', cursor: collapsible ? 'pointer' : 'default',
      }}
    >
      <span style={{ fontSize: '0.7rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: tone }}>
        {label}
      </span>
      <span style={{ fontSize: '0.7rem', fontWeight: 700, color: colors.textMuted }}>{count}</span>
      <span style={{ flex: 1, height: '1px', backgroundColor: colors.borderLight }} />
      {collapsible && <span style={{ fontSize: '0.7rem', color: colors.textSecondary }}>{open ? 'Hide' : 'Show'}</span>}
    </div>
  );

  const reviewPane = (
    <>
      <div style={{ padding: '0.8rem 1rem', borderBottom: `1px solid ${colors.borderLight}` }}>
        <div style={{ display: 'flex', gap: '0.7rem', alignItems: 'flex-start' }}>
          {docFile?.thumbDataUrl && (
            <img
              src={docFile.thumbDataUrl} alt="Delivery note"
              style={{ width: '52px', height: '52px', objectFit: 'cover', borderRadius: '8px', border: `1px solid ${colors.borderLight}`, flexShrink: 0 }}
            />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: '1rem', color: colors.textPrimary }}>{note?.supplier || 'Delivery note'}</div>
            <div style={{ fontSize: '0.76rem', color: colors.textSecondary }}>
              {[note?.documentType, prettyDate(note?.deliveryDate), note?.reference && `Ref ${note.reference}`]
                .filter(Boolean).join(' · ')}
            </div>
            {learnedCount > 0 && (
              <div style={{ fontSize: '0.72rem', color: accent, fontWeight: 600, marginTop: '0.15rem' }}>
                {learnedCount} recognised from previous notes
              </div>
            )}
            {arrivalDate(note?.deliveryDate) && (
              <div style={{ fontSize: '0.72rem', color: colors.textSecondary, marginTop: '0.15rem' }}>
                Stock will be dated {prettyDate(note.deliveryDate)}, not today
              </div>
            )}
          </div>
        </div>

        {alreadyLogged && (() => {
          // How much the earlier scan actually produced matters. The note is
          // saved before its deliveries are logged, so a connection dropping in
          // between leaves a note claiming lines with nothing behind it — and
          // "already logged" would then talk someone out of logging a delivery
          // that never landed.
          const before = Array.isArray(alreadyLogged.entryIds) ? alreadyLogged.entryIds.length : 0;
          const when = alreadyLogged.uploadedAt?.toDate
            ? ` on ${alreadyLogged.uploadedAt.toDate().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
            : '';
          const who = alreadyLogged.uploadedBy ? ` by ${alreadyLogged.uploadedBy}` : '';
          return (
            <div style={{ marginTop: '0.6rem', padding: '0.6rem 0.7rem', borderRadius: '8px', backgroundColor: colors.dangerSoft, color: colors.error, fontSize: '0.78rem', fontWeight: 600 }}>
              {before > 0 ? (
                <>
                  This note was scanned{when}{who} and recorded {before} deliver{before === 1 ? 'y' : 'ies'}.
                  Logging it again would add the same stock a second time, so nothing is ticked — tick
                  anything you genuinely need to re-add.
                </>
              ) : (
                <>
                  This note was scanned{when}{who} but recorded no deliveries — it looks like that attempt
                  didn't finish. Nothing is ticked, but this one probably does need logging.
                </>
              )}
            </div>
          );
        })()}
        {isCreditNote && (
          <div style={{ marginTop: '0.6rem', padding: '0.55rem 0.7rem', borderRadius: '8px', backgroundColor: colors.dangerSoft, color: colors.error, fontSize: '0.78rem', fontWeight: 600 }}>
            This is a credit note — it reverses a charge rather than delivering stock. It can be
            kept as a record, but its lines won't be logged as goods in.
          </div>
        )}
        {!docFile?.storable && (
          <div style={{ marginTop: '0.5rem', fontSize: '0.73rem', color: colors.textSecondary }}>
            The document is too large to keep a copy of — the lines below will still be saved.
          </div>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 1rem 0.75rem' }}>
        {groups.needsYou.length > 0 && (
          <>
            {groupHeader('Needs you', groups.needsYou.length, colors.warning)}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {groups.needsYou.map((r) => lineRow(r, { compact: false }))}
            </div>
          </>
        )}

        {groups.short.length > 0 && (
          <>
            {groupHeader('Delivered short', groups.short.length, colors.error)}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {groups.short.map((r) => lineRow(r, { compact: false }))}
            </div>
          </>
        )}

        {groups.ready.length > 0 && (
          <>
            {groupHeader('Ready to log', groups.ready.length, accent, {
              collapsible: true, open: showDone, onToggle: () => setShowDone((v) => !v),
            })}
            {showDone && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                {groups.ready.map((r) => lineRow(r, { compact: true }))}
              </div>
            )}
          </>
        )}

        {groups.skipped.length > 0 && (
          <>
            {groupHeader('Not stock in', groups.skipped.length, colors.textMuted, {
              collapsible: true, open: showSkipped, onToggle: () => setShowSkipped((v) => !v),
            })}
            {showSkipped && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                {groups.skipped.map((r) => lineRow(r, { compact: true }))}
              </div>
            )}
          </>
        )}
      </div>

      <div style={{ padding: '0.8rem 1rem', borderTop: `1px solid ${colors.borderLight}` }}>
        {error && <div style={{ fontSize: '0.82rem', color: colors.error, marginBottom: '0.5rem', fontWeight: 600 }}>{error}</div>}

        {/* Only shown for documents that actually carry prices */}
        {costChanges.length > 0 && (
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.6rem', fontSize: '0.78rem', color: colors.textSecondary, cursor: 'pointer' }}>
            <input
              type="checkbox" checked={updateCosts} onChange={(e) => setUpdateCosts(e.target.checked)}
              style={{ marginTop: '0.1rem', width: '18px', height: '18px', flexShrink: 0, accentColor: accent }}
            />
            <span>
              Update cost prices for {costChanges.length} item{costChanges.length === 1 ? '' : 's'}
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
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: colors.bgCard, borderRadius: '14px', width: '100%', maxWidth: '640px',
          maxHeight: '92vh', display: 'flex', flexDirection: 'column',
          boxShadow: `0 12px 40px ${colors.shadow}`, overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.8rem 1rem', borderBottom: `1px solid ${colors.borderLight}` }}>
          <div style={{ flex: 1, fontWeight: 700, fontSize: '1.05rem', color: colors.textPrimary }}>Scan delivery note</div>
          {stage !== 'saving' && stage !== 'working' && stage !== 'done' && (
            <button onClick={requestClose} aria-label="Close" style={{ width: '30px', height: '30px', border: 'none', borderRadius: '50%', backgroundColor: 'transparent', color: colors.textSecondary, fontSize: '1.2rem', cursor: 'pointer', lineHeight: 1 }}>×</button>
          )}
        </div>

        {stage === 'pick' && pickPane}
        {stage === 'working' && workingPane}
        {(stage === 'review' || stage === 'saving') && reviewPane}
        {stage === 'done' && reward && (
          <LearningReward
            {...reward}
            person={receivedBy}
            colors={colors}
            accent={accent}
            onAccent={onAccent}
            onDone={() => onDone(reward.logged, reward.failed)}
          />
        )}
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
              scanning again.
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
