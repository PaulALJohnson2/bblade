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
