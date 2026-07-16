/**
 * MealSplitReview — confirm AI meal breakdowns ONE meal at a time before import.
 *
 * For each composite meal the AI found, shows the proposed ingredient components
 * (editable name / qty / unit). The user confirms the split (meal → ingredients)
 * or keeps it as a single item. Built deliberately one-at-a-time to catch
 * mistakes; components are deduped downstream in applyMealSplits().
 *
 * Props:
 *   meals     - [{ name, category, components: [{name, quantity, unit}] }]
 *   colors    - theme colours
 *   onComplete(decisions) - decisions: { [mealName]: {action:'split', components} | {action:'keep'} }
 *   onCancel()
 */

import React, { useState, useEffect } from 'react';
import UnitPicker from './UnitPicker';

// Seed each ingredient's stock unit from the AI's per-portion unit hint, so the
// picker opens on a sensible kitchen measure that the user confirms/adjusts.
function seedUnit(aiUnit) {
  if (aiUnit === 'g' || aiUnit === 'kg') return { wholeUnit: 'Bag 1*1kg', partUnit: 'Kilogram' };
  if (aiUnit === 'each' || aiUnit === 'slice' || aiUnit === 'portion') return { wholeUnit: 'Each', partUnit: '' };
  return { wholeUnit: '', partUnit: '' }; // e.g. ml — let the user pick
}

function MealSplitReview({ meals, colors, onComplete, onCancel }) {
  const [idx, setIdx] = useState(0);
  const [decisions, setDecisions] = useState({});
  const [comps, setComps] = useState([]);

  const meal = meals[idx];

  // Load this meal's components into an editable copy whenever we move card,
  // seeding each with a sensible stock unit.
  useEffect(() => {
    setComps((meal?.components || []).map((c) => ({ name: c.name, ...seedUnit(c.unit) })));
  }, [idx]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!meal) return null;

  const setRow = (i, patch) => setComps(comps.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const removeRow = (i) => setComps(comps.filter((_, j) => j !== i));
  const addRow = () => setComps([...comps, { name: '', wholeUnit: 'Each', partUnit: '' }]);

  const decide = (action) => {
    const entry = action === 'split'
      ? { action: 'split', components: comps.filter((c) => String(c.name).trim()) }
      : { action: 'keep' };
    const next = { ...decisions, [meal.name]: entry };
    setDecisions(next);
    if (idx + 1 >= meals.length) onComplete(next);
    else setIdx(idx + 1);
  };

  const input = {
    padding: '0.55rem', fontSize: '0.95rem', border: `1px solid ${colors.border}`,
    borderRadius: '8px', backgroundColor: colors.bgCard, color: colors.textPrimary, minWidth: 0,
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 3000, backgroundColor: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
    }}>
      <div style={{
        backgroundColor: colors.bgCard, borderRadius: '14px', width: '100%', maxWidth: '460px',
        maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '1rem 1.25rem', borderBottom: `1px solid ${colors.borderLight}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, color: colors.textPrimary }}>Review meal breakdown</div>
            <div style={{ fontSize: '0.8rem', color: colors.textSecondary }}>Meal {idx + 1} of {meals.length}</div>
          </div>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', fontSize: '1.5rem', color: colors.textSecondary, cursor: 'pointer', lineHeight: 1, flexShrink: 0 }}>×</button>
        </div>

        {/* Progress bar */}
        <div style={{ height: '4px', backgroundColor: colors.bgLight }}>
          <div style={{ height: '100%', width: `${(idx / meals.length) * 100}%`, backgroundColor: colors.primary, transition: 'width 0.2s' }} />
        </div>

        {/* Body */}
        <div style={{ padding: '1.25rem', overflowY: 'auto' }}>
          <div style={{ fontSize: '1.2rem', fontWeight: 700, color: colors.textPrimary }}>{meal.name}</div>
          <div style={{ fontSize: '0.85rem', color: colors.textSecondary, margin: '0.25rem 0 1rem' }}>
            Breaks into these ingredients — edit, then confirm. Each becomes a kitchen item to count (duplicates across meals are merged).
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {comps.length === 0 && (
              <div style={{ color: colors.textSecondary, fontSize: '0.85rem', fontStyle: 'italic' }}>No ingredients — add some, or keep as a single item.</div>
            )}
            {comps.map((c, i) => (
              <div key={i} style={{ border: `1px solid ${colors.borderLight}`, borderRadius: '10px', padding: '0.6rem' }}>
                <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <input value={c.name} onChange={(e) => setRow(i, { name: e.target.value })} placeholder="Ingredient" style={{ ...input, flex: 1 }} />
                  <button onClick={() => removeRow(i)} style={{ background: 'none', border: 'none', color: colors.error, fontSize: '1.3rem', cursor: 'pointer', flexShrink: 0 }}>×</button>
                </div>
                <UnitPicker
                  section="kitchen"
                  value={{ wholeUnit: c.wholeUnit, partUnit: c.partUnit }}
                  onChange={(u) => setRow(i, { wholeUnit: u.wholeUnit, partUnit: u.partUnit, unit: u.unit })}
                  colors={colors}
                />
              </div>
            ))}
          </div>

          <button onClick={addRow} style={{ marginTop: '0.6rem', background: 'none', border: `1px dashed ${colors.border}`, color: colors.primary, borderRadius: '8px', padding: '0.5rem', width: '100%', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
            + Add ingredient
          </button>
        </div>

        {/* Footer actions */}
        <div style={{ padding: '0.85rem 1.25rem', borderTop: `1px solid ${colors.borderLight}`, display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {idx > 0 && (
            <button onClick={() => setIdx(idx - 1)} style={{ padding: '0.7rem 0.9rem', backgroundColor: colors.bgLight, color: colors.textPrimary, border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Back</button>
          )}
          <button onClick={() => decide('keep')} style={{ flex: 1, padding: '0.7rem', backgroundColor: colors.bgLight, color: colors.textPrimary, border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>
            Keep as one item
          </button>
          <button onClick={() => decide('split')} style={{ flex: 1.4, padding: '0.7rem', backgroundColor: colors.primary, color: colors.onPrimary, border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}>
            {idx + 1 >= meals.length ? 'Confirm & finish' : 'Confirm split →'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default MealSplitReview;
