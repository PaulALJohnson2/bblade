// Pre-populate the global `catalog` with the biggest UK on-trade brands so the
// add-stock lookup works from day one, before any venue has stocked them.
// Entries are marked curated:true / sources:0 and NEVER overwrite an existing
// catalog doc (venue-derived data from seed-catalog.cjs always wins — it also
// outranks these in the client, which sorts equal matches by `sources`).
//
//   TOKEN=$(gcloud auth print-access-token) DRY=1 node scripts/seed-brands.cjs   # preview
//   TOKEN=$(gcloud auth print-access-token)       node scripts/seed-brands.cjs   # write
//
// Names are kept ASCII (Ciroc not Cîroc, Jagermeister not Jägermeister) —
// productNameKey() strips non-ascii, so accented names would get broken keys.
const BASE = 'https://firestore.googleapis.com/v1';
const PARENT = 'projects/bar-blade/databases/(default)/documents';
const TOKEN = process.env.TOKEN;

// ---- unit presets (canonical wholeUnit/partUnit the counting engine knows) --
const sp70 = { wholeUnit: 'Bottle 1*70cl', partUnit: 'Tenth', unit: '70cl', casePack: 0 };
const sp50 = { wholeUnit: 'Bottle 1*50cl', partUnit: 'Tenth', unit: '50cl', casePack: 0 };
const keg50 = { wholeUnit: 'Keg 1*50ltr', partUnit: 'Litre', unit: '50L', casePack: 0 };
const keg30 = { wholeUnit: 'Keg 1*30ltr', partUnit: 'Litre', unit: '30L', casePack: 0 };
const cask9 = { wholeUnit: 'Cask 1*9gall', partUnit: 'Gallon', unit: '9G', casePack: 0 };
const wine75 = { wholeUnit: 'Bottle 1*75cl', partUnit: 'Tenth', unit: '75cl', casePack: 6 };
const btl = (ml, cp) => ({ wholeUnit: `${ml}ml`, partUnit: '', unit: `${ml}ml`, casePack: cp });

// ---- the brands: [name, category, unit] -------------------------------------
const BRANDS = [
  // Draught lager
  ['Carling', 'Draught Lager', keg50], ["Foster's", 'Draught Lager', keg50],
  ['Carlsberg', 'Draught Lager', keg50], ['Stella Artois', 'Draught Lager', keg50],
  ['Heineken', 'Draught Lager', keg50], ['Amstel', 'Draught Lager', keg50],
  ['San Miguel', 'Draught Lager', keg50], ['Estrella Damm', 'Draught Lager', keg50],
  ['Cruzcampo', 'Draught Lager', keg50], ['Madri Excepcional', 'Draught Lager', keg50],
  ['Birra Moretti', 'Draught Lager', keg50], ['Peroni Nastro Azzurro', 'Draught Lager', keg50],
  ['Kronenbourg 1664', 'Draught Lager', keg50], ['Coors', 'Draught Lager', keg50],
  ['Budweiser', 'Draught Lager', keg50], ['Asahi Super Dry', 'Draught Lager', keg50],
  ['Staropramen', 'Draught Lager', keg50], ['Camden Hells', 'Draught Lager', keg30],
  // Draught IPA / pale
  ['Beavertown Neck Oil', 'Draught IPA', keg30], ['BrewDog Punk IPA', 'Draught IPA', keg30],
  ['Camden Pale Ale', 'Draught IPA', keg30], 
  // Draught stout
  ['Guinness', 'Draught Stout', keg50], ["Murphy's", 'Draught Stout', keg50],
  // Draught / cask ale
  ["John Smith's", 'Draught Ale', keg50], ["Tetley's Smooth", 'Draught Ale', keg50],
  ['Doom Bar', 'Draught Ale', cask9], ['London Pride', 'Draught Ale', cask9],
  ['Greene King IPA', 'Draught Ale', cask9], ['Abbot Ale', 'Draught Ale', cask9],
  ['Old Speckled Hen', 'Draught Ale', cask9], ['Timothy Taylor Landlord', 'Draught Ale', cask9],
  ['Hobgoblin', 'Draught Ale', cask9], ['Wainwright', 'Draught Ale', cask9],
  // Draught cider
  ['Strongbow', 'Draught Cider', keg50], ['Strongbow Dark Fruit', 'Draught Cider', keg50],
  ['Thatchers Gold', 'Draught Cider', keg50], ['Thatchers Haze', 'Draught Cider', keg50],
  ["Inch's", 'Draught Cider', keg50], ['Stowford Press', 'Draught Cider', keg50],
  ['Aspall', 'Draught Cider', keg50], ['Somersby', 'Draught Cider', keg50],
  // Bottled beer
  ['Corona Extra', 'Bottled Beer', btl(330, 24)], 
  ['Desperados', 'Bottled Beer', btl(330, 24)], ['Sol', 'Bottled Beer', btl(330, 24)],
  ['Tiger', 'Bottled Beer', btl(330, 24)], ["Beck's", 'Bottled Beer', btl(275, 24)],
  ['Newcastle Brown Ale', 'Bottled Beer', btl(550, 12)], ['Blue Moon', 'Bottled Beer', btl(330, 24)],
  ['Guinness 0.0', 'Bottled Beer', btl(538, 24)], ['Heineken 0.0', 'Bottled Beer', btl(330, 24)],
  ['Peroni Nastro Azzurro 0.0', 'Bottled Beer', btl(330, 24)], ['Lucky Saint', 'Bottled Beer', btl(330, 24)],
  ['Corona Cero', 'Bottled Beer', btl(330, 24)], ['Erdinger Alkoholfrei', 'Bottled Beer', btl(500, 12)],
  // Bottled cider
  ['Kopparberg Strawberry & Lime', 'Bottled Cider', btl(500, 15)],
  ['Kopparberg Mixed Fruit', 'Bottled Cider', btl(500, 15)],
  ['Rekorderlig Strawberry & Lime', 'Bottled Cider', btl(500, 15)],
  ['Old Mout Berries & Cherries', 'Bottled Cider', btl(500, 12)],
  ['Old Mout Kiwi & Lime', 'Bottled Cider', btl(500, 12)],
  ['Magners Original', 'Bottled Cider', btl(568, 12)],
  ['Bulmers Original', 'Bottled Cider', btl(500, 12)],
  ['Henry Westons Vintage', 'Bottled Cider', btl(500, 12)],
  ['Brothers Toffee Apple', 'Bottled Cider', btl(500, 12)],
  // Vodka
  ['Absolut', 'Vodka', sp70], ['Absolut Vanilia', 'Vodka', sp70],
  ['Belvedere', 'Vodka', sp70], ['Ciroc', 'Vodka', sp70],
  ['AU Vodka Blue Raspberry', 'Vodka', sp70], ['AU Vodka Black Grape', 'Vodka', sp70],
  ['AU Vodka Fruit Punch', 'Vodka', sp70], ['Ketel One', 'Vodka', sp70],
  ['Stolichnaya', 'Vodka', sp70], ['Russian Standard', 'Vodka', sp70],
  ['Chase Vodka', 'Vodka', sp70], ['JJ Whitley Artisanal Vodka', 'Vodka', sp70],
  ['Zubrowka Bison Grass', 'Vodka', sp70],
  // Gin
  ['Tanqueray', 'Gin', sp70], ['Tanqueray Flor de Sevilla', 'Gin', sp70],
  ['Tanqueray No. Ten', 'Gin', sp70], ["Hendrick's", 'Gin', sp70],
  ['Beefeater', 'Gin', sp70], ['Beefeater Pink Strawberry', 'Gin', sp70],
  ['Plymouth Gin', 'Gin', sp70], ['Sipsmith London Dry', 'Gin', sp70],
  ['Malfy Gin Rosa', 'Gin', sp70], ['Malfy Con Limone', 'Gin', sp70],
  ["Warner's Rhubarb Gin", 'Gin', sp70], ['Roku Gin', 'Gin', sp70],
  ['Monkey 47', 'Gin', sp50], ['The Botanist', 'Gin', sp70],
  ['Opihr Oriental Spiced', 'Gin', sp70], ['Gin Mare', 'Gin', sp70],
  ['Silent Pool', 'Gin', sp70], ['Whitley Neill Blood Orange', 'Gin', sp70],
  ['Whitley Neill Parma Violet', 'Gin', sp70],
  // Rum
  ['Kraken Black Spiced', 'Rum', sp70], ['Kraken Coffee', 'Rum', sp70], ['Sailor Jerry Spiced', 'Rum', sp70],
  ['Havana Club 3 Year', 'Rum', sp70], ['Havana Club Especial', 'Rum', sp70],
  ['Havana Club 7 Year', 'Rum', sp70], ['Mount Gay Eclipse', 'Rum', sp70],
  ['Wray & Nephew Overproof', 'Rum', sp70], ["Lamb's Navy Rum", 'Rum', sp70],
  ['OVD Demerara Rum', 'Rum', sp70], ["Dead Man's Fingers Spiced", 'Rum', sp70],
  ["Dead Man's Fingers Coconut", 'Rum', sp70], ['Diplomatico Reserva Exclusiva', 'Rum', sp70],
  ['Goslings Black Seal', 'Rum', sp70],
  // Whiskey
  ["Jack Daniel's Fire", 'Whiskey', sp70], ["Jack Daniel's Blackcurrant", 'Whiskey', sp70],
  ["Jack Daniel's Honey", 'Whiskey', sp70], ['The Famous Grouse', 'Whiskey', sp70],
  ["Bell's Original", 'Whiskey', sp70], ['Johnnie Walker Red Label', 'Whiskey', sp70],
  ['Johnnie Walker Black Label', 'Whiskey', sp70], ['Monkey Shoulder', 'Whiskey', sp70],
  ['Chivas Regal 12', 'Whiskey', sp70], ['Glenfiddich 12', 'Whiskey', sp70],
  ['Glenmorangie Original', 'Whiskey', sp70], ['Glenlivet 12', 'Whiskey', sp70],
  ['Laphroaig 10', 'Whiskey', sp70], ['Talisker 10', 'Whiskey', sp70],
  ['Woodford Reserve', 'Whiskey', sp70], ['Bulleit Bourbon', 'Whiskey', sp70],
  ['Jim Beam', 'Whiskey', sp70], ['Wild Turkey', 'Whiskey', sp70],
  ['Canadian Club', 'Whiskey', sp70], ['Tullamore D.E.W.', 'Whiskey', sp70],
  ['Proper No. Twelve', 'Whiskey', sp70], ['Redbreast 12', 'Whiskey', sp70],
  // Other spirits (tequila, brandy/cognac)
  ['Jose Cuervo Especial Gold', 'Other Spirits', sp70],
  ['Jose Cuervo Especial Silver', 'Other Spirits', sp70],
  ['Olmeca Altos Plata', 'Other Spirits', sp70], ['Olmeca Reposado', 'Other Spirits', sp70],
  ['Patron Silver', 'Other Spirits', sp70], ['Don Julio Blanco', 'Other Spirits', sp70],
  ['Casamigos Blanco', 'Other Spirits', sp70], ['El Jimador Blanco', 'Other Spirits', sp70],
  ['Cazcabel Coffee', 'Other Spirits', sp70], ['Cazcabel Honey', 'Other Spirits', sp70],
  ['Hennessy VS', 'Other Spirits', sp70], ['Remy Martin VSOP', 'Other Spirits', sp70],
  ['Martell VS', 'Other Spirits', sp70], ['Three Barrels VSOP', 'Other Spirits', sp70],
  // Liqueurs & aperitifs
  ['Campari', 'Liqueurs & Aperitifs', sp70], ['Peach Schnapps', 'Liqueurs & Aperitifs', sp70], ['Kahlua', 'Liqueurs & Aperitifs', sp70],
  ['Grand Marnier', 'Liqueurs & Aperitifs', sp70], ['Raspberry Sourz', 'Liqueurs & Aperitifs', sp70],
  ['Tequila Rose', 'Liqueurs & Aperitifs', sp70], ['Luxardo Limoncello', 'Liqueurs & Aperitifs', sp70],
  ['Frangelico', 'Liqueurs & Aperitifs', sp70],
  ['Drambuie', 'Liqueurs & Aperitifs', sp70], ['Midori', 'Liqueurs & Aperitifs', sp70],
  ['Passoa', 'Liqueurs & Aperitifs', sp70], ['St Germain', 'Liqueurs & Aperitifs', sp70],
  ['Martini Bianco', 'Liqueurs & Aperitifs', sp70], ['Martini Extra Dry', 'Liqueurs & Aperitifs', sp70],
  ['Martini Rosso', 'Liqueurs & Aperitifs', sp70], ['Fireball', 'Liqueurs & Aperitifs', sp70],
  // Wine
  ['Oyster Bay Sauvignon Blanc', 'Wine', wine75], ['Villa Maria Sauvignon Blanc', 'Wine', wine75],
  ['Casillero del Diablo Merlot', 'Wine', wine75], ['Casillero del Diablo Sauvignon Blanc', 'Wine', wine75],
  ['Barefoot Pinot Grigio', 'Wine', wine75], ['Barefoot White Zinfandel', 'Wine', wine75],
  ['Echo Falls White Zinfandel', 'Wine', wine75], ['Hardys Chardonnay', 'Wine', wine75],
  ['Campo Viejo Rioja', 'Wine', wine75], ['Trivento Malbec', 'Wine', wine75],
  ['19 Crimes Red', 'Wine', wine75], ['Yellow Tail Shiraz', 'Wine', wine75],
  ['Whispering Angel Rose', 'Wine', wine75], ['Cloudy Bay Sauvignon Blanc', 'Wine', wine75],
  // Sparkling
  ['Prosecco 0%', 'Sparkling', btl(200, 24)], ['Prosecco Rose Mini', 'Sparkling', btl(200, 24)],
  ['Freixenet Prosecco', 'Sparkling', wine75], ['Mionetto Prosecco', 'Sparkling', wine75],
  ['Bottega Gold Prosecco', 'Sparkling', wine75], ['Moet & Chandon', 'Sparkling', wine75],
  ['Veuve Clicquot', 'Sparkling', wine75], ['Laurent-Perrier Brut', 'Sparkling', wine75],
  ['Laurent-Perrier Rose', 'Sparkling', wine75], ['Bollinger', 'Sparkling', wine75],
  ['Lanson Black Label', 'Sparkling', wine75], ['Taittinger', 'Sparkling', wine75],
  // Soft drinks
  ['Diet Coke', 'Soft Drinks', btl(330, 24)], 
  ['J2O Orange & Passionfruit', 'Soft Drinks', btl(275, 24)],
  ['J2O Apple & Raspberry', 'Soft Drinks', btl(275, 24)],
  ['J2O Apple & Mango', 'Soft Drinks', btl(275, 24)],
  ['Fever-Tree Indian Tonic Water', 'Soft Drinks', btl(200, 24)],
  ['Fever-Tree Light Tonic Water', 'Soft Drinks', btl(200, 24)],
  ['Fever-Tree Mediterranean Tonic Water', 'Soft Drinks', btl(200, 24)],
  ['Fever-Tree Elderflower Tonic Water', 'Soft Drinks', btl(200, 24)],
  ['Fever-Tree Ginger Beer', 'Soft Drinks', btl(200, 24)],
  ['Schweppes Tonic Water', 'Soft Drinks', btl(200, 24)],
  ['Schweppes Slimline Tonic', 'Soft Drinks', btl(200, 24)],
  ['Schweppes Lemonade', 'Soft Drinks', btl(200, 24)],
  ['Schweppes Ginger Ale', 'Soft Drinks', btl(200, 24)],
  ['Schweppes Soda Water', 'Soft Drinks', btl(200, 24)],
  ['Red Bull', 'Soft Drinks', btl(250, 24)], ['Red Bull Sugarfree', 'Soft Drinks', btl(250, 24)],
  ['Britvic Orange Juice', 'Soft Drinks', btl(160, 24)],
  ['Britvic Pineapple Juice', 'Soft Drinks', btl(160, 24)],
  ['Britvic Cranberry Juice', 'Soft Drinks', btl(160, 24)],
  ['Fentimans Rose Lemonade', 'Soft Drinks', btl(275, 12)],
  ['Fentimans Ginger Beer', 'Soft Drinks', btl(275, 12)],
  // Alcopops / RTDs
  ['WKD Blue', 'Alcopops', btl(275, 24)], ['Smirnoff Ice', 'Alcopops', btl(275, 24)],
  ['VK Blue', 'Alcopops', btl(275, 24)], ['VK Orange & Passionfruit', 'Alcopops', btl(275, 24)],
];

// Must stay in step with productNameKey() in src/services/catalogService.js.
const nameKey = (name) => String(name || '')
  .toLowerCase()
  .replace(/[’‘`]/g, "'")
  .replace(/[^a-z0-9&%.' ]+/g, ' ')
  .replace(/'/g, '')
  .replace(/\s+/g, ' ')
  .trim();

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}/${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(body).slice(0, 400)}`);
  return body;
}

(async () => {
  // Existing catalog IDs — venue-derived entries always win, never overwrite.
  const existing = new Set();
  let pageToken = '';
  do {
    const res = await api(`${PARENT}/catalog?pageSize=300&mask.fieldPaths=nameKey${pageToken ? `&pageToken=${pageToken}` : ''}`);
    for (const d of res.documents || []) existing.add(d.name.split('/').pop());
    pageToken = res.nextPageToken || '';
  } while (pageToken);
  console.log(existing.size, 'existing catalog entries');

  const now = new Date().toISOString();
  const writes = [];
  let skipped = 0;
  const seen = new Set();
  for (const [name, category, u] of BRANDS) {
    const key = nameKey(name);
    const id = key.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100);
    if (!id || seen.has(id)) throw new Error(`bad/duplicate brand row: ${name}`);
    seen.add(id);
    if (existing.has(id)) { skipped++; continue; }
    console.log(`${name.padEnd(40)} | ${category.padEnd(22)} | ${u.unit}${u.casePack ? ` x${u.casePack}` : ''}`);
    writes.push({
      update: {
        name: `${PARENT}/catalog/${id}`,
        fields: {
          name: { stringValue: name },
          nameKey: { stringValue: key },
          category: { stringValue: category },
          section: { stringValue: 'bar' },
          wholeUnit: { stringValue: u.wholeUnit },
          partUnit: { stringValue: u.partUnit },
          unit: { stringValue: u.unit },
          casePack: { integerValue: String(u.casePack) },
          sources: { integerValue: '0' },
          curated: { booleanValue: true },
          updatedAt: { timestampValue: now },
        },
      },
      // Belt and braces: fail the write if the doc appeared since we listed.
      currentDocument: { exists: false },
    });
  }
  console.log(`\n${writes.length} brand entries to add, ${skipped} already in catalog (skipped)`);
  if (process.env.DRY) { console.log('DRY RUN — nothing written'); return; }
  for (let i = 0; i < writes.length; i += 400) {
    const res = await api(`${PARENT.replace('/documents', '')}/documents:commit`, {
      method: 'POST', body: JSON.stringify({ writes: writes.slice(i, i + 400) }),
    });
    console.log('committed', (res.writeResults || []).length);
  }
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
