/**
 * Admin — manage the pub (venue) name and the account's staff (members).
 *
 * No auth yet, so this is openly reachable via the header gear. A "member" is an
 * account-level person (identity + role + which venues they can access) used to
 * attribute stock counts; later it becomes a real authenticated user. For now,
 * with a single venue, new members default to venueAccess: 'all'.
 */

import React, { useEffect, useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getThemeColors } from '../utils/theme';
import useTheme from '../hooks/useTheme';
import StockListAdmin from '../components/StockListAdmin';
import StockManager from '../components/StockManager';
import StockOverview from '../components/StockOverview';
import WastageReport from '../components/WastageReport';
import Timesheets from '../components/Timesheets';
import LeaveRequests from '../components/LeaveRequests';
import Tile from '../components/Tile';
import { subscribeToLeaveRequests } from '../services/apiService';

const ROLES = ['owner', 'manager', 'staff'];

// Which side of the pub a member works — will drive feature access per
// department later. 'both' = works across bar and kitchen.
const DEPARTMENTS = [
  ['bar', 'Bar'],
  ['kitchen', 'Kitchen'],
  ['both', 'Bar & kitchen'],
];
const departmentLabel = (d) => (DEPARTMENTS.find(([k]) => k === d) || DEPARTMENTS[0])[1];

function Admin() {
  const { pubName, members, saveVenue, saveMember, deleteMember, resetMemberPassword, selectedPub, isAdmin, userProfile } = useAuth();
  const [resettingId, setResettingId] = useState(null);

  const handleResetPassword = async (member) => {
    setError(null);
    setResettingId(member.id);
    const res = await resetMemberPassword(member.id);
    setResettingId(null);
    // On success the member's initialPassword updates live and shows in the row.
    if (!res.success) setError('Could not reset password: ' + res.error);
  };
  const navigate = useNavigate();
  const { isDark, toggleTheme } = useTheme();
  const colors = getThemeColors(isDark);

  const [view, setView] = useState(null); // null=hub | account | overview | edit | wastage
  const [nameInput, setNameInput] = useState(pubName || '');
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState('staff');
  const [newDepartment, setNewDepartment] = useState('bar');
  const [newOnRota, setNewOnRota] = useState(true);
  const [newWithStock, setNewWithStock] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [error, setError] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState('staff');
  const [editDepartment, setEditDepartment] = useState('bar');
  const [editOnRota, setEditOnRota] = useState(true);
  const [editWithStock, setEditWithStock] = useState(false);

  // Keep the field in sync if the live value arrives after mount.
  useEffect(() => { setNameInput(pubName || ''); }, [pubName]);

  // Count pending leave requests, for the dashboard tile badge.
  const [pendingLeave, setPendingLeave] = useState(0);
  useEffect(() => {
    if (!selectedPub?.path) return undefined;
    const unsub = subscribeToLeaveRequests(
      selectedPub.path,
      (list) => setPendingLeave((list || []).filter((r) => r.status === 'pending').length),
      () => {},
    );
    return () => unsub();
  }, [selectedPub?.path]);

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
    const res = await saveMember(null, { displayName, email, role: newRole, department: newDepartment, venueAccess: 'all', active: true, onRota: newOnRota, withStock: newWithStock });
    if (res.success) { setNewName(''); setNewEmail(''); setNewRole('staff'); setNewDepartment('bar'); setNewOnRota(true); setNewWithStock(false); }
    else setError('Could not add staff: ' + res.error);
  };

  const startEdit = (member) => {
    setError(null);
    setEditingId(member.id);
    setEditName(member.displayName || '');
    setEditEmail(member.email || '');
    setEditRole(member.role || 'staff');
    setEditDepartment(member.department || 'bar');
    setEditOnRota(member.onRota !== false);
    setEditWithStock(!!member.withStock);
  };

  const handleSaveEdit = async () => {
    const displayName = editName.trim();
    const email = editEmail.trim().toLowerCase();
    if (!displayName) { setError('Please enter a name.'); return; }
    if (members.some(m => m.id !== editingId && (m.displayName || '').toLowerCase() === displayName.toLowerCase())) {
      setError(`"${displayName}" is already a staff member.`);
      return;
    }
    if (email && members.some(m => m.id !== editingId && (m.email || '').toLowerCase() === email)) {
      setError(`${email} is already authorised.`);
      return;
    }
    setError(null);
    const res = await saveMember(editingId, { displayName, email, role: editRole, department: editDepartment, onRota: editOnRota, withStock: editWithStock });
    if (res.success) setEditingId(null);
    else setError('Could not save staff: ' + res.error);
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

  const admin = !!(isAdmin && isAdmin());

  // Admin section is owner/manager only — non-admins can't reach it at all.
  if (!admin) return <Navigate to="/" replace />;

  const TILES = [
    { key: 'account', label: 'Account', desc: 'Pub name & staff', accent: colors.primary, show: true,
      icon: ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'] },
    { key: 'overview', label: 'Stock overview', desc: 'Current & completed stock takes', accent: colors.primary, show: admin,
      icon: ['M3 3v18h18', 'M18 9l-5 5-3-3-4 4'] },
    { key: 'edit', label: 'Stock edit', desc: 'Edit items, units & import list', accent: colors.primary, show: admin,
      icon: ['M12 20h9', 'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z'] },
    { key: 'wastage', label: 'Wastage overview', desc: 'Totals & who wasted what', accent: colors.wastage, show: admin,
      icon: ['M3 3v18h18', 'M7 16v-5', 'M12 16V8', 'M17 16v-3'] },
    { key: 'rota', label: 'Rotas', desc: 'Build weekly staff rota', accent: colors.primary, show: admin, to: '/rota?edit=1',
      icon: ['M8 2v4', 'M16 2v4', 'M3 10h18', 'M5 6h14v14H5z'] },
    { key: 'timesheets', label: 'Timesheets', desc: 'Clock-ins, hours & approvals', accent: colors.primary, show: admin,
      icon: ['M12 22a10 10 0 1 0 0-20a10 10 0 0 0 0 20', 'M12 6v6l4 2'] },
    { key: 'leave', label: 'Leave requests', desc: 'Approve staff annual leave', accent: colors.warning, show: admin,
      badge: pendingLeave ? String(pendingLeave) : undefined,
      icon: ['M8 2v4', 'M16 2v4', 'M3 10h18', 'M5 6h14v14H5z', 'M9 16l2 2 4-4'] },
    { key: 'sales', label: 'Sales', desc: 'Till sales reports', accent: colors.primary, show: admin, to: '/sales',
      icon: ['M3 3v18h18', 'M7 15l4-4 3 3 5-6'] },
  ].filter((t) => t.show);

  const SECTION_TITLES = { account: 'Account', overview: 'Stock overview', edit: 'Stock edit', wastage: 'Wastage overview', timesheets: 'Timesheets', leave: 'Leave requests' };

  // ---- Hub: a 2-column grid of tiles into each settings section ----
  if (!view) {
    return (
      <div style={{ maxWidth: '560px', margin: '0 auto' }}>
        <h1 style={{ margin: '0.25rem 0 1.25rem', fontSize: '1.5rem', color: colors.textPrimary }}>Admin</h1>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          {TILES.map((t) => (
            <Tile key={t.key} label={t.label} desc={t.desc} icon={t.icon} accent={t.accent} badge={t.badge} onClick={() => (t.to ? navigate(t.to) : setView(t.key))} />
          ))}
        </div>

        {/* Appearance */}
        <div style={{ ...card, marginTop: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: '1rem', color: colors.textPrimary }}>Dark mode</div>
            <div style={{ fontSize: '0.82rem', color: colors.textSecondary }}>{isDark ? 'On' : 'Off'}</div>
          </div>
          <button
            onClick={toggleTheme}
            role="switch"
            aria-checked={isDark}
            aria-label="Toggle dark mode"
            style={{ width: '52px', height: '30px', borderRadius: '9999px', border: 'none', cursor: 'pointer', padding: '3px', backgroundColor: isDark ? colors.primary : colors.border, display: 'flex', justifyContent: isDark ? 'flex-end' : 'flex-start', transition: 'background-color 0.15s' }}
          >
            <span style={{ width: '24px', height: '24px', borderRadius: '50%', backgroundColor: isDark ? colors.onPrimary : '#fff', boxShadow: `0 1px 3px ${colors.shadow}` }} />
          </button>
        </div>
      </div>
    );
  }

  // ---- A single section, with a back-to-hub header ----
  const sectionHeader = (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
      <button
        onClick={() => setView(null)}
        style={{ padding: '0.5rem 0.75rem', backgroundColor: colors.bgLight, color: colors.textPrimary, border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.9rem' }}
      >
        ← Admin
      </button>
      <h1 style={{ margin: 0, fontSize: '1.5rem', color: colors.textPrimary }}>{SECTION_TITLES[view]}</h1>
    </div>
  );

  if (view === 'overview') {
    return (
      <div style={{ maxWidth: '560px', margin: '0 auto' }}>
        {sectionHeader}
        {selectedPub?.path && <StockOverview venuePath={selectedPub.path} canEdit={true} />}
      </div>
    );
  }
  if (view === 'edit') {
    return (
      <div style={{ maxWidth: '560px', margin: '0 auto' }}>
        {sectionHeader}
        {selectedPub?.path && <StockManager venuePath={selectedPub.path} canEdit={true} />}
        {selectedPub?.path && <StockListAdmin venuePath={selectedPub.path} canEdit={true} />}
      </div>
    );
  }
  if (view === 'wastage') {
    return (
      <div style={{ maxWidth: '560px', margin: '0 auto' }}>
        {sectionHeader}
        {selectedPub?.path && <WastageReport venuePath={selectedPub.path} canEdit={true} />}
      </div>
    );
  }
  if (view === 'timesheets') {
    return (
      <div style={{ maxWidth: '560px', margin: '0 auto' }}>
        {sectionHeader}
        {error && (
          <div style={{ padding: '0.75rem 1rem', backgroundColor: colors.errorDark, color: 'white', borderRadius: '8px', marginBottom: '1rem' }}>
            {error}
          </div>
        )}
        {selectedPub?.path && (
          <Timesheets
            venuePath={selectedPub.path}
            members={members}
            approverName={userProfile?.displayName || ''}
            colors={colors}
            showToast={(m) => setError(m)}
          />
        )}
      </div>
    );
  }

  if (view === 'leave') {
    return (
      <div style={{ maxWidth: '560px', margin: '0 auto' }}>
        {sectionHeader}
        {error && (
          <div style={{ padding: '0.75rem 1rem', backgroundColor: colors.errorDark, color: 'white', borderRadius: '8px', marginBottom: '1rem' }}>
            {error}
          </div>
        )}
        {selectedPub?.path && (
          <LeaveRequests
            venuePath={selectedPub.path}
            deciderName={userProfile?.displayName || ''}
            colors={colors}
            showToast={(m) => setError(m)}
          />
        )}
      </div>
    );
  }

  // view === 'account'
  return (
    <div style={{ maxWidth: '560px', margin: '0 auto' }}>
      {sectionHeader}

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
          Add the people who do stock takes. Giving someone an email sets up their
          login and generates an initial password (shown below their name) — pass
          it on, and they set their own the first time they sign in. Use "Reset
          password" if they're ever locked out. Leave the email blank for someone
          who only needs crediting on counts (no login). Pick who you are in the
          header when counting.
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
          <select
            value={newDepartment}
            onChange={(e) => setNewDepartment(e.target.value)}
            style={{
              padding: '0.75rem', fontSize: '1rem', borderRadius: '8px',
              border: `2px solid ${colors.border}`, backgroundColor: colors.bgCard, color: colors.textPrimary,
            }}
          >
            {DEPARTMENTS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.9rem', color: colors.textPrimary, whiteSpace: 'nowrap', cursor: 'pointer' }}>
            <input type="checkbox" checked={newOnRota} onChange={(e) => setNewOnRota(e.target.checked)} style={{ width: '18px', height: '18px' }} />
            On rota
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.9rem', color: colors.textPrimary, whiteSpace: 'nowrap', cursor: 'pointer' }}>
            <input type="checkbox" checked={newWithStock} onChange={(e) => setNewWithStock(e.target.checked)} style={{ width: '18px', height: '18px' }} />
            With stock
          </label>
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
                style={{ padding: '0.6rem 0.85rem', backgroundColor: colors.bgLight, borderRadius: '8px' }}
              >
                {editingId === member.id ? (
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      style={{ ...input, minWidth: '120px' }}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit()}
                      placeholder="Name"
                    />
                    <input
                      style={{ ...input, minWidth: '160px' }}
                      type="email"
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit()}
                      placeholder="Google email (optional)"
                    />
                    <select
                      value={editRole}
                      onChange={(e) => setEditRole(e.target.value)}
                      style={{
                        padding: '0.75rem', fontSize: '1rem', borderRadius: '8px',
                        border: `2px solid ${colors.border}`, backgroundColor: colors.bgCard, color: colors.textPrimary,
                        textTransform: 'capitalize',
                      }}
                    >
                      {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <select
                      value={editDepartment}
                      onChange={(e) => setEditDepartment(e.target.value)}
                      style={{
                        padding: '0.75rem', fontSize: '1rem', borderRadius: '8px',
                        border: `2px solid ${colors.border}`, backgroundColor: colors.bgCard, color: colors.textPrimary,
                      }}
                    >
                      {DEPARTMENTS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                    </select>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.9rem', color: colors.textPrimary, whiteSpace: 'nowrap', cursor: 'pointer' }}>
                      <input type="checkbox" checked={editOnRota} onChange={(e) => setEditOnRota(e.target.checked)} style={{ width: '18px', height: '18px' }} />
                      On rota
                    </label>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.9rem', color: colors.textPrimary, whiteSpace: 'nowrap', cursor: 'pointer' }}>
                      <input type="checkbox" checked={editWithStock} onChange={(e) => setEditWithStock(e.target.checked)} style={{ width: '18px', height: '18px' }} />
                      With stock
                    </label>
                    <button onClick={handleSaveEdit} style={primaryBtn}>Save</button>
                    <button
                      onClick={() => setEditingId(null)}
                      style={{ padding: '0.75rem 1rem', background: 'none', border: `1px solid ${colors.border}`, borderRadius: '8px', color: colors.textSecondary, cursor: 'pointer', fontSize: '0.95rem' }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <span style={{ color: colors.textPrimary, minWidth: 0, flex: '1 1 12rem' }}>
                      {member.displayName}
                      {member.role && (
                        <span style={{
                          marginLeft: '0.5rem', fontSize: '0.7rem', color: colors.textSecondary,
                          textTransform: 'uppercase', letterSpacing: '0.04em',
                        }}>
                          {member.role}
                        </span>
                      )}
                      <span style={{
                        marginLeft: '0.5rem', fontSize: '0.7rem', color: colors.textSecondary,
                        textTransform: 'uppercase', letterSpacing: '0.04em',
                      }}>
                        · {departmentLabel(member.department)}
                      </span>
                      {member.withStock && (
                        <span style={{
                          marginLeft: '0.5rem', fontSize: '0.7rem', color: colors.textSecondary,
                          textTransform: 'uppercase', letterSpacing: '0.04em',
                        }}>
                          · with stock
                        </span>
                      )}
                      {member.onRota === false && (
                        <span style={{
                          marginLeft: '0.5rem', fontSize: '0.7rem', color: colors.textMuted,
                          textTransform: 'uppercase', letterSpacing: '0.04em',
                        }}>
                          · not on rota
                        </span>
                      )}
                      {member.email && (
                        <span style={{ display: 'block', fontSize: '0.78rem', color: colors.textSecondary, overflowWrap: 'anywhere' }}>
                          {member.email}
                        </span>
                      )}
                    </span>
                    <div style={{ display: 'flex', gap: '0.9rem', alignItems: 'center', flexShrink: 0, marginLeft: 'auto' }}>
                      <button
                        onClick={() => startEdit(member)}
                        style={{ background: 'none', border: 'none', color: colors.primary, cursor: 'pointer', fontSize: '0.85rem', textDecoration: 'underline' }}
                      >
                        Edit
                      </button>
                      {member.email && (
                        <button
                          onClick={() => handleResetPassword(member)}
                          disabled={resettingId === member.id}
                          style={{ background: 'none', border: 'none', color: colors.textSecondary, cursor: resettingId === member.id ? 'default' : 'pointer', fontSize: '0.85rem', textDecoration: 'underline' }}
                        >
                          {resettingId === member.id ? 'Resetting…' : 'Reset password'}
                        </button>
                      )}
                      <button
                        onClick={() => handleRemoveMember(member)}
                        style={{ background: 'none', border: 'none', color: colors.errorDark, cursor: 'pointer', fontSize: '0.85rem', textDecoration: 'underline' }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  {member.initialPassword && (
                    <div style={{ marginTop: '0.5rem', padding: '0.5rem 0.7rem', borderRadius: '8px', backgroundColor: colors.bgCard, border: `1px solid ${colors.border}`, fontSize: '0.82rem', color: colors.textPrimary }}>
                      🔑 Initial password: <strong style={{ fontFamily: 'ui-monospace, Menlo, monospace', letterSpacing: '0.02em' }}>{member.initialPassword}</strong>
                      <span style={{ display: 'block', color: colors.textSecondary, fontSize: '0.76rem', marginTop: '0.15rem' }}>
                        Give this to them. It clears once they sign in and set their own password.
                      </span>
                    </div>
                  )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default Admin;
