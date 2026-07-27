/**
 * LearningReward — the moment after a delivery note is logged.
 *
 * The point of this screen is not the number. It's that a landlord watches the
 * system get better at their job, one fact at a time, and then gets told
 * exactly what that buys them next time. So the facts arrive in sequence
 * rather than as a total, and the screen ends on a PREDICTION — "next
 * Tradeteam note: 15 of 19 lines match instantly" — which the next scan either
 * honours or doesn't. A promise that gets kept is what makes this credible
 * rather than decorative.
 *
 * Deliberately restrained: no confetti, no badges. Someone with a bar to run
 * finds that patronising. Energy comes from motion and from the numbers being
 * real, not from fanfare.
 *
 * Props: delta, levelBefore, levelAfter, person, prediction, logged, failed,
 *        colors, accent, onAccent, onDone
 */

import React, { useEffect, useRef, useState } from 'react';
import { FACT_LABELS } from '../utils/learningScore';

/** Ease-out count-up. A total that lands instantly reads as a label. */
function useCountUp(target, ms = 750) {
  const [n, setN] = useState(0);
  const raf = useRef(0);
  useEffect(() => {
    if (!target) { setN(0); return undefined; }
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setN(target); return undefined; }
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / ms);
      setN(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, ms]);
  return n;
}

/** Facts collapsed to one line per kind — "15 supplier codes", not 15 rows. */
function summarise(delta) {
  const rows = [];
  for (const [kind, agg] of Object.entries(delta.byKind || {})) {
    rows.push({
      kind,
      count: agg.count,
      value: agg.value,
      label: agg.count > 1 ? `${FACT_LABELS[kind]} ×${agg.count}` : FACT_LABELS[kind],
      // One example gives the summary something concrete to point at.
      detail: delta.facts.find((f) => f.kind === kind)?.detail || '',
    });
  }
  return rows.sort((a, b) => b.value - a.value);
}

function LearningReward({
  delta, levelBefore, levelAfter, person, prediction, logged, failed,
  colors, accent, onAccent, onDone,
}) {
  const total = delta?.total || 0;
  const shown = useCountUp(total);
  const rows = summarise(delta || {});
  const levelledUp = levelAfter && levelBefore && levelAfter.level > levelBefore.level;
  const next = levelAfter?.next;

  // The bar fills from where it stood, so the movement is the reward.
  const [barTo, setBarTo] = useState(levelledUp ? 0 : (levelBefore?.progress || 0));
  useEffect(() => {
    const t = setTimeout(() => setBarTo(levelAfter?.progress || 0), 420);
    return () => clearTimeout(t);
  }, [levelAfter]);

  return (
    <div style={{ padding: '1.5rem 1.25rem 1.1rem', textAlign: 'center', overflowY: 'auto' }}>
      <div
        className="bb-pop"
        style={{
          width: '54px', height: '54px', margin: '0 auto 0.75rem', borderRadius: '50%',
          backgroundColor: accent, color: onAccent, display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: '1.6rem', fontWeight: 700,
        }}
      >✓</div>

      <div style={{ fontSize: '0.82rem', color: colors.textSecondary }}>
        {logged} deliver{logged === 1 ? 'y' : 'ies'} logged
        {failed > 0 && ` · ${failed} failed`}
      </div>

      {total > 0 ? (
        <>
          <div className="bb-rise" style={{ fontSize: '2.6rem', fontWeight: 800, color: accent, lineHeight: 1.1, marginTop: '0.35rem' }}>
            +{shown}
          </div>
          <div style={{ fontSize: '0.85rem', color: colors.textPrimary, fontWeight: 600 }}>
            learned from this note
          </div>
          {person && (
            <div className="bb-rise" style={{ fontSize: '0.78rem', color: colors.textSecondary, marginTop: '0.2rem', animationDelay: '0.1s' }}>
              Nice one, {person}
            </div>
          )}
        </>
      ) : (
        <div style={{ fontSize: '0.9rem', color: colors.textSecondary, marginTop: '0.5rem' }}>
          Nothing new to learn from this one — it already knew every line.
        </div>
      )}

      {/* Level standing. A crossed threshold is the moment, so it's said plainly. */}
      {levelAfter && (
        <div style={{ marginTop: '1.1rem', textAlign: 'left' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginBottom: '0.3rem' }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: levelledUp ? accent : colors.textSecondary }}>
              Level {levelAfter.level} · {levelAfter.name}
            </span>
            {levelledUp && <span className="bb-pop" style={{ fontSize: '0.68rem', fontWeight: 800, color: accent }}>UNLOCKED</span>}
          </div>
          <div style={{ height: '8px', borderRadius: '4px', backgroundColor: colors.bgLight, overflow: 'hidden' }}>
            <div style={{ width: `${Math.round(barTo * 100)}%`, height: '100%', borderRadius: '4px', backgroundColor: accent, transition: 'width 900ms cubic-bezier(.2,.8,.3,1)' }} />
          </div>
          {levelledUp && levelBefore && (
            <div style={{ fontSize: '0.76rem', color: accent, fontWeight: 600, marginTop: '0.35rem' }}>
              {levelAfter.rows[levelAfter.level - 1]?.unlocks}
            </div>
          )}
          {next && (
            <div style={{ fontSize: '0.74rem', color: colors.textSecondary, marginTop: '0.3rem' }}>
              {Math.max(0, next.target - next.have)} to go until <strong>{next.name}</strong> — {next.unlocks.toLowerCase()}
            </div>
          )}
        </div>
      )}

      {/* What it learned, arriving one at a time */}
      {rows.length > 0 && (
        <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.3rem', textAlign: 'left' }}>
          {rows.map((r, i) => (
            <div
              key={r.kind}
              className="bb-rise"
              style={{
                animationDelay: `${0.18 + i * 0.11}s`,
                display: 'flex', alignItems: 'center', gap: '0.55rem',
                padding: '0.5rem 0.6rem', borderRadius: '9px',
                backgroundColor: colors.deliverySoft,
              }}
            >
              <span style={{ flexShrink: 0, color: accent, fontWeight: 700 }}>✓</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.82rem', fontWeight: 600, color: colors.textPrimary }}>{r.label}</div>
                {r.detail && (
                  <div style={{ fontSize: '0.7rem', color: colors.textSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.detail}{r.count > 1 ? ' and others' : ''}
                  </div>
                )}
              </div>
              <span style={{ flexShrink: 0, fontSize: '0.8rem', fontWeight: 700, color: accent }}>+{r.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* The promise. The next scan either keeps it or it doesn't. */}
      {prediction?.lines > 0 && (
        <div
          className="bb-rise"
          style={{
            animationDelay: `${0.28 + rows.length * 0.11}s`,
            marginTop: '1rem', padding: '0.7rem 0.8rem', textAlign: 'left',
            border: `1px dashed ${accent}`, borderRadius: '10px',
          }}
        >
          <div style={{ fontSize: '0.68rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: colors.textSecondary }}>
            Next {prediction.supplier || 'delivery'} note
          </div>
          <div style={{ fontSize: '0.92rem', fontWeight: 700, color: colors.textPrimary, marginTop: '0.15rem' }}>
            {prediction.lines} line{prediction.lines === 1 ? '' : 's'} will match instantly
          </div>
          {prediction.minutes > 0 && (
            <div style={{ fontSize: '0.75rem', color: colors.textSecondary }}>
              about {prediction.minutes} minute{prediction.minutes === 1 ? '' : 's'} you won't spend keying it in
            </div>
          )}
        </div>
      )}

      <button
        onClick={onDone}
        style={{ width: '100%', marginTop: '1.2rem', padding: '0.85rem', border: 'none', borderRadius: '10px', backgroundColor: accent, color: onAccent, fontWeight: 700, fontSize: '1rem', cursor: 'pointer' }}
      >Done</button>
    </div>
  );
}

export default LearningReward;
