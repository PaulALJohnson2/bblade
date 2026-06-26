/**
 * Unit templates — the "how is it counted?" presets shared by the Add-Item
 * picker (UnitPicker) and the count-page size prompt (CountUnitPrompt).
 *
 * Each size emits the canonical wholeUnit/partUnit pair that parseUnitInfo()
 * understands, so the picker is just a friendly front-end over the existing
 * counting engine — no separate maths.
 *
 * `sections` controls where a template is offered: bar items see drink measures
 * (kegs, casks, bottles), kitchen items see food measures (each, pack, weight) —
 * so a counter is never asked to measure a pudding in kegs.
 *
 * Sizes are common UK-trade sizes, most-common first (the first is the default
 * when a template is tapped). The ✎ Custom option covers anything unusual.
 */

export const UNIT_TEMPLATES = [
  // ---- Bar (drinks) ----
  {
    key: 'keg', label: '🛢 Keg', sections: ['bar'], sizes: [
      { label: '50L (11G)', wholeUnit: 'Keg 1*50ltr', partUnit: 'Litre' },
      { label: '30L (6.6G)', wholeUnit: 'Keg 1*30ltr', partUnit: 'Litre' },
      { label: '20L (4.4G)', wholeUnit: 'Keg 1*20ltr', partUnit: 'Litre' },
      { label: '88L (19.4G)', wholeUnit: 'Keg 1*88ltr', partUnit: 'Litre' },
      { label: '100L (22G)', wholeUnit: 'Keg 1*100ltr', partUnit: 'Litre' },
    ],
  },
  {
    key: 'cask', label: '🪵 Cask', sections: ['bar'], sizes: [
      { label: '9G Firkin', wholeUnit: 'Cask 1*9gall', partUnit: 'Gallon' },
      { label: '4.5G Pin', wholeUnit: 'Cask 1*4.5gall', partUnit: 'Gallon' },
      { label: '18G Kilderkin', wholeUnit: 'Cask 1*18gall', partUnit: 'Gallon' },
      { label: '22G', wholeUnit: 'Cask 1*22gall', partUnit: 'Gallon' },
      { label: '36G Barrel', wholeUnit: 'Cask 1*36gall', partUnit: 'Gallon' },
      { label: '54G Hogshead', wholeUnit: 'Cask 1*54gall', partUnit: 'Gallon' },
    ],
  },
  {
    key: 'spirit', label: '🥃 Spirit bottle', sections: ['bar'], sizes: [
      { label: '70cl', wholeUnit: 'Bottle 1*70cl', partUnit: 'Tenth' },
      { label: '1L', wholeUnit: 'Bottle 1*100cl', partUnit: 'Tenth' },
      { label: '1.5L', wholeUnit: 'Bottle 1*150cl', partUnit: 'Tenth' },
      { label: '75cl', wholeUnit: 'Bottle 1*75cl', partUnit: 'Tenth' },
      { label: '50cl', wholeUnit: 'Bottle 1*50cl', partUnit: 'Tenth' },
      { label: '35cl', wholeUnit: 'Bottle 1*35cl', partUnit: 'Tenth' },
      { label: '20cl', wholeUnit: 'Bottle 1*20cl', partUnit: 'Tenth' },
    ],
  },
  {
    key: 'wine', label: '🍷 Wine bottle', sections: ['bar'], sizes: [
      { label: '75cl', wholeUnit: 'Bottle 1*75cl', partUnit: 'Tenth' },
      { label: '37.5cl Half', wholeUnit: 'Bottle 1*37.5cl', partUnit: 'Tenth' },
      { label: '18.7cl', wholeUnit: 'Bottle 1*18.7cl', partUnit: '' },
      { label: '1.5L Magnum', wholeUnit: 'Bottle 1*150cl', partUnit: 'Tenth' },
      { label: '3L', wholeUnit: 'Bottle 1*300cl', partUnit: 'Tenth' },
    ],
  },
  {
    key: 'bottlecan', label: '🍾 Bottle / can', sections: ['bar'], sizes: [
      { label: '330ml', wholeUnit: '330ml', partUnit: '' },
      { label: '440ml', wholeUnit: '440ml', partUnit: '' },
      { label: '500ml', wholeUnit: '500ml', partUnit: '' },
      { label: 'Pint 568ml', wholeUnit: '568ml', partUnit: '' },
      { label: '275ml', wholeUnit: '275ml', partUnit: '' },
      { label: '250ml', wholeUnit: '250ml', partUnit: '' },
      { label: '660ml', wholeUnit: '660ml', partUnit: '' },
      { label: '750ml', wholeUnit: '750ml', partUnit: '' },
    ],
  },

  // ---- Kitchen (food) ----
  {
    key: 'weight', label: '⚖️ Weight', sections: ['kitchen'], sizes: [
      { label: '1kg', wholeUnit: 'Bag 1*1kg', partUnit: 'Kilogram' },
      { label: '2.5kg', wholeUnit: 'Bag 1*2.5kg', partUnit: 'Kilogram' },
      { label: '5kg', wholeUnit: 'Bag 1*5kg', partUnit: 'Kilogram' },
      { label: '500g', wholeUnit: 'Bag 1*500g', partUnit: 'Gram' },
      { label: '250g', wholeUnit: 'Bag 1*250g', partUnit: 'Gram' },
      { label: '10kg', wholeUnit: 'Bag 1*10kg', partUnit: 'Kilogram' },
      { label: '12.5kg', wholeUnit: 'Bag 1*12.5kg', partUnit: 'Kilogram' },
      { label: '20kg', wholeUnit: 'Bag 1*20kg', partUnit: 'Kilogram' },
      { label: '25kg', wholeUnit: 'Bag 1*25kg', partUnit: 'Kilogram' },
    ],
  },
  {
    key: 'pack', label: '🧆 Pack', sections: ['kitchen'], sizes: [
      { label: 'of 6', wholeUnit: 'Pack 1*6Each', partUnit: 'Each' },
      { label: 'of 4', wholeUnit: 'Pack 1*4Each', partUnit: 'Each' },
      { label: 'of 8', wholeUnit: 'Pack 1*8Each', partUnit: 'Each' },
      { label: 'of 10', wholeUnit: 'Pack 1*10Each', partUnit: 'Each' },
      { label: 'of 12', wholeUnit: 'Pack 1*12Each', partUnit: 'Each' },
      { label: 'of 18', wholeUnit: 'Pack 1*18Each', partUnit: 'Each' },
      { label: 'of 24', wholeUnit: 'Pack 1*24Each', partUnit: 'Each' },
    ],
  },

  // ---- Both ----
  {
    key: 'case', label: '📦 Case', sections: ['bar', 'kitchen'], sizes: [
      { label: 'of 24', wholeUnit: 'Case 1*24Each', partUnit: 'Each' },
      { label: 'of 12', wholeUnit: 'Case 1*12Each', partUnit: 'Each' },
      { label: 'of 6', wholeUnit: 'Case 1*6Each', partUnit: 'Each' },
      { label: 'of 8', wholeUnit: 'Case 1*8Each', partUnit: 'Each' },
      { label: 'of 18', wholeUnit: 'Case 1*18Each', partUnit: 'Each' },
      { label: 'of 30', wholeUnit: 'Case 1*30Each', partUnit: 'Each' },
      { label: 'of 48', wholeUnit: 'Case 1*48Each', partUnit: 'Each' },
    ],
  },
  {
    key: 'each', label: '🔢 Each', sections: ['bar', 'kitchen'], sizes: [
      { label: 'Singles', wholeUnit: 'Each', partUnit: '' },
    ],
  },
];

/**
 * Per-template "type your own size" support: given a chosen template and a typed
 * number, build the canonical wholeUnit/partUnit — so a 75L keg or a 90cl bottle
 * works without dropping to the raw whole/part-unit Custom fields.
 */
const CUSTOM_BUILDERS = {
  keg:    { hint: 'Litres', suffix: 'L',  build: n => ({ wholeUnit: `Keg 1*${n}ltr`,  partUnit: 'Litre',    unit: `${n}L` }) },
  cask:   { hint: 'Gallons', suffix: 'G', build: n => ({ wholeUnit: `Cask 1*${n}gall`, partUnit: 'Gallon',   unit: `${n}G` }) },
  spirit: { hint: 'cl', suffix: 'cl',     build: n => ({ wholeUnit: `Bottle 1*${n}cl`, partUnit: 'Tenth',    unit: `${n}cl` }) },
  wine:   { hint: 'cl', suffix: 'cl',     build: n => ({ wholeUnit: `Bottle 1*${n}cl`, partUnit: 'Tenth',    unit: `${n}cl` }) },
  bottlecan: { hint: 'ml', suffix: 'ml',  build: n => ({ wholeUnit: `${n}ml`,          partUnit: '',         unit: `${n}ml` }) },
  weight: { hint: 'kg', suffix: 'kg',     build: n => ({ wholeUnit: `Bag 1*${n}kg`,    partUnit: 'Kilogram', unit: `${n}kg` }) },
  pack:   { hint: 'How many', suffix: '', build: n => ({ wholeUnit: `Pack 1*${n}Each`, partUnit: 'Each',     unit: `of ${n}` }) },
  case:   { hint: 'How many', suffix: '', build: n => ({ wholeUnit: `Case 1*${n}Each`, partUnit: 'Each',     unit: `of ${n}` }) },
};

/** Does this template support a typed custom size? */
export function templateAcceptsCustomSize(templateKey) {
  return !!CUSTOM_BUILDERS[templateKey];
}

/** A hint/suffix for the custom-size input of a template. */
export function customSizeMeta(templateKey) {
  const c = CUSTOM_BUILDERS[templateKey];
  return c ? { hint: c.hint, suffix: c.suffix } : null;
}

/** Build a wholeUnit/partUnit from a template + typed number; null if invalid. */
export function customSizeFor(templateKey, value) {
  const cfg = CUSTOM_BUILDERS[templateKey];
  if (!cfg) return null;
  const n = parseFloat(value);
  if (!(n > 0)) return null;
  return cfg.build(n);
}

/** Templates relevant to a section ('bar' | 'kitchen'); all if section unknown. */
export function templatesForSection(section) {
  if (section !== 'bar' && section !== 'kitchen') return UNIT_TEMPLATES;
  return UNIT_TEMPLATES.filter(t => t.sections.includes(section));
}

// Which template/size does a given wholeUnit/partUnit correspond to?
export function findUnitSelection(wholeUnit, partUnit) {
  for (const t of UNIT_TEMPLATES) {
    for (const s of t.sizes) {
      if (s.wholeUnit === wholeUnit && (s.partUnit || '') === (partUnit || '')) {
        return { templateKey: t.key, sizeLabel: s.label };
      }
    }
  }
  return { templateKey: null, sizeLabel: null };
}

// Has this item had its count method/size captured yet?
export function itemHasUnit(item) {
  return !!(item && item.wholeUnit && String(item.wholeUnit).trim());
}
