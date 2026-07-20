// Seed the global `catalog` collection (the cross-venue product lookup that
// pre-fills category/size when adding stock) from every account's stockItems.
// Groups by normalised name, majority-votes category/unit where venues
// disagree. Deterministic doc IDs (the nameKey slug) so re-runs upsert —
// re-run whenever a new venue's stock has been categorised.
//
//   TOKEN=$(gcloud auth print-access-token) DRY=1 node scripts/seed-catalog.cjs   # preview
//   TOKEN=$(gcloud auth print-access-token)       node scripts/seed-catalog.cjs   # write
//
// The nameKey normalisation here must stay in step with productNameKey() in
// src/services/catalogService.js.
const BASE = 'https://firestore.googleapis.com/v1';
const PARENT = 'projects/bar-blade/databases/(default)/documents';
const TOKEN = process.env.TOKEN;

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}/${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(body).slice(0, 400)}`);
  return body;
}

const g = (f, k) => f?.[k]?.stringValue ?? f?.[k]?.integerValue ?? f?.[k]?.doubleValue ?? '';

// Venue item names cleaned out of the catalog on 2026-07-20 (duplicates and
// typos of entries we keep — "Barcardi", "Guinness - 0%" vs "Guinness 0.0",
// etc.). Their nameKeys are skipped on re-seed so the dupes don't come back
// while the underlying stock items still carry the old names.
const SUPPRESS_NAMES = [
  'Guinness - 0%', 'Guinness Zero', 'Barcardi', 'Appletizer', 'Gray Goose',
  'Jamesons', 'Jonnie Walker Black', 'Jack Danials Honey', 'Jack Danials Fire',
  'Jack Danials Blackcurrant', 'Kracken Rum', 'Kracken Coffee', 'Veuve Cliquet',
  'Tanquary No Ten', 'Hendricks him', 'Heinken Zero', 'Old Moat',
  "Peach Schnapps's", 'Courvosier VS', 'Capt Morgans Spiced',
  'Captain Morgans Dark Rum', 'Coke Bottle', 'Coke Zero Bottle',
  'Diet Coke Bottle', 'Redbull', 'Fevertree Tonic', 'Fevertree light',
  'Fevertree mediterranean', 'Fevertree Elderflower', 'J20 - Apple & Raspberry',
  'J20 - Orange & Passionfruit', 'Jägermeister', 'Kahlúa', 'Glenfiddich 12yr',
  'Glenmorangie', 'Famous Grouse', 'Fireball whiskey', 'Havana Club Rum',
  'Madri', 'Malfy Gin', 'Mount Gay', 'Laphroaig', 'Peroni - 0%',
  'Remy Martin V.S.O.P', 'Smirnoff', 'Tanqueray Gin', 'Tanqueray Sevilla Orange',
  'Thatchers', 'Whitley Neill Gin', 'St. Germain', 'Corona', '0% prosecco',
  'Prosecco rosé Mini', 'Test beer',
];

// Normalise a product name for matching: lowercase, straighten curly quotes,
// drop punctuation, collapse whitespace. "Jack Daniel’s" == "jack daniels".
const nameKey = (name) => String(name || '')
  .toLowerCase()
  .replace(/[’‘`]/g, "'")
  .replace(/[^a-z0-9&%.' ]+/g, ' ')
  .replace(/'/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const mode = (arr) => {
  const counts = new Map();
  for (const v of arr) if (v !== '' && v != null) counts.set(v, (counts.get(v) || 0) + 1);
  let best = '', n = 0;
  for (const [v, c] of counts) if (c > n) { best = v; n = c; }
  return best;
};

(async () => {
  // Collection-group sweep of every stockItems doc across all accounts.
  const rows = [];
  let pageToken;
  do {
    const q = {
      structuredQuery: {
        from: [{ collectionId: 'stockItems', allDescendants: true }],
        limit: 1000,
        ...(pageToken ? {} : {}),
      },
    };
    // runQuery has no page token; use offset-free single sweep with cursor on __name__.
    if (rows.length) q.structuredQuery.startAt = { values: [{ referenceValue: rows[rows.length - 1].ref }], before: false };
    q.structuredQuery.orderBy = [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }];
    const res = await api(`${PARENT.replace('/documents', '')}/documents:runQuery`, { method: 'POST', body: JSON.stringify(q) });
    const docs = res.map(r => r.document).filter(Boolean);
    for (const d of docs) rows.push({ ref: d.name, f: d.fields || {} });
    pageToken = docs.length === 1000;
  } while (pageToken);
  console.log('swept', rows.length, 'stock items across all accounts');

  // Keep rows that can teach us something: a name plus category and/or unit.
  const groups = new Map();
  for (const { f } of rows) {
    if (f.archived?.booleanValue) continue;
    const name = String(g(f, 'name')).trim();
    const key = nameKey(name);
    if (!key) continue;
    const category = String(g(f, 'category')).trim();
    const wholeUnit = String(g(f, 'wholeUnit')).trim();
    if (!category && !wholeUnit) continue;
    (groups.get(key) || groups.set(key, []).get(key)).push({
      name,
      category,
      section: g(f, 'section') === 'kitchen' ? 'kitchen' : 'bar',
      wholeUnit,
      partUnit: String(g(f, 'partUnit')).trim(),
      unit: String(g(f, 'unit')).trim(),
      casePack: parseInt(g(f, 'casePack'), 10) || 0,
    });
  }

  const suppress = new Set(SUPPRESS_NAMES.map(nameKey));
  const now = new Date().toISOString();
  const writes = [];
  for (const [key, arr] of [...groups.entries()].sort()) {
    if (suppress.has(key)) continue;
    const unitVote = mode(arr.map(r => r.wholeUnit && `${r.wholeUnit}|${r.partUnit}|${r.unit}|${r.casePack}`));
    const [wholeUnit = '', partUnit = '', unit = '', casePack = '0'] = unitVote ? unitVote.split('|') : [];
    const entry = {
      name: mode(arr.map(r => r.name)),
      nameKey: key,
      category: mode(arr.map(r => r.category)),
      section: mode(arr.map(r => r.section)) || 'bar',
      wholeUnit, partUnit, unit,
      casePack: parseInt(casePack, 10) || 0,
      sources: arr.length,
      updatedAt: now,
    };
    const id = key.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100);
    if (!id) continue;
    console.log(`${entry.name.padEnd(36)} | ${String(entry.category).padEnd(22)} | ${entry.wholeUnit.padEnd(18)} | x${entry.sources}`);
    writes.push({
      update: {
        name: `${PARENT}/catalog/${id}`,
        fields: {
          name: { stringValue: entry.name },
          nameKey: { stringValue: entry.nameKey },
          category: { stringValue: entry.category },
          section: { stringValue: entry.section },
          wholeUnit: { stringValue: entry.wholeUnit },
          partUnit: { stringValue: entry.partUnit },
          unit: { stringValue: entry.unit },
          casePack: { integerValue: String(entry.casePack) },
          sources: { integerValue: String(entry.sources) },
          updatedAt: { timestampValue: entry.updatedAt },
        },
      },
    });
  }
  console.log(`\n${writes.length} catalog entries prepared`);
  if (process.env.DRY) { console.log('DRY RUN — nothing written'); return; }
  for (let i = 0; i < writes.length; i += 400) {
    const res = await api(`${PARENT.replace('/documents', '')}/documents:commit`, {
      method: 'POST', body: JSON.stringify({ writes: writes.slice(i, i + 400) }),
    });
    console.log('committed', (res.writeResults || []).length);
  }
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
