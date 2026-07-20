/**
 * formatCategoryName — tidy a hand-typed category before it becomes a filter
 * pill. Staff type in a hurry ("red wine", "draft ipa") and the raw string
 * carried straight onto the pills; this trims, collapses doubled spaces, and
 * capitalises each word so pills read consistently ("Red Wine", "Draft IPA").
 *
 * Only the first letter of each word is forced up — the rest keep their typed
 * case, so "IPA" survives as typed. A short list of known all-caps pub terms
 * is uppercased outright.
 */

const ACRONYMS = new Set(['ipa']);

export function formatCategoryName(raw) {
  return String(raw || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

/**
 * compareCategories — sort category pills the way a drinks menu (and a stock
 * walk) runs: draught, bottled beer, cider, wine, sparkling, spirits, liqueurs,
 * soft drinks, hot drinks, then the kitchen course order. Categories that match
 * no group land after the known ones; ties inside a group fall back to
 * alphabetical, so unknown names still sort predictably.
 */
const CATEGORY_GROUPS = [
  /\b(draught|draft|tap|keg|cask)\b/,
  /\b(beers?|lagers?|ales?|stout|ipa|pale)\b/,
  /\bciders?\b/,
  /\bwines?\b/,
  /\b(sparkling|prosecco|champagne|fizz)\b/,
  /\bgins?\b/,
  /\bvodkas?\b/,
  /\brums?\b/,
  /\b(whisk|bourbon|scotch)/,
  /\b(tequila|mezcal|brandy|cognac|spirits?)\b/,
  /\b(liqueurs?|aperitifs?|shots?|schnapps)\b/,
  /\b(softs?|mixers?|juices?|waters?|squash|cordials?|minerals?)\b/,
  /\b(coffee|teas?|hot drinks?)\b/,
  /\b(breakfast|brunch)\b/,
  /\b(starters?|light bites?|small plates?|tapas)\b/,
  /\b(mains?|burgers?|grill|pizzas?|roasts?)\b/,
  /\b(sides?|chips|snacks?)\b/,
  /\b(desserts?|puddings?|ice cream|brownies?)\b/,
  /\bkids?\b/,
];

function categoryRank(name) {
  const s = String(name || '').toLowerCase();
  const i = CATEGORY_GROUPS.findIndex((re) => re.test(s));
  return i === -1 ? CATEGORY_GROUPS.length : i;
}

export function compareCategories(a, b) {
  return categoryRank(a) - categoryRank(b) || String(a).localeCompare(String(b));
}
