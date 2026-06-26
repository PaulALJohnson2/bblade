/**
 * stockService.js — Stock data access layer (Bar Blade), AWS Amplify edition.
 *
 * Drop-in replacement for the old firebase/firestoreService.js: every exported
 * function keeps the SAME name, arguments and { success, data?/id?, error? }
 * return shape, so apiService.js and all UI components are untouched.
 *
 * The old Firestore path hierarchy is mapped to flat AppSync/DynamoDB models:
 *   accounts/{accountId}                  → Account  (id = accountId)
 *     ├─ members/{memberId}               → Member   (accountId field)
 *     └─ venues/{venueId}                 → Venue    (id = venueId, accountId field)
 *          ├─ stockItems/{itemId}         → StockItem    (venueId field)
 *          └─ stockSessions/{sessionId}   → StockSession (venueId field)
 *
 * Functions still take a VENUE PATH (`accounts/{accountId}/venues/{venueId}`) or
 * an accountId; we extract the ids and query by the indexed field.
 *
 * NOTE ON OFFLINE: Firestore gave offline-first writes for free; Amplify Gen 2
 * does not. These writes are online-first (awaited). The signal-dead-cellar
 * offline queue is a separate follow-up (see saveStockCount).
 *
 * NOTE ON TIMESTAMPS: Firestore stored Timestamp objects; here we store ISO
 * strings (JSON-native). Amplify auto-manages `createdAt`/`updatedAt` on every
 * record. Anything reading `countedAt`/`history[].countedAt` must treat them as
 * ISO strings, not Firestore Timestamps.
 */
import { generateClient } from 'aws-amplify/data';
import { Hub } from 'aws-amplify/utils';
import { idsFromVenuePath } from '../config/app';
import { cacheGet, cacheSet, outboxAdd, outboxAll, outboxDelete, isOnline } from './offline';

// Lazily create the data client so Amplify.configure() (in amplifyConfig.js) is
// guaranteed to have run by the time any function is actually called.
let _client;
const db = () => (_client ??= generateClient());

const now = () => new Date().toISOString();

// `counts` / `entitlements` / `venueAccess` are stored as JSON strings (not the
// AWSJSON a.json() type, which the data client serializes incorrectly for
// populated values — amplify-data #474). Encode on write, decode on read so the
// rest of the app still works with plain objects/arrays.
const encodeJSON = (v) => (v == null ? null : JSON.stringify(v));
const decodeJSON = (v, fallback) => {
  if (v == null) return fallback;
  if (typeof v !== 'string') return v; // defensive: already parsed
  try { return JSON.parse(v); } catch { return v; }
};
const hydrateSession = (s) => (s ? { ...s, counts: decodeJSON(s.counts, {}) } : s);
const hydrateAccount = (a) => (a ? { ...a, entitlements: decodeJSON(a.entitlements, {}) } : a);
const hydrateMember = (m) => (m ? { ...m, venueAccess: decodeJSON(m.venueAccess, undefined) } : m);

// ============================================
// OFFLINE-FIRST COUNTING  (see offline.js)
//
// Firestore queued writes + cached reads for free; Amplify Gen 2 doesn't, so the
// counting path is built here:
//   - reads (items / sessions) cache their last result and fall back to it with
//     no signal, so the count screen loads in a dead cellar;
//   - saveStockCount appends to a durable IndexedDB outbox and returns instantly
//     (fire-and-forget, like the old Firestore write), then syncs when online.
// Starting / completing a session stays online-only (done with signal).
// ============================================

const ck = {
  items: (venueId, section) => `items:${venueId}:${section || 'all'}`,
  sessions: (venueId) => `sessions:${venueId}`,
  session: (sessionId) => `session:${sessionId}`,
};

// Shape a queued count into the session.counts entry shape (for optimistic display).
const countEntryFromQueued = (countData, countedAt) => ({
  wholeCount: countData.wholeCount,
  partCount: countData.partCount,
  quantity: countData.quantity,
  itemName: countData.itemName,
  wholeLabel: countData.wholeLabel,
  partLabel: countData.partLabel,
  countedBy: countData.countedBy ? [countData.countedBy] : [],
  countedAt,
  pending: true, // marks a not-yet-synced count
});

// Overlay any queued (unsynced) counts for a session on top of its server counts.
function overlayOutbox(session, entries) {
  if (!session) return session;
  const mine = entries.filter((e) => e.sessionId === session.id);
  if (!mine.length) return session;
  const counts = { ...(session.counts || {}) };
  for (const e of mine) counts[e.itemId] = countEntryFromQueued(e.countData, e.countedAt);
  return { ...session, counts };
}

// Live subscriptions go quiet offline (observeQuery only emits with a network),
// so session subscribers register a refresher here; saveStockCount calls them
// after queuing a count so the screen reflects it immediately, online or off.
const offlineRefreshers = new Set();
function notifyOfflineRefresh() {
  offlineRefreshers.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
}

// The actual server write for one count: read-merge-write the session's counts
// JSON (used both for online saves and when flushing the offline queue).
async function commitCountToServer(sessionId, itemId, countData, countedAt) {
  const session = unwrap(await db().models.StockSession.get({ id: sessionId }));
  if (!session) throw new Error('Session not found');

  const counts = { ...decodeJSON(session.counts, {}) };
  const existing = counts[itemId];

  let contributors = [];
  if (existing?.countedBy) {
    contributors = Array.isArray(existing.countedBy) ? [...existing.countedBy] : [existing.countedBy];
  }
  if (Array.isArray(existing?.entries)) {
    existing.entries.forEach((e) => {
      if (e.countedBy && !contributors.includes(e.countedBy)) contributors.push(e.countedBy);
    });
  }
  if (countData.countedBy && !contributors.includes(countData.countedBy)) {
    contributors.push(countData.countedBy);
  }

  const history = Array.isArray(existing?.history) ? [...existing.history] : [];
  if (history.length === 0 && existing?.countedAt) {
    history.push({
      wholeCount: existing.wholeCount,
      partCount: existing.partCount,
      quantity: existing.quantity,
      countedBy: Array.isArray(existing.countedBy) ? existing.countedBy[0] : existing.countedBy || '',
      countedAt: existing.countedAt,
    });
  }
  history.push({
    wholeCount: countData.wholeCount,
    partCount: countData.partCount,
    quantity: countData.quantity,
    countedBy: countData.countedBy || '',
    countedAt,
  });

  counts[itemId] = {
    wholeCount: countData.wholeCount,
    partCount: countData.partCount,
    quantity: countData.quantity,
    itemName: countData.itemName,
    wholeLabel: countData.wholeLabel,
    partLabel: countData.partLabel,
    countedBy: contributors,
    countedAt,
    history,
  };

  unwrap(await db().models.StockSession.update({ id: sessionId, counts: encodeJSON(counts) }));
}

let flushing = false;
/** Flush queued offline counts to the server, oldest first. Stops on the first
 *  failure (e.g. still offline / not yet signed in) and retries on the next trigger. */
export async function flushOutbox() {
  if (flushing || !isOnline()) return;
  flushing = true;
  try {
    const entries = await outboxAll(); // FIFO by autoincrement id
    for (const e of entries) {
      try {
        await commitCountToServer(e.sessionId, e.itemId, e.countData, e.countedAt);
        await outboxDelete(e.id);
      } catch (err) {
        console.warn('[offline] flush paused (will retry):', err?.message || err);
        break;
      }
    }
  } finally {
    flushing = false;
  }
}

let offlineInited = false;
/** Wire up automatic flushing: on reconnect, on sign-in, and once at startup. */
export function initOfflineSync() {
  if (offlineInited) return;
  offlineInited = true;
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => { flushOutbox(); });
  }
  Hub.listen('auth', ({ payload }) => {
    if (payload.event === 'signedIn' || payload.event === 'tokenRefresh') flushOutbox();
  });
  flushOutbox(); // catch anything queued from a previous session
}

/** Flatten an Amplify { data, errors } result; throw on errors. */
function unwrap({ data, errors }) {
  if (errors && errors.length) {
    throw new Error(errors.map((e) => e.message).join('; '));
  }
  return data;
}

/** List every page of a model query (Amplify paginates, default 100/page). */
async function listAll(model, options = {}) {
  const all = [];
  let nextToken = null;
  do {
    const res = await model.list({ ...options, nextToken, limit: 1000 });
    if (res.errors && res.errors.length) {
      throw new Error(res.errors.map((e) => e.message).join('; '));
    }
    all.push(...(res.data || []));
    nextToken = res.nextToken;
  } while (nextToken);
  return all;
}

/** Run async work over items in small concurrent chunks (no batch API in AppSync). */
async function inChunks(items, size, fn, onChunk) {
  let done = 0;
  for (let i = 0; i < items.length; i += size) {
    const chunk = items.slice(i, i + size);
    await Promise.all(chunk.map(fn));
    done += chunk.length;
    if (onChunk) onChunk(done);
  }
}

const bySectionThenName = (a, b) =>
  (a.section || '').localeCompare(b.section || '') || (a.name || '').localeCompare(b.name || '');
const byName = (a, b) => (a.name || '').localeCompare(b.name || '');
const byCreatedDesc = (a, b) => (b.createdAt || '').localeCompare(a.createdAt || '');

// ============================================
// STOCK ITEMS
// ============================================

/** Get all stock items for a venue. Optionally filter by section. */
export async function getAllStockItems(venuePath, section = null) {
  try {
    const { venueId } = idsFromVenuePath(venuePath);
    const filter = section
      ? { and: [{ venueId: { eq: venueId } }, { section: { eq: section } }] }
      : { venueId: { eq: venueId } };
    const items = await listAll(db().models.StockItem, { filter });
    items.sort(section ? byName : bySectionThenName);
    return { success: true, data: items };
  } catch (error) {
    console.error('Error getting stock items:', error);
    return { success: false, error: error.message };
  }
}

/** Get a single stock item by ID. */
export async function getStockItemById(venuePath, itemId) {
  try {
    const data = unwrap(await db().models.StockItem.get({ id: itemId }));
    return { success: true, data: data || null };
  } catch (error) {
    console.error('Error getting stock item:', error);
    return { success: false, error: error.message };
  }
}

/** Save or update a stock item. itemId=null creates a new one. */
export async function saveOrUpdateStockItem(venuePath, itemId, data) {
  try {
    const { accountId, venueId } = idsFromVenuePath(venuePath);
    let result;
    if (itemId) {
      result = await db().models.StockItem.update({ ...data, id: itemId, accountId, venueId });
    } else {
      result = await db().models.StockItem.create({ ...data, accountId, venueId });
    }
    const saved = unwrap(result);
    return { success: true, id: saved.id };
  } catch (error) {
    console.error('Error saving stock item:', error);
    return { success: false, error: error.message };
  }
}

/** Delete a stock item. */
export async function deleteStockItem(venuePath, itemId) {
  try {
    unwrap(await db().models.StockItem.delete({ id: itemId }));
    return { success: true };
  } catch (error) {
    console.error('Error deleting stock item:', error);
    return { success: false, error: error.message };
  }
}

/** Subscribe to stock items for real-time updates. Optionally filter by section. */
export function subscribeToStockItems(venuePath, onData, onError, section = null) {
  const { venueId } = idsFromVenuePath(venuePath);
  const key = ck.items(venueId, section);
  const filter = section
    ? { and: [{ venueId: { eq: venueId } }, { section: { eq: section } }] }
    : { venueId: { eq: venueId } };
  let gotLive = false;
  // Serve cached items first so the screen loads instantly / with no signal.
  cacheGet(key).then((cached) => { if (cached && !gotLive) onData(cached); }).catch(() => {});
  const sub = db().models.StockItem.observeQuery({ filter }).subscribe({
    next: ({ items }) => {
      gotLive = true;
      const sorted = [...items].sort(section ? byName : bySectionThenName);
      cacheSet(key, sorted).catch(() => {});
      onData(sorted);
    },
    error: (error) => {
      console.error('Error in stock items listener:', error);
      cacheGet(key)
        .then((cached) => {
          if (cached) onData(cached);
          else if (onError) onError(error.message || String(error));
        })
        .catch(() => { if (onError) onError(error.message || String(error)); });
    },
  });
  return () => sub.unsubscribe();
}

// ============================================
// STOCK SESSIONS
// ============================================

/** Create a new stock session. Returns its ID. */
export async function createStockSession(venuePath, userId, userName, section) {
  try {
    const { accountId, venueId } = idsFromVenuePath(venuePath);
    const created = unwrap(
      await db().models.StockSession.create({
        accountId,
        venueId,
        createdBy: userId,
        createdByName: userName || 'Unknown',
        status: 'in_progress',
        section: section || 'bar',
        counts: encodeJSON({}),
      })
    );
    return { success: true, sessionId: created.id };
  } catch (error) {
    console.error('Error creating stock session:', error);
    return { success: false, error: error.message };
  }
}

/** Get the most recent in-progress session for a venue, or null. */
export async function getCurrentStockSession(venuePath) {
  try {
    const { venueId } = idsFromVenuePath(venuePath);
    const sessions = await listAll(db().models.StockSession, {
      filter: { and: [{ venueId: { eq: venueId } }, { status: { eq: 'in_progress' } }] },
    });
    if (!sessions.length) return { success: true, data: null };
    sessions.sort(byCreatedDesc);
    return { success: true, data: hydrateSession(sessions[0]) };
  } catch (error) {
    console.error('Error getting current stock session:', error);
    return { success: false, error: error.message };
  }
}

/** Get a stock session by ID. */
export async function getStockSession(venuePath, sessionId) {
  try {
    const data = unwrap(await db().models.StockSession.get({ id: sessionId }));
    return { success: true, data: hydrateSession(data) || null };
  } catch (error) {
    console.error('Error getting stock session:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Save a count to a stock session — OFFLINE-FIRST.
 *
 * Appends the count to a durable IndexedDB outbox and returns success
 * immediately (like the old fire-and-forget Firestore write, so the counter
 * never blocks in a dead-signal cellar), optimistically updates the cached
 * session so a reload still shows it, then triggers a sync. The real
 * read-merge-write happens in commitCountToServer when the queue flushes.
 *
 * Conflict model (unchanged): different items never conflict; the same item
 * across two offline devices is last-write-wins on sync.
 */
export async function saveStockCount(venuePath, sessionId, itemId, countData) {
  const countedAt = now();
  try {
    await outboxAdd({ venuePath, sessionId, itemId, countData, countedAt });
  } catch (err) {
    // IndexedDB unavailable — fall back to a direct online write.
    try {
      await commitCountToServer(sessionId, itemId, countData, countedAt);
      return { success: true };
    } catch (e) {
      console.error('Error saving stock count:', e);
      return { success: false, error: e.message };
    }
  }

  // Optimistically reflect the count in the cached session (survives reload).
  try {
    const cached = await cacheGet(ck.session(sessionId));
    if (cached) {
      const counts = { ...(cached.counts || {}) };
      counts[itemId] = countEntryFromQueued(countData, countedAt);
      await cacheSet(ck.session(sessionId), { ...cached, counts });
    }
  } catch { /* best-effort */ }

  notifyOfflineRefresh(); // update any open session views right away
  flushOutbox(); // fire-and-forget; syncs now if online, later when reconnected
  return { success: true };
}

/** Complete a session and write final counted quantities back to stock items. */
export async function completeStockSession(venuePath, sessionId) {
  try {
    await flushOutbox(); // ensure any offline-queued counts are committed first
    const session = unwrap(await db().models.StockSession.get({ id: sessionId }));
    if (!session) return { success: false, error: 'Session not found' };

    const entries = Object.entries(decodeJSON(session.counts, {}));
    await inChunks(entries, 20, ([itemId, countData]) =>
      db().models.StockItem.update({
        id: itemId,
        quantity: countData.quantity,
        lastCountedAt: now(),
      })
    );

    unwrap(await db().models.StockSession.update({ id: sessionId, status: 'completed', completedAt: now() }));
    return { success: true };
  } catch (error) {
    console.error('Error completing stock session:', error);
    return { success: false, error: error.message };
  }
}

/** Reopen a completed session. */
export async function reopenStockSession(venuePath, sessionId) {
  try {
    unwrap(await db().models.StockSession.update({ id: sessionId, status: 'in_progress', completedAt: null }));
    return { success: true };
  } catch (error) {
    console.error('Error reopening stock session:', error);
    return { success: false, error: error.message };
  }
}

/** Delete/cancel a session. */
export async function deleteStockSession(venuePath, sessionId) {
  try {
    unwrap(await db().models.StockSession.delete({ id: sessionId }));
    return { success: true };
  } catch (error) {
    console.error('Error deleting stock session:', error);
    return { success: false, error: error.message };
  }
}

/** Get all sessions for a venue (history). */
export async function getAllStockSessions(venuePath) {
  try {
    const { venueId } = idsFromVenuePath(venuePath);
    const sessions = await listAll(db().models.StockSession, { filter: { venueId: { eq: venueId } } });
    sessions.sort(byCreatedDesc);
    return { success: true, data: sessions.map(hydrateSession) };
  } catch (error) {
    console.error('Error getting stock sessions:', error);
    return { success: false, error: error.message };
  }
}

/** Subscribe to all sessions for a venue. */
export function subscribeToStockSessions(venuePath, onData, onError) {
  const { venueId } = idsFromVenuePath(venuePath);
  const key = ck.sessions(venueId);
  let gotLive = false;
  const refresh = async () => {
    const cached = await cacheGet(key);
    if (cached) {
      const entries = await outboxAll();
      onData(cached.map((s) => overlayOutbox(s, entries)));
    }
  };
  offlineRefreshers.add(refresh);
  cacheGet(key)
    .then(async (cached) => {
      if (cached && !gotLive) {
        const entries = await outboxAll();
        onData(cached.map((s) => overlayOutbox(s, entries)));
      }
    })
    .catch(() => {});
  const sub = db().models.StockSession.observeQuery({ filter: { venueId: { eq: venueId } } }).subscribe({
    next: async ({ items }) => {
      gotLive = true;
      const sorted = [...items].sort(byCreatedDesc).map(hydrateSession);
      cacheSet(key, sorted).catch(() => {}); // cache server truth (pre-overlay)
      const entries = await outboxAll();
      onData(sorted.map((s) => overlayOutbox(s, entries)));
    },
    error: (error) => {
      console.error('Error in stock sessions listener:', error);
      cacheGet(key)
        .then(async (cached) => {
          if (cached) {
            const entries = await outboxAll();
            onData(cached.map((s) => overlayOutbox(s, entries)));
          } else if (onError) onError(error.message || String(error));
        })
        .catch(() => { if (onError) onError(error.message || String(error)); });
    },
  });
  return () => { offlineRefreshers.delete(refresh); sub.unsubscribe(); };
}

/** Subscribe to a single stock session. */
export function subscribeToStockSession(venuePath, sessionId, onData, onError) {
  const key = ck.session(sessionId);
  let gotLive = false;
  const refresh = async () => {
    const cached = await cacheGet(key);
    if (cached) {
      const entries = await outboxAll();
      onData(overlayOutbox(cached, entries) || null);
    }
  };
  offlineRefreshers.add(refresh);
  cacheGet(key)
    .then(async (cached) => {
      if (cached && !gotLive) {
        const entries = await outboxAll();
        onData(overlayOutbox(cached, entries) || null);
      }
    })
    .catch(() => {});
  const sub = db().models.StockSession.observeQuery({ filter: { id: { eq: sessionId } } }).subscribe({
    next: async ({ items }) => {
      gotLive = true;
      const s = hydrateSession(items[0]) || null;
      if (s) cacheSet(key, s).catch(() => {}); // cache server truth (pre-overlay)
      const entries = await outboxAll();
      onData(s ? overlayOutbox(s, entries) : null);
    },
    error: (error) => {
      console.error('Error in stock session listener:', error);
      cacheGet(key)
        .then(async (cached) => {
          if (cached) {
            const entries = await outboxAll();
            onData(overlayOutbox(cached, entries));
          } else if (onError) onError(error.message || String(error));
        })
        .catch(() => { if (onError) onError(error.message || String(error)); });
    },
  });
  return () => { offlineRefreshers.delete(refresh); sub.unsubscribe(); };
}

// ============================================
// STOCK IMPORT
// ============================================

// Shape a parsed stock-list row into a StockItem record.
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
  };
}

// Create items in concurrent chunks (AppSync has no batch write).
async function writeStockItems(venuePath, items, onProgress) {
  const { accountId, venueId } = idsFromVenuePath(venuePath);
  await inChunks(
    items,
    20,
    (item) => db().models.StockItem.create(buildStockItemData(item, accountId, venueId)),
    (completed) => {
      if (onProgress) onProgress({ completed, total: items.length });
    }
  );
}

/** Delete every stock item for a venue. Returns the number removed. */
export async function deleteAllStockItems(venuePath) {
  try {
    const { venueId } = idsFromVenuePath(venuePath);
    const items = await listAll(db().models.StockItem, { filter: { venueId: { eq: venueId } } });
    await inChunks(items, 20, (it) => db().models.StockItem.delete({ id: it.id }));
    return { success: true, count: items.length };
  } catch (error) {
    console.error('Error deleting stock list:', error);
    return { success: false, error: error.message };
  }
}

/** Apply a merge-patch to many stock items at once. */
export async function bulkPatchStockItems(venuePath, ids, patch) {
  try {
    await inChunks(ids, 20, (id) => db().models.StockItem.update({ ...patch, id }));
    return { success: true, count: ids.length };
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

/** Fix stock items that have wholeUnit "Gallon" — these should be kegs. */
export async function fixGallonStockItems(venuePath) {
  const fixes = {
    'Ale Hobgoblin Cask 9G': { wholeUnit: 'Keg 1*9gall', partUnit: 'Gallon', unit: 'Keg 1*9gall', costPrice: 52.2 },
    'Ale Pedigree 9G Cask': { wholeUnit: 'Keg 1*9gall', partUnit: 'Gallon', unit: 'Keg 1*9gall', costPrice: 52.2 },
    'Cider Strongbow Dark 11G Keg': { wholeUnit: 'Keg 1*11gall', partUnit: 'Gallon', unit: 'Keg 1*11gall', costPrice: 105.71 },
    'Lager Brooklyn 30L DELIST': { wholeUnit: 'Keg 1*30ltr', partUnit: 'Litre', unit: 'Keg 1*30ltr', costPrice: 70.49 },
    'Lager Brooklyn Pilsner IPA 50L': { wholeUnit: 'Keg 1*50ltr', partUnit: 'Litre', unit: 'Keg 1*50ltr', costPrice: 93.06 },
    'Lager Shipyard Pale Ale': { wholeUnit: 'Keg 1*11gall', partUnit: 'Gallon', unit: 'Keg 1*11gall', costPrice: 72.27 },
  };

  try {
    const { venueId } = idsFromVenuePath(venuePath);
    const items = await listAll(db().models.StockItem, {
      filter: { and: [{ venueId: { eq: venueId } }, { wholeUnit: { eq: 'Gallon' } }] },
    });
    if (!items.length) return { success: true, fixed: 0, message: 'No Gallon items found' };

    const toFix = items.filter((it) => fixes[it.name]);
    await inChunks(toFix, 20, (it) => {
      const fix = fixes[it.name];
      return db().models.StockItem.update({ id: it.id, ...fix, unitCost: fix.costPrice });
    });
    return { success: true, fixed: toFix.length, message: `Fixed ${toFix.length} item(s)` };
  } catch (error) {
    console.error('Error fixing gallon items:', error);
    return { success: false, error: error.message };
  }
}

// ============================================
// VENUE  (Venue record, id = venueId → { name })
// ============================================

/** Subscribe to a venue's record (name, etc.) for live updates. */
export function subscribeToVenue(venuePath, onData, onError) {
  const { venueId } = idsFromVenuePath(venuePath);
  const sub = db().models.Venue.observeQuery({ filter: { id: { eq: venueId } } }).subscribe({
    next: ({ items }) => onData(items[0] || {}),
    error: (error) => {
      console.error('Error in venue listener:', error);
      if (onError) onError(error.message || String(error));
    },
  });
  return () => sub.unsubscribe();
}

/** Get a venue's record once. */
export async function getVenue(venuePath) {
  try {
    const { venueId } = idsFromVenuePath(venuePath);
    const data = unwrap(await db().models.Venue.get({ id: venueId }));
    return { success: true, data: data || {} };
  } catch (error) {
    console.error('Error getting venue:', error);
    return { success: false, error: error.message };
  }
}

/** Save (upsert) a venue's record — e.g. { name }. */
export async function saveVenue(venuePath, data) {
  try {
    const { accountId, venueId } = idsFromVenuePath(venuePath);
    const existing = unwrap(await db().models.Venue.get({ id: venueId }));
    if (existing) {
      unwrap(await db().models.Venue.update({ ...data, id: venueId }));
    } else {
      unwrap(await db().models.Venue.create({ ...data, id: venueId, accountId }));
    }
    return { success: true };
  } catch (error) {
    console.error('Error saving venue:', error);
    return { success: false, error: error.message };
  }
}

// ============================================
// ACCOUNT  (Account record, id = accountId)
// ============================================

/** Subscribe to an account's record for live updates. */
export function subscribeToAccount(accountId, onData, onError) {
  const sub = db().models.Account.observeQuery({ filter: { id: { eq: accountId } } }).subscribe({
    next: ({ items }) => onData(hydrateAccount(items[0]) || {}),
    error: (error) => {
      console.error('Error in account listener:', error);
      if (onError) onError(error.message || String(error));
    },
  });
  return () => sub.unsubscribe();
}

/** Get an account's record once. */
export async function getAccount(accountId) {
  try {
    const data = unwrap(await db().models.Account.get({ id: accountId }));
    return { success: true, data: hydrateAccount(data) || {} };
  } catch (error) {
    console.error('Error getting account:', error);
    return { success: false, error: error.message };
  }
}

/** Save (upsert) an account's record — e.g. { name } or { entitlements }. */
export async function saveAccount(accountId, data) {
  try {
    const payload = 'entitlements' in data ? { ...data, entitlements: encodeJSON(data.entitlements) } : data;
    const existing = unwrap(await db().models.Account.get({ id: accountId }));
    if (existing) {
      unwrap(await db().models.Account.update({ ...payload, id: accountId }));
    } else {
      unwrap(await db().models.Account.create({ ...payload, id: accountId }));
    }
    return { success: true };
  } catch (error) {
    console.error('Error saving account:', error);
    return { success: false, error: error.message };
  }
}

// ============================================
// MEMBERS  (account-level staff identity + access)
// ============================================

/** Subscribe to an account's members for live updates. */
export function subscribeToMembers(accountId, onData, onError) {
  const sub = db().models.Member.observeQuery({ filter: { accountId: { eq: accountId } } }).subscribe({
    next: ({ items }) =>
      onData(
        [...items]
          .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''))
          .map(hydrateMember)
      ),
    error: (error) => {
      console.error('Error in members listener:', error);
      if (onError) onError(error.message || String(error));
    },
  });
  return () => sub.unsubscribe();
}

/** Get an account's members once (used for the login authorization check). */
export async function getMembers(accountId) {
  try {
    const members = await listAll(db().models.Member, { filter: { accountId: { eq: accountId } } });
    return { success: true, data: members.map(hydrateMember) };
  } catch (error) {
    console.error('Error getting members:', error);
    return { success: false, error: error.message };
  }
}

/** Create or update a member. Pass memberId=null to create. */
export async function saveMember(accountId, memberId, data) {
  try {
    const payload = 'venueAccess' in data ? { ...data, venueAccess: encodeJSON(data.venueAccess) } : data;
    let result;
    if (memberId) {
      result = await db().models.Member.update({ ...payload, id: memberId, accountId });
    } else {
      result = await db().models.Member.create({ ...payload, accountId });
    }
    const saved = unwrap(result);
    return { success: true, id: saved.id };
  } catch (error) {
    console.error('Error saving member:', error);
    return { success: false, error: error.message };
  }
}

/** Delete a member. */
export async function deleteMember(accountId, memberId) {
  try {
    unwrap(await db().models.Member.delete({ id: memberId }));
    return { success: true };
  } catch (error) {
    console.error('Error deleting member:', error);
    return { success: false, error: error.message };
  }
}
