/**
 * mealSplit — turn AI meal-breakdowns + the user's per-meal decisions into the
 * final import list. Split meals are archived (kept as a reference); their
 * ingredient components become deduplicated kitchen stock items.
 */

const normName = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const cleanName = (s) => String(s || '').trim().replace(/\s+/g, ' ');

/**
 * From classified items + the AI split map, build the list of meals to review.
 * @returns {Array<{ name, category, components: Array<{name,quantity,unit}> }>}
 */
export function buildMealReviewList(items, splitMap) {
  const meals = [];
  for (const it of items) {
    if (it.archived || (it.section || 'bar') !== 'kitchen') continue;
    const s = splitMap[it.name];
    if (s && s.isMeal && s.components.length) {
      meals.push({
        name: it.name,
        category: it.category || '',
        components: s.components.map((c) => ({
          name: cleanName(c.name),
          quantity: c.quantity || 1,
          unit: c.unit || 'each',
        })),
      });
    }
  }
  return meals;
}

/**
 * Apply per-meal decisions to the classified items.
 * decisions: { [mealName]: { action: 'split'|'keep', components?: [{name,...}] } }
 *  - 'split': archive the meal; add its components as deduped kitchen ingredients
 *  - 'keep' (or no decision): leave the item as-is
 * Components dedupe by name across all meals, and are not re-added if a
 * non-archived item with that name already exists.
 * @returns {Array} final items to import
 */
export function applyMealSplits(items, decisions) {
  const result = items.map((it) => ({ ...it }));

  // Archive the meals the user chose to split.
  for (const it of result) {
    if (decisions[it.name]?.action === 'split') it.archived = true;
  }

  // Names already present and countable (so we don't duplicate a real item).
  const existing = new Set(result.filter((i) => !i.archived).map((i) => normName(i.name)));

  const componentByKey = new Map(); // key -> {name, wholeUnit, partUnit, unit} (first occurrence wins)
  for (const d of Object.values(decisions)) {
    if (d.action !== 'split' || !Array.isArray(d.components)) continue;
    for (const c of d.components) {
      const key = normName(c.name);
      if (!key || existing.has(key) || componentByKey.has(key)) continue;
      componentByKey.set(key, {
        name: cleanName(c.name),
        wholeUnit: c.wholeUnit || '',
        partUnit: c.partUnit || '',
        unit: c.unit || '',
      });
    }
  }

  const components = [...componentByKey.values()].map((c) => ({
    name: c.name,
    section: 'kitchen',
    category: 'Ingredients',
    wholeUnit: c.wholeUnit,
    partUnit: c.partUnit,
    unit: c.unit,
    archived: false,
    categorySuggested: '',
  }));

  return [...result, ...components];
}

/** How many unique new ingredient items the decisions would add (for the preview). */
export function countNewComponents(items, decisions) {
  const before = items.filter((i) => !i.archived).length;
  const after = applyMealSplits(items, decisions).filter((i) => !i.archived).length;
  return after - before;
}
