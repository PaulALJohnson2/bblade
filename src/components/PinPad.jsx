/**
 * PinPad — the 4-digit keypad on the bar tablet.
 *
 * Two jobs behind one component:
 *   mode="set"    first time this person uses the tablet — enter a PIN, then
 *                 confirm it (a typo here would lock them out of their own card
 *                 until a manager reset, so it's always entered twice).
 *   mode="verify" every time after — one entry, checked by the server.
 *
 * Submits itself on the fourth digit: a tablet on a bar is used with one hand,
 * often a wet one, and an extra "OK" tap is one more thing to miss. Keys are
 * deliberately large — this is the only screen in the app designed for a
 * standing person at arm's length.
 *
 * onSubmit(pin) → resolve with { ok } or { error } so the pad can shake and
 * clear without the parent owning any of the entry state.
 */

import React, { useEffect, useRef, useState } from 'react';
import { getThemeColors } from '../utils/theme';
import useTheme from '../hooks/useTheme';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', null, '0', 'del'];
const PIN_LENGTH = 4;

function PinPad({ member, mode = 'verify', onSubmit, onCancel, busy = false }) {
  const { isDark } = useTheme();
  const colors = getThemeColors(isDark);

  const [entry, setEntry] = useState('');
  const [firstPin, setFirstPin] = useState(null); // set mode: the PIN being confirmed
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const submitting = useRef(false);

  const confirming = mode === 'set' && firstPin !== null;

  const fail = (message) => {
    setError(message);
    setShake(true);
    setEntry('');
    setTimeout(() => setShake(false), 400);
  };

  // Runs on the fourth digit. In set mode the first pass just stashes the PIN
  // and asks again; only a matching second pass goes to the server.
  const complete = async (pin) => {
    if (mode === 'set' && firstPin === null) {
      setFirstPin(pin);
      setEntry('');
      setError('');
      return;
    }
    if (mode === 'set' && pin !== firstPin) {
      setFirstPin(null);
      fail("Those didn't match. Start again.");
      return;
    }
    submitting.current = true;
    const res = await onSubmit(pin);
    submitting.current = false;
    if (res && res.error) {
      setFirstPin(null);
      fail(res.error);
    }
  };

  const press = (key) => {
    if (busy || submitting.current) return;
    if (key === 'del') { setEntry((e) => e.slice(0, -1)); return; }
    if (entry.length >= PIN_LENGTH) return;
    setError('');
    const next = entry + key;
    setEntry(next);
    if (next.length === PIN_LENGTH) complete(next);
  };

  // A tablet may well have a keyboard attached (or be a laptop while you test
  // this), so digits, backspace and Escape all work.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key >= '0' && e.key <= '9') press(e.key);
      else if (e.key === 'Backspace') press('del');
      else if (e.key === 'Escape') onCancel?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const title = mode === 'set'
    ? (confirming ? 'Enter it again' : 'Choose a 4-digit PIN')
    : `Hello ${member?.displayName || ''}`;
  const subtitle = mode === 'set'
    ? (confirming
      ? 'Just to be sure you can repeat it.'
      : "This is yours — you'll use it every time you pick up the tablet. Don't use your card PIN.")
    : 'Enter your PIN';

  const key = {
    fontSize: '1.6rem', fontWeight: 700, padding: '1rem 0',
    borderRadius: '14px', border: `1px solid ${colors.border}`,
    backgroundColor: colors.bgCard, color: colors.textPrimary,
    cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
    touchAction: 'manipulation', userSelect: 'none',
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 6000,
        backgroundColor: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem',
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: '340px', padding: '1.5rem',
          backgroundColor: colors.bgCard, borderRadius: '18px',
          boxShadow: `0 18px 50px ${colors.shadow}`,
          transform: shake ? 'translateX(0)' : undefined,
          animation: shake ? 'pinShake 0.4s' : undefined,
        }}
      >
        <style>{`@keyframes pinShake {
          10%, 90% { transform: translateX(-2px); }
          20%, 80% { transform: translateX(4px); }
          30%, 50%, 70% { transform: translateX(-7px); }
          40%, 60% { transform: translateX(7px); }
        }`}</style>

        <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
          <div style={{ fontSize: '1.15rem', fontWeight: 800, color: colors.textPrimary }}>{title}</div>
          <div style={{ fontSize: '0.85rem', color: colors.textSecondary, marginTop: '0.2rem', lineHeight: 1.35 }}>
            {subtitle}
          </div>
        </div>

        {/* Four dots — enough feedback to see a digit landed, nothing anyone
            over your shoulder can read. */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '0.85rem', margin: '1.1rem 0' }}>
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <span
              key={i}
              style={{
                width: '16px', height: '16px', borderRadius: '50%',
                backgroundColor: i < entry.length ? colors.primary : 'transparent',
                border: `2px solid ${i < entry.length ? colors.primary : colors.border}`,
              }}
            />
          ))}
        </div>

        <div style={{ minHeight: '1.2rem', textAlign: 'center', marginBottom: '0.6rem' }}>
          {error && <span style={{ color: colors.error, fontSize: '0.85rem', fontWeight: 600 }}>{error}</span>}
          {!error && busy && <span style={{ color: colors.textSecondary, fontSize: '0.85rem' }}>Checking…</span>}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.6rem' }}>
          {KEYS.map((k, i) => (k === null ? <span key={i} /> : (
            <button
              key={i}
              type="button"
              onClick={() => press(k)}
              style={{ ...key, ...(k === 'del' ? { fontSize: '1.1rem', color: colors.textSecondary } : {}) }}
              aria-label={k === 'del' ? 'Delete' : k}
            >
              {k === 'del' ? '⌫' : k}
            </button>
          )))}
        </div>

        <button
          type="button"
          onClick={onCancel}
          style={{
            marginTop: '1rem', width: '100%', padding: '0.8rem',
            background: 'none', border: 'none', cursor: 'pointer',
            color: colors.textSecondary, fontSize: '0.95rem', fontWeight: 600,
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export default PinPad;
