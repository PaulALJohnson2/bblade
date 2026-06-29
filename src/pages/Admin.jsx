/**
 * Admin — manage the pub (venue) name and the account's staff (members).
 *
 * No auth yet, so this is openly reachable via the header gear. A "member" is an
 * account-level person (identity + role + which venues they can access) used to
 * attribute stock counts; later it becomes a real authenticated user. For now,
 * with a single venue, new members default to venueAccess: 'all'.
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getThemeColors } from '../utils/theme';
import useTheme from '../hooks/useTheme';
import StockListAdmin from '../components/StockListAdmin';
import StockManager from '../components/StockManager';
import WastageReport from '../components/WastageReport';

const ROLES = ['owner', 'manager', 'staff'];

function Admin() {
  const navigate = useNavigate();
  const { pubName, members, saveVenue, saveMember, deleteMember, selectedPub, isAdmin } = useAuth();
  const { isDark } = useTheme();
  const colors = getThemeColors(isDark);

  const [nameInput, setNameInput] = useState(pubName || '');
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState('staff');
  const [savingName, setSavingName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [error, setError] = useState(null);

  // Keep the field in sync if the live value arrives after mount.
  useEffect(() => { setNameInput(pubName || ''); }, [pubName]);

  const handleSaveName = async () => {
    const name = nameInput.trim();
    if (!name) { setError('Please enter a pub name.'); return; }
    setSavingName(true);
    setError(null);
    const res = await saveVenue({ name });
    setSavingName(false);
    if (res.success) {
      setNameSaved(true);
      setTimeout(() => setNameSaved(false), 2000);
    } else {
      setError('Could not save name: ' + res.error);
    }
  };

  const handleAddMember = async () => {
    const displayName = newName.trim();
    const email = newEmail.trim().toLowerCase();
    if (!displayName) return;
    if (members.some(m => (m.displayName || '').toLowerCase() === displayName.toLowerCase())) {
      setError(`"${displayName}" is already a staff member.`);
      return;
    }
    if (email && members.some(m => (m.email || '').toLowerCase() === email)) {
      setError(`${email} is already authorised.`);
      return;
    }
    setError(null);
    const res = await saveMember(null, { displayName, email, role: newRole, venueAccess: 'all', active: true });
    if (res.success) { setNewName(''); setNewEmail(''); setNewRole('staff'); }
    else setError('Could not add staff: ' + res.error);
  };

  const handleRemoveMember = async (member) => {
    setError(null);
    const res = await deleteMember(member.id);
    if (!res.success) setError('Could not remove staff: ' + res.error);
  };

  const card = {
    backgroundColor: colors.bgCard,
    border: `1px solid ${colors.borderLight}`,
    borderRadius: '12px',
    padding: '1.5rem',
    marginBottom: '1.5rem',
    boxShadow: `0 2px 12px ${colors.shadow}`,
  };
  const input = {
    flex: 1,
    minWidth: 0, // allow the field to shrink so neighbouring buttons aren't clipped
    padding: '0.75rem',
    fontSize: '1rem',
    border: `2px solid ${colors.border}`,
    borderRadius: '8px',
    backgroundColor: colors.bgCard,
    color: colors.textPrimary,
    boxSizing: 'border-box',
  };
  const primaryBtn = {
    padding: '0.75rem 1.25rem',
    backgroundColor: colors.primary,
    color: colors.onPrimary,
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '1rem',
    fontWeight: 600,
    flexShrink: 0,
    whiteSpace: 'nowrap',
  };

  return (
    <div style={{ maxWidth: '560px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <button
          onClick={() => navigate('/')}
          style={{
            padding: '0.5rem 0.75rem', backgroundColor: colors.bgLight, color: colors.textPrimary,
            border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.9rem',
          }}
        >
          ← Back
        </button>
        <h1 style={{ margin: 0, fontSize: '1.5rem', color: colors.textPrimary }}>Settings</h1>
      </div>

      {/* Quick entry into the main flows */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <button
          onClick={() => navigate('/stock')}
          style={{ padding: '1rem', borderRadius: '12px', border: 'none', backgroundColor: colors.primary, color: colors.onPrimary, fontWeight: 700, fontSize: '1rem', cursor: 'pointer' }}
        >
          Stock Count
        </button>
        <button
          onClick={() => navigate('/wastage')}
          style={{ padding: '1rem', borderRadius: '12px', border: 'none', backgroundColor: colors.wastage, color: colors.onWastage, fontWeight: 700, fontSize: '1rem', cursor: 'pointer' }}
        >
          Wastage
        </button>
      </div>

      {error && (
        <div style={{
          padding: '0.75rem 1rem', backgroundColor: colors.errorDark, color: 'white',
          borderRadius: '8px', marginBottom: '1rem',
        }}>
          {error}
        </div>
      )}

      {/* Pub (venue) name */}
      <div style={card}>
        <h2 style={{ margin: '0 0 0.25rem', fontSize: '1.1rem', color: colors.textPrimary }}>Pub name</h2>
        <p style={{ margin: '0 0 1rem', color: colors.textSecondary, fontSize: '0.85rem' }}>
          Shown in the header and on the stock-take report.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <input
            style={input}
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
            placeholder="e.g. The Duke and Rye"
          />
          <button onClick={handleSaveName} disabled={savingName} style={primaryBtn}>
            {savingName ? 'Saving…' : nameSaved ? 'Saved ✓' : 'Save'}
          </button>
        </div>
      </div>

      {/* Staff (members) */}
      <div style={card}>
        <h2 style={{ margin: '0 0 0.25rem', fontSize: '1.1rem', color: colors.textPrimary }}>Staff</h2>
        <p style={{ margin: '0 0 1rem', color: colors.textSecondary, fontSize: '0.85rem' }}>
          Add the people who do stock takes. An email authorises that person to
          sign in with Google; leave it blank for someone who only needs crediting
          on counts (no login). Pick who you are in the header when counting.
        </p>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <input
            style={{ ...input, minWidth: '140px' }}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddMember()}
            placeholder="Name"
          />
          <input
            style={{ ...input, minWidth: '180px' }}
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddMember()}
            placeholder="Google email (optional)"
          />
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value)}
            style={{
              padding: '0.75rem', fontSize: '1rem', borderRadius: '8px',
              border: `2px solid ${colors.border}`, backgroundColor: colors.bgCard, color: colors.textPrimary,
              textTransform: 'capitalize',
            }}
          >
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <button onClick={handleAddMember} style={primaryBtn}>Add</button>
        </div>

        {members.length === 0 ? (
          <div style={{ color: colors.textSecondary, fontSize: '0.9rem', textAlign: 'center', padding: '1rem' }}>
            No staff added yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {members.map((member) => (
              <div
                key={member.id}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '0.6rem 0.85rem', backgroundColor: colors.bgLight, borderRadius: '8px',
                }}
              >
                <span style={{ color: colors.textPrimary }}>
                  {member.displayName}
                  {member.role && (
                    <span style={{
                      marginLeft: '0.5rem', fontSize: '0.7rem', color: colors.textSecondary,
                      textTransform: 'uppercase', letterSpacing: '0.04em',
                    }}>
                      {member.role}
                    </span>
                  )}
                  {member.email && (
                    <span style={{ display: 'block', fontSize: '0.78rem', color: colors.textSecondary }}>
                      {member.email}
                    </span>
                  )}
                </span>
                <button
                  onClick={() => handleRemoveMember(member)}
                  style={{
                    background: 'none', border: 'none', color: colors.errorDark,
                    cursor: 'pointer', fontSize: '0.85rem', textDecoration: 'underline',
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Stock list — upload CSV/JSON, or delete the whole list */}
      {isAdmin && isAdmin() && selectedPub?.path && (
        <StockListAdmin venuePath={selectedPub.path} canEdit={true} />
      )}

      {/* Manage stock — edit names, sections, and categories */}
      {isAdmin && isAdmin() && selectedPub?.path && (
        <StockManager venuePath={selectedPub.path} canEdit={true} />
      )}

      {/* Wastage overview — totals with drill-down */}
      {isAdmin && isAdmin() && selectedPub?.path && (
        <WastageReport venuePath={selectedPub.path} canEdit={true} />
      )}
    </div>
  );
}

export default Admin;
