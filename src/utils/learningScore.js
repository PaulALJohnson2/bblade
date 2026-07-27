/**
 * learningScore — what the venue has taught the system, and who taught it.
 *
 * THE CENTRAL DESIGN DECISION: a score is the sum of the learned FACTS that
 * currently carry someone's name — not a tally of actions they performed.
 * Attribution rides on the artefact, and everything here is a pure function of
 * current state. Two properties follow, and both matter once money is attached
 * to the number:
 *
 *   Farming stops working. Facts are keyed and deduplicated by the artefact
 *   they come from, so re-scanning the same note creates nothing new and earns
 *   nothing. The dedupe that exists for correctness is the anti-gaming
 *   mechanism.
 *
 *   Wrong answers self-heal. Correct someone's mapping and the artefact now
 *   carries your name; the score follows automatically, with no clawback,
 *   because it reads current state rather than a log of events.
 *
 * REWARD INFORMATION, NOT ACTIVITY. Value is set by how much the system
 * learned, so diminishing returns are deliberate: the fiftieth Tradeteam note
 * teaches nothing new and earns almost nothing. Without that the number
 * becomes an activity meter and stops meaning anything.
 *
 * WHAT DELIBERATELY SCORES NOTHING:
 *   - Wastage. Paying for wastage entries pays people to create them, and a
 *     fake wastage entry is exactly how stock loss gets covered up. Nothing
 *     that could mask theft is ever worth points.
 *   - Products nobody can corroborate. A stock item only counts once a
 *     delivery note, a mapping or a count vouches for it — otherwise a
 *     hundred invented items is a hundred times fifteen points.
 *   - Correcting your own entry. Mis-match deliberately, "correct" it, collect
 *     the bonus. Only a correction that changes the target AND replaces
 *     somebody else's answer earns the difference.
 */

const millis = (t) => (t?.toMillis ? t.toMillis() : (t instanceof Date ? t.getTime() : (typeof t === 'number' ? t : 0)));

/**
 * Points per fact, by information value rather than effort. One place to tune.
 */
export const FACT_VALUES = {
  correction: 12,     // a human overruling the machine — the richest signal there is
  newSupplier: 25,    // a whole profile from nothing
  productAdded: 15,   // a hole in the stock list nobody knew was there
  packFact: 6,        // permanent; applies to every future delivery
  supplierCode: 4,    // one line that will match instantly forever
  noteLogged: 3,      // the delivery data itself, even when nothing new is learned
  stockTake: 20,      // unlocks a whole usage period
  itemCounted: 1,     // per item, so a shared count splits fairly
};

export const FACT_LABELS = {
  correction: 'Corrected a match',
  newSupplier: 'First note from a new supplier',
  productAdded: 'Added a product you were buying blind',
  packFact: 'Captured a case size',
  supplierCode: 'Taught a supplier code',
  noteLogged: 'Logged a delivery note',
  stockTake: 'Completed a stock take',
  itemCounted: 'Counted an item',
};

/** Rough keying time per line saved by reading a document instead of typing it. */
const SECONDS_SAVED_PER_LINE = 25;

/**
 * Items a document, a mapping or a count vouches for. Anything else was
 * asserted by one person with nothing behind it, and can't be worth points.
 */
function corroboratedItems({ notes, supplierProducts, sessions }) {
  const ok = new Set();
  for (const n of notes || []) {
    for (const l of n.lines || []) if (l.itemId) ok.add(l.itemId);
  }
  for (const p of supplierProducts || []) if (p.itemId) ok.add(p.itemId);
  for (const s of sessions || []) {
    if (s.status !== 'completed') continue;
    for (const id of Object.keys(s.counts || {})) ok.add(id);
  }
  return ok;
}

/**
 * Every learned fact in the venue's current state.
 *
 * @param {Object} state - { items, supplierProducts, notes, sessions }
 * @returns {Array} { key, kind, value, owner, earnedAt, label, detail }
 */
export function learningFacts(state) {
  const { items = [], supplierProducts = [], notes = [], sessions = [] } = state || {};
  const facts = [];
  const vouched = corroboratedItems(state);
  const itemName = (id) => items.find((i) => i.id === id)?.name || '';

  // ---- learned supplier mappings ----
  for (const p of supplierProducts) {
    if (!p.id || !p.itemId) continue;
    const owner = p.firstConfirmedBy || p.confirmedBy || '';
    facts.push({
      key: `code:${p.id}`,
      kind: 'supplierCode',
      value: FACT_VALUES.supplierCode,
      owner,
      earnedAt: millis(p.firstSeenAt || p.lastSeenAt),
      detail: `${p.itemCode || p.description} → ${p.itemName || itemName(p.itemId)}`,
    });
    // The correction bonus goes to whoever overruled somebody else's answer.
    // A mapping "corrected" by the person who made it is just an edit.
    if (p.corrected && p.previousOwner && p.previousOwner !== p.confirmedBy) {
      facts.push({
        key: `fix:${p.id}`,
        kind: 'correction',
        value: FACT_VALUES.correction - FACT_VALUES.supplierCode,
        owner: p.confirmedBy || '',
        earnedAt: millis(p.lastSeenAt),
        detail: `${p.itemCode || p.description} → ${p.itemName || itemName(p.itemId)}`,
      });
    }
  }

  // ---- delivery notes: the document, and a supplier seen for the first time ----
  const supplierFirst = new Map();
  for (const n of notes) {
    const key = String(n.supplier || '').trim().toLowerCase() || 'unknown';
    const at = millis(n.uploadedAt);
    const seen = supplierFirst.get(key);
    if (!seen || at < seen.at) supplierFirst.set(key, { at, note: n });
  }
  for (const [key, { at, note }] of supplierFirst) {
    facts.push({
      key: `supplier:${key}`,
      kind: 'newSupplier',
      value: FACT_VALUES.newSupplier,
      owner: note.uploadedBy || '',
      earnedAt: at,
      detail: note.supplier || 'Unknown supplier',
    });
  }
  for (const n of notes) {
    // Keyed on the document's own reference so the same paper scanned twice
    // is one fact, not two.
    const ref = String(n.reference || '').trim()
      || `${String(n.supplier || '').toLowerCase()}:${n.deliveryDate || millis(n.uploadedAt)}`;
    facts.push({
      key: `note:${ref}`,
      kind: 'noteLogged',
      value: FACT_VALUES.noteLogged,
      owner: n.uploadedBy || '',
      earnedAt: millis(n.uploadedAt),
      detail: `${n.supplier || 'Delivery note'}${n.reference ? ` · ${n.reference}` : ''}`,
    });
  }

  // ---- stock items: products discovered, and pack facts ----
  for (const i of items) {
    if (i.createdBy && vouched.has(i.id)) {
      facts.push({
        key: `item:${i.id}`,
        kind: 'productAdded',
        value: FACT_VALUES.productAdded,
        owner: i.createdBy,
        earnedAt: millis(i.createdAt),
        detail: i.name,
      });
    }
    if (i.casePackSetBy && Number(i.casePack) > 0 && vouched.has(i.id)) {
      facts.push({
        key: `pack:${i.id}`,
        kind: 'packFact',
        value: FACT_VALUES.packFact,
        owner: i.casePackSetBy,
        earnedAt: millis(i.casePackSetAt),
        detail: `${i.name} · case of ${i.casePack}`,
      });
    }
  }

  // ---- stock takes: the count, and each item counted ----
  for (const s of sessions) {
    if (s.status !== 'completed') continue;
    const at = millis(s.completedAt);
    facts.push({
      key: `take:${s.id}`,
      kind: 'stockTake',
      value: FACT_VALUES.stockTake,
      owner: s.completedBy || s.createdByName || '',
      earnedAt: at,
      detail: `Stock take · ${Object.keys(s.counts || {}).length} items`,
    });
    // Per item, from each count's own countedBy — a stock take is usually
    // several people and whoever pressed Complete shouldn't collect for all.
    for (const [itemId, c] of Object.entries(s.counts || {})) {
      const by = Array.isArray(c?.countedBy) ? c.countedBy[0] : c?.countedBy;
      if (!by) continue;
      facts.push({
        key: `count:${s.id}:${itemId}`,
        kind: 'itemCounted',
        value: FACT_VALUES.itemCounted,
        owner: by,
        earnedAt: millis(c?.countedAt) || at,
        detail: c?.itemName || itemName(itemId),
      });
    }
  }

  // Belt and braces: the artefacts are already deduplicated, but a key clash
  // must never double-count.
  const seen = new Set();
  return facts.filter((f) => {
    if (!f.key || seen.has(f.key)) return false;
    seen.add(f.key);
    f.label = FACT_LABELS[f.kind] || f.kind;
    return true;
  });
}

// ---------------------------------------------------------------------------
//  Levels — each one a real capability turning on, not a cosmetic tier
// ---------------------------------------------------------------------------

export const LEVELS = [
  {
    key: 'stocked', name: 'Stocked', target: 1,
    unlocks: 'Every line on a note lands on a real stock item',
    hint: 'Scan a delivery note and give every line a stock item',
    have: (s) => s.fullyMatchedNotes,
  },
  {
    key: 'recognised', name: 'Recognised', target: 10,
    unlocks: 'Supplier codes match instantly, no guessing',
    hint: 'Confirm matches on a few more notes',
    have: (s) => s.codes,
  },
  {
    key: 'estimated', name: 'Estimated', target: 4,
    unlocks: 'Usage rates from your delivery pattern',
    hint: 'Scan a few more notes from the same supplier',
    have: (s) => s.mostNotesFromOneSupplier,
  },
  {
    key: 'measured', name: 'Measured', target: 2,
    unlocks: 'True usage measured between counts',
    hint: 'Complete a second stock take',
    have: (s) => s.completedTakes,
  },
  {
    key: 'predicted', name: 'Predicted', target: 1,
    unlocks: 'Par levels and an order sheet',
    hint: 'Keep counts recent — a count in the last fortnight anchors the forecast',
    have: (s) => s.recentCount,
  },
  // The goal gradient is tied to an OPEN goal: pace collapses the moment the
  // last one is claimed (Kivetz et al.). A terminal top level would kill the
  // pull at exactly the point the venue is most valuable, so the final gate is
  // a maintenance one that reopens whenever the venue drifts — earned by
  // keeping every supplier's paperwork current rather than by a new milestone.
  {
    key: 'current', name: 'Current', target: 1,
    unlocks: 'Forecasts stay trustworthy',
    hint: 'Scan each supplier’s notes as they arrive and keep counts recent',
    have: (s) => s.suppliersCurrent,
  },
];

const RECENT_COUNT_DAYS = 14;
/** A supplier whose paperwork hasn't been seen this long has gone stale. */
const STALE_SUPPLIER_DAYS = 45;

/** The raw counts the level gates read. */
function levelInputs({ items, supplierProducts, notes, sessions }, now) {
  const perSupplier = new Map();
  let fullyMatched = 0;
  for (const n of notes || []) {
    const key = String(n.supplier || '').trim().toLowerCase() || 'unknown';
    perSupplier.set(key, (perSupplier.get(key) || 0) + 1);
    const real = (n.lines || []).filter((l) => l.status !== 'return');
    if (real.length && real.every((l) => l.itemId)) fullyMatched += 1;
  }
  const completed = (sessions || []).filter((s) => s.status === 'completed');
  const lastCount = completed.reduce((m, s) => Math.max(m, millis(s.completedAt)), 0);
  const recentCount = lastCount && (now - lastCount) <= RECENT_COUNT_DAYS * 86400000 ? 1 : 0;

  // "Current" means nobody's paperwork has gone stale: every supplier the venue
  // uses has been scanned inside its own usual gap, plus a fortnight's grace.
  const lastBySupplier = new Map();
  for (const n of notes || []) {
    const key = String(n.supplier || '').trim().toLowerCase() || 'unknown';
    lastBySupplier.set(key, Math.max(lastBySupplier.get(key) || 0, millis(n.uploadedAt)));
  }
  const stale = [...lastBySupplier.values()].some((at) => (now - at) > STALE_SUPPLIER_DAYS * 86400000);

  return {
    fullyMatchedNotes: fullyMatched,
    codes: (supplierProducts || []).length,
    mostNotesFromOneSupplier: perSupplier.size ? Math.max(...perSupplier.values()) : 0,
    completedTakes: completed.length,
    recentCount,
    suppliersCurrent: lastBySupplier.size > 0 && !stale && recentCount ? 1 : 0,
    items: (items || []).length,
  };
}

/**
 * Level standing plus the next gate, so progress can be shown as a bar.
 * Levels are sequential: reaching one requires everything below it.
 */
export function venueLevel(state, now = Date.now()) {
  const inputs = levelInputs(state || {}, now);
  const rows = LEVELS.map((l) => {
    const have = l.have(inputs);
    return { ...l, have, done: have >= l.target, progress: Math.min(1, have / l.target) };
  });

  let level = 0;
  for (const r of rows) {
    if (!r.done) break;
    level += 1;
  }
  const next = rows[level] || null;
  return {
    level,
    name: level > 0 ? rows[level - 1].name : 'Getting started',
    rows,
    next,
    progress: next ? next.progress : 1,
  };
}

// ---------------------------------------------------------------------------
//  Aggregation
// ---------------------------------------------------------------------------

const inWindow = (f, from, to) =>
  (!from || f.earnedAt >= from) && (!to || f.earnedAt <= to);

const tally = (facts) => {
  const byKind = {};
  let total = 0;
  for (const f of facts) {
    byKind[f.kind] = (byKind[f.kind] || { count: 0, value: 0 });
    byKind[f.kind].count += 1;
    byKind[f.kind].value += f.value;
    total += f.value;
  }
  return { total, byKind };
};

/**
 * The venue's standing: total score, level, and minutes not spent keying
 * deliveries in by hand.
 */
export function scoreVenue(state, now = Date.now()) {
  const facts = learningFacts(state);
  const { total, byKind } = tally(facts);
  const loggedLines = (state?.notes || []).reduce(
    (t, n) => t + (n.lines || []).filter((l) => l.included).length, 0);
  return {
    total,
    byKind,
    facts,
    level: venueLevel(state, now),
    factCount: facts.length,
    timeSavedMinutes: Math.round((loggedLines * SECONDS_SAVED_PER_LINE) / 60),
  };
}

/**
 * Per-person contributions, optionally windowed.
 *
 * Two numbers are wanted for different jobs: LIFETIME is standing and never
 * decays; a window is what's newly earned in a bonus period. Windowing is on
 * when the fact was first established, never when it was last touched, so
 * re-scanning old paperwork can't re-earn it.
 *
 * @param {Object} state
 * @param {Object} [window] - { from, to } in ms
 */
export function scoreByPerson(state, window = {}) {
  const { from, to } = window;
  const all = learningFacts(state);
  const people = new Map();

  for (const f of all) {
    const who = (f.owner || '').trim();
    if (!who) continue; // unattributed facts count for the venue, nobody's pay
    if (!people.has(who)) people.set(who, { person: who, facts: [], lifetime: 0 });
    const p = people.get(who);
    p.lifetime += f.value;
    if (inWindow(f, from, to)) p.facts.push(f);
  }

  // Sorted by NAME, deliberately. A list ordered by points is a leaderboard
  // whichever way it's labelled, and stack-ranking colleagues is the single
  // best-evidenced way to make workplace gamification backfire. Callers that
  // genuinely need another order can re-sort; the default won't hand anyone a
  // ranking by accident.
  return [...people.values()]
    .map((p) => {
      const { total, byKind } = tally(p.facts);
      return {
        person: p.person,
        lifetime: p.lifetime,
        earned: total,
        factCount: p.facts.length,
        byKind,
        // Itemised, because a figure someone is paid against has to be one
        // they can look at and check.
        facts: p.facts.sort((a, b) => b.earnedAt - a.earnedAt),
      };
    })
    .filter((p) => p.lifetime > 0)
    .sort((a, b) => a.person.localeCompare(b.person));
}

/** Calendar-month key, so a cached month figure can't be read in the wrong month. */
export const periodKeyOf = (now = Date.now()) => {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const startOfMonth = (now) => {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
};

/**
 * A small, cacheable summary of the whole picture.
 *
 * Scoring reads every note, mapping and completed count — all manager-level,
 * and far too much to pull on a home screen. This is what gets written once by
 * a manager and read cheaply by everybody, so staff can see their own
 * contribution without being able to read the back-office collections it was
 * derived from.
 *
 * Per-person FACTS are deliberately dropped: the itemised detail is a person's
 * own business and stays behind the live computation.
 */
export function buildLearningProfile(state, now = Date.now()) {
  const venue = scoreVenue(state, now);
  const people = scoreByPerson(state, { from: startOfMonth(now) });
  const next = venue.level.next;
  return {
    total: venue.total,
    factCount: venue.factCount,
    timeSavedMinutes: venue.timeSavedMinutes,
    level: {
      level: venue.level.level,
      name: venue.level.name,
      progress: venue.level.progress,
      next: next ? { name: next.name, unlocks: next.unlocks, have: next.have, target: next.target } : null,
    },
    // The month figure is only meaningful inside the month it was computed in.
    periodKey: periodKeyOf(now),
    people: people.map((p) => ({
      person: p.person,
      lifetime: p.lifetime,
      earned: p.earned,
      factCount: p.factCount,
    })),
  };
}

/** Difference between two states, for the "+120 learned" moment after a scan. */
export function scoreDelta(before, after) {
  const seen = new Set(learningFacts(before).map((f) => f.key));
  const gained = learningFacts(after).filter((f) => !seen.has(f.key));
  const { total, byKind } = tally(gained);
  return { total, byKind, facts: gained };
}
