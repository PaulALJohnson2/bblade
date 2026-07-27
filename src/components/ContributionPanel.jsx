/**
 * ContributionPanel — what the venue has taught the system, and who taught it.
 *
 * Three deliberate choices, all argued in design/learning-rewards.md:
 *
 *   NOT A LEADERBOARD. The team list is alphabetical. A list ordered by points
 *   is a ranking whichever way it's labelled, and stack-ranking colleagues is
 *   the best-evidenced way to make workplace gamification backfire.
 *
 *   THE VENUE TOTAL IS THE SHARED GOAL. Everyone sees the venue's standing and
 *   their own part in it; only managers see the whole team. Shared goals
 *   support relatedness, individual comparison doesn't.
 *
 *   THE GUIDANCE TRAVELS WITH THE NUMBER. We don't pay anyone — but we hand a
 *   figure to someone who may well reward against it, so what it doesn't
 *   measure, and how to use it without doing harm, is on this screen rather
 *   than in a document nobody opens.
 *
 * Two paths, because scoring reads back-office collections staff can't:
 *   MANAGERS compute it live from notes, mappings and every completed count —
 *   too much to pull on every home-screen visit, so it loads on demand — and
 *   publish a small summary as a side effect.
 *   STAFF read that summary. Cheap, and no back-office access required. It
 *   carries an "as of" date because it's a snapshot, not a live figure.
 *
 * Props: venuePath, items, personName, isManager, colors, accent, onAccent
 */

import React, { useMemo, useState } from 'react';
import {
  getSupplierProducts, getAllStockSessions, getDeliveryNotesBetween,
  getLearningProfile, saveLearningProfile,
} from '../services/apiService';
import {
  scoreVenue, scoreByPerson, buildLearningProfile, periodKeyOf, FACT_LABELS,
} from '../utils/learningScore';

const monthStart = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
};
const monthName = () => new Date().toLocaleDateString('en-GB', { month: 'long' });
const shortDate = (ms) => (ms ? new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');

function ContributionPanel({ venuePath, items, personName, isManager, colors, accent, onAccent }) {
  const [state, setState] = useState(null);   // managers: the raw artefacts
  const [cached, setCached] = useState(null); // staff: the published summary
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [showMine, setShowMine] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setOpen(true);
    if (state || cached || loading) return;
    setLoading(true);
    try {
      if (!isManager) {
        const res = await getLearningProfile(venuePath);
        setCached(res.data);
        return;
      }
      const long = new Date(Date.now() - 3 * 365 * 86400000);
      const [codes, notes, sessions] = await Promise.all([
        getSupplierProducts(venuePath),
        getDeliveryNotesBetween(venuePath, long, new Date()),
        getAllStockSessions(venuePath),
      ]);
      const loaded = {
        supplierProducts: codes.data || [],
        notes: notes.data || [],
        sessions: (sessions.success ? sessions.data : []) || [],
      };
      setState(loaded);
      // Publishing is a side effect of a manager looking, so the figure staff
      // see is refreshed by ordinary use rather than needing its own chore.
      saveLearningProfile(venuePath, buildLearningProfile({ ...loaded, items }))
        .catch((err) => console.warn('Could not publish the contribution summary:', err));
    } catch (err) {
      console.error('Could not load contributions:', err);
      setError('Could not load contributions just now.');
    } finally {
      setLoading(false);
    }
  };

  const full = useMemo(() => (state ? { ...state, items } : null), [state, items]);
  const live = useMemo(() => (full ? scoreVenue(full) : null), [full]);
  const livePeople = useMemo(
    () => (full ? scoreByPerson(full, { from: monthStart() }) : []),
    [full],
  );

  // Managers read the live computation; staff read the published summary. The
  // level card is identical either way.
  const venue = live || (cached ? { total: cached.total, level: cached.level, timeSavedMinutes: cached.timeSavedMinutes } : null);
  const people = live ? livePeople : (cached?.people || []);
  const mine = people.find((p) => p.person === personName) || null;

  // A cached month figure is only meaningful inside the month it was computed
  // in — say so rather than quietly showing last month's number as this one's.
  const staleMonth = !live && cached && cached.periodKey !== periodKeyOf();
  const asOf = !live && cached?.computedAt?.toDate ? cached.computedAt.toDate() : null;

  const card = {
    border: `1px solid ${colors.borderLight}`, borderRadius: '12px',
    backgroundColor: colors.bgCard, padding: '0.85rem 1rem',
  };
  const heading = {
    fontSize: '0.68rem', fontWeight: 800, letterSpacing: '0.06em',
    textTransform: 'uppercase', color: colors.textSecondary,
  };

  if (!open) {
    return (
      <button
        onClick={load}
        style={{ ...card, width: '100%', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.6rem' }}
      >
        <span style={{ fontSize: '1.2rem' }}>🧠</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontWeight: 700, color: colors.textPrimary, fontSize: '0.9rem' }}>
            What this place has taught it
          </span>
          <span style={{ display: 'block', fontSize: '0.75rem', color: colors.textSecondary }}>
            Your contribution and the venue's standing
          </span>
        </span>
        <span style={{ color: colors.textMuted }}>›</span>
      </button>
    );
  }

  return (
    <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span style={heading}>What this place has taught it</span>
        <span style={{ flex: 1 }} />
        <button
          onClick={() => setOpen(false)}
          style={{ border: 'none', background: 'transparent', color: colors.textSecondary, fontSize: '0.78rem', cursor: 'pointer' }}
        >Hide</button>
      </div>

      {loading && <div style={{ fontSize: '0.85rem', color: colors.textSecondary }}>Working it out…</div>}
      {error && <div style={{ fontSize: '0.85rem', color: colors.error }}>{error}</div>}
      {!loading && !venue && !error && (
        <div style={{ fontSize: '0.85rem', color: colors.textSecondary }}>
          Nothing worked out yet — this fills in once a manager has opened it.
        </div>
      )}

      {venue && (
        <>
          {/* The shared goal, and the capability it's working towards */}
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
              <span style={{ fontSize: '1.05rem', fontWeight: 800, color: colors.textPrimary }}>
                Level {venue.level.level} · {venue.level.name}
              </span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: '0.78rem', color: colors.textSecondary }}>
                {venue.total} learned
              </span>
            </div>
            <div style={{ height: '8px', borderRadius: '4px', backgroundColor: colors.bgLight, overflow: 'hidden', marginTop: '0.35rem' }}>
              <div style={{ width: `${Math.round(venue.level.progress * 100)}%`, height: '100%', borderRadius: '4px', backgroundColor: accent, transition: 'width 700ms cubic-bezier(.2,.8,.3,1)' }} />
            </div>
            {venue.level.next && (
              <div style={{ fontSize: '0.75rem', color: colors.textSecondary, marginTop: '0.3rem' }}>
                {Math.max(0, venue.level.next.target - venue.level.next.have)} to go until{' '}
                <strong style={{ color: colors.textPrimary }}>{venue.level.next.name}</strong> — {venue.level.next.unlocks.toLowerCase()}
              </div>
            )}
            {asOf && (
              <div style={{ fontSize: '0.7rem', color: colors.textMuted, marginTop: '0.3rem' }}>
                As of {asOf.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
              </div>
            )}
            {venue.timeSavedMinutes > 0 && (
              <div style={{ fontSize: '0.75rem', color: colors.textSecondary, marginTop: '0.2rem' }}>
                About {venue.timeSavedMinutes} minutes not spent keying deliveries in by hand.
              </div>
            )}
          </div>

          {/* Your own part in it */}
          <div style={{ padding: '0.7rem 0.8rem', borderRadius: '10px', backgroundColor: colors.deliverySoft }}>
            <div style={heading}>Your contribution</div>
            {mine ? (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginTop: '0.2rem' }}>
                  <span style={{ fontSize: '1.4rem', fontWeight: 800, color: accent }}>
                    {staleMonth ? mine.lifetime : mine.earned}
                  </span>
                  <span style={{ fontSize: '0.8rem', color: colors.textSecondary }}>
                    {staleMonth ? 'all time' : `in ${monthName()}`}
                  </span>
                  <span style={{ flex: 1 }} />
                  {!staleMonth && (
                    <span style={{ fontSize: '0.78rem', color: colors.textSecondary }}>{mine.lifetime} all time</span>
                  )}
                </div>
                {mine.factCount > 0 && live && (
                  <button
                    onClick={() => setShowMine((v) => !v)}
                    style={{ marginTop: '0.4rem', padding: '0.3rem 0.6rem', border: `1px solid ${colors.border}`, borderRadius: '7px', background: 'transparent', color: colors.textSecondary, fontSize: '0.74rem', cursor: 'pointer' }}
                  >{showMine ? 'Hide the detail' : `See all ${mine.factCount} this month`}</button>
                )}
                {showMine && (
                  <div style={{ marginTop: '0.45rem', display: 'flex', flexDirection: 'column', gap: '0.2rem', maxHeight: '220px', overflowY: 'auto' }}>
                    {mine.facts.map((f) => (
                      <div key={f.key} style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline', fontSize: '0.75rem' }}>
                        <span style={{ flex: 1, minWidth: 0, color: colors.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {FACT_LABELS[f.kind]}{f.detail ? ` · ${f.detail}` : ''}
                        </span>
                        <span style={{ flexShrink: 0, color: colors.textMuted }}>{shortDate(f.earnedAt)}</span>
                        <span style={{ flexShrink: 0, fontWeight: 700, color: accent }}>+{f.value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize: '0.8rem', color: colors.textSecondary, marginTop: '0.2rem' }}>
                {isManager
                  ? 'Nothing yet this month. Scanning a delivery note is the quickest way to teach it something.'
                  : 'Nothing recorded for you yet. Counting stock is what counts towards this.'}
              </div>
            )}
          </div>

          {/* Managers see the whole team — alphabetically, never ranked */}
          {isManager && people.length > 0 && (
            <div>
              <div style={heading}>The team · {monthName()}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginTop: '0.35rem' }}>
                {people.map((p) => (
                  <div key={p.person} style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', padding: '0.4rem 0.5rem', border: `1px solid ${colors.borderLight}`, borderRadius: '8px' }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: '0.85rem', fontWeight: 600, color: colors.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {p.person}
                    </span>
                    <span style={{ flexShrink: 0, fontSize: '0.85rem', fontWeight: 700, color: colors.textPrimary }}>{p.earned}</span>
                    <span style={{ flexShrink: 0, fontSize: '0.72rem', color: colors.textMuted }}>{p.lifetime} all time</span>
                  </div>
                ))}
              </div>

              <button
                onClick={() => setShowGuide((v) => !v)}
                style={{ marginTop: '0.5rem', padding: '0.35rem 0.65rem', border: `1px solid ${colors.border}`, borderRadius: '7px', background: 'transparent', color: colors.textSecondary, fontSize: '0.74rem', cursor: 'pointer' }}
              >{showGuide ? 'Hide' : 'What these numbers are, and are not'}</button>

              {showGuide && (
                <div style={{ marginTop: '0.5rem', padding: '0.7rem 0.8rem', borderRadius: '10px', border: `1px dashed ${colors.border}`, fontSize: '0.78rem', color: colors.textSecondary, lineHeight: 1.5 }}>
                  <p style={{ marginBottom: '0.5rem' }}>
                    This counts what someone <strong style={{ color: colors.textPrimary }}>taught the system</strong> —
                    supplier codes confirmed, products found, case sizes captured, items counted. It is a
                    slice of the job, and not the important slice.
                  </p>
                  <p style={{ marginBottom: '0.5rem' }}>
                    It cannot see good service, care taken over a count, honest reporting, or keeping the
                    cellar straight. Reward only what's here and you'll quietly bid attention away from all
                    of that.
                  </p>
                  <p style={{ marginBottom: '0.5rem' }}>
                    If you do want to recognise it, the evidence favours{' '}
                    <strong style={{ color: colors.textPrimary }}>a surprise over an announced rate</strong>,
                    occasional over standing, and the whole team over one person. A promised amount per point
                    turns willing help into piece work, and taking it away later leaves people less willing
                    than before it started.
                  </p>
                  <p>
                    Watch for contributions climbing while stock variance climbs too. That's the sign the
                    number is being served instead of the pub.
                  </p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default ContributionPanel;
