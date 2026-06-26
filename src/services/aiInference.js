/**
 * aiInference — category/section inference + meal splitting for stock imports.
 *
 * NOTE: the Firebase AI Logic (Gemini) backend was removed in the AWS migration
 * (the Firebase project is dead). These functions currently run the OFFLINE
 * KEYWORD FALLBACK only — same behaviour the app already had whenever AI was
 * unreachable. The proper AWS replacement (Amazon Bedrock / Claude) is a tracked
 * follow-up; when it lands it slots back in behind these same exports.
 *
 * Exports and return shapes are unchanged so the import flow (StockListUpload,
 * MealSplitReview, enrichItemsWithInference) works untouched.
 */

import { classifySection } from '../utils/classifySection';

/**
 * Classify a venue's distinct categories into bar / kitchen / ignore.
 * @param {string[]} categories
 * @returns {Promise<{ map: Record<string,'bar'|'kitchen'|'ignore'>, source: 'ai'|'fallback' }>}
 */
export async function classifyCategories(categories) {
  const cats = [...new Set(categories.filter((c) => c && c.trim()))];
  const map = {};
  for (const c of cats) map[c] = classifySection(c) || 'bar';
  return { map, source: 'fallback' };
}

/**
 * Infer a category (and section) for items that arrived with no category.
 * Without AI we can't suggest category text, so this returns an empty map
 * (callers default such items to the bar section / capture at count time).
 * @param {string[]} names
 * @returns {Promise<{ map: Record<string,{category:string,section:string}>, source: 'ai'|'fallback' }>}
 */
export async function inferItemCategories(names) {
  void names;
  return { map: {}, source: 'fallback' };
}

/**
 * Break composite meals into countable components. Needs AI; without it we keep
 * each line as a single item (no splitting).
 * @param {string[]} names
 * @returns {Promise<{ map: Record<string,{isMeal:boolean,components:Array}>, source:'ai'|'fallback' }>}
 */
export async function splitMealsIntoComponents(names) {
  void names;
  return { map: {}, source: 'fallback' };
}

/**
 * Enrich a parsed item list with inferred section + suggested category.
 * Returns { items, summary, source }.
 */
export async function enrichItemsWithInference(items) {
  const withCat = items.filter((i) => i.category && i.category.trim());
  const withoutCat = items.filter((i) => !(i.category && i.category.trim()));

  const [catRes, inferRes] = await Promise.all([
    classifyCategories(withCat.map((i) => i.category)),
    inferItemCategories(withoutCat.map((i) => i.name)),
  ]);

  const summary = { bar: 0, kitchen: 0, ignore: 0 };
  const enriched = items.map((item) => {
    let section;
    let archived = false;
    let categorySuggested = '';
    if (item.category && item.category.trim()) {
      const verdict = catRes.map[item.category] || 'bar';
      if (verdict === 'ignore') { archived = true; section = item.section || 'bar'; }
      else section = verdict;
    } else {
      const guess = inferRes.map[item.name];
      if (guess) {
        categorySuggested = guess.category;
        if (guess.section === 'ignore') { archived = true; section = item.section || 'bar'; }
        else section = guess.section;
      } else {
        section = item.section || 'bar';
      }
    }
    summary[archived ? 'ignore' : section] = (summary[archived ? 'ignore' : section] || 0) + 1;
    return { ...item, section, archived, categorySuggested };
  });

  const source = catRes.source === 'ai' || inferRes.source === 'ai' ? 'ai' : 'fallback';
  return { items: enriched, summary, source };
}
