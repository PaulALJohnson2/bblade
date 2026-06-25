/**
 * Unit templates — the "how is it counted?" presets shared by the Add-Item
 * picker (UnitPicker) and the count-page size prompt (CountUnitPrompt).
 *
 * Each size emits the canonical wholeUnit/partUnit pair that parseUnitInfo()
 * understands, so the picker is just a friendly front-end over the existing
 * counting engine — no separate maths.
 */

export const UNIT_TEMPLATES = [
  {
    key: 'keg', label: '🛢 Keg', sizes: [
      { label: '30L', wholeUnit: 'Keg 1*30ltr', partUnit: 'Litre' },
      { label: '50L', wholeUnit: 'Keg 1*50ltr', partUnit: 'Litre' },
      { label: '100L', wholeUnit: 'Keg 1*100ltr', partUnit: 'Litre' },
    ],
  },
  {
    key: 'cask', label: '🪵 Cask', sizes: [
      { label: '9G Firkin', wholeUnit: 'Cask 1*9gall', partUnit: 'Gallon' },
      { label: '4.5G Pin', wholeUnit: 'Cask 1*4.5gall', partUnit: 'Gallon' },
      { label: '18G Kil', wholeUnit: 'Cask 1*18gall', partUnit: 'Gallon' },
      { label: '22G', wholeUnit: 'Cask 1*22gall', partUnit: 'Gallon' },
    ],
  },
  {
    key: 'spirit', label: '🥃 Spirit bottle', sizes: [
      { label: '70cl', wholeUnit: 'Bottle 1*70cl', partUnit: 'Tenth' },
      { label: '1L', wholeUnit: 'Bottle 1*100cl', partUnit: 'Tenth' },
      { label: '1.5L', wholeUnit: 'Bottle 1*150cl', partUnit: 'Tenth' },
      { label: '35cl', wholeUnit: 'Bottle 1*35cl', partUnit: 'Tenth' },
    ],
  },
  {
    key: 'wine', label: '🍷 Wine bottle', sizes: [
      { label: '75cl', wholeUnit: 'Bottle 1*75cl', partUnit: 'Tenth' },
      { label: '1.5L Magnum', wholeUnit: 'Bottle 1*150cl', partUnit: 'Tenth' },
      { label: '18.7cl', wholeUnit: 'Bottle 1*18.7cl', partUnit: '' },
    ],
  },
  {
    key: 'case', label: '📦 Case + singles', sizes: [
      { label: 'of 12', wholeUnit: 'Case 1*12Each', partUnit: 'Each' },
      { label: 'of 24', wholeUnit: 'Case 1*24Each', partUnit: 'Each' },
      { label: 'of 48', wholeUnit: 'Case 1*48Each', partUnit: 'Each' },
    ],
  },
  {
    key: 'weight', label: '⚖️ Weight', sizes: [
      { label: '5kg', wholeUnit: 'Bag 1*5kg', partUnit: 'Kilogram' },
      { label: '10kg', wholeUnit: 'Bag 1*10kg', partUnit: 'Kilogram' },
      { label: '25kg', wholeUnit: 'Bag 1*25kg', partUnit: 'Kilogram' },
    ],
  },
  {
    key: 'each', label: '🔢 Each', sizes: [
      { label: 'Singles', wholeUnit: 'Each', partUnit: '' },
    ],
  },
];

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
