/**
 * stockPosition — what's in the cellar right now, and what that implies for the
 * next order.
 *
 * This is the report a venue needs LONG before it has enough history to deserve
 * one. The Richmond has two counts a week apart and one delivery between them.
 * That is one measurement of one week — an anecdote — and the honest thing to
 * do with an anecdote is not to hide it, but to say what it can and can't carry.
 * So nothing here is presented as a number alone: every position states how it
 * was arrived at, and every item that can't be positioned at all says so out
 * loud instead of quietly reading zero.
 *
 * THE ARITHMETIC. Per item, from its own most recent count:
 *
 *     position = anchor count + deliveries since − wastage since − rate × days
 *
 * with the depletion term dropped entirely when no rate exists. There is no
 * sales feed at the venues this is built for (see design notes), so the only
 * thing that pulls stock down is the derived usage rate — which is why the four
 * bases below are kept visibly distinct rather than blended into one figure.
 *
 * ANCHORED PER ITEM, NOT PER COUNT. A stock take is not all-or-nothing: the
 * Richmond's second take covered 69 of the 79 items in its first. Anchoring the
 * whole report to "the last stock take" would have silently dropped eleven
 * items, Malibu among them — the exact lines most likely to be forgotten and so
 * the exact lines worth flagging. Each item is therefore anchored to the last
 * count that actually contains IT, and an item skipped by a later count of its
 * own section is called skipped, not stale: someone walked past it.
 *
 * WHAT "LOW" MEANS WITHOUT A RATE. Days of cover needs a rate, and most items at
 * a new venue have none. But "one container left" is a shortage signal that
 * needs no history at all — a single bottle of Malibu is a single bottle
 * whether or not anyone knows how fast it goes. So low fires on cover where
 * cover is known, and on bare depth where it isn't. That's what makes the
 * report useful in week one rather than month three.
 *
 * Read design/usage-rates-real-world.md before changing the period arithmetic
 * this leans on.
 */

const DAY = 24 * 60 * 60 * 1000;
const round2 = (n) => Math.round(n * 100) / 100;
const round1 = (n) => Math.round(n * 10) / 10;
const millis = (t) => (t?.toMillis ? t.toMillis() : (t instanceof Date ? t.getTime() : (typeof t === 'number' ? t : 0)));

/** Cover below this needs ordering — an independent orders about weekly. */
export const LOW_COVER_DAYS = 7;
/** Order up to this much cover: the week, plus a few days for a missed drop. */
export const TARGET_COVER_DAYS = 10;
/** Past this long uncounted, a projection is a guess wearing a number. */
export const UNSEEN_DAYS = 10;
/** Without a rate, this little depth is the shortage signal. */
export const LOW_WHOLE_UNITS = 1;

/**
 * How a position was arrived at. Kept apart on purpose: a count is a fact, a
 * projection is a forecast, and the gap between them is the whole reason a
 * manager should still walk the cellar.
 */
export const BASIS = {
  counted: { key: 'counted', label: 'Counted', note: 'counted, nothing moved since' },
  adjusted: { key: 'adjusted', label: 'Adjusted', note: 'counted, then deliveries and wastage applied' },
  projected: { key: 'projected', label: 'Projected', note: 'counted, then run down at the measured rate' },
  unknown: { key: 'unknown', label: 'Not counted', note: 'never counted — only what has been delivered' },
};

/**
 * Every signal the report can raise, in the order a manager should care.
 * `group` drives the screen's three sections: something to order, something to
 * go and look at, something that doesn't add up.
 */
export const SIGNALS = {
  out: { key: 'out', label: 'Out', group: 'order', rank: 0, tone: 'error' },
  low: { key: 'low', label: 'Low', group: 'order', rank: 1, tone: 'warning' },
  ranDry: { key: 'ranDry', label: 'Ran dry', group: 'order', rank: 2, tone: 'warning' },
  skipped: { key: 'skipped', label: 'Empty or missed', group: 'look', rank: 3, tone: 'warning' },
  never: { key: 'never', label: 'Never counted', group: 'look', rank: 4, tone: 'info' },
  unseen: { key: 'unseen', label: 'Not counted lately', group: 'look', rank: 5, tone: 'info' },
  suspect: { key: 'suspect', label: "Doesn't add up", group: 'check', rank: 6, tone: 'info' },
  still: { key: 'still', label: 'No movement', group: 'check', rank: 7, tone: 'muted' },
};

export const GROUP_TITLES = {
  order: 'Order these',
  look: 'Go and look',
  check: "Doesn't add up",
  settled: 'Everything else',
};

/**
 * The last completed count containing each item, plus the last completed count
 * of its section — which is what tells skipped apart from simply not counted
 * in a while.
 *
 * @param {Array} sessions - stock sessions, any status, any order
 */
export function anchorCounts(sessions) {
  const byItem = new Map();
  const lastBySection = { bar: 0, kitchen: 0 };

  for (const s of sessions || []) {
    if (s.status !== 'completed' || !s.completedAt) continue;
    // A take pulled out of variance was pulled out for a reason — usually a
    // botched count — and it shouldn't anchor a position either.
    if (s.hiddenFromVariance) continue;
    const at = millis(s.completedAt);
    const section = s.section === 'kitchen' ? 'kitchen' : 'bar';
    if (at > lastBySection[section]) lastBySection[section] = at;

    for (const [id, c] of Object.entries(s.counts || {})) {
      const cur = byItem.get(id);
      if (cur && cur.at >= at) continue;
      byItem.set(id, { at, qty: Number(c?.quantity) || 0, itemName: c?.itemName || '', sessionId: s.id, section });
    }
  }

  return { byItem, lastBySection };
}

/**
 * Whether this venue's counters ever write a zero.
 *
 * Worth knowing, because it decides how to read a missing line. A venue that
 * records zeros means an absent item genuinely wasn't reached; a venue that has
 * never recorded one is a venue whose habit is to skip what isn't there, and
 * its blank lines are far more likely to be empties. Two counts across ninety
 * lines without a single zero is not a venue where nothing ran out.
 */
export function countingHabits(sessions) {
  let counted = 0;
  let zeros = 0;
  let takes = 0;
  for (const s of sessions || []) {
    if (s.status !== 'completed' || s.hiddenFromVariance) continue;
    takes += 1;
    for (const c of Object.values(s.counts || {})) {
      counted += 1;
      if ((Number(c?.quantity) || 0) === 0) zeros += 1;
    }
  }
  return { takes, counted, zeros, everRecordsZero: zeros > 0 };
}

/** Total per item of log entries strictly after `since`. */
function sumAfter(entries, timeField, since) {
  const out = new Map();
  for (const e of entries || []) {
    if (!e?.itemId) continue;
    const at = millis(e[timeField]);
    if (!at) continue;
    const from = since.get(e.itemId);
    // No anchor at all → everything ever delivered counts, since there is no
    // count to have already included it.
    if (from !== undefined && at <= from) continue;
    out.set(e.itemId, (out.get(e.itemId) || 0) + (Number(e.quantity) || 0));
  }
  return out;
}

/** Whole containers, rounding an order UP — nobody orders 3.2 kegs. */
function wholesNeeded(baseQty, unitInfo) {
  const upw = (unitInfo?.unitsPerWhole > 0 ? unitInfo.unitsPerWhole : 1);
  let wholes = Math.ceil(round2(baseQty / upw));
  const pack = Number(unitInfo?.casePack) || 0;
  // An item that only comes in cases of 12 can't be ordered in sevens.
  if (pack > 1) wholes = Math.ceil(wholes / pack) * pack;
  return wholes;
}

/**
 * One position row per stock item.
 *
 * @param {Object} args
 *   items       - stock items (archived ones are skipped)
 *   sessions    - all stock sessions
 *   deliveries  - deliveryLog entries covering at least the oldest anchor
 *   wastage     - wastageLog entries over the same span
 *   rates       - itemStats rows / mergeRates output, keyed however
 *   unitInfoFor - (item) => parseUnitInfo(item)
 *   now         - ms, injectable for tests
 */
export function buildPositions({ items, sessions, deliveries, wastage, rates, unitInfoFor, now = Date.now() }) {
  const { byItem: anchors, lastBySection } = anchorCounts(sessions);
  const since = new Map([...anchors].map(([id, a]) => [id, a.at]));
  const delivered = sumAfter(deliveries, 'receivedAt', since);
  const wasted = sumAfter(wastage, 'wastedAt', since);

  const rateById = new Map();
  for (const r of rates || []) {
    const id = r.itemId || r.id;
    if (id) rateById.set(id, r);
  }

  // Last delivery of anything, per item, whether or not it's since the anchor —
  // evidence the line is live even when nothing else is known about it.
  const lastDelivery = new Map();
  for (const d of deliveries || []) {
    if (!d?.itemId) continue;
    const at = millis(d.receivedAt);
    if (at > (lastDelivery.get(d.itemId) || 0)) lastDelivery.set(d.itemId, at);
  }

  const rows = [];
  for (const item of items || []) {
    if (item.archived) continue;
    const id = item.id;
    const unitInfo = unitInfoFor ? unitInfoFor(item) : null;
    const upw = (unitInfo?.unitsPerWhole > 0 ? unitInfo.unitsPerWhole : 1);
    const section = item.section === 'kitchen' ? 'kitchen' : 'bar';

    const anchor = anchors.get(id) || null;
    const inQty = delivered.get(id) || 0;
    const outQty = wasted.get(id) || 0;
    const rate = rateById.get(id) || null;
    const perWeek = Number(rate?.usagePerWeek) || 0;
    const perDay = perWeek / 7;

    const daysSince = anchor ? (now - anchor.at) / DAY : null;
    const known = (anchor ? anchor.qty : 0) + inQty - outQty;
    const depletion = perDay > 0 && daysSince > 0 ? perDay * daysSince : 0;
    // Floored at zero: a projection that has run past empty says "you're out",
    // not "you're minus forty litres".
    const projected = Math.max(0, known - depletion);

    let basis;
    if (!anchor) basis = BASIS.unknown;
    else if (depletion > 0) basis = BASIS.projected;
    else if (inQty > 0 || outQty > 0) basis = BASIS.adjusted;
    else basis = BASIS.counted;

    const position = anchor ? projected : inQty - outQty;
    const coverDays = perDay > 0 ? round1(position / perDay) : null;
    const wholes = round2(position / upw);

    // A count sheet records what was counted, not what wasn't, so an item
    // missing from a take has two opposite readings: nobody got to it, or
    // there was none there and the counter moved on. They cannot be told apart
    // from the data — and treating the second as the first is the dangerous
    // way round, because it reports stock on a line that has run dry.
    //
    // So for a skipped item the position is published as a CEILING, and the
    // usage the empty reading would imply is published beside it. A cellar
    // person can settle "two kegs of cider a week — is that us?" in a second,
    // which is a question worth asking; "how much Aspall is there?" is one
    // they'd have to walk downstairs to answer.
    const ifEmptyPerWeek = daysSince > 0.5 ? round2(((anchor ? anchor.qty : 0) + inQty - outQty) / daysSince * 7) : 0;

    // --- signals -----------------------------------------------------------
    const sig = [];
    const skipped = !!anchor && lastBySection[anchor.section] > anchor.at;
    const stale = daysSince !== null && daysSince >= UNSEEN_DAYS;

    // Every shortage signal needs a real count behind it. An item known only
    // from a delivery note isn't out and isn't low — it's unmeasured, and
    // saying "order more" off a delivery that arrived last week is how a
    // report loses a manager's trust in its first fortnight.
    if (anchor && position <= 0.001) sig.push(SIGNALS.out);
    else if (coverDays !== null && coverDays < LOW_COVER_DAYS) sig.push(SIGNALS.low);
    // No rate to compute cover from, so judge depth instead — but only where
    // the venue has actually re-ordered the line at some point. An untouched
    // shelf bottle at one deep is a line the pub keeps one of, not a shortage.
    else if (anchor && coverDays === null && wholes <= LOW_WHOLE_UNITS && lastDelivery.has(id)) {
      sig.push(SIGNALS.low);
    }

    // Measured usage on an item that emptied is a floor, not a rate: they sold
    // what was there, not what they could have. Ordering to the measurement
    // shorts the next week harder.
    if (rate?.ranOutPeriods > 0 || rate?.lowerBound) sig.push(SIGNALS.ranDry);

    if (!anchor) sig.push(SIGNALS.never);
    else if (skipped) sig.push(SIGNALS.skipped);
    else if (stale) sig.push(SIGNALS.unseen);

    if (rate?.implausiblePeriods > 0) sig.push(SIGNALS.suspect);
    if (perWeek === 0 && rate?.observations > 0 && position > 0) sig.push(SIGNALS.still);

    const top = sig.slice().sort((a, b) => a.rank - b.rank)[0] || null;
    const group = top ? top.group : 'settled';

    // --- suggestion --------------------------------------------------------
    // Only where a rate exists. Everywhere else the honest instruction is
    // "count it", and inventing a number would bury that.
    let suggestWholes = 0;
    if (perDay > 0) {
      const shortfall = perDay * TARGET_COVER_DAYS - position;
      if (shortfall > 0) suggestWholes = wholesNeeded(shortfall, unitInfo);
    }

    rows.push({
      itemId: id,
      name: item.name || anchor?.itemName || 'Item',
      category: item.category || '',
      section,
      unitInfo,
      basis,
      anchorQty: anchor ? round2(anchor.qty) : null,
      anchorAt: anchor ? anchor.at : null,
      daysSinceCount: daysSince === null ? null : round1(daysSince),
      delivered: round2(inQty),
      wasted: round2(outQty),
      depletion: round2(depletion),
      position: round2(position),
      // True only while the item hasn't been skipped: then it's an upper bound.
      positionIsCeiling: skipped,
      ifEmptyPerWeek,
      wholes,
      perWeek,
      perWeekSource: rate?.source || null,
      confidence: rate?.confidence || 'none',
      observations: rate?.observations ?? null,
      coverDays,
      suggestWholes,
      lastDeliveryAt: lastDelivery.get(id) || null,
      signals: sig,
      signal: top,
      group,
      skipped,
    });
  }

  // Worst first inside a group: the shortest cover, then whatever there's
  // actually stock or movement behind, then the biggest seller — so the top of
  // the list is what stops service, and a line nobody has ever touched sinks.
  return rows.sort((a, b) => {
    const ra = a.signal ? a.signal.rank : 99;
    const rb = b.signal ? b.signal.rank : 99;
    if (ra !== rb) return ra - rb;
    const ca = a.coverDays === null ? Infinity : a.coverDays;
    const cb = b.coverDays === null ? Infinity : b.coverDays;
    if (ca !== cb) return ca - cb;
    const ea = (a.position > 0 || a.delivered > 0) ? 0 : 1;
    const eb = (b.position > 0 || b.delivered > 0) ? 0 : 1;
    if (ea !== eb) return ea - eb;
    // Among items with no rate — the whole "go and look" group — stock that
    // arrived since the count is the strongest evidence the line matters. A
    // skipped cider keg that took 50 litres last week outranks a shelf liqueur
    // nobody has touched, and alphabetical order would bury it.
    const da = a.delivered > 0 ? 0 : 1;
    const dbv = b.delivered > 0 ? 0 : 1;
    if (da !== dbv) return da - dbv;
    if (b.perWeek !== a.perWeek) return b.perWeek - a.perWeek;
    if (b.wholes !== a.wholes) return b.wholes - a.wholes;
    return String(a.name).localeCompare(String(b.name));
  });
}

/**
 * The headline a manager reads before any row: how much of the venue this
 * report can actually see, and how thin the evidence under it is.
 */
export function summarise(rows, periods) {
  const counted = rows.filter((r) => r.anchorAt);
  const measured = rows.filter((r) => r.perWeekSource === 'counts');
  const estimated = rows.filter((r) => r.perWeekSource === 'deliveries');
  const newest = counted.reduce((m, r) => Math.max(m, r.anchorAt), 0);
  const totalDays = (periods || []).reduce((t, p) => t + (p.days || 0), 0);

  return {
    items: rows.length,
    counted: counted.length,
    uncounted: rows.length - counted.length,
    skipped: rows.filter((r) => r.skipped).length,
    measured: measured.length,
    estimated: estimated.length,
    rated: measured.length + estimated.length,
    periods: (periods || []).length,
    measuredDays: round1(totalDays),
    lastCountAt: newest || null,
    order: rows.filter((r) => r.group === 'order').length,
    look: rows.filter((r) => r.group === 'look').length,
    check: rows.filter((r) => r.group === 'check').length,
    still: rows.filter((r) => r.signals.includes(SIGNALS.still)).length,
    suspect: rows.filter((r) => r.signals.includes(SIGNALS.suspect)).length,
  };
}

/**
 * The single most useful thing this venue could do next, in a sentence.
 *
 * Deliberately one instruction, not a list. A venue two counts into using the
 * thing has one bottleneck at a time, and naming it is worth more than a page
 * of caveats it will read once.
 */
export function nextBestAction(summary, rows, habits) {
  if (summary.counted === 0) return 'Do a stock take — nothing here can be worked out until something has been counted once.';
  if (summary.periods === 0) return 'Do a second stock take. One count is a snapshot; two are a rate, and everything below gets sharper the moment you have one.';
  if (summary.skipped > 0) {
    // A venue that has never written a zero has a habit, not an oversight, and
    // the fix is a sentence to whoever counts rather than a longer list of
    // items. Naming it is worth more than naming them.
    if (habits && habits.counted > 20 && !habits.everRecordsZero) {
      return `${summary.skipped} item${summary.skipped === 1 ? ' was' : 's were'} left out of the last count, and across ${habits.counted} counted lines not one zero has ever been recorded — so nobody can now tell an empty shelf from one that wasn't reached. Tap None left when something's out, or settle the stragglers on the Anything empty? screen when you finish a take: each one you resolve becomes a real position and earns a usage rate.`;
    }
    // Name the ones that took stock in since they were last seen: those are
    // where the blind spot is actively growing, and a named example lands
    // harder than a count.
    const worst = (rows || []).filter((r) => r.skipped && r.delivered > 0).slice(0, 2).map((r) => r.name);
    const tail = worst.length
      ? ` ${worst.join(' and ')} took ${worst.length === 1 ? 'a delivery' : 'deliveries'} you can't see the effect of.`
      : '';
    return `${summary.skipped} item${summary.skipped === 1 ? ' was' : 's were'} skipped in your last count — they're invisible to every figure here.${tail}`;
  }
  if (summary.uncounted > 0) {
    return `${summary.uncounted} item${summary.uncounted === 1 ? ' has' : 's have'} never been counted. Until they are, the only thing known about them is what arrived.`;
  }
  if (summary.measuredDays < 21) return 'Keep counting on the same rhythm. Three or four periods is where these rates stop being an anecdote.';
  return 'Nothing pressing — the counts are keeping up with the stock.';
}

/** "3 days", "under a day", "2 weeks+" — cover in words a cellar person uses. */
export function formatCover(days) {
  if (days === null || days === undefined) return null;
  if (days <= 0) return 'none';
  if (days < 1) return 'under a day';
  if (days < 2) return '1 day';
  if (days < 14) return `${Math.round(days)} days`;
  if (days < 28) return `${Math.round(days / 7)} weeks`;
  return '4 weeks+';
}

/** "4 kegs", "1 case" — the unit an order is actually placed in. */
export function formatWholes(n, unitInfo) {
  const label = unitInfo?.wholeLabel || 'units';
  const single = label.replace(/s$/i, '');
  const rounded = round2(n);
  return `${rounded} ${rounded === 1 ? single : label}`;
}

export const CONFIDENCE_NOTE = {
  none: 'no usage history',
  low: 'one short period — treat as a hint',
  fair: 'a few periods, or estimated from deliveries',
  good: 'measured consistently across several periods',
};
