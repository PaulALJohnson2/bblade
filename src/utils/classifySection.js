/**
 * classifySection — guess whether a stock category belongs to Bar, Kitchen,
 * or is not real stock (Ignore). Till/EPOS exports dump food and drink into one
 * list; this pre-fills the Bar/Kitchen/Ignore sort screen so the admin only has
 * to correct the rare miss.
 *
 * Category-level (not per-item): a pub's categories are almost always wholly
 * food or wholly drink, so classifying ~30 categories covers hundreds of items.
 */

const KITCHEN = [
  'pudding', 'dessert', 'brownie', 'ice cream', 'kids', 'meal', 'breakfast',
  'brunch', 'roast', 'main', 'burger', 'starter', 'light bite', 'sandwich',
  'tapas', 'side', 'snack', 'sunday', 'lunch', 'dinner', 'grill', 'pizza',
  'chips', 'food', 'platter', 'sharing', 'salad', 'wrap', 'panini', 'sauce',
];

const BAR = [
  'draught', 'gin', 'rum', 'vodka', 'whisky', 'whiskey', 'cocktail', 'shot',
  'wine', 'sparkling', 'prosecco', 'champagne', 'soft', 'bottled', 'alcohol',
  'lager', 'beer', 'cider', 'spirit', 'liquor', 'liqueur', 'brandy', 'ale',
  'port', 'sherry', 'vermouth', 'tonic', 'mixer', 'hot drink', 'coffee', 'tea',
  'aperitif', 'stout', 'ipa', 'pale', 'bitter', 'cordial', 'juice', 'minerals',
  'post mix', 'postmix', 'post-mix', 'draught soft',
];

// Strong "this isn't stock" signals — checked first.
const IGNORE_STRONG = ['allerg', 'function', 'offer', 'misc', 'sundry', 'deposit', 'voucher', 'gift'];
// Weak ignore — only if nothing else matched.
const IGNORE_WEAK = ['hotel', 'room', 'accommodation', 'service charge'];

/**
 * @param {string} category
 * @returns {'bar'|'kitchen'|'ignore'|null}  null = couldn't tell
 */
export function classifySection(category) {
  const s = String(category || '').toLowerCase();
  if (!s.trim()) return null;

  if (IGNORE_STRONG.some(k => s.includes(k))) return 'ignore';
  if (KITCHEN.some(k => s.includes(k))) return 'kitchen';
  if (BAR.some(k => s.includes(k))) return 'bar';
  if (IGNORE_WEAK.some(k => s.includes(k))) return 'ignore';
  return null;
}
