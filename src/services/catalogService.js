/**
 * catalogService — the shared cross-venue product lookup (top-level `catalog`
 * collection, readable by any signed-in user, curated by platform staff).
 *
 * Used when adding new stock: type "Smirnoff" and the known entry pre-fills
 * the category and suggests the size in the unit picker. Entries are seeded
 * from every account's already-categorised stock items, so the lookup gets
 * better as more venues are set up.
 *
 * The whole catalog is a few hundred tiny docs — fetched once per session and
 * matched client-side; no per-keystroke queries.
 */

import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';

/**
 * Normalise a product name for matching — lowercase, straighten curly quotes,
 * drop punctuation, collapse whitespace. Must stay in step with the seed
 * script's nameKey so "Jack Daniel's" finds "jack daniels".
 */
export function productNameKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[^a-z0-9&%.' ]+/g, ' ')
    .replace(/'/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

let catalogPromise = null;

/** Fetch the catalog once per session; later calls reuse the same promise. */
export function loadCatalog() {
  if (!catalogPromise) {
    catalogPromise = getDocs(collection(db, 'catalog'))
      .then((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      .catch((e) => {
        // Lookup is a nicety — never let it break adding stock. Allow a retry
        // on the next call rather than caching the failure for the session.
        catalogPromise = null;
        console.warn('catalog load failed:', e.message);
        return [];
      });
  }
  return catalogPromise;
}

/**
 * Match a typed name against the catalog. Every typed word must prefix-match
 * a word of the entry's nameKey ("cap mor" hits "captain morgan dark"), so
 * word order and missing middles don't matter. Exact key match ranks first,
 * then leading-prefix matches, then word matches; ties break on how many
 * venues agree (sources), then name.
 *
 * @returns {Array} up to `limit` entries, best first
 */
export function matchCatalog(entries, typed, { section, limit = 5 } = {}) {
  const key = productNameKey(typed);
  if (key.length < 2 || !entries?.length) return [];
  const words = key.split(' ');
  const scored = [];
  for (const e of entries) {
    if (section && e.section && e.section !== section) continue;
    const ek = e.nameKey || productNameKey(e.name);
    if (!ek) continue;
    let score;
    if (ek === key) score = 0;
    else if (ek.startsWith(key)) score = 1;
    else {
      const ewords = ek.split(' ');
      if (!words.every((w) => ewords.some((ew) => ew.startsWith(w)))) continue;
      score = 2;
    }
    scored.push({ e, score });
  }
  scored.sort((a, b) =>
    a.score - b.score
    || (b.e.sources || 0) - (a.e.sources || 0)
    || String(a.e.name).localeCompare(String(b.e.name)));
  return scored.slice(0, limit).map((s) => s.e);
}

/**
 * The entry confident enough to act on while typing: an exact name match, or
 * the only entry left matching. Ambiguous prefixes ("gordon" → several gins)
 * return null — those stay tap-to-pick suggestions, never silent fills.
 */
export function bestCatalogMatch(entries, typed, section) {
  const key = productNameKey(typed);
  if (key.length < 2 || !entries?.length) return null;
  const exact = entries.find((e) => (e.nameKey || productNameKey(e.name)) === key && (!section || !e.section || e.section === section));
  if (exact) return exact;
  const m = matchCatalog(entries, typed, { section, limit: 2 });
  return m.length === 1 ? m[0] : null;
}
