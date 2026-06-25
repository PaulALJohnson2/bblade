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
  setDoc,
  getDoc,
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
} from 'firebase/firestore';
import { db } from './config';
import { idsFromVenuePath } from '../config/app';

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
  try {
    const docRef = doc(db, `${venuePath}/stockSessions/${sessionId}`);

    await runTransaction(db, async (transaction) => {
      const docSnap = await transaction.get(docRef);
      if (!docSnap.exists()) {
        throw new Error('Session not found');
      }

      const sessionData = docSnap.data();
      const existing = sessionData.counts?.[itemId];

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
          wholeCount: existing.wholeCount,
          partCount: existing.partCount,
          quantity: existing.quantity,
          countedBy: Array.isArray(existing.countedBy) ? existing.countedBy[0] : (existing.countedBy || ''),
          countedAt: existing.countedAt
        });
      }
      const now = Timestamp.now();
      history.push({
        wholeCount: countData.wholeCount,
        partCount: countData.partCount,
        quantity: countData.quantity,
        countedBy: countData.countedBy || '',
        countedAt: now
      });

      transaction.update(docRef, {
        [`counts.${itemId}`]: {
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
      });
    });

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
