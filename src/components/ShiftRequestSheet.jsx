/**
 * ShiftRequestSheet — "can't work this?" A centred modal a staff member gets
 * from their own shift card. Two ways out of a shift, both needing the
 * manager's sign-off before the rota changes:
 *
 *   Offer it up      — the day goes on the board for any free colleague to
 *                      take (a give-away).
 *   Swap with someone — trade the day for one of a colleague's days this week.
 *                      Only mutually-workable trades are offered: they must be
 *                      free on your day, you must be free on theirs.
 */

import React, { useState } from 'react';
import { getThemeColors } from '../utils/theme';
import { shiftRangeLabel } from '../utils/rota';
import useTheme from '../hooks/useTheme';

// A button label that never resizes when it flips to its busy text. `align`
// matches the surrounding layout (the big option buttons are left-aligned).
function BtnLabel({ idle, busyLabel, busy, align = 'center' }) {
  return (
    <span style={{ display: 'grid', placeItems: `center ${align}` }}>
      <span style={{ gridArea: '1 / 1', visibility: busy ? 'hidden' : 'visible' }}>{idle}</span>
      <span style={{ gridArea: '1 / 1', visibility: busy ? 'visible' : 'hidden' }}>{busyLabel}</span>
    </span>
  );
}

function ShiftRequestSheet({ dayLabel, shifts, timeFormat, colleagues, swapsLoading = false, onSubmit, onClose }) {
  const { isDark } = useTheme();
  const colors = getThemeColors(isDark);
  const [step, setStep] = useState('choose'); // 'choose' | 'swap'
  const [busy, setBusy] = useState(null); // 'giveaway' | 'swap:{memberId}:{weekId}:{dayKey}'
  const [error, setError] = useState('');

  const anySwaps = colleagues.some((c) => c.days.length > 0);
  const times = shifts.map((s) => shiftRangeLabel(s, timeFormat)).join(' & ');

  const submit = async (kind, target, busyKey) => {
    if (busy) return;
    setError('');
    setBusy(busyKey);
    const res = await onSubmit(kind, target);
    setBusy(null);
    if (!res.success) setError(res.error || 'Could not send the request.');
    // Success closes the sheet from the parent.
  };

  const overlay = {
    position: 'fixed', inset: 0, zIndex: 7000,
    backgroundColor: 'rgba(0,0,0,0.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
  };
  const modal = {
    width: '100%', maxWidth: '360px', maxHeight: '90vh', overflowY: 'auto',
    backgroundColor: colors.bgCard, color: colors.textPrimary,
    border: `1px solid ${colors.borderLight}`, borderRadius: '14px',
    boxShadow: colors.shadowMd, padding: '1.25rem',
  };
  const bigOption = (disabled) => ({
    display: 'block', width: '100%', textAlign: 'left',
    padding: '0.8rem 0.9rem', marginBottom: '0.6rem',
    background: 'none', border: `1px solid ${colors.border}`, borderRadius: '10px',
    color: colors.textPrimary, cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  });

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>Can't work {dayLabel}?</div>
        <div style={{ color: colors.textSecondary, fontSize: '0.85rem', marginBottom: '1rem' }}>{times}</div>

        {error && (
          <div style={{ marginBottom: '0.75rem', padding: '0.5rem 0.75rem', borderRadius: '8px', backgroundColor: colors.bgLight, color: colors.error, fontSize: '0.85rem', fontWeight: 600 }}>
            {error}
          </div>
        )}

        {step === 'choose' && (
          <>
            <button type="button" style={bigOption(!!busy)} disabled={!!busy} onClick={() => submit('giveaway', null, 'giveaway')}>
              <span style={{ fontWeight: 700, fontSize: '0.95rem', display: 'block' }}>
                <BtnLabel idle="Offer it up" busyLabel="Sending…" busy={busy === 'giveaway'} align="start" />
              </span>
              <span style={{ color: colors.textSecondary, fontSize: '0.8rem' }}>
                Anyone free can take it; your manager approves.
              </span>
            </button>
            <button type="button" style={bigOption(swapsLoading || !anySwaps || !!busy)} disabled={swapsLoading || !anySwaps || !!busy} onClick={() => setStep('swap')}>
              <span style={{ fontWeight: 700, fontSize: '0.95rem', display: 'block' }}>Swap with someone</span>
              <span style={{ color: colors.textSecondary, fontSize: '0.8rem' }}>
                {swapsLoading ? 'Checking the coming weeks…'
                  : anySwaps ? 'Trade it for one of their days in the coming weeks.'
                    : 'No swappable days in the coming weeks — everything clashes or is off.'}
              </span>
            </button>
          </>
        )}

        {step === 'swap' && (
          <>
            <div style={{ color: colors.textSecondary, fontSize: '0.82rem', marginBottom: '0.6rem' }}>
              Pick the day you'd work instead — they take yours.
            </div>
            {colleagues.filter((c) => c.days.length > 0).map((c) => (
              <div key={c.memberId} style={{ marginBottom: '0.7rem' }}>
                <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.3rem' }}>{c.name}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                  {c.days.map((d) => {
                    const key = `swap:${c.memberId}:${d.weekId || ''}:${d.dayKey}`;
                    return (
                      <button
                        key={key}
                        type="button"
                        disabled={!!busy}
                        onClick={() => submit('swap', { memberId: c.memberId, name: c.name, weekId: d.weekId, dayKey: d.dayKey, shifts: d.shifts }, key)}
                        style={{
                          padding: '0.45rem 0.7rem', fontSize: '0.82rem', fontWeight: 600,
                          borderRadius: '9999px', cursor: busy ? 'progress' : 'pointer',
                          border: `1px solid ${colors.border}`,
                          backgroundColor: colors.bgLight, color: colors.textPrimary,
                          opacity: busy && busy !== key ? 0.6 : 1,
                        }}
                      >
                        <BtnLabel
                          idle={`${d.dayLabel} · ${d.shifts.map((s) => shiftRangeLabel(s, timeFormat)).join(' & ')}`}
                          busyLabel="Sending…"
                          busy={busy === key}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setStep('choose')}
              style={{ background: 'none', border: 'none', color: colors.textSecondary, cursor: 'pointer', fontSize: '0.85rem', textDecoration: 'underline', padding: 0 }}
            >
              ‹ Back
            </button>
          </>
        )}

        <div style={{ display: 'flex', marginTop: '1rem' }}>
          <button
            type="button"
            onClick={onClose}
            style={{ marginLeft: 'auto', padding: '0.7rem 1rem', fontSize: '0.95rem', fontWeight: 700, borderRadius: '8px', cursor: 'pointer', backgroundColor: 'transparent', color: colors.textSecondary, border: `1px solid ${colors.border}` }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default ShiftRequestSheet;
