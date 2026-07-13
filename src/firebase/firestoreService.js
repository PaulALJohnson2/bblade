/**
 * firestoreService.js — Stock data access layer (Bar Blade).
 *
 * Multi-tenant model:
 *   accounts/{accountId}                     ← customer, holds { name, staff: [] }
 *     └─ pubs/{pubId}                         ← { name }
 *          ├─ stockItems/{itemId}
 *          └─ stockSessions/{sessionId}
 *
 * Stock + venue functions take a VENUE PATH (`accounts/{accountId}/venues/{venueId}`)
 * so this layer never needs to know how the tenant is resolved. Account-level
 * functions take an accountId.
 *
 * All functions return { success, data?/id?/..., error? }. Subscribe* return an
 * unsubscribe function.
 */

import {
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  getDocFromCache,
  getDocs,
  query,
  where,
  orderBy,
  deleteDoc,
  updateDoc,
  writeBatch,
  Timestamp,
  onSnapshot,
  runTransaction,
  increment,
  limit,
} from 'firebase/firestore';
import { db } from './config';
import { idsFromVenuePath } from '../config/app';

/** Reject a promise if it doesn't settle within `ms` — guards offline hot paths. */
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

// ============================================
// STOCK ITEMS  (under {venuePath}/stockItems)
// ============================================

/** Get all stock items for a pub. Optionally filter by section. */
export async function getAllStockItems(venuePath, section = null) {
  try {
    const colRef = collection(db, `${venuePath}/stockItems`);
    let q;
    if (section) {
      q = query(colRef, where('section', '==', section), orderBy('name'));
    } else {
      q = query(colRef, orderBy('section'), orderBy('name'));
    }

    const snapshot = await getDocs(q);
    const items = [];
    snapshot.forEach((doc) => items.push({ id: doc.id, ...doc.data() }));
    return { success: true, data: items };
  } catch (error) {
    console.error('Error getting stock items:', error);
    return { success: false, error: error.message };
  }
}

/** Get a single stock item by ID. */
export async function getStockItemById(venuePath, itemId) {
  try {
    const docSnap = await getDoc(doc(db, `${venuePath}/stockItems/${itemId}`));
    if (docSnap.exists()) {
      return { success: true, data: { id: docSnap.id, ...docSnap.data() } };
    }
    return { success: true, data: null };
  } catch (error) {
    console.error('Error getting stock item:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Save or update a stock item.
 * @param {string} venuePath
 * @param {string|null} itemId - null for new items
 * @param {object} data
 */
export async function saveOrUpdateStockItem(venuePath, itemId, data) {
  try {
    const { accountId, venueId } = idsFromVenuePath(venuePath);
    const docData = { ...data, accountId, venueId, updatedAt: Timestamp.now() };
    const docRef = itemId
      ? doc(db, `${venuePath}/stockItems/${itemId}`)
      : doc(collection(db, `${venuePath}/stockItems`));
    await setDoc(docRef, docData, { merge: true });
    return { success: true, id: docRef.id };
  } catch (error) {
    console.error('Error saving stock item:', error);
    return { success: false, error: error.message };
  }
}

/** Delete a stock item. */
export async function deleteStockItem(venuePath, itemId) {
  try {
    await deleteDoc(doc(db, `${venuePath}/stockItems/${itemId}`));
    return { success: true };
  } catch (error) {
    console.error('Error deleting stock item:', error);
    return { success: false, error: error.message };
  }
}

/** Subscribe to stock items for real-time updates. Optionally filter by section. */
export function subscribeToStockItems(venuePath, onData, onError, section = null) {
  const colRef = collection(db, `${venuePath}/stockItems`);
  let q;
  if (section) {
    q = query(colRef, where('section', '==', section), orderBy('name'));
  } else {
    q = query(colRef, orderBy('section'), orderBy('name'));
  }

  return onSnapshot(
    q,
    (snapshot) => {
      const items = [];
      snapshot.forEach((doc) => items.push({ id: doc.id, ...doc.data() }));
      onData(items);
    },
    (error) => {
      console.error('Error in stock items listener:', error);
      if (onError) onError(error.message);
    }
  );
}

// ============================================
// SHIFTS — punch clock (under {venuePath}/shifts/{shiftId})
//
// Ported from the standalone Punch app. A shift belongs to a MEMBER (memberId/
// memberName), not the auth user — so a shared "bar account" device can later
// clock people in/out on their behalf and attribution still works.
// Backdated clock-ins keep both times: clockIn = requested start,
// clockInActual = when the button was really pressed, approvalStatus tracks
// the manager's decision (approve keeps the requested time; refuse reverts).
// ============================================

const dayKeyFor = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Live shifts feed, newest clock-in first (capped — a pub's volume is small). */
export function subscribeToShifts(venuePath, onData, onError) {
  const q = query(collection(db, `${venuePath}/shifts`), orderBy('clockIn', 'desc'), limit(600));
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (error) => {
      console.error('Error in shifts listener:', error);
      if (onError) onError(error.message);
    }
  );
}

/**
 * Clock a member in. requestedTime (ms) earlier than now records a backdated
 * start pending manager approval; reason says why.
 */
export async function clockInShift(venuePath, { memberId, memberName, station, requestedTime = null, reason = null, byUid = null }) {
  try {
    const { accountId, venueId } = idsFromVenuePath(venuePath);
    const now = Date.now();
    const effective = requestedTime ? Math.min(requestedTime, now) : now;
    const data = {
      memberId,
      memberName: memberName || '',
      station: station === 'kitchen' ? 'kitchen' : 'bar',
      clockIn: Timestamp.fromMillis(effective),
      clockOut: null,
      dayKey: dayKeyFor(effective),
      accountId,
      venueId,
      createdAt: Timestamp.now(),
      createdByUid: byUid,
    };
    if (requestedTime && effective !== now) {
      data.clockInActual = Timestamp.fromMillis(now);
      if (reason) data.clockInReason = reason;
      data.approvalStatus = 'pending';
    }
    const ref = await addDoc(collection(db, `${venuePath}/shifts`), data);
    return { success: true, id: ref.id };
  } catch (error) {
    console.error('Error clocking in:', error);
    return { success: false, error: error.message };
  }
}

/** Clock a shift out (never before its clock-in). */
export async function clockOutShift(venuePath, shift, atMs = Date.now()) {
  try {
    const clockInMs = shift.clockIn?.toMillis ? shift.clockIn.toMillis() : shift.clockIn;
    const out = Math.max(clockInMs || 0, atMs);
    await updateDoc(doc(db, `${venuePath}/shifts/${shift.id}`), { clockOut: Timestamp.fromMillis(out) });
    return { success: true };
  } catch (error) {
    console.error('Error clocking out:', error);
    return { success: false, error: error.message };
  }
}

/** Manager: add a shift by hand. */
export async function addManualShift(venuePath, { memberId, memberName, station, clockIn, clockOut = null }) {
  try {
    const { accountId, venueId } = idsFromVenuePath(venuePath);
    await addDoc(collection(db, `${venuePath}/shifts`), {
      memberId,
      memberName: memberName || '',
      station: station === 'kitchen' ? 'kitchen' : 'bar',
      clockIn: Timestamp.fromMillis(clockIn),
      clockOut: clockOut === null ? null : Timestamp.fromMillis(clockOut),
      dayKey: dayKeyFor(clockIn),
      accountId,
      venueId,
      createdAt: Timestamp.now(),
      manual: true,
    });
    return { success: true };
  } catch (error) {
    console.error('Error adding shift:', error);
    return { success: false, error: error.message };
  }
}

/** Manager: edit a shift's times/station. */
export async function updateShiftTimes(venuePath, shiftId, { clockIn, clockOut, station } = {}) {
  try {
    const patch = {};
    if (clockIn != null) {
      patch.clockIn = Timestamp.fromMillis(clockIn);
      patch.dayKey = dayKeyFor(clockIn);
    }
    if (clockOut !== undefined) patch.clockOut = clockOut === null ? null : Timestamp.fromMillis(clockOut);
    if (station !== undefined) patch.station = station;
    if (Object.keys(patch).length === 0) return { success: true };
    await updateDoc(doc(db, `${venuePath}/shifts/${shiftId}`), patch);
    return { success: true };
  } catch (error) {
    console.error('Error updating shift:', error);
    return { success: false, error: error.message };
  }
}

/** Manager: accept a backdated clock-in (the requested time stands). */
export async function approveShiftBackdate(venuePath, shiftId, approverName) {
  try {
    await updateDoc(doc(db, `${venuePath}/shifts/${shiftId}`), {
      approvalStatus: 'approved',
      approvedBy: approverName || 'unknown',
      approvedAt: Timestamp.now(),
    });
    return { success: true };
  } catch (error) {
    console.error('Error approving shift:', error);
    return { success: false, error: error.message };
  }
}

/** Manager: refuse a backdate — the shift reverts to when they really pressed the button. */
export async function refuseShiftBackdate(venuePath, shift) {
  try {
    const actual = shift.clockInActual?.toMillis ? shift.clockInActual.toMillis() : shift.clockInActual;
    if (!actual) return { success: false, error: 'No actual punch time recorded.' };
    await updateDoc(doc(db, `${venuePath}/shifts/${shift.id}`), {
      clockIn: Timestamp.fromMillis(actual),
      dayKey: dayKeyFor(actual),
      clockInActual: null,
      clockInReason: null,
      approvalStatus: null,
    });
    return { success: true };
  } catch (error) {
    console.error('Error refusing backdate:', error);
    return { success: false, error: error.message };
  }
}

/** Manager: delete a shift outright. */
export async function deleteShift(venuePath, shiftId) {
  try {
    await deleteDoc(doc(db, `${venuePath}/shifts/${shiftId}`));
    return { success: true };
  } catch (error) {
    console.error('Error deleting shift:', error);
    return { success: false, error: error.message };
  }
}

// ============================================
// STOCK SESSIONS  (under {venuePath}/stockSessions/{timestamp})
// ============================================

/** Create a new stock session. Returns its ID (a timestamp). */
export async function createStockSession(venuePath, userId, userName, section) {
  try {
    const { accountId, venueId } = idsFromVenuePath(venuePath);
    const sessionId = Date.now().toString();
    await setDoc(doc(db, `${venuePath}/stockSessions/${sessionId}`), {
      createdAt: Timestamp.now(),
      createdBy: userId,
      createdByName: userName || 'Unknown',
      status: 'in_progress',
      section: section || 'bar',
      accountId,
      venueId,
      counts: {},
    });
    return { success: true, sessionId };
  } catch (error) {
    console.error('Error creating stock session:', error);
    return { success: false, error: error.message };
  }
}

/** Get the most recent in-progress session for a pub, or null. */
export async function getCurrentStockSession(venuePath) {
  try {
    const q = query(
      collection(db, `${venuePath}/stockSessions`),
      where('status', '==', 'in_progress'),
      orderBy('createdAt', 'desc')
    );
    const snapshot = await getDocs(q);
    if (snapshot.empty) return { success: true, data: null };
    const d = snapshot.docs[0];
    return { success: true, data: { id: d.id, ...d.data() } };
  } catch (error) {
    console.error('Error getting current stock session:', error);
    return { success: false, error: error.message };
  }
}

/** Get a stock session by ID. */
export async function getStockSession(venuePath, sessionId) {
  try {
    const docSnap = await getDoc(doc(db, `${venuePath}/stockSessions/${sessionId}`));
    if (docSnap.exists()) {
      return { success: true, data: { id: docSnap.id, ...docSnap.data() } };
    }
    return { success: true, data: null };
  } catch (error) {
    console.error('Error getting stock session:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Save a count to a stock session (multi-entry support).
 * Uses a transaction to merge contributors and append history.
 */
export async function saveStockCount(venuePath, sessionId, itemId, countData) {
  // Offline-first: this must work in dead-signal cellars. Firestore transactions
  // require connectivity, so instead we read the session from the local cache and
  // do a field-path update that is applied to the cache immediately and synced
  // when signal returns. We intentionally DON'T await the server ack — awaited
  // writes stay pending while offline, which would hang the counter's screen.
  // Trade-off vs the old transaction: if two devices edit the SAME item while
  // both offline, it's last-write-wins on sync (different items never conflict —
  // they're separate field paths).
  try {
    const docRef = doc(db, `${venuePath}/stockSessions/${sessionId}`);
    // Read from the LOCAL CACHE, never the server. On a flaky signal a plain
    // getDoc() tries the server first and can hang for many seconds before
    // falling back — that's the mid-count "freeze". The session is actively
    // subscribed while counting, so it's always warm in the cache; only fall
    // back to a (server) getDoc if it somehow isn't cached yet.
    //
    // Hard guard: each read is time-bounded so the save can NEVER hang the
    // counter's screen. If both reads time out we proceed without the prior
    // data — the new count still writes (we just can't merge this item's
    // existing contributors/history that one time). Registering the count
    // matters more than the merge.
    let sessionData = null;
    let sessionMissing = false;
    try {
      const snap = await withTimeout(getDocFromCache(docRef), 2500);
      if (snap.exists()) sessionData = snap.data(); else sessionMissing = true;
    } catch {
      try {
        const snap = await withTimeout(getDoc(docRef), 2500);
        if (snap.exists()) sessionData = snap.data(); else sessionMissing = true;
      } catch {
        sessionData = null; // timed out / unreadable — proceed without merge
      }
    }
    if (sessionMissing) {
      return { success: false, error: 'Session not found' };
    }

    const existing = sessionData?.counts?.[itemId];

    let contributors = [];
    if (existing?.countedBy) {
      contributors = Array.isArray(existing.countedBy)
        ? [...existing.countedBy]
        : [existing.countedBy];
    }
    if (existing?.entries && Array.isArray(existing.entries)) {
      existing.entries.forEach(e => {
        if (e.countedBy && !contributors.includes(e.countedBy)) {
          contributors.push(e.countedBy);
        }
      });
    }
    if (countData.countedBy && !contributors.includes(countData.countedBy)) {
      contributors.push(countData.countedBy);
    }

    const history = existing?.history && Array.isArray(existing.history)
      ? [...existing.history]
      : [];
    if (history.length === 0 && existing?.countedAt) {
      history.push({
        caseCount: existing.caseCount ?? 0,
        wholeCount: existing.wholeCount,
        partCount: existing.partCount,
        quantity: existing.quantity,
        countedBy: Array.isArray(existing.countedBy) ? existing.countedBy[0] : (existing.countedBy || ''),
        countedAt: existing.countedAt
      });
    }
    const now = Timestamp.now();
    history.push({
      caseCount: countData.caseCount ?? 0,
      wholeCount: countData.wholeCount,
      partCount: countData.partCount,
      quantity: countData.quantity,
      countedBy: countData.countedBy || '',
      countedAt: now
    });

    // Don't await — the local write applies instantly; failures (if any) surface
    // on sync and are logged. This is what lets the count "save" with no signal.
    updateDoc(docRef, {
      [`counts.${itemId}`]: {
        caseCount: countData.caseCount ?? 0,
        caseLabel: countData.caseLabel ?? 'Cases',
        wholeCount: countData.wholeCount,
        partCount: countData.partCount,
        quantity: countData.quantity,
        itemName: countData.itemName,
        wholeLabel: countData.wholeLabel,
        partLabel: countData.partLabel,
        countedBy: contributors,
        countedAt: now,
        history
      }
    }).catch(err => console.error('Deferred stock-count write failed:', err));

    return { success: true };
  } catch (error) {
    console.error('Error saving stock count:', error);
    return { success: false, error: error.message };
  }
}

/** Complete a session and write final counted quantities back to stock items. */
export async function completeStockSession(venuePath, sessionId) {
  try {
    const sessionRef = doc(db, `${venuePath}/stockSessions/${sessionId}`);
    const sessionSnap = await getDoc(sessionRef);
    if (!sessionSnap.exists()) {
      return { success: false, error: 'Session not found' };
    }

    const session = sessionSnap.data();
    const batch = writeBatch(db);

    for (const [itemId, countData] of Object.entries(session.counts || {})) {
      const itemRef = doc(db, `${venuePath}/stockItems/${itemId}`);
      batch.update(itemRef, {
        quantity: countData.quantity,
        lastCountedAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      });
    }

    batch.update(sessionRef, { status: 'completed', completedAt: Timestamp.now() });
    await batch.commit();
    return { success: true };
  } catch (error) {
    console.error('Error completing stock session:', error);
    return { success: false, error: error.message };
  }
}

/** Reopen a completed session. */
export async function reopenStockSession(venuePath, sessionId) {
  try {
    await updateDoc(doc(db, `${venuePath}/stockSessions/${sessionId}`), {
      status: 'in_progress',
      completedAt: null
    });
    return { success: true };
  } catch (error) {
    console.error('Error reopening stock session:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Hide (or unhide) a completed session from variance reports. The count and
 * its data are kept — it just stops being a period boundary, so its period
 * merges into the neighbouring one.
 */
export async function setStockSessionVarianceHidden(venuePath, sessionId, hidden) {
  try {
    await updateDoc(doc(db, `${venuePath}/stockSessions/${sessionId}`), {
      hiddenFromVariance: !!hidden,
    });
    return { success: true };
  } catch (error) {
    console.error('Error updating stock session:', error);
    return { success: false, error: error.message };
  }
}

/** Delete/cancel a session. */
export async function deleteStockSession(venuePath, sessionId) {
  try {
    await deleteDoc(doc(db, `${venuePath}/stockSessions/${sessionId}`));
    return { success: true };
  } catch (error) {
    console.error('Error deleting stock session:', error);
    return { success: false, error: error.message };
  }
}

/** Get all sessions for a pub (history). */
export async function getAllStockSessions(venuePath) {
  try {
    const q = query(collection(db, `${venuePath}/stockSessions`), orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    const sessions = [];
    snapshot.forEach((doc) => sessions.push({ id: doc.id, ...doc.data() }));
    return { success: true, data: sessions };
  } catch (error) {
    console.error('Error getting stock sessions:', error);
    return { success: false, error: error.message };
  }
}

/** Subscribe to all sessions for a pub. */
export function subscribeToStockSessions(venuePath, onData, onError) {
  const q = query(collection(db, `${venuePath}/stockSessions`), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const sessions = [];
      snapshot.forEach((doc) => sessions.push({ id: doc.id, ...doc.data() }));
      onData(sessions);
    },
    (error) => {
      console.error('Error in stock sessions listener:', error);
      if (onError) onError(error.message);
    }
  );
}

/**
 * Import a full stock list, replacing all existing stock items for a pub.
 * Batched writes (max 500/batch).
 */
// Shape a parsed stock-list row into the Firestore stock-item document.
function buildStockItemData(item, accountId, venueId) {
  return {
    name: item.name,
    section: item.section,
    category: item.category || '',
    productCode: item.productCode || '',
    costPrice: item.costPrice || 0,
    wholeUnit: item.wholeUnit || '',
    partUnit: item.partUnit || '',
    unit: item.unit || '',
    quantity: 0,
    unitCost: item.costPrice || 0,
    archived: item.archived || false,
    categorySuggested: item.categorySuggested || '',
    accountId,
    venueId,
    updatedAt: Timestamp.now()
  };
}

// Write items in batches without deleting anything first (append).
async function writeStockItems(venuePath, items, onProgress) {
  const { accountId, venueId } = idsFromVenuePath(venuePath);
  let batch = writeBatch(db);
  let batchCount = 0;
  let completed = 0;

  for (const item of items) {
    const docRef = doc(collection(db, `${venuePath}/stockItems`));
    batch.set(docRef, buildStockItemData(item, accountId, venueId));
    batchCount++;
    completed++;
    if (batchCount === 500) {
      await batch.commit();
      batch = writeBatch(db);
      batchCount = 0;
      if (onProgress) onProgress({ completed, total: items.length });
    }
  }

  if (batchCount > 0) {
    await batch.commit();
    if (onProgress) onProgress({ completed, total: items.length });
  }
}

/** Delete every stock item for a venue. Returns the number removed. */
export async function deleteAllStockItems(venuePath) {
  try {
    const colRef = collection(db, `${venuePath}/stockItems`);
    const snapshot = await getDocs(colRef);
    let batch = writeBatch(db);
    let inBatch = 0;
    let count = 0;
    for (const docSnap of snapshot.docs) {
      batch.delete(docSnap.ref);
      inBatch++;
      count++;
      if (inBatch === 500) {
        await batch.commit();
        batch = writeBatch(db);
        inBatch = 0;
      }
    }
    if (inBatch > 0) await batch.commit();
    return { success: true, count };
  } catch (error) {
    console.error('Error deleting stock list:', error);
    return { success: false, error: error.message };
  }
}

/** Apply a merge-patch to many stock items at once (batched). For bulk admin
 *  edits like renaming a category across its items, or moving a section. */
export async function bulkPatchStockItems(venuePath, ids, patch) {
  try {
    let batch = writeBatch(db);
    let inBatch = 0;
    let count = 0;
    for (const id of ids) {
      batch.set(doc(db, `${venuePath}/stockItems/${id}`), { ...patch, updatedAt: Timestamp.now() }, { merge: true });
      inBatch++;
      count++;
      if (inBatch === 500) { await batch.commit(); batch = writeBatch(db); inBatch = 0; }
    }
    if (inBatch > 0) await batch.commit();
    return { success: true, count };
  } catch (error) {
    console.error('Error bulk-patching stock items:', error);
    return { success: false, error: error.message };
  }
}

/** Append items to the existing stock list (no delete). */
export async function addStockItems(venuePath, items, onProgress = null) {
  try {
    await writeStockItems(venuePath, items, onProgress);
    return { success: true, count: items.length };
  } catch (error) {
    console.error('Error adding stock items:', error);
    return { success: false, error: error.message };
  }
}

/** Replace the entire stock list: delete existing items, then write the new set. */
export async function importStockList(venuePath, items, onProgress = null) {
  try {
    const delResult = await deleteAllStockItems(venuePath);
    if (!delResult.success) return delResult;
    await writeStockItems(venuePath, items, onProgress);
    return { success: true, count: items.length };
  } catch (error) {
    console.error('Error importing stock list:', error);
    return { success: false, error: error.message };
  }
}

/** Subscribe to a single stock session. */
export function subscribeToStockSession(venuePath, sessionId, onData, onError) {
  const docRef = doc(db, `${venuePath}/stockSessions/${sessionId}`);
  return onSnapshot(
    docRef,
    (docSnap) => onData(docSnap.exists() ? { id: docSnap.id, ...docSnap.data() } : null),
    (error) => {
      console.error('Error in stock session listener:', error);
      if (onError) onError(error.message);
    }
  );
}

/**
 * Fix stock items that have wholeUnit "Gallon" — these should be kegs.
 * Returns the number of items fixed.
 */
export async function fixGallonStockItems(venuePath) {
  const fixes = {
    'Ale Hobgoblin Cask 9G': { wholeUnit: 'Keg 1*9gall', partUnit: 'Gallon', unit: 'Keg 1*9gall', costPrice: 52.20 },
    'Ale Pedigree 9G Cask': { wholeUnit: 'Keg 1*9gall', partUnit: 'Gallon', unit: 'Keg 1*9gall', costPrice: 52.20 },
    'Cider Strongbow Dark 11G Keg': { wholeUnit: 'Keg 1*11gall', partUnit: 'Gallon', unit: 'Keg 1*11gall', costPrice: 105.71 },
    'Lager Brooklyn 30L DELIST': { wholeUnit: 'Keg 1*30ltr', partUnit: 'Litre', unit: 'Keg 1*30ltr', costPrice: 70.49 },
    'Lager Brooklyn Pilsner IPA 50L': { wholeUnit: 'Keg 1*50ltr', partUnit: 'Litre', unit: 'Keg 1*50ltr', costPrice: 93.06 },
    'Lager Shipyard Pale Ale': { wholeUnit: 'Keg 1*11gall', partUnit: 'Gallon', unit: 'Keg 1*11gall', costPrice: 72.27 },
  };

  try {
    const q = query(collection(db, `${venuePath}/stockItems`), where('wholeUnit', '==', 'Gallon'));
    const snap = await getDocs(q);
    if (snap.empty) return { success: true, fixed: 0, message: 'No Gallon items found' };

    let fixed = 0;
    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      const fix = fixes[data.name];
      if (fix) {
        await updateDoc(docSnap.ref, { ...fix, unitCost: fix.costPrice, updatedAt: Timestamp.now() });
        fixed++;
      }
    }
    return { success: true, fixed, message: `Fixed ${fixed} item(s)` };
  } catch (error) {
    console.error('Error fixing gallon items:', error);
    return { success: false, error: error.message };
  }
}

// ============================================
// WASTAGE  (rolling log under {venuePath}/wastageLog)
// ============================================

/**
 * Log a single wastage event and decrement the item's stock by the wasted amount.
 *
 * Wastage is a rolling log (not a session): each call writes one wastageLog entry
 * and adjusts stockItems/{itemId}.quantity by -quantity. Like saveStockCount, the
 * stock write is offline-first (applies to the local cache immediately, syncs on
 * reconnect) — we use increment() so concurrent edits from other devices merge.
 *
 * @param {Object} data - { itemName, section, units: [{label, count}],
 *   quantity (base units wasted), baseLabel, reason, note, wastedBy }
 */
export async function logWastage(venuePath, itemId, data) {
  try {
    const { accountId, venueId } = idsFromVenuePath(venuePath);
    const now = Timestamp.now();
    const entryRef = doc(collection(db, `${venuePath}/wastageLog`));
    const wasted = Number(data.quantity) || 0;

    await setDoc(entryRef, {
      itemId,
      itemName: data.itemName || '',
      section: data.section || 'bar',
      units: Array.isArray(data.units) ? data.units : [],
      quantity: wasted,
      baseLabel: data.baseLabel || '',
      reason: data.reason || '',
      note: data.note || '',
      wastedBy: data.wastedBy || '',
      wastedAt: now,
      accountId,
      venueId,
    });

    // Decrement stock. Don't await — applies to cache instantly, syncs later.
    if (wasted > 0) {
      updateDoc(doc(db, `${venuePath}/stockItems/${itemId}`), {
        quantity: increment(-wasted),
        updatedAt: now,
      }).catch(err => console.error('Deferred wastage stock decrement failed:', err));
    }

    return { success: true, id: entryRef.id };
  } catch (error) {
    console.error('Error logging wastage:', error);
    return { success: false, error: error.message };
  }
}

/** Live list of recent wastage entries (newest first, capped at `max`). */
export function subscribeToWastageLog(venuePath, onData, onError, max = 100) {
  const q = query(
    collection(db, `${venuePath}/wastageLog`),
    orderBy('wastedAt', 'desc'),
    limit(max)
  );
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    (error) => {
      console.error('Error in wastage listener:', error);
      if (onError) onError(error.message);
    }
  );
}

/** Undo a wastage entry: add its amount back onto the item, then delete the log. */
export async function deleteWastageEntry(venuePath, entryId) {
  try {
    const entryRef = doc(db, `${venuePath}/wastageLog/${entryId}`);
    const snap = await getDoc(entryRef);
    if (!snap.exists()) return { success: false, error: 'Entry not found' };

    const entry = snap.data();
    const wasted = Number(entry.quantity) || 0;
    if (wasted > 0 && entry.itemId) {
      updateDoc(doc(db, `${venuePath}/stockItems/${entry.itemId}`), {
        quantity: increment(wasted),
        updatedAt: Timestamp.now(),
      }).catch(err => console.error('Deferred wastage restore failed:', err));
    }
    await deleteDoc(entryRef);
    return { success: true };
  } catch (error) {
    console.error('Error deleting wastage entry:', error);
    return { success: false, error: error.message };
  }
}

// ============================================
// DELIVERIES  (rolling log under {venuePath}/deliveryLog)
// ============================================

/**
 * Log a delivery/purchase event and add the received amount onto the item's stock.
 *
 * The mirror of logWastage: each call writes one deliveryLog entry and adjusts
 * stockItems/{itemId}.quantity by +quantity. The stock write is offline-first
 * (applies to the local cache immediately, syncs on reconnect) — increment()
 * lets concurrent edits from other devices merge.
 *
 * @param {Object} data - { itemName, section, units: [{label, count}],
 *   quantity (base units received), baseLabel, supplier, cost, note, receivedBy }
 */
export async function logDelivery(venuePath, itemId, data) {
  try {
    const { accountId, venueId } = idsFromVenuePath(venuePath);
    const now = Timestamp.now();
    const entryRef = doc(collection(db, `${venuePath}/deliveryLog`));
    const received = Number(data.quantity) || 0;
    const cost = Number(data.cost);

    await setDoc(entryRef, {
      itemId,
      itemName: data.itemName || '',
      section: data.section || 'bar',
      units: Array.isArray(data.units) ? data.units : [],
      quantity: received,
      baseLabel: data.baseLabel || '',
      supplier: data.supplier || '',
      cost: Number.isFinite(cost) ? cost : null,
      note: data.note || '',
      receivedBy: data.receivedBy || '',
      receivedAt: now,
      accountId,
      venueId,
    });

    // Add to stock. Don't await — applies to cache instantly, syncs later.
    if (received > 0) {
      updateDoc(doc(db, `${venuePath}/stockItems/${itemId}`), {
        quantity: increment(received),
        updatedAt: now,
      }).catch(err => console.error('Deferred delivery stock increment failed:', err));
    }

    return { success: true, id: entryRef.id };
  } catch (error) {
    console.error('Error logging delivery:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Set how many whole units come in a case (0 clears it). Captured during
 * delivery entry; feeds the "Cases (×N)" row in counts and deliveries alike.
 */
export async function setStockItemCasePack(venuePath, itemId, casePack) {
  try {
    await updateDoc(doc(db, `${venuePath}/stockItems/${itemId}`), {
      casePack: Number(casePack) || 0,
      updatedAt: Timestamp.now(),
    });
    return { success: true };
  } catch (error) {
    console.error('Error setting case size:', error);
    return { success: false, error: error.message };
  }
}

/** Set per-item case sizes in one batched write. entries = [{ id, casePack }]. */
export async function bulkSetCasePacks(venuePath, entries) {
  try {
    const now = Timestamp.now();
    let batch = writeBatch(db);
    let inBatch = 0;
    let count = 0;
    for (const { id, casePack } of entries) {
      if (!id) continue;
      batch.set(doc(db, `${venuePath}/stockItems/${id}`), { casePack: Number(casePack) || 0, updatedAt: now }, { merge: true });
      count++;
      if (++inBatch === 500) { await batch.commit(); batch = writeBatch(db); inBatch = 0; }
    }
    if (inBatch > 0) await batch.commit();
    return { success: true, count };
  } catch (error) {
    console.error('Error bulk-setting case sizes:', error);
    return { success: false, error: error.message };
  }
}

/** Live list of recent delivery entries (newest first, capped at `max`). */
export function subscribeToDeliveryLog(venuePath, onData, onError, max = 100) {
  const q = query(
    collection(db, `${venuePath}/deliveryLog`),
    orderBy('receivedAt', 'desc'),
    limit(max)
  );
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    (error) => {
      console.error('Error in delivery listener:', error);
      if (onError) onError(error.message);
    }
  );
}

/** Undo a delivery entry: take its amount back off the item, then delete the log. */
export async function deleteDeliveryEntry(venuePath, entryId) {
  try {
    const entryRef = doc(db, `${venuePath}/deliveryLog/${entryId}`);
    const snap = await getDoc(entryRef);
    if (!snap.exists()) return { success: false, error: 'Entry not found' };

    const entry = snap.data();
    const received = Number(entry.quantity) || 0;
    if (received > 0 && entry.itemId) {
      updateDoc(doc(db, `${venuePath}/stockItems/${entry.itemId}`), {
        quantity: increment(-received),
        updatedAt: Timestamp.now(),
      }).catch(err => console.error('Deferred delivery undo failed:', err));
    }
    await deleteDoc(entryRef);
    return { success: true };
  } catch (error) {
    console.error('Error deleting delivery entry:', error);
    return { success: false, error: error.message };
  }
}

// ============================================
// SALES REPORTS  (till exports under {venuePath}/salesReports, doc id = YYYY-MM-DD)
// ============================================

/**
 * Save a till sales report covering an inclusive trading-date RANGE (a single
 * day or a whole week/fortnight, depending on how the till exports). The doc
 * id encodes the range, so re-uploading the same range replaces it (the UI
 * warns first). Lines are embedded — a few hundred rows ≈ tens of KB, well
 * inside Firestore's 1MB doc limit.
 *
 * @param {Object} report - { fromDate, toDate: 'YYYY-MM-DD', fileName,
 *   source: 'csv', lines: [...], totals: {...}, uploadedBy }
 */
export async function saveSalesReport(venuePath, report) {
  try {
    const { accountId, venueId } = idsFromVenuePath(venuePath);
    const { fromDate, toDate } = report;
    const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
    if (!isDate(fromDate) || !isDate(toDate) || fromDate > toDate) {
      return { success: false, error: 'Invalid report dates' };
    }
    const id = fromDate === toDate ? fromDate : `${fromDate}_${toDate}`;
    await setDoc(doc(db, `${venuePath}/salesReports/${id}`), {
      fromDate,
      toDate,
      reportDate: toDate, // list/query ordering (and legacy readers)
      fileName: report.fileName || '',
      source: report.source || 'csv',
      lines: Array.isArray(report.lines) ? report.lines : [],
      lineCount: Array.isArray(report.lines) ? report.lines.length : 0,
      totals: report.totals || {},
      uploadedBy: report.uploadedBy || '',
      uploadedAt: Timestamp.now(),
      accountId,
      venueId,
    });
    return { success: true, id };
  } catch (error) {
    console.error('Error saving sales report:', error);
    return { success: false, error: error.message };
  }
}

/** Live list of sales reports, newest date first (capped at `max` days). */
export function subscribeToSalesReports(venuePath, onData, onError, max = 62) {
  const q = query(
    collection(db, `${venuePath}/salesReports`),
    orderBy('reportDate', 'desc'),
    limit(max)
  );
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    (error) => {
      console.error('Error in sales reports listener:', error);
      if (onError) onError(error.message);
    }
  );
}

/** Delete a sales report (by its date id). */
export async function deleteSalesReport(venuePath, reportId) {
  try {
    await deleteDoc(doc(db, `${venuePath}/salesReports/${reportId}`));
    return { success: true };
  } catch (error) {
    console.error('Error deleting sales report:', error);
    return { success: false, error: error.message };
  }
}

/** One-shot: delivery entries received in (fromTs, toTs]. */
export async function getDeliveriesBetween(venuePath, fromTs, toTs) {
  try {
    const q = query(
      collection(db, `${venuePath}/deliveryLog`),
      where('receivedAt', '>', fromTs),
      where('receivedAt', '<=', toTs)
    );
    const snap = await getDocs(q);
    return { success: true, data: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
  } catch (error) {
    console.error('Error getting deliveries between:', error);
    return { success: false, error: error.message };
  }
}

/** One-shot: wastage entries logged in (fromTs, toTs]. */
export async function getWastageBetween(venuePath, fromTs, toTs) {
  try {
    const q = query(
      collection(db, `${venuePath}/wastageLog`),
      where('wastedAt', '>', fromTs),
      where('wastedAt', '<=', toTs)
    );
    const snap = await getDocs(q);
    return { success: true, data: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
  } catch (error) {
    console.error('Error getting wastage between:', error);
    return { success: false, error: error.message };
  }
}

/**
 * One-shot: sales reports whose trading-date RANGE overlaps [fromDate, toDate)
 * (ISO strings; report ranges are inclusive, legacy docs have reportDate only).
 * Fetched by recency and filtered client-side so range and legacy docs mix.
 */
export async function getSalesReportsBetween(venuePath, fromDate, toDate) {
  try {
    const q = query(
      collection(db, `${venuePath}/salesReports`),
      orderBy('reportDate', 'desc'),
      limit(400)
    );
    const snap = await getDocs(q);
    const data = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(r => {
        const from = r.fromDate || r.reportDate;
        const to = r.toDate || r.reportDate;
        return from && to && from < toDate && to >= fromDate;
      });
    return { success: true, data };
  } catch (error) {
    console.error('Error getting sales reports between:', error);
    return { success: false, error: error.message };
  }
}

// ============================================
// TILL PRODUCTS  ({venuePath}/tillProducts — till line → stock item mapping)
// ============================================

/** Live map of till-product mappings (doc id = till ProductID or name key). */
export function subscribeToTillProducts(venuePath, onData, onError) {
  return onSnapshot(
    collection(db, `${venuePath}/tillProducts`),
    (snap) => onData(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    (error) => {
      console.error('Error in till products listener:', error);
      if (onError) onError(error.message);
    }
  );
}

/** Save (merge) one till-product mapping. */
export async function saveTillProduct(venuePath, key, data) {
  try {
    const { accountId, venueId } = idsFromVenuePath(venuePath);
    await setDoc(doc(db, `${venuePath}/tillProducts/${key}`), {
      ...data, accountId, venueId, mappedAt: Timestamp.now(),
    }, { merge: true });
    return { success: true };
  } catch (error) {
    console.error('Error saving till product mapping:', error);
    return { success: false, error: error.message };
  }
}

/** Remove a till-product mapping (back to unmapped). */
export async function deleteTillProduct(venuePath, key) {
  try {
    await deleteDoc(doc(db, `${venuePath}/tillProducts/${key}`));
    return { success: true };
  } catch (error) {
    console.error('Error deleting till product mapping:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Set per-item cost prices in one batched write. entries = [{ id, costPrice }].
 * Writes unitCost too — the two fields mirror each other everywhere else.
 */
export async function bulkSetCostPrices(venuePath, entries) {
  try {
    const now = Timestamp.now();
    let batch = writeBatch(db);
    let inBatch = 0;
    let count = 0;
    for (const { id, costPrice } of entries) {
      const n = Number(costPrice);
      if (!id || !Number.isFinite(n) || n <= 0) continue;
      batch.set(doc(db, `${venuePath}/stockItems/${id}`), { costPrice: n, unitCost: n, updatedAt: now }, { merge: true });
      count++;
      if (++inBatch === 500) { await batch.commit(); batch = writeBatch(db); inBatch = 0; }
    }
    if (inBatch > 0) await batch.commit();
    return { success: true, count };
  } catch (error) {
    console.error('Error bulk-setting cost prices:', error);
    return { success: false, error: error.message };
  }
}

/** Save many till-product mappings in one batched write. entries = [{ key, data }]. */
export async function bulkSaveTillProducts(venuePath, entries) {
  try {
    const { accountId, venueId } = idsFromVenuePath(venuePath);
    const now = Timestamp.now();
    let batch = writeBatch(db);
    let inBatch = 0;
    let count = 0;
    for (const { key, data } of entries) {
      if (!key) continue;
      batch.set(doc(db, `${venuePath}/tillProducts/${key}`), { ...data, accountId, venueId, mappedAt: now }, { merge: true });
      count++;
      if (++inBatch === 500) { await batch.commit(); batch = writeBatch(db); inBatch = 0; }
    }
    if (inBatch > 0) await batch.commit();
    return { success: true, count };
  } catch (error) {
    console.error('Error bulk-saving till product mappings:', error);
    return { success: false, error: error.message };
  }
}

// ============================================
// VENUE  (the venue document at {venuePath} → { name })
// ============================================

/** Subscribe to a venue's document (name, etc.) for live updates. */
export function subscribeToVenue(venuePath, onData, onError) {
  return onSnapshot(
    doc(db, venuePath),
    (snap) => onData(snap.exists() ? snap.data() : {}),
    (error) => {
      console.error('Error in venue listener:', error);
      if (onError) onError(error.message);
    }
  );
}

/** Get a venue's document once. */
export async function getVenue(venuePath) {
  try {
    const snap = await getDoc(doc(db, venuePath));
    return { success: true, data: snap.exists() ? snap.data() : {} };
  } catch (error) {
    console.error('Error getting venue:', error);
    return { success: false, error: error.message };
  }
}

/** Save (merge) a venue's document — e.g. { name }. */
export async function saveVenue(venuePath, data) {
  try {
    await setDoc(doc(db, venuePath), { ...data, updatedAt: Timestamp.now() }, { merge: true });
    return { success: true };
  } catch (error) {
    console.error('Error saving venue:', error);
    return { success: false, error: error.message };
  }
}

// ============================================
// ACCOUNT  (the account document at accounts/{accountId})
//   { name, ownerUid, plan, entitlements: { stock, bookings, … } }
// ============================================

/** Subscribe to an account's document for live updates. */
export function subscribeToAccount(accountId, onData, onError) {
  return onSnapshot(
    doc(db, `accounts/${accountId}`),
    (snap) => onData(snap.exists() ? snap.data() : {}),
    (error) => {
      console.error('Error in account listener:', error);
      if (onError) onError(error.message);
    }
  );
}

/** Get an account's document once. */
export async function getAccount(accountId) {
  try {
    const snap = await getDoc(doc(db, `accounts/${accountId}`));
    return { success: true, data: snap.exists() ? snap.data() : {} };
  } catch (error) {
    console.error('Error getting account:', error);
    return { success: false, error: error.message };
  }
}

/** Save (merge) an account's document — e.g. { name } or { entitlements }. */
export async function saveAccount(accountId, data) {
  try {
    await setDoc(doc(db, `accounts/${accountId}`), { ...data, updatedAt: Timestamp.now() }, { merge: true });
    return { success: true };
  } catch (error) {
    console.error('Error saving account:', error);
    return { success: false, error: error.message };
  }
}

// ---- Platform (super-admin) ----

/** Subscribe to ALL accounts (super-admin console). */
export function subscribeToAccounts(onData, onError) {
  const q = query(collection(db, 'accounts'), orderBy('name'));
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (error) => {
      // 'name' may be missing on older docs; fall back to an unordered read.
      if (error?.code === 'failed-precondition') {
        return onSnapshot(collection(db, 'accounts'),
          (s) => onData(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
          (e) => { console.error('Error in accounts listener:', e); if (onError) onError(e.message); });
      }
      console.error('Error in accounts listener:', error);
      if (onError) onError(error.message);
    }
  );
}

/** Venues under an account, once. */
export async function getVenues(accountId) {
  try {
    const snap = await getDocs(collection(db, `accounts/${accountId}/venues`));
    return { success: true, data: snap.docs.map((d) => ({ id: d.id, ...d.data() })) };
  } catch (error) {
    console.error('Error getting venues:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Create a new customer account with its first venue and a single owner member.
 * @returns { success, accountId, venueId }
 */
export async function createAccountWithOwner({ accountName, venueName, ownerName, ownerEmail }) {
  try {
    const now = Timestamp.now();
    const accountRef = doc(collection(db, 'accounts'));
    await setDoc(accountRef, {
      name: (accountName || '').trim() || 'New account',
      entitlements: { stock: true },
      createdAt: now,
      updatedAt: now,
    });

    const venueRef = doc(collection(db, `accounts/${accountRef.id}/venues`));
    await setDoc(venueRef, {
      name: (venueName || '').trim() || 'Main venue',
      createdAt: now,
      updatedAt: now,
    });

    const email = (ownerEmail || '').trim().toLowerCase();
    if (email || ownerName) {
      const memberRef = doc(collection(db, `accounts/${accountRef.id}/members`));
      await setDoc(memberRef, {
        displayName: (ownerName || '').trim() || email,
        email,
        role: 'owner',
        venueAccess: 'all',
        active: true,
        createdAt: now,
        updatedAt: now,
      });
    }

    return { success: true, accountId: accountRef.id, venueId: venueRef.id };
  } catch (error) {
    console.error('Error creating account:', error);
    return { success: false, error: error.message };
  }
}

// ============================================
// MEMBERS  (account-level staff identity + access)
//   accounts/{accountId}/members/{memberId}
//   { displayName, role: 'owner'|'manager'|'staff', venueAccess: [venueId]|'all', active }
// Identity (who a person is) is separate from a venue's operational data; a
// person can work across the account's venues. When auth lands, memberId becomes
// the Firebase Auth uid and `role`/`venueAccess` are mirrored into custom claims.
// ============================================

/** Subscribe to an account's members for live updates. */
export function subscribeToMembers(accountId, onData, onError) {
  const q = query(collection(db, `accounts/${accountId}/members`), orderBy('displayName'));
  return onSnapshot(
    q,
    (snapshot) => {
      const members = [];
      snapshot.forEach((doc) => members.push({ id: doc.id, ...doc.data() }));
      onData(members);
    },
    (error) => {
      console.error('Error in members listener:', error);
      if (onError) onError(error.message);
    }
  );
}

/** Get an account's members once (used for the login authorization check). */
export async function getMembers(accountId) {
  try {
    const snapshot = await getDocs(collection(db, `accounts/${accountId}/members`));
    const members = [];
    snapshot.forEach((doc) => members.push({ id: doc.id, ...doc.data() }));
    return { success: true, data: members };
  } catch (error) {
    console.error('Error getting members:', error);
    return { success: false, error: error.message };
  }
}

/** Create or update a member. Pass memberId=null to create (auto-ID). */
export async function saveMember(accountId, memberId, data) {
  try {
    const docData = { ...data, updatedAt: Timestamp.now() };
    const docRef = memberId
      ? doc(db, `accounts/${accountId}/members/${memberId}`)
      : doc(collection(db, `accounts/${accountId}/members`));
    await setDoc(docRef, docData, { merge: true });
    return { success: true, id: docRef.id };
  } catch (error) {
    console.error('Error saving member:', error);
    return { success: false, error: error.message };
  }
}

/** Delete a member. */
export async function deleteMember(accountId, memberId) {
  try {
    await deleteDoc(doc(db, `accounts/${accountId}/members/${memberId}`));
    return { success: true };
  } catch (error) {
    console.error('Error deleting member:', error);
    return { success: false, error: error.message };
  }
}

// ============================================
// ROTAS  (weekly staff rota, under {venuePath}/rotas/{weekId})
//   weekId = the Monday of the week, ISO 'YYYY-MM-DD'.
//   { weekStart, rows: [{ memberId, name, shifts: { mon..sun: {start,end}|null } }] }
// ============================================

/** Subscribe to a single week's rota. onData receives the doc data, or null if
 *  the week has no rota saved yet. Returns an unsubscribe function. */
export function subscribeToRota(venuePath, weekId, onData, onError) {
  const docRef = doc(db, `${venuePath}/rotas/${weekId}`);
  return onSnapshot(
    docRef,
    (snap) => onData(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    (error) => {
      console.error('Error in rota listener:', error);
      if (onError) onError(error.message);
    }
  );
}

/**
 * Whether any week's rota has been published (sent to staff). Drives whether
 * staff see the Rota tile at all — before the first published rota there's
 * nothing for them to look at.
 */
export async function hasPublishedRota(venuePath) {
  try {
    const q = query(collection(db, `${venuePath}/rotas`), where('published', '==', true), limit(1));
    const snapshot = await getDocs(q);
    return { success: true, data: !snapshot.empty };
  } catch (error) {
    console.error('Error checking published rotas:', error);
    return { success: false, error: error.message };
  }
}

/** Create or overwrite a week's rota. weekId is the Monday's ISO date. */
export async function saveRota(venuePath, weekId, data) {
  try {
    const { accountId, venueId } = idsFromVenuePath(venuePath);
    const docData = { ...data, accountId, venueId, updatedAt: Timestamp.now() };
    await setDoc(doc(db, `${venuePath}/rotas/${weekId}`), docData, { merge: true });
    return { success: true, id: weekId };
  } catch (error) {
    console.error('Error saving rota:', error);
    return { success: false, error: error.message };
  }
}

/** Publish (or unpublish) a week's rota so staff can see it. */
export async function setRotaPublished(venuePath, weekId, published) {
  try {
    const { accountId, venueId } = idsFromVenuePath(venuePath);
    const docData = {
      accountId, venueId, published,
      publishedAt: published ? Timestamp.now() : null,
      updatedAt: Timestamp.now(),
    };
    await setDoc(doc(db, `${venuePath}/rotas/${weekId}`), docData, { merge: true });
    return { success: true };
  } catch (error) {
    console.error('Error publishing rota:', error);
    return { success: false, error: error.message };
  }
}

/** Live shift-pattern usage counts for a venue, as { 'HH:MM-HH:MM': count }.
 *  Used to rank the shift-editor quick-pick pills by how often each is used. */
export function subscribeToShiftPatterns(venuePath, onData, onError) {
  const ref = doc(db, `${venuePath}/rotaPrefs/shiftPatterns`);
  return onSnapshot(
    ref,
    (snap) => onData(snap.exists() ? (snap.data().counts || {}) : {}),
    (error) => {
      console.error('Error in shift patterns listener:', error);
      if (onError) onError(error.message);
    }
  );
}

/** Live custom staff ordering for the rota (array of memberIds). */
export function subscribeToStaffOrder(venuePath, onData, onError) {
  const ref = doc(db, `${venuePath}/rotaPrefs/staffOrder`);
  return onSnapshot(
    ref,
    (snap) => onData(snap.exists() ? (snap.data().order || []) : []),
    (error) => {
      console.error('Error in staff order listener:', error);
      if (onError) onError(error.message);
    }
  );
}

/** Persist the custom staff ordering (array of memberIds). */
export async function saveStaffOrder(venuePath, order) {
  try {
    const { accountId, venueId } = idsFromVenuePath(venuePath);
    const ref = doc(db, `${venuePath}/rotaPrefs/staffOrder`);
    await setDoc(ref, { accountId, venueId, order, updatedAt: Timestamp.now() }, { merge: true });
    return { success: true };
  } catch (error) {
    console.error('Error saving staff order:', error);
    return { success: false, error: error.message };
  }
}

/** Live rota display settings (e.g. { timeFormat: '12h' | '24h' }). */
export function subscribeToRotaSettings(venuePath, onData, onError) {
  const ref = doc(db, `${venuePath}/rotaPrefs/settings`);
  return onSnapshot(
    ref,
    (snap) => onData(snap.exists() ? (snap.data() || {}) : {}),
    (error) => {
      console.error('Error in rota settings listener:', error);
      if (onError) onError(error.message);
    }
  );
}

/** Persist rota display settings (merged, so callers pass only what changed). */
export async function saveRotaSettings(venuePath, patch) {
  try {
    const { accountId, venueId } = idsFromVenuePath(venuePath);
    const ref = doc(db, `${venuePath}/rotaPrefs/settings`);
    await setDoc(ref, { accountId, venueId, ...patch, updatedAt: Timestamp.now() }, { merge: true });
    return { success: true };
  } catch (error) {
    console.error('Error saving rota settings:', error);
    return { success: false, error: error.message };
  }
}

/** Record one use of a start–end shift pattern (increments its counter). */
export async function bumpShiftPattern(venuePath, start, end) {
  try {
    const { accountId, venueId } = idsFromVenuePath(venuePath);
    const key = `${start}-${end}`;
    const ref = doc(db, `${venuePath}/rotaPrefs/shiftPatterns`);
    await setDoc(ref, { accountId, venueId, counts: { [key]: increment(1) }, updatedAt: Timestamp.now() }, { merge: true });
    return { success: true };
  } catch (error) {
    console.error('Error bumping shift pattern:', error);
    return { success: false, error: error.message };
  }
}
