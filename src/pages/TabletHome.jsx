/**
 * TabletHome — the home screen of the tablet behind the bar.
 *
 * The tablet is signed in once, as its own staff member, and then left on this
 * page: a card per person. Tap your name, enter your PIN (set it the first
 * time), and the app acts as you until you finish or walk away — see
 * `beginTabletSession` in AuthContext, which is what makes your clock-ins and
 * wastage carry your name rather than the tablet's.
 *
 * Staff features only, and no stock: counting is done on a person's own login
 * (the rules bar the tablet from stock takes outright).
 *
 * Reachable at /tablet from any login, which is how you try it without signing
 * a tablet in. Only a tablet account lands here by default.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { subscribeToShifts } from '../services/apiService';
import { getThemeColors } from '../utils/theme';
import { formatClock, effectiveClockIn } from '../utils/shiftUtils';
import useTheme from '../hooks/useTheme';
import Tile from '../components/Tile';
import PinPad from '../components/PinPad';

/** "Sarah Jones" → "SJ"; a single name gives one letter. */
const initialsOf = (name) => (name || '?')
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((w) => w[0].toUpperCase())
  .join('');

function TabletHome() {
  const navigate = useNavigate();
  const { isDark } = useTheme();
  const colors = getThemeColors(isDark);
  const {
    members, selectedPub, pubName,
    actingMember, beginTabletSession, endTabletSession,
    setStaffPin, verifyStaffPin,
  } = useAuth();

  const [picked, setPicked] = useState(null); // member whose pad is open
  const [busy, setBusy] = useState(false);
  const [shifts, setShifts] = useState(null);
  const [notice, setNotice] = useState('');

  // Live shifts, so a card can say who's already on the clock. Behind a bar
  // that's the most useful thing the screen can tell you at a glance.
  useEffect(() => {
    if (!selectedPub?.path) return undefined;
    const unsub = subscribeToShifts(selectedPub.path, setShifts, () => {});
    return () => unsub();
  }, [selectedPub?.path]);

  const onClockByMember = useMemo(() => {
    const map = new Map();
    (shifts || []).filter((s) => !s.clockOut).forEach((s) => map.set(s.memberId, s));
    return map;
  }, [shifts]);

  // People, not devices: the tablet's own record is excluded, as is anyone off
  // the rota (they have no shifts to clock) or deactivated. Whoever is on the
  // clock sorts first — they're the ones coming back to the tablet.
  const people = useMemo(() => (members || [])
    .filter((m) => m.active !== false && m.onRota !== false && !m.isTablet)
    .sort((a, b) => {
      const aOn = onClockByMember.has(a.id) ? 0 : 1;
      const bOn = onClockByMember.has(b.id) ? 0 : 1;
      if (aOn !== bOn) return aOn - bOn;
      return (a.displayName || '').localeCompare(b.displayName || '');
    }), [members, onClockByMember]);

  const flash = (msg) => { setNotice(msg); setTimeout(() => setNotice(''), 3000); };

  // The pad hands back the PIN; which callable it goes to depends on whether
  // this person has one yet. A returned { error } keeps the pad open and shakes.
  const submitPin = async (pin) => {
    setBusy(true);
    const first = !picked.hasPin;
    const res = first ? await setStaffPin(picked.id, pin) : await verifyStaffPin(picked.id, pin);
    setBusy(false);
    if (!res.success) {
      // "Already exists" means the card's hasPin flag hadn't caught up — they
      // do have a PIN. Flip the pad to asking for it rather than telling them
      // to pick one they can't set.
      if (first && res.code === 'functions/already-exists') {
        setPicked({ ...picked, hasPin: true });
        return { error: 'You already have a PIN — enter it.' };
      }
      return {
        error: res.code === 'functions/resource-exhausted'
          ? 'Too many tries. Ask a manager to reset it.'
          : first ? 'Could not save that PIN. Try again.' : 'That PIN is not right.',
      };
    }
    beginTabletSession(picked);
    setPicked(null);
    if (first) flash('PIN saved — that one is yours from now on.');
    return { ok: true };
  };

  const TILES = [
    {
      key: 'clock', label: 'Clock In', desc: 'Punch in & out of shifts', to: '/clock', accent: colors.success,
      icon: ['M12 22a10 10 0 1 0 0-20a10 10 0 0 0 0 20', 'M12 6v6l4 2'],
    },
    {
      key: 'wastage', label: 'Wastage', desc: 'Log spillage & breakages', to: '/wastage', accent: colors.wastage,
      icon: ['M3 6h18', 'M8 6V4h8v2', 'M6 6l1 14h10l1-14', 'M10 10v6', 'M14 10v6'],
    },
    {
      key: 'rota', label: 'Rota', desc: 'See your shifts & book leave', to: '/rota', accent: colors.primary,
      icon: ['M8 2v4', 'M16 2v4', 'M3 10h18', 'M5 6h14v14H5z'],
    },
  ];

  // ---- Unlocked: this person's own hub ----
  if (actingMember) {
    return (
      <div style={{ maxWidth: '760px', margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
          <div style={{
            width: '54px', height: '54px', borderRadius: '50%', flexShrink: 0,
            backgroundColor: colors.primary, color: colors.onPrimary,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1.25rem', fontWeight: 800,
          }}>
            {initialsOf(actingMember.displayName)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: '1.5rem', color: colors.textPrimary }}>
              Hello {actingMember.displayName}
            </h1>
            <div style={{ fontSize: '0.85rem', color: colors.textSecondary }}>
              Everything you do now is logged in your name.
            </div>
          </div>
          <button
            type="button"
            onClick={endTabletSession}
            style={{
              padding: '0.85rem 1.4rem', borderRadius: '10px', border: `1px solid ${colors.border}`,
              backgroundColor: colors.bgCard, color: colors.textPrimary,
              fontSize: '1rem', fontWeight: 700, cursor: 'pointer', flexShrink: 0,
            }}
          >
            Finish
          </button>
        </div>

        {notice && (
          <div style={{ marginBottom: '1rem', padding: '0.7rem 1rem', borderRadius: '10px', backgroundColor: colors.bgLight, color: colors.textPrimary, fontSize: '0.9rem', fontWeight: 600 }}>
            {notice}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          {TILES.map((t) => (
            <Tile key={t.key} label={t.label} desc={t.desc} icon={t.icon} accent={t.accent} onClick={() => navigate(t.to)} />
          ))}
        </div>

        <div style={{ marginTop: '1.25rem', fontSize: '0.8rem', color: colors.textMuted, textAlign: 'center' }}>
          The tablet returns to the name cards on its own if it's left alone.
        </div>
      </div>
    );
  }

  // ---- Locked: the name cards ----
  return (
    <div style={{ maxWidth: '900px', margin: '0 auto' }}>
      <h1 style={{ margin: '0.25rem 0 0.25rem', fontSize: '1.6rem', color: colors.textPrimary }}>
        {pubName || 'Staff'}
      </h1>
      <p style={{ margin: '0 0 1.5rem', color: colors.textSecondary, fontSize: '0.95rem' }}>
        Tap your name to clock in, log wastage or check the rota.
      </p>

      {notice && (
        <div style={{ marginBottom: '1rem', padding: '0.7rem 1rem', borderRadius: '10px', backgroundColor: colors.bgLight, color: colors.textPrimary, fontSize: '0.9rem', fontWeight: 600 }}>
          {notice}
        </div>
      )}

      {people.length === 0 ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: colors.textSecondary, fontSize: '0.95rem' }}>
          Nobody on the rota yet — add staff in Admin → Account.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '1rem' }}>
          {people.map((m) => {
            const on = onClockByMember.get(m.id);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setPicked(m)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.6rem',
                  padding: '1.4rem 1rem', borderRadius: '18px',
                  border: `1px solid ${on ? colors.success : colors.borderLight}`,
                  backgroundColor: colors.bgCard,
                  boxShadow: `0 2px 12px ${colors.shadow}`,
                  cursor: 'pointer', WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation',
                }}
              >
                <span style={{
                  width: '64px', height: '64px', borderRadius: '50%',
                  backgroundColor: on ? colors.success : colors.primary, color: colors.onPrimary,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '1.4rem', fontWeight: 800,
                }}>
                  {initialsOf(m.displayName)}
                </span>
                <span style={{ fontSize: '1.05rem', fontWeight: 700, color: colors.textPrimary, textAlign: 'center', overflowWrap: 'anywhere' }}>
                  {m.displayName}
                </span>
                <span style={{ fontSize: '0.78rem', color: on ? colors.success : colors.textMuted, fontWeight: on ? 700 : 500, minHeight: '1.1em', textAlign: 'center' }}>
                  {on ? `On since ${formatClock(effectiveClockIn(on))}`
                    : m.hasPin ? '' : 'Tap to set your PIN'}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {picked && (
        <PinPad
          member={picked}
          mode={picked.hasPin ? 'verify' : 'set'}
          busy={busy}
          onSubmit={submitPin}
          onCancel={() => { if (!busy) setPicked(null); }}
        />
      )}
    </div>
  );
}

export default TabletHome;
