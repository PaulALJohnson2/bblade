// Seed the two non-customer accounts: a dev sandbox and a demo venue.
//
//   TOKEN=$(gcloud auth print-access-token) DRY=1 node scripts/seed-sandbox.cjs   # preview
//   TOKEN=$(gcloud auth print-access-token)       node scripts/seed-sandbox.cjs   # write
//   TOKEN=... ONLY=demo node scripts/seed-sandbox.cjs                             # one of them
//
// SAFE TO RE-RUN, and meant to be. Every document id is deterministic, so a
// second run updates in place rather than duplicating, and every date is
// computed relative to NOW — so re-running before a demo rolls the whole
// history forward and the venue never looks abandoned. That's the "keep it up
// to date" part: it's a command, not a chore.
//
// The demo venue is FICTIONAL. Nothing here is derived from a customer's data:
// a real pub's range, volumes, suppliers and buying patterns are its own
// commercial information and don't belong in front of prospects.
//
// Members created with an email are picked up by the syncMemberAuth function,
// which provisions the Firebase Auth user and writes a generated
// `initialPassword` back onto the member doc. This script prints where to find
// them rather than inventing passwords of its own.

const BASE = 'https://firestore.googleapis.com/v1';
const PARENT = 'projects/bar-blade/databases/(default)/documents';
const TOKEN = process.env.TOKEN;
const DRY = !!process.env.DRY;
const ONLY = (process.env.ONLY || '').toLowerCase(); // '', 'test', 'demo'

if (!TOKEN) {
  console.error('Set TOKEN=$(gcloud auth print-access-token)');
  process.exit(1);
}

// Fixed account ids so the accounts are stable across runs and easy to spot.
const TEST_ACCOUNT = 'zz-sandbox-test';
const DEMO_ACCOUNT = 'zz-sandbox-demo';
const TEST_VENUE = 'sandbox-venue';
const DEMO_VENUE = 'fox-and-compass';

// ---------------------------------------------------------------------------
// Firestore REST plumbing
// ---------------------------------------------------------------------------

const val = (v) => {
  if (v === null) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(val) } };
  switch (typeof v) {
    case 'string': return { stringValue: v };
    case 'boolean': return { booleanValue: v };
    case 'number': return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    case 'object': return { mapValue: { fields: fields(v) } };
    default: throw new Error(`unsupported value type: ${typeof v}`);
  }
};
const fields = (o) => Object.fromEntries(
  Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, val(v)]),
);

const writes = [];
const put = (path, data) => writes.push({ update: { name: `${PARENT}/${path}`, fields: fields(data) } });

async function commit() {
  if (DRY) {
    console.log(`\nDRY RUN — ${writes.length} documents would be written. Nothing sent.`);
    const byCol = {};
    for (const w of writes) {
      const p = w.update.name.replace(`${PARENT}/`, '').split('/');
      const col = p.slice(0, -1).join('/');
      byCol[col] = (byCol[col] || 0) + 1;
    }
    for (const [k, n] of Object.entries(byCol).sort()) console.log(`  ${n.toString().padStart(4)}  ${k}`);
    return;
  }
  for (let i = 0; i < writes.length; i += 400) {
    const chunk = writes.slice(i, i + 400);
    const res = await fetch(`${BASE}/${PARENT}:commit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ writes: chunk }),
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 500)}`);
    console.log(`  committed ${Math.min(i + 400, writes.length)}/${writes.length}`);
  }
}

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

/** Seeded PRNG — the same run twice produces the same venue, not a new one. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const rand = rng(20260727);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

const DAY = 86400000;
const NOW = Date.now();
const daysAgo = (d) => new Date(NOW - d * DAY);
const isoDay = (d) => daysAgo(d).toISOString().slice(0, 10);
/** Most recent date, N days back, that falls on `weekday` (0=Sun). */
function lastWeekday(weekday, weeksBack = 0) {
  const d = new Date(NOW);
  const shift = (d.getDay() - weekday + 7) % 7;
  return Math.round(shift + weeksBack * 7);
}

// ---------------------------------------------------------------------------
// The fictional venue's range
// ---------------------------------------------------------------------------

const KEG = (l) => ({ wholeUnit: `Keg 1*${l}ltr`, partUnit: 'Litre', unit: `${l}L` });
const CASK = (g) => ({ wholeUnit: `Cask 1*${g}gall`, partUnit: 'Gallon', unit: `${g}G` });
const BTL = (cl) => ({ wholeUnit: `Bottle 1*${cl}cl`, partUnit: 'Tenth', unit: `${cl}cl` });
const CASE = (n) => ({ wholeUnit: `Case 1*${n}Each`, partUnit: 'Each', unit: `of ${n}` });
const BIB = (l) => ({ wholeUnit: `BIB 1*${l}ltr`, partUnit: 'Litre', unit: `${l}L` });
const BAG = (kg) => ({ wholeUnit: `Bag 1*${kg}kg`, partUnit: 'Kilogram', unit: `${kg}kg` });

// [name, category, unit, supplierCode, costPrice] — codes drive the learned
// mappings, so the demo shows "REMEMBERED" on a second scan.
const DEMO_ITEMS = [
  ['Harbour Pale',            'Draught Ale',    KEG(30),  'WK1101', 92.40],
  ['Compass Bitter',          'Draught Ale',    CASK(9),  'WK1102', 88.00],
  ['Meridian Lager',          'Draught Lager',  KEG(50),  'WK1103', 128.50],
  ['Meridian Lager 0.0',      'Draught Lager',  KEG(30),  'WK1104', 96.00],
  ['Northbank Pilsner',       'Draught Lager',  KEG(50),  'WK1105', 141.20],
  ['Old Quay Stout',          'Draught Stout',  KEG(50),  'WK1106', 152.75],
  ['Windward Cider',          'Draught Cider',  KEG(50),  'WK1107', 118.90],
  ['Windward Berry',          'Draught Cider',  KEG(30),  'WK1108', 84.30],
  ['Session IPA',             'Draught IPA',    KEG(30),  'WK1109', 99.60],

  ['Meridian Bottles',        'Bottled Beer',   CASE(24), 'WB2201', 28.80],
  ['Old Quay Bottles',        'Bottled Beer',   CASE(24), 'WB2202', 31.20],
  ['Low Tide 0.5%',           'Bottled Beer',   CASE(24), 'WB2203', 24.00],
  ['Windward Bottles',        'Bottled Cider',  CASE(12), 'WB2204', 19.80],

  ['Saltmarsh Gin',           'Gin',            BTL(70),  'WS3301', 16.40],
  ['Saltmarsh Rhubarb',       'Gin',            BTL(70),  'WS3302', 17.10],
  ['Saltmarsh Pink',          'Gin',            BTL(70),  'WS3303', 16.90],
  ['Juniper Row London Dry',  'Gin',            BTL(150), 'WS3304', 29.50],
  ['Polar Star Vodka',        'Vodka',          BTL(150), 'WS3305', 26.80],
  ['Polar Star Citrus',       'Vodka',          BTL(70),  'WS3306', 15.20],
  ['Cane & Anchor White',     'Rum',            BTL(150), 'WS3307', 25.40],
  ['Cane & Anchor Spiced',    'Rum',            BTL(150), 'WS3308', 26.10],
  ['Cane & Anchor Dark',      'Rum',            BTL(70),  'WS3309', 14.80],
  ['Glen Toller Blend',       'Whisky',         BTL(70),  'WS3310', 18.60],
  ['Glen Toller 12',          'Whisky',         BTL(70),  'WS3311', 32.40],
  ['Kentucky Mile Bourbon',   'Whisky',         BTL(70),  'WS3312', 21.30],
  ['Agave Nine Reposado',     'Tequila',        BTL(70),  'WS3313', 24.90],
  ['Amaro Vespro',            'Liqueurs',       BTL(70),  'WS3314', 15.70],
  ['Cocoa Nib Cream',         'Liqueurs',       BTL(70),  'WS3315', 13.20],
  ['Aniseed Forty',           'Liqueurs',       BTL(70),  'WS3316', 14.10],
  ['Bitter Orange Aperitif',  'Liqueurs',       BTL(100), 'WS3317', 17.80],

  ['House White',             'Wine',           CASE(6),  'WW4401', 38.40],
  ['House Red',               'Wine',           CASE(6),  'WW4402', 38.40],
  ['House Rosé',              'Wine',           CASE(6),  'WW4403', 37.20],
  ['Coastal Sauvignon',       'Wine',           CASE(6),  'WW4404', 52.80],
  ['Hillside Malbec',         'Wine',           CASE(6),  'WW4405', 56.40],
  ['Stone Ridge Pinot Grigio','Wine',           CASE(6),  'WW4406', 46.20],
  ['Prosecco Brut',           'Sparkling',      CASE(6),  'WW4407', 61.50],
  ['Prosecco Rosé',           'Sparkling',      CASE(6),  'WW4408', 64.80],

  ['Cola Post Mix',           'Post Mix',       BIB(7),   'WP5501', 42.30],
  ['Diet Cola Post Mix',      'Post Mix',       BIB(7),   'WP5502', 42.30],
  ['Lemonade Post Mix',       'Post Mix',       BIB(7),   'WP5503', 39.90],
  ['Tonic',                   'Soft Drinks',    CASE(24), 'WP5504', 14.40],
  ['Slimline Tonic',          'Soft Drinks',    CASE(24), 'WP5505', 14.40],
  ['Elderflower Tonic',       'Soft Drinks',    CASE(24), 'WP5506', 16.80],
  ['Ginger Ale',              'Soft Drinks',    CASE(24), 'WP5507', 15.60],
  ['Soda Water',              'Soft Drinks',    CASE(24), 'WP5508', 11.20],
  ['Orange Juice',            'Soft Drinks',    CASE(12), 'WP5509',  9.60],
  ['Apple Juice',             'Soft Drinks',    CASE(12), 'WP5510',  9.60],
  ['Cranberry Juice',         'Soft Drinks',    CASE(12), 'WP5511', 10.20],
  ['Still Water',             'Soft Drinks',    CASE(24), 'WP5512', 10.80],
  ['Sparkling Water',         'Soft Drinks',    CASE(24), 'WP5513', 10.80],
  ['Energy Drink',            'Soft Drinks',    CASE(24), 'WP5514', 26.40],

  // Harbour Provisions — the second supplier, snacks and kitchen.
  ['Sea Salt Crisps',         'Snacks',         CASE(24), 'HP7701',  8.40],
  ['Cheese & Onion Crisps',   'Snacks',         CASE(24), 'HP7702',  8.40],
  ['Salted Peanuts',          'Snacks',         CASE(24), 'HP7703',  9.60],
  ['Pork Crackling',          'Snacks',         CASE(20), 'HP7704', 11.00],
  ['Olives',                  'Snacks',         CASE(12), 'HP7705', 14.40],
];

const DEMO_KITCHEN = [
  ['Skin-on Fries',           'Sides',          BAG(10),  'HP7801', 12.60],
  ['Beef Patties',            'Mains',          CASE(24), 'HP7802', 28.40],
  ['Brioche Buns',            'Bakery',         CASE(48), 'HP7803',  9.80],
  ['Mature Cheddar',          'Dairy',          BAG(2.5), 'HP7804', 18.20],
  ['Streaky Bacon',           'Meat',           BAG(2.5), 'HP7805', 16.90],
  ['Buttermilk Chicken',      'Mains',          BAG(5),   'HP7806', 31.50],
  ['Onion Rings',             'Sides',          BAG(2.5), 'HP7807',  8.70],
  ['Garlic Ciabatta',         'Sides',          CASE(30), 'HP7808', 13.40],
];

const SUPPLIERS = {
  WK: 'Welloak Drinks', WB: 'Welloak Drinks', WS: 'Welloak Drinks',
  WW: 'Welloak Drinks', WP: 'Welloak Drinks', HP: 'Harbour Provisions',
};
const supplierOf = (code) => SUPPLIERS[code.slice(0, 2)] || 'Welloak Drinks';

// Named contributors, so the contribution panel has more than one person in it.
const DEMO_TEAM = [
  { id: 'alex',  displayName: 'Alex Mercer',    role: 'owner',   email: 'barblade3+demo@gmail.com' },
  { id: 'priya', displayName: 'Priya Nair',     role: 'manager', email: '' },
  { id: 'danny', displayName: "Danny O'Connell", role: 'staff',  email: '' },
  { id: 'ruth',  displayName: 'Ruth Salter',    role: 'staff',   email: '' },
];

const TEST_TEAM = [
  { id: 'owner',   displayName: 'Sandbox Owner',   role: 'owner',   email: 'barblade3+sandbox.owner@gmail.com' },
  { id: 'manager', displayName: 'Sandbox Manager', role: 'manager', email: 'barblade3+sandbox.manager@gmail.com' },
  { id: 'staff',   displayName: 'Sandbox Staff',   role: 'staff',   email: 'barblade3+sandbox.staff@gmail.com' },
];

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function account(accountId, name, plan) {
  put(`accounts/${accountId}`, {
    name, plan, entitlements: { stock: true },
    sandbox: true, // never a customer; safe for scripts to wipe or reseed
    createdAt: daysAgo(90), updatedAt: new Date(),
  });
}

function venue(accountId, venueId, name) {
  put(`accounts/${accountId}/venues/${venueId}`, {
    name, createdAt: daysAgo(90), updatedAt: new Date(),
  });
}

function members(accountId, team) {
  for (const m of team) {
    put(`accounts/${accountId}/members/${m.id}`, {
      displayName: m.displayName,
      email: m.email || '',
      role: m.role,
      venueAccess: 'all',
      withStock: true,
      active: true,
      createdAt: daysAgo(90),
      updatedAt: new Date(),
    });
  }
}

/** Item metadata only — no writes yet, because quantity depends on history. */
function itemMeta(rows, section) {
  return rows.map(([name, category, unit, code, cost]) => ({
    id: slug(name), name, category, unit, code, cost, section,
  }));
}

/**
 * Write the stock items, with `quantity` set to what the history implies:
 * the last count, plus everything delivered since, less what was wasted. A
 * demo showing an empty cellar under three completed stock takes reads as
 * broken, and the arithmetic has to agree with the variance report anyway.
 */
function writeStockItems(accountId, venueId, meta, quantities, createdBy) {
  for (const it of meta) {
    put(`accounts/${accountId}/venues/${venueId}/stockItems/${it.id}`, {
      name: it.name, category: it.category, section: it.section,
      ...it.unit,
      casePack: 0,
      quantity: Math.max(0, Math.round((quantities[it.id] || 0) * 100) / 100),
      costPrice: it.cost,
      archived: false,
      categorySuggested: '',
      accountId, venueId,
      createdAt: daysAgo(88),
      createdBy: createdBy || '',
      lastCountedAt: daysAgo(4),
      updatedAt: new Date(),
    });
  }
}

/**
 * Base units in one whole container, mirroring parseUnitInfo.
 *
 * Spirits and wine are counted in TENTHS of a bottle, so a 70cl bottle is 10
 * base units and not 70 — reading the number off the wholeUnit string inflates
 * every spirit sevenfold and makes the whole demo's stock, variance and usage
 * arithmetic nonsense.
 */
function unitsPerWhole(unit) {
  if (unit.partUnit === 'Tenth') return 10;
  const m = unit.wholeUnit.match(/^(\w+)\s+1\*(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[2]) : 1;
}

/**
 * A supplier's delivery history: notes, the log entries they produced, and the
 * learned code→item mappings a review would have left behind.
 */
function deliveries(accountId, venueId, items, { supplier, weekday, everyWeeks, count, prefix, team }) {
  const path = `accounts/${accountId}/venues/${venueId}`;
  const mine = items.filter((i) => supplierOf(i.code) === supplier);
  const received = []; // { itemId, quantity, at } — feeds the closing position
  let noteNo = 0;

  for (let n = count - 1; n >= 0; n--) {
    const back = lastWeekday(weekday, n * everyWeeks);
    if (back > 84) continue;
    const at = daysAgo(back);
    const who = n === 0 ? team[0].displayName : pick(team).displayName;
    noteNo += 1;
    const reference = `${prefix}${(100000 + noteNo * 137).toString()}`;
    const noteId = `note-${slug(supplier)}-${noteNo}`;

    // A realistic drop: the fast movers most weeks, a tail now and then.
    const lines = [];
    for (const it of mine) {
      const fast = /Draught|Post Mix|Soft Drinks|Snacks/.test(it.category);
      if (!fast && rand() > 0.28) continue;
      if (fast && rand() > 0.85) continue;
      const ordered = fast ? between(1, 4) : 1;
      // One short delivery in the set, so fill rate isn't a flat 100%.
      const short = n === 2 && it.name === 'Meridian Lager';
      const delivered = short ? ordered - 1 : ordered;
      lines.push({
        itemCode: it.code,
        description: it.name.toUpperCase(),
        packSize: it.unit.unit,
        container: 'other',
        qtyOrdered: ordered,
        qtyDespatched: ordered,
        qtyDelivered: delivered,
        unitCode: /Keg|Cask|BIB/.test(it.unit.wholeUnit) ? 'EA' : 'CA',
        isReturn: false,
        status: 'matched',
        included: delivered > 0,
        itemId: it.id,
        itemName: it.name,
      });
    }
    if (!lines.length) continue;

    // Empties going back the other way — the line that must never be stock in.
    lines.push({
      itemCode: '', description: 'EMPTY KEGS COLLECTED', packSize: '', container: 'keg',
      qtyOrdered: -1, qtyDespatched: -1, qtyDelivered: between(4, 11), unitCode: 'UN',
      isReturn: true, status: 'return', included: false, itemId: '', itemName: '',
    });

    put(`${path}/deliveryNotes/${noteId}`, {
      supplier,
      documentType: 'Delivery Note',
      documentKind: 'delivery-note',
      reference,
      deliveryDate: at.toISOString().slice(0, 10),
      fileName: `${slug(supplier)}-${reference}.pdf`,
      mimeType: 'application/pdf',
      thumb: '',
      imageStored: false,
      lines,
      lineCount: lines.length,
      entryIds: [],
      uploadedBy: who,
      uploadedAt: at,
      accountId, venueId,
    });

    for (const l of lines) {
      if (!l.included || !l.itemId) continue;
      const it = mine.find((x) => x.id === l.itemId);
      const upw = unitsPerWhole(it.unit);
      put(`${path}/deliveryLog/${noteId}-${l.itemId}`, {
        itemId: l.itemId, itemName: l.itemName, section: it.section,
        units: [{ label: it.unit.wholeUnit.split(' ')[0] + 's', count: l.qtyDelivered }],
        quantity: l.qtyDelivered * upw,
        baseLabel: it.unit.partUnit || 'Each',
        supplier,
        cost: Math.round(l.qtyDelivered * it.cost * 100) / 100,
        note: `Delivery note ${reference}`,
        noteId,
        receivedBy: who,
        receivedAt: at,
        accountId, venueId,
      });
      received.push({ itemId: l.itemId, quantity: l.qtyDelivered * upw, at });
    }
  }

  // What reviewing those notes taught the venue.
  for (const it of mine) {
    const who = pick(team).displayName;
    put(`${path}/supplierProducts/${slug(supplier)}__c-${it.code.toLowerCase()}`, {
      supplier, supplierKey: slug(supplier), key: `c-${it.code.toLowerCase()}`,
      itemCode: it.code, itemId: it.id, itemName: it.name,
      description: it.name.toUpperCase(), packSize: it.unit.unit,
      container: /Keg|Cask/.test(it.unit.wholeUnit) ? 'keg' : 'packaged',
      unitCode: 'EA', unitsPerOuter: 0,
      corrected: false, previousOwner: '',
      confirmedBy: who, firstConfirmedBy: who,
      timesSeen: between(2, 8),
      firstSeenAt: daysAgo(between(50, 80)), lastSeenAt: daysAgo(between(1, 10)),
      accountId, venueId,
    });
  }
  return received;
}

/** Completed stock takes, so usage rates have periods to measure between. */
function stockTakes(accountId, venueId, items, team, daysBackList) {
  const path = `accounts/${accountId}/venues/${venueId}`;
  let last = null;
  daysBackList.forEach((back, idx) => {
    const at = daysAgo(back);
    const counts = {};
    for (const it of items) {
      const upw = unitsPerWhole(it.unit);
      const whole = between(0, /Draught/.test(it.category) ? 4 : 3);
      const part = Math.round(rand() * upw * 0.6);
      counts[it.id] = {
        itemName: it.name,
        quantity: whole * upw + part,
        wholeCount: whole,
        partCount: part,
        wholeLabel: it.unit.wholeUnit.split(' ')[0] + 's',
        partLabel: it.unit.partUnit || '',
        countedBy: pick(team).displayName,
        countedAt: at,
      };
    }
    put(`${path}/stockSessions/take-${idx + 1}`, {
      name: `Stock take ${at.toLocaleDateString('en-GB')}`,
      status: 'completed',
      counts,
      createdBy: team[0].id,
      createdByName: team[0].displayName,
      completedBy: pick(team).displayName,
      startedAt: at, completedAt: at,
      accountId, venueId,
    });
    last = { at, counts };
  });
  return last;
}

/** A little wastage, so the variance report has something to show. */
function wastage(accountId, venueId, items, team) {
  const path = `accounts/${accountId}/venues/${venueId}`;
  const lost = [];
  for (let i = 0; i < 14; i++) {
    const it = pick(items);
    const at = daysAgo(between(1, 55));
    lost.push({ itemId: it.id, quantity: 1, at });
    put(`${path}/wastageLog/waste-${i}`, {
      itemId: it.id, itemName: it.name, section: it.section,
      units: [{ label: 'Loose', count: 1 }],
      quantity: 1,
      baseLabel: it.unit.partUnit || 'Each',
      reason: pick(['Line cleaning', 'Breakage', 'Out of date', 'Spillage', 'Customer return']),
      note: '',
      wastedBy: pick(team).displayName,
      wastedAt: at,
      accountId, venueId,
    });
  }
  return lost;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function buildTest() {
  console.log('\nSandbox (dev playground)');
  account(TEST_ACCOUNT, 'BBlade Sandbox', 'internal');
  venue(TEST_ACCOUNT, TEST_VENUE, 'Sandbox Venue');
  members(TEST_ACCOUNT, TEST_TEAM);
  // Deliberately small and boring: a playground wants to be quick to reason
  // about and cheap to break, not realistic.
  const rows = [...itemMeta(DEMO_ITEMS.slice(0, 8), 'bar'), ...itemMeta(DEMO_KITCHEN.slice(0, 3), 'kitchen')];
  const qty = Object.fromEntries(rows.map((r) => [r.id, between(2, 40)]));
  writeStockItems(TEST_ACCOUNT, TEST_VENUE, rows, qty, 'Sandbox Owner');
  console.log(`  account ${TEST_ACCOUNT} · venue ${TEST_VENUE} · ${rows.length} items · ${TEST_TEAM.length} members`);
}

function buildDemo() {
  console.log('\nDemo (The Fox & Compass — fictional)');
  account(DEMO_ACCOUNT, 'The Fox & Compass', 'demo');
  venue(DEMO_ACCOUNT, DEMO_VENUE, 'The Fox & Compass');
  members(DEMO_ACCOUNT, DEMO_TEAM);

  const all = [...itemMeta(DEMO_ITEMS, 'bar'), ...itemMeta(DEMO_KITCHEN, 'kitchen')];

  // Weekly drinks, fortnightly provisions — enough history for cadence, fill
  // rate and a delivery-derived usage rate to all have something to say.
  const received = [
    ...deliveries(DEMO_ACCOUNT, DEMO_VENUE, all, {
      supplier: 'Welloak Drinks', weekday: 4, everyWeeks: 1, count: 11, prefix: 'WO', team: DEMO_TEAM,
    }),
    ...deliveries(DEMO_ACCOUNT, DEMO_VENUE, all, {
      supplier: 'Harbour Provisions', weekday: 2, everyWeeks: 2, count: 6, prefix: 'HB', team: DEMO_TEAM,
    }),
  ];

  // Three counts, the most recent a few days ago so forecasts stay anchored.
  const lastTake = stockTakes(DEMO_ACCOUNT, DEMO_VENUE, all, DEMO_TEAM, [63, 32, 4]);
  const lost = wastage(DEMO_ACCOUNT, DEMO_VENUE, all, DEMO_TEAM);

  // Closing position = last count + delivered since − wasted since.
  const qty = {};
  for (const it of all) qty[it.id] = lastTake?.counts[it.id]?.quantity || 0;
  const since = lastTake ? lastTake.at.getTime() : 0;
  for (const r of received) if (r.at.getTime() > since) qty[r.itemId] = (qty[r.itemId] || 0) + r.quantity;
  for (const w of lost) if (w.at.getTime() > since) qty[w.itemId] = (qty[w.itemId] || 0) - w.quantity;

  writeStockItems(DEMO_ACCOUNT, DEMO_VENUE, all, qty, 'Priya Nair');
  console.log(`  account ${DEMO_ACCOUNT} · venue ${DEMO_VENUE} · ${all.length} items · ${DEMO_TEAM.length} members`);
  console.log(`  ${received.length} delivery lines · 3 stock takes · closing stock derived from the history`);
}

/**
 * Read back what the provisioning function generated. Passwords aren't chosen
 * here — syncMemberAuth creates the auth user and writes a memorable
 * `initialPassword` onto the member doc, flagged mustChangePassword.
 */
async function showPasswords() {
  for (const accountId of [TEST_ACCOUNT, DEMO_ACCOUNT]) {
    const res = await fetch(`${BASE}/${PARENT}/accounts/${accountId}/members?pageSize=50`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (!res.ok) { console.log(`\n${accountId}: ${res.status}`); continue; }
    const body = await res.json();
    console.log(`\n${accountId}`);
    for (const d of body.documents || []) {
      const g = (k) => d.fields?.[k]?.stringValue || '';
      if (!g('email')) continue;
      console.log(`  ${g('role').padEnd(8)} ${g('email').padEnd(40)} ${g('initialPassword') || '(already changed)'}`);
    }
  }
}

(async () => {
  if (process.argv.includes('--passwords')) return showPasswords();
  if (ONLY !== 'demo') buildTest();
  if (ONLY !== 'test') buildDemo();
  await commit();
  if (!DRY) {
    console.log('\nDone. Provisioning runs asynchronously — give it a few seconds, then:');
    console.log('  TOKEN=$(gcloud auth print-access-token) node scripts/seed-sandbox.cjs --passwords');
  }
})().catch((e) => { console.error(e); process.exit(1); });
