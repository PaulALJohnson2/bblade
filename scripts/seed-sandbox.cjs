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

// The sandbox mirrors a real venue's STOCK LIST — not its trade. Testing
// against invented items misses everything that actually breaks: tenths,
// gallon casks, bag-in-box, cases of odd sizes, curly apostrophes in names.
// This is internal only and must stay that way; the demo account is synthetic
// precisely because that one gets shown to people.
const MIRROR_ACCOUNT = '6MtupVAFlsowDZnqpHQ0'; // The Richmond
const MIRROR_VENUE = '6wjbSy9qEHG6Nhu6OeSh';

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
// Everything this script writes is stamped `seeded`, and pruning only ever
// removes documents carrying that stamp. Without it, re-seeding would delete
// an in-progress stock take somebody was part way through — a playground where
// refreshing the fixtures destroys your work is worse than no fixtures.
const put = (path, data) => writes.push({
  update: { name: `${PARENT}/${path}`, fields: fields({ ...data, seeded: true }) },
});
const del = (path) => writes.push({ delete: `${PARENT}/${path}` });

/**
 * Drop documents the seed no longer produces.
 *
 * A mirror that only ever adds isn't a mirror: items dropped upstream, or left
 * behind by an earlier version of this script, would linger for ever and
 * quietly diverge the sandbox from the thing it's meant to reflect.
 */
async function prune(collectionPath, keepIds) {
  let n = 0;
  let pageToken = '';
  do {
    const url = `${BASE}/${PARENT}/${collectionPath}?pageSize=300`
      + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!res.ok) return n;
    const body = await res.json();
    for (const d of body.documents || []) {
      const id = d.name.split('/').pop();
      const isSeed = d.fields?.seeded?.booleanValue === true;
      if (isSeed && !keepIds.has(id)) { del(`${collectionPath}/${id}`); n += 1; }
    }
    pageToken = body.nextPageToken || '';
  } while (pageToken);
  return n;
}

/**
 * Prune every seeded collection under a venue, keeping exactly what this run
 * produced. Without it a changed document id — `take-1` becoming `take-02`,
 * say — leaves the old history sitting alongside the new, and a usage rate
 * measured across a doubled set of stock takes is worse than no demo at all.
 */
async function pruneSeeded(venuePrefix, collections) {
  const keep = {};
  for (const w of writes) {
    if (!w.update) continue;
    const rel = w.update.name.replace(`${PARENT}/`, '');
    for (const c of collections) {
      const p = `${venuePrefix}/${c}/`;
      if (rel.startsWith(p)) {
        if (!keep[c]) keep[c] = new Set();
        keep[c].add(rel.slice(p.length));
      }
    }
  }
  let total = 0;
  for (const c of collections) total += await prune(`${venuePrefix}/${c}`, keep[c] || new Set());
  return total;
}

async function commit() {
  if (DRY) {
    console.log(`\nDRY RUN — ${writes.length} documents would be written. Nothing sent.`);
    const byCol = {};
    for (const w of writes) {
      const name = w.update ? w.update.name : w.delete;
      const p = name.replace(`${PARENT}/`, '').split('/');
      const col = `${w.update ? '' : 'DELETE '}${p.slice(0, -1).join('/')}`;
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
  // [name, category, unit, supplierCode, costPrice, weeklyUsage]
  // weeklyUsage is in WHOLE units and is the spine of the whole dataset:
  // deliveries replace it, counts hold a week or so of it, and the usage-rate
  // feature measures its way back to roughly this number. Guessing quantities
  // independently is what made the first cut look like an abandoned pub.
  ['Harbour Pale',            'Draught Ale',    KEG(30),  'WK1101', 92.40, 2.2],
  ['Compass Bitter',          'Draught Ale',    CASK(9),  'WK1102', 88.00, 1.4],
  ['Anchor Best',             'Draught Ale',    CASK(9),  'WK1103', 84.50, 0.9],
  ['Ironworks Amber',         'Draught Ale',    KEG(30),  'WK1104', 89.90, 0.7],
  ['Meridian Lager',          'Draught Lager',  KEG(50),  'WK1105', 128.50, 4.5],
  ['Meridian Lager 0.0',      'Draught Lager',  KEG(30),  'WK1106', 96.00, 0.6],
  ['Northbank Pilsner',       'Draught Lager',  KEG(50),  'WK1107', 141.20, 2.8],
  ['Sternlight Premium',      'Draught Lager',  KEG(50),  'WK1108', 152.00, 1.9],
  ['Bay Ridge Helles',        'Draught Lager',  KEG(30),  'WK1109', 118.40, 1.1],
  ['Old Quay Stout',          'Draught Stout',  KEG(50),  'WK1110', 152.75, 3.1],
  ['Windward Cider',          'Draught Cider',  KEG(50),  'WK1111', 118.90, 2.4],
  ['Windward Berry',          'Draught Cider',  KEG(30),  'WK1112', 84.30, 1.3],
  ['Orchard Lane Dry',        'Draught Cider',  KEG(50),  'WK1113', 112.60, 0.8],
  ['Session IPA',             'Draught IPA',    KEG(30),  'WK1114', 99.60, 1.6],
  ['Halyard Hazy',            'Draught IPA',    KEG(30),  'WK1115', 108.20, 1.0],

  ['Meridian Bottles',        'Bottled Beer',   CASE(24), 'WB2201', 28.80, 1.8],
  ['Old Quay Bottles',        'Bottled Beer',   CASE(24), 'WB2202', 31.20, 0.9],
  ['Low Tide 0.5%',           'Bottled Beer',   CASE(24), 'WB2203', 24.00, 0.6],
  ['Sternlight Bottles',      'Bottled Beer',   CASE(24), 'WB2204', 33.60, 1.1],
  ['Corona Bay',              'Bottled Beer',   CASE(24), 'WB2205', 30.00, 1.5],
  ['Gluten Free Lager',       'Bottled Beer',   CASE(24), 'WB2206', 32.40, 0.3],
  ['Windward Bottles',        'Bottled Cider',  CASE(12), 'WB2207', 19.80, 0.7],
  ['Orchard Rhubarb',         'Bottled Cider',  CASE(12), 'WB2208', 21.60, 0.9],
  ['Orchard Mango',           'Bottled Cider',  CASE(12), 'WB2209', 21.60, 0.8],
  ['Orchard Wildberry',       'Bottled Cider',  CASE(12), 'WB2210', 21.60, 1.0],
  ['Alcohol Free Cider',      'Bottled Cider',  CASE(12), 'WB2211', 18.00, 0.2],

  ['Saltmarsh Gin',           'Gin',            BTL(70),  'WS3301', 16.40, 2.4],
  ['Saltmarsh Rhubarb',       'Gin',            BTL(70),  'WS3302', 17.10, 1.6],
  ['Saltmarsh Pink',          'Gin',            BTL(70),  'WS3303', 16.90, 1.9],
  ['Saltmarsh Blackberry',    'Gin',            BTL(70),  'WS3304', 17.10, 1.1],
  ['Saltmarsh Lemon',         'Gin',            BTL(70),  'WS3305', 17.10, 0.7],
  ['Juniper Row London Dry',  'Gin',            BTL(150), 'WS3306', 29.50, 2.1],
  ['Juniper Row Pink',        'Gin',            BTL(150), 'WS3307', 29.50, 1.4],
  ['Harbourmaster Navy',      'Gin',            BTL(70),  'WS3308', 22.80, 0.5],
  ['Botanist Reserve',        'Gin',            BTL(70),  'WS3309', 31.20, 0.4],
  ['Polar Star Vodka',        'Vodka',          BTL(150), 'WS3310', 26.80, 3.2],
  ['Polar Star Citrus',       'Vodka',          BTL(70),  'WS3311', 15.20, 0.8],
  ['Polar Star Raspberry',    'Vodka',          BTL(70),  'WS3312', 15.20, 0.9],
  ['Iceflow Premium',         'Vodka',          BTL(70),  'WS3313', 24.60, 0.6],
  ['Cane & Anchor White',     'Rum',            BTL(150), 'WS3314', 25.40, 1.7],
  ['Cane & Anchor Spiced',    'Rum',            BTL(150), 'WS3315', 26.10, 2.6],
  ['Cane & Anchor Dark',      'Rum',            BTL(70),  'WS3316', 14.80, 0.9],
  ['Cane & Anchor Coconut',   'Rum',            BTL(70),  'WS3317', 14.20, 1.2],
  ['Cane & Anchor Cherry',    'Rum',            BTL(70),  'WS3318', 14.20, 0.7],
  ['Glen Toller Blend',       'Whisky',         BTL(70),  'WS3319', 18.60, 1.5],
  ['Glen Toller 12',          'Whisky',         BTL(70),  'WS3320', 32.40, 0.5],
  ['Kentucky Mile Bourbon',   'Whisky',         BTL(70),  'WS3321', 21.30, 1.8],
  ['Kentucky Mile Honey',     'Whisky',         BTL(70),  'WS3322', 21.30, 1.1],
  ['Kentucky Mile Apple',     'Whisky',         BTL(70),  'WS3323', 21.30, 0.9],
  ['Islay Shore 10',          'Whisky',         BTL(70),  'WS3324', 38.90, 0.3],
  ['Dublin Quay Irish',       'Whisky',         BTL(70),  'WS3325', 22.40, 1.0],
  ['Agave Nine Reposado',     'Tequila',        BTL(70),  'WS3326', 24.90, 0.8],
  ['Agave Nine Blanco',       'Tequila',        BTL(70),  'WS3327', 22.60, 1.3],
  ['Vieux Pont VS',           'Brandy',         BTL(70),  'WS3328', 23.80, 0.4],
  ['Amaro Vespro',            'Liqueurs',       BTL(70),  'WS3329', 15.70, 0.9],
  ['Cocoa Nib Cream',         'Liqueurs',       BTL(70),  'WS3330', 13.20, 0.7],
  ['Aniseed Forty',           'Liqueurs',       BTL(70),  'WS3331', 14.10, 1.4],
  ['Aniseed Forty Black',     'Liqueurs',       BTL(70),  'WS3332', 14.10, 0.8],
  ['Bitter Orange Aperitif',  'Liqueurs',       BTL(100), 'WS3333', 17.80, 1.6],
  ['Elderflower Cordial Liq', 'Liqueurs',       BTL(70),  'WS3334', 16.20, 0.5],
  ['Coffee Liqueur',          'Liqueurs',       BTL(70),  'WS3335', 15.40, 1.2],
  ['Peach Schnapps',          'Liqueurs',       BTL(70),  'WS3336', 12.60, 0.6],
  ['Triple Sec',              'Liqueurs',       BTL(70),  'WS3337', 11.80, 0.9],
  ['Herbal Digestif',         'Liqueurs',       BTL(70),  'WS3338', 18.40, 1.1],
  ['Cream Liqueur',           'Liqueurs',       BTL(70),  'WS3339', 13.90, 0.8],
  ['Summer Cup',              'Liqueurs',       BTL(70),  'WS3340', 16.60, 1.0],

  ['House White',             'Wine',           CASE(6),  'WW4401', 38.40, 3.4],
  ['House Red',               'Wine',           CASE(6),  'WW4402', 38.40, 2.9],
  ['House Rosé',              'Wine',           CASE(6),  'WW4403', 37.20, 2.2],
  ['Coastal Sauvignon',       'Wine',           CASE(6),  'WW4404', 52.80, 1.8],
  ['Hillside Malbec',         'Wine',           CASE(6),  'WW4405', 56.40, 1.5],
  ['Stone Ridge Pinot Grigio','Wine',           CASE(6),  'WW4406', 46.20, 2.4],
  ['Old Vine Rioja',          'Wine',           CASE(6),  'WW4407', 58.80, 0.9],
  ['Loire Chenin',            'Wine',           CASE(6),  'WW4408', 51.00, 0.6],
  ['Provence Rosé',           'Wine',           CASE(6),  'WW4409', 66.00, 0.8],
  ['Chianti Riserva',         'Wine',           CASE(6),  'WW4410', 61.20, 0.5],
  ['Prosecco Brut',           'Sparkling',      CASE(6),  'WW4411', 61.50, 1.7],
  ['Prosecco Rosé',           'Sparkling',      CASE(6),  'WW4412', 64.80, 1.1],
  ['Mini Prosecco',           'Sparkling',      CASE(24), 'WW4413', 58.80, 0.6],
  ['Champagne Brut',          'Sparkling',      CASE(6),  'WW4414', 168.00, 0.2],

  ['Cola Post Mix',           'Post Mix',       BIB(7),   'WP5501', 42.30, 2.6],
  ['Diet Cola Post Mix',      'Post Mix',       BIB(7),   'WP5502', 42.30, 2.1],
  ['Lemonade Post Mix',       'Post Mix',       BIB(7),   'WP5503', 39.90, 1.8],
  ['Orange Post Mix',         'Post Mix',       BIB(7),   'WP5504', 39.90, 0.7],
  ['Tonic',                   'Soft Drinks',    CASE(24), 'WP5505', 14.40, 2.8],
  ['Slimline Tonic',          'Soft Drinks',    CASE(24), 'WP5506', 14.40, 2.2],
  ['Elderflower Tonic',       'Soft Drinks',    CASE(24), 'WP5507', 16.80, 1.1],
  ['Mediterranean Tonic',     'Soft Drinks',    CASE(24), 'WP5508', 16.80, 0.9],
  ['Ginger Ale',              'Soft Drinks',    CASE(24), 'WP5509', 15.60, 1.0],
  ['Ginger Beer',             'Soft Drinks',    CASE(24), 'WP5510', 16.20, 1.3],
  ['Soda Water',              'Soft Drinks',    CASE(24), 'WP5511', 11.20, 1.4],
  ['Orange Juice',            'Soft Drinks',    CASE(12), 'WP5512',  9.60, 1.6],
  ['Apple Juice',             'Soft Drinks',    CASE(12), 'WP5513',  9.60, 1.2],
  ['Cranberry Juice',         'Soft Drinks',    CASE(12), 'WP5514', 10.20, 0.8],
  ['Pineapple Juice',         'Soft Drinks',    CASE(12), 'WP5515', 10.20, 0.7],
  ['Tomato Juice',            'Soft Drinks',    CASE(24), 'WP5516', 12.00, 0.3],
  ['Still Water',             'Soft Drinks',    CASE(24), 'WP5517', 10.80, 1.5],
  ['Sparkling Water',         'Soft Drinks',    CASE(24), 'WP5518', 10.80, 1.2],
  ['Energy Drink',            'Soft Drinks',    CASE(24), 'WP5519', 26.40, 1.9],
  ['Cloudy Lemonade',         'Soft Drinks',    CASE(24), 'WP5520', 15.00, 0.9],
  ['Apple & Raspberry',       'Soft Drinks',    CASE(24), 'WP5521', 17.40, 1.1],
  ['Orange & Passionfruit',   'Soft Drinks',    CASE(24), 'WP5522', 17.40, 1.0],

  ['Sea Salt Crisps',         'Snacks',         CASE(24), 'HP7701',  8.40, 1.4],
  ['Cheese & Onion Crisps',   'Snacks',         CASE(24), 'HP7702',  8.40, 1.2],
  ['Salt & Vinegar Crisps',   'Snacks',         CASE(24), 'HP7703',  8.40, 1.0],
  ['Salted Peanuts',          'Snacks',         CASE(24), 'HP7704',  9.60, 0.8],
  ['Dry Roasted Peanuts',     'Snacks',         CASE(24), 'HP7705',  9.60, 0.7],
  ['Pork Crackling',          'Snacks',         CASE(20), 'HP7706', 11.00, 0.5],
  ['Scampi Bites',            'Snacks',         CASE(24), 'HP7707', 10.20, 0.6],
  ['Olives',                  'Snacks',         CASE(12), 'HP7708', 14.40, 0.4],
];
const DEMO_KITCHEN = [
  ['Skin-on Fries',           'Sides',          BAG(10),  'HP7801', 12.60, 6.5],
  ['Chunky Chips',            'Sides',          BAG(10),  'HP7802', 12.20, 3.2],
  ['Onion Rings',             'Sides',          BAG(2.5), 'HP7803',  8.70, 1.8],
  ['Garlic Ciabatta',         'Sides',          CASE(30), 'HP7804', 13.40, 1.1],
  ['Sweet Potato Fries',      'Sides',          BAG(2.5), 'HP7805',  9.40, 2.0],
  ['Beef Patties',            'Mains',          CASE(24), 'HP7806', 28.40, 3.4],
  ['Buttermilk Chicken',      'Mains',          BAG(5),   'HP7807', 31.50, 2.6],
  ['Beer Battered Cod',       'Mains',          CASE(20), 'HP7808', 42.00, 1.9],
  ['Vegan Patties',           'Mains',          CASE(12), 'HP7809', 22.80, 0.8],
  ['Gammon Steaks',           'Mains',          BAG(5),   'HP7810', 34.60, 1.2],
  ['Pork Sausages',           'Mains',          BAG(5),   'HP7811', 21.40, 1.5],
  ['Scampi',                  'Mains',          BAG(2.5), 'HP7812', 26.80, 1.0],
  ['Brioche Buns',            'Bakery',         CASE(48), 'HP7813',  9.80, 2.2],
  ['Seeded Baps',             'Bakery',         CASE(48), 'HP7814',  8.60, 1.1],
  ['Sourdough Loaf',          'Bakery',         CASE(12), 'HP7815', 14.40, 0.9],
  ['Mature Cheddar',          'Dairy',          BAG(2.5), 'HP7816', 18.20, 1.4],
  ['Mozzarella',              'Dairy',          BAG(2.5), 'HP7817', 16.80, 0.7],
  ['Butter Portions',         'Dairy',          CASE(100),'HP7818', 11.20, 0.8],
  ['Double Cream',            'Dairy',          CASE(12), 'HP7819', 15.60, 0.6],
  ['Whole Milk',              'Dairy',          CASE(12), 'HP7820',  9.90, 2.4],
  ['Streaky Bacon',           'Meat',           BAG(2.5), 'HP7821', 16.90, 1.6],
  ['Pulled Pork',             'Meat',           BAG(2.5), 'HP7822', 19.80, 0.9],
  ['Chicken Wings',           'Meat',           BAG(5),   'HP7823', 24.20, 1.7],
  ['Smoked Salmon',           'Fish',           BAG(1),   'HP7824', 28.60, 0.4],
  ['Baby Potatoes',           'Veg',            BAG(10),  'HP7825',  8.80, 1.3],
  ['Mixed Salad',             'Veg',            CASE(6),  'HP7826', 12.40, 2.8],
  ['Tomatoes',                'Veg',            BAG(5),   'HP7827',  9.60, 1.5],
  ['Red Onions',              'Veg',            BAG(5),   'HP7828',  6.80, 1.1],
  ['Garden Peas',             'Frozen',         BAG(2.5), 'HP7829',  5.40, 1.0],
  ['Vanilla Ice Cream',       'Frozen',         CASE(4),  'HP7830', 18.60, 0.7],
  ['Sticky Toffee Pudding',   'Frozen',         CASE(12), 'HP7831', 16.20, 0.9],
  ['Chocolate Brownie',       'Frozen',         CASE(12), 'HP7832', 15.40, 1.0],
  ['Plain Flour',             'Dry Goods',      BAG(16),  'HP7833', 14.20, 0.4],
  ['Rapeseed Oil',            'Dry Goods',      CASE(4),  'HP7834', 26.40, 1.2],
  ['Sea Salt',                'Dry Goods',      BAG(2.5), 'HP7835',  4.80, 0.2],
  ['Peppercorns',             'Dry Goods',      BAG(1),   'HP7836',  9.20, 0.15],
  ['Ketchup',                 'Condiments',     CASE(6),  'HP7837', 13.80, 0.8],
  ['Mayonnaise',              'Condiments',     CASE(4),  'HP7838', 15.20, 0.9],
  ['Burger Sauce',            'Condiments',     CASE(4),  'HP7839', 14.60, 1.1],
  ['Sachet Assortment',       'Condiments',     CASE(200),'HP7840', 18.90, 0.3],
];
/**
 * Unit shapes a real bar list won't necessarily contain. The mirror gives
 * realistic names and messy real-world strings; these make sure casks,
 * weights, packs and loose singles are all present to test against too.
 */
const SHAPE_COVERAGE = [
  ['Sandbox Cask Ale',      'Draught Ale',  CASK(9),        'ZZ9001', 82.00],
  ['Sandbox Pin',           'Draught Ale',  CASK(4.5),      'ZZ9002', 44.00],
  ['Sandbox Bottled Single','Bottled Beer', { wholeUnit: '330ml', partUnit: '', unit: '330ml' }, 'ZZ9003', 1.40],
  ['Sandbox Bulk Flour',    'Dry Goods',    BAG(16),        'ZZ9004', 14.20],
  ['Sandbox Loose Item',    'Sundries',     { wholeUnit: 'Each', partUnit: '', unit: 'Each' }, 'ZZ9005', 0.85],
  ['Sandbox Pack of 6',     'Sundries',     { wholeUnit: 'Pack 1*6Each', partUnit: 'Each', unit: 'of 6' }, 'ZZ9006', 5.40],
];

const SUPPLIERS = {
  WK: 'Welloak Drinks', WB: 'Welloak Drinks', WS: 'Welloak Drinks',
  WW: 'Welloak Drinks', WP: 'Welloak Drinks', HP: 'Harbour Provisions',
  SB: 'Sandbox Supplies', ZZ: 'Sandbox Supplies',
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

/**
 * Pull a live venue's stock list and reshape it into item metadata.
 *
 * Names, categories and units come across verbatim — the unit strings are the
 * whole point, since they're what exercises parseUnitInfo. Quantities do NOT:
 * the sandbox gets its own invented stock so nobody mistakes a playground for
 * a mirror of somebody's live cellar.
 */
async function mirrorStockList(accountId, venueId) {
  const url = `${BASE}/${PARENT}/accounts/${accountId}/venues/${venueId}/stockItems?pageSize=1000`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) throw new Error(`could not read the mirror source: ${res.status}`);
  const body = await res.json();
  const g = (f, k) => (f[k] ? Object.values(f[k])[0] : '');
  return (body.documents || [])
    .map((d, i) => {
      const f = d.fields || {};
      return {
        id: slug(g(f, 'name')),
        name: g(f, 'name'),
        category: g(f, 'category'),
        section: g(f, 'section') === 'kitchen' ? 'kitchen' : 'bar',
        unit: {
          wholeUnit: g(f, 'wholeUnit'),
          partUnit: g(f, 'partUnit'),
          unit: g(f, 'unit'),
        },
        // Mirrored items arrive with no supplier code. Synthesising one lets
        // the sandbox generate delivery notes and learned mappings like any
        // other venue — it's a test fixture, not a claim about the source.
        code: `SB${String(1000 + i)}`,
        cost: Number(g(f, 'costPrice')) || 0,
        archived: g(f, 'archived') === true,
      };
    })
    .filter((i) => i.name && !i.archived);
}

/**
 * A plausible weekly usage for a mirrored item, which arrives without one.
 * Category-shaped rather than uniform, so the sandbox's fast lines behave like
 * fast lines — a playground where everything moves at the same rate hides the
 * bugs that only show up at the extremes.
 */
function assumeWeekly(item) {
  const c = (item.category || '').toLowerCase();
  const base =
    /draught|post mix/.test(c) ? 1.6 :
    /soft|snack|bottled/.test(c) ? 1.1 :
    /wine|sparkling/.test(c) ? 1.3 :
    /gin|vodka|rum|whisk|tequila|liqueur|spirit/.test(c) ? 1.0 :
    0.7;
  return Math.round((base * (0.35 + rand() * 1.5)) * 100) / 100;
}

/** Item metadata only — no writes yet, because quantity depends on history. */
function itemMeta(rows, section) {
  return rows.map(([name, category, unit, code, cost, weekly]) => ({
    id: slug(name), name, category, unit, code, cost, section,
    weekly: weekly || 0.5,
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

  // A running deficit per item, so ordering falls out of consumption instead
  // of being invented. A line used 2.4 kegs a week gets 2 or 3 most weeks; one
  // used 0.2 cases a week turns up every fifth drop with a single case. That's
  // what makes the delivery-derived usage rate land near the real figure, and
  // what stops the demo showing a pub that orders champagne every Thursday.
  const owed = Object.fromEntries(mine.map((i) => [i.id, rand() * 0.8]));
  let noteNo = 0;

  for (let n = count - 1; n >= 0; n--) {
    const back = lastWeekday(weekday, n * everyWeeks);
    const at = daysAgo(back);
    noteNo += 1;
    const who = pick(team).displayName;
    const reference = `${prefix}${100000 + noteNo * 137}`;
    const noteId = `note-${slug(supplier)}-${String(noteNo).padStart(2, '0')}`;

    const lines = [];
    for (const it of mine) {
      owed[it.id] += it.weekly * everyWeeks;
      if (owed[it.id] < 1) continue;
      const ordered = Math.max(1, Math.round(owed[it.id] * (0.85 + rand() * 0.3)));
      owed[it.id] = Math.max(0, owed[it.id] - ordered);

      // One short delivery in the set, so fill rate isn't a flat 100% and the
      // usage-rate censoring rule has something real to exclude.
      const short = n === 3 && it.name === 'Meridian Lager';
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
        units: [{ label: `${it.unit.wholeUnit.split(' ')[0]}s`, count: l.qtyDelivered }],
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
      timesSeen: between(2, 12),
      firstSeenAt: daysAgo(between(90, 130)), lastSeenAt: daysAgo(between(1, 12)),
      accountId, venueId,
    });
  }
  return received;
}

/**
 * Completed stock takes, counted as a plausible level of COVER rather than a
 * random number — roughly half a week to a week and a half of what the line
 * actually sells. That's what makes the cellar read as a working pub instead
 * of one that's about to run dry, and it keeps the variance report's figures
 * inside believable bounds.
 */
function stockTakes(accountId, venueId, items, team, daysBackList) {
  const path = `accounts/${accountId}/venues/${venueId}`;
  let last = null;
  daysBackList.forEach((back, idx) => {
    const at = daysAgo(back);
    const counts = {};
    for (const it of items) {
      const upw = unitsPerWhole(it.unit);
      const cover = 0.5 + rand() * 1.1;            // weeks of stock on hand
      const base = Math.max(0, it.weekly * cover * upw);
      const whole = Math.floor(base / upw);
      const part = Math.round(base - whole * upw);
      counts[it.id] = {
        itemName: it.name,
        quantity: Math.round((whole * upw + part) * 100) / 100,
        wholeCount: whole,
        partCount: part,
        wholeLabel: `${it.unit.wholeUnit.split(' ')[0]}s`,
        partLabel: it.unit.partUnit || '',
        countedBy: pick(team).displayName,
        countedAt: at,
      };
    }
    put(`${path}/stockSessions/take-${String(idx + 1).padStart(2, '0')}`, {
      name: `Stock take ${at.toLocaleDateString('en-GB')}`,
      status: 'completed',
      counts,
      createdBy: team[0].id,
      createdByName: team[0].displayName,
      completedBy: pick(team).displayName,
      startedAt: at, completedAt: at,
      accountId, venueId,
    });
    if (!last || at > last.at) last = { at, counts };
  });
  return last;
}

/** A little wastage, so the variance report has something to show. */
function wastage(accountId, venueId, items, team, howMany = 46) {
  const path = `accounts/${accountId}/venues/${venueId}`;
  const lost = [];
  for (let i = 0; i < howMany; i++) {
    const it = pick(items);
    const at = daysAgo(between(1, howMany > 20 ? 150 : 44));
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

async function buildTest() {
  console.log('\nSandbox (dev playground)');
  account(TEST_ACCOUNT, 'BBlade Sandbox', 'internal');
  venue(TEST_ACCOUNT, TEST_VENUE, 'Sandbox Venue');
  members(TEST_ACCOUNT, TEST_TEAM);

  // Mirror a real stock list so the playground exercises real unit shapes.
  // Falls back to the demo range if the source is unreachable — a sandbox that
  // can't be seeded is worse than one seeded from fiction.
  let rows;
  try {
    rows = await mirrorStockList(MIRROR_ACCOUNT, MIRROR_VENUE);
    console.log(`  mirrored ${rows.length} items from the source venue's stock list`);
  } catch (err) {
    console.warn(`  mirror unavailable (${err.message}) — falling back to the demo range`);
    rows = [...itemMeta(DEMO_ITEMS, 'bar'), ...itemMeta(DEMO_KITCHEN, 'kitchen')];
  }

  // Top up with the shapes the source venue doesn't stock, so cask gallons,
  // bulk weight, packs and loose singles all have something to test against.
  const covered = new Set(rows.map((r) => (r.unit.wholeUnit || '').split(' ')[0].replace(/\d.*/, '')));
  const extras = itemMeta(SHAPE_COVERAGE, 'bar').filter((e) => {
    const head = (e.unit.wholeUnit || '').split(' ')[0].replace(/\d.*/, '');
    return !covered.has(head) || /^Sandbox (Cask|Pin)/.test(e.name);
  });
  rows = [...rows, ...extras];
  if (extras.length) console.log(`  added ${extras.length} items to cover unit shapes the source doesn't stock`);

  // Give every item a usage figure so the sandbox can generate a history the
  // same way the demo does.
  for (const r of rows) r.weekly = r.weekly || assumeWeekly(r);

  // A short history — enough to exercise variance, usage rates and the
  // contribution panel without turning the playground into a second demo.
  // Four counts is three measurable periods: sufficient to test the maths,
  // small enough to hold in your head when something looks wrong.
  const received = deliveries(TEST_ACCOUNT, TEST_VENUE, rows, {
    supplier: 'Sandbox Supplies', weekday: 3, everyWeeks: 1, count: 7, prefix: 'SB', team: TEST_TEAM,
  });
  const lastTake = stockTakes(TEST_ACCOUNT, TEST_VENUE, rows, TEST_TEAM, [45, 31, 17, 3]);
  const lost = wastage(TEST_ACCOUNT, TEST_VENUE, rows, TEST_TEAM, 12);

  const qty = {};
  for (const r of rows) qty[r.id] = lastTake?.counts[r.id]?.quantity || 0;
  const since = lastTake ? lastTake.at.getTime() : 0;
  for (const r of received) if (r.at.getTime() > since) qty[r.itemId] = (qty[r.itemId] || 0) + r.quantity;
  for (const w of lost) if (w.at.getTime() > since) qty[w.itemId] = (qty[w.itemId] || 0) - w.quantity;

  writeStockItems(TEST_ACCOUNT, TEST_VENUE, rows, qty, 'Sandbox Owner');
  const dropped = await pruneSeeded(`accounts/${TEST_ACCOUNT}/venues/${TEST_VENUE}`, [
    'stockItems', 'stockSessions', 'deliveryNotes', 'deliveryLog', 'supplierProducts', 'wastageLog',
  ]);
  if (dropped) console.log(`  pruned ${dropped} documents no longer produced by the seed`);

  const shapes = [...new Set(rows.map((r) => (r.unit.wholeUnit || '').split(' ')[0]))].sort();
  console.log(`  account ${TEST_ACCOUNT} · venue ${TEST_VENUE} · ${rows.length} items · ${TEST_TEAM.length} members`);
  console.log(`  container shapes covered: ${shapes.join(', ')}`);
}

async function buildDemo() {
  console.log('\nDemo (The Fox & Compass — fictional)');
  account(DEMO_ACCOUNT, 'The Fox & Compass', 'demo');
  venue(DEMO_ACCOUNT, DEMO_VENUE, 'The Fox & Compass');
  members(DEMO_ACCOUNT, DEMO_TEAM);

  const all = [...itemMeta(DEMO_ITEMS, 'bar'), ...itemMeta(DEMO_KITCHEN, 'kitchen')];

  // Weekly drinks, fortnightly provisions — enough history for cadence, fill
  // rate and a delivery-derived usage rate to all have something to say.
  const received = [
    ...deliveries(DEMO_ACCOUNT, DEMO_VENUE, all, {
      supplier: 'Welloak Drinks', weekday: 4, everyWeeks: 1, count: 22, prefix: 'WO', team: DEMO_TEAM,
    }),
    ...deliveries(DEMO_ACCOUNT, DEMO_VENUE, all, {
      supplier: 'Harbour Provisions', weekday: 2, everyWeeks: 2, count: 11, prefix: 'HB', team: DEMO_TEAM,
    }),
  ];

  // Fortnightly counts across five months, the most recent a few days ago so
  // forecasts stay anchored. Nine counts is eight measurable periods — enough
  // for the usage rates to reach "good" confidence rather than sitting on
  // "low" through a whole demo.
  const lastTake = stockTakes(DEMO_ACCOUNT, DEMO_VENUE, all, DEMO_TEAM,
    [144, 130, 116, 102, 88, 74, 60, 32, 4]);
  const lost = wastage(DEMO_ACCOUNT, DEMO_VENUE, all, DEMO_TEAM);

  // Closing position = last count + delivered since − wasted since.
  const qty = {};
  for (const it of all) qty[it.id] = lastTake?.counts[it.id]?.quantity || 0;
  const since = lastTake ? lastTake.at.getTime() : 0;
  for (const r of received) if (r.at.getTime() > since) qty[r.itemId] = (qty[r.itemId] || 0) + r.quantity;
  for (const w of lost) if (w.at.getTime() > since) qty[w.itemId] = (qty[w.itemId] || 0) - w.quantity;

  writeStockItems(DEMO_ACCOUNT, DEMO_VENUE, all, qty, 'Priya Nair');

  const dropped = await pruneSeeded(`accounts/${DEMO_ACCOUNT}/venues/${DEMO_VENUE}`, [
    'stockItems', 'stockSessions', 'deliveryNotes', 'deliveryLog', 'supplierProducts', 'wastageLog',
  ]);
  if (dropped) console.log(`  pruned ${dropped} documents from earlier runs`);

  console.log(`  account ${DEMO_ACCOUNT} · venue ${DEMO_VENUE} · ${all.length} items · ${DEMO_TEAM.length} members`);
  console.log(`  ${received.length} delivery lines · 9 stock takes · closing stock derived from the history`);
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
  if (ONLY !== 'demo') await buildTest();
  if (ONLY !== 'test') await buildDemo();
  await commit();
  if (!DRY) {
    console.log('\nDone. Provisioning runs asynchronously — give it a few seconds, then:');
    console.log('  TOKEN=$(gcloud auth print-access-token) node scripts/seed-sandbox.cjs --passwords');
  }
})().catch((e) => { console.error(e); process.exit(1); });
