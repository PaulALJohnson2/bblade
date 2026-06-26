/**
 * offline.js — IndexedDB primitives for offline-first stock counting.
 *
 * Firestore gave offline reads + queued writes for free; Amplify Gen 2 does not
 * (DataStore was removed). This module is the storage layer that stockService
 * builds the offline behaviour on:
 *
 *   - `cache`  : last-known-good snapshots of reads (stock items, sessions) so
 *                the counting screen loads with no signal (even after a reload).
 *   - `outbox` : durable queue of stock-count writes made offline, flushed to
 *                AppSync when connectivity returns (survives reload / tab close).
 *
 * Pure storage — no AppSync imports here, so stockService can own the sync logic
 * without a circular dependency.
 */

const DB_NAME = 'bblade-offline';
const DB_VERSION = 1;

let dbPromise;
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache');
      if (!db.objectStoreNames.contains('outbox')) {
        db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

const reqDone = (req) =>
  new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
const txDone = (t) =>
  new Promise((res, rej) => {
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });

// ---- read cache (key -> structured-cloneable value) ----

export async function cacheGet(key) {
  try {
    const db = await openDB();
    return await reqDone(db.transaction('cache').objectStore('cache').get(key));
  } catch {
    return undefined; // no IndexedDB → behave as cache-miss
  }
}

export async function cacheSet(key, value) {
  try {
    const db = await openDB();
    const t = db.transaction('cache', 'readwrite');
    t.objectStore('cache').put(value, key);
    await txDone(t);
  } catch {
    /* best-effort cache; ignore */
  }
}

// ---- outbox (queued offline writes) ----

export async function outboxAdd(entry) {
  const db = await openDB(); // let caller handle failure (so it can fall back to a direct write)
  const t = db.transaction('outbox', 'readwrite');
  t.objectStore('outbox').add(entry);
  await txDone(t);
}

export async function outboxAll() {
  try {
    const db = await openDB();
    return (await reqDone(db.transaction('outbox').objectStore('outbox').getAll())) || [];
  } catch {
    return [];
  }
}

export async function outboxDelete(id) {
  const db = await openDB();
  const t = db.transaction('outbox', 'readwrite');
  t.objectStore('outbox').delete(id);
  await txDone(t);
}

export const isOnline = () =>
  typeof navigator === 'undefined' || navigator.onLine !== false;
