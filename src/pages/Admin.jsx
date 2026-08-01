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
import CaseSizeSuggestions from '../components/CaseSizeSuggestions';
import { useStockData } from '../contexts/StockDataContext';
import StockOverview from '../components/StockOverview';
import StockPosition from '../components/StockPosition';
import WastageReport from '../components/WastageReport';
import Timesheets from '../components/Timesheets';
import Requests from '../components/Requests';
import Tile from '../components/Tile';
import { subscribeToLeaveRequests, subscribeToShiftRequests, subscribeToRotaSettings, saveRotaSettings, subscribeToTabletSettings, saveTabletSettings } from '../services/apiService';
import { DAY_KEYS, fmtClock, normaliseCloseEnds, summariseCloseEnds } from '../utils/rota';

const ROLES = ['owner', 'manager', 'staff'];

const DAY_NAMES = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

// ---------------------------------------------------------------------------
// Tablet accounts.
//
// The tablet behind the bar signs in as an ordinary staff member — same
// provisioning, same initial password in the row below — it just isn't a
// person. Its login is generated rather than typed, on the venue's own name:
// tablet@therichmond.email, then tablet2@ for a second device. Nothing is ever
// emailed to it (sign-in is by password), so the address only has to be
// unique and recognisable at a glance.
// ---------------------------------------------------------------------------

const venueSlug = (name) => (name || '').toLowerCase().replace(/[^a-z0-9]/g, '') || 'venue';

/** The next free tablet address for this venue, e.g. tablet3@therichmond.email. */
function nextTabletEmail(members, pubName, excludeId = null) {
  const domain = `${venueSlug(pubName)}.email`;
  const taken = new Set((members || [])
    .filter((m) => m.id !== excludeId)
    .map((m) => (m.email || '').toLowerCase()));
  for (let n = 1; n < 50; n += 1) {
    const candidate = `tablet${n === 1 ? '' : n}@${domain}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `tablet${Date.now()}@${domain}`;
}

// Candidate closing times: 15-minute steps from 8pm round to 4am. A pub's
// "close" is when the last person finishes (cleardown included), not last
// orders, so the list runs well past midnight.
const CLOSE_OPTIONS = (() => {
  const out = [];
  for (let mins = 20 * 60; mins <= 28 * 60; mins += 15) {
    const h = Math.floor(mins / 60) % 24;
    const m = mins % 60;
    out.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }
  return out;
})();

// Which side of the pub a member works — will drive feature access per
// department later. 'both' = works across bar and kitchen.
const DEPARTMENTS = [
  ['bar', 'Bar'],
  ['kitchen', 'Kitchen'],
  ['both', 'Bar & kitchen'],
];
const departmentLabel = (d) => (DEPARTMENTS.find(([k]) => k === d) || DEPARTMENTS[0])[1];

function Admin() {
  const { pubName, members, saveVenue, saveMember, deleteMember, resetMemberPassword, resetStaffPin, selectedPub, isAdmin, isSuperAdmin, userProfile, currentMember } = useAuth();
  const [resettingId, setResettingId] = useState(null);

  const handleResetPassword = async (member) => {
    setError(null);
    setResettingId(member.id);
    const res = await resetMemberPassword(member.id);
    setResettingId(null);
    // On success the member's initialPassword updates live and shows in the row.
    if (!res.success) setError('Could not reset password: ' + res.error);
  };

  // Clearing a tablet PIN — forgotten, or locked out after five wrong tries.
  // No confirmation: unlike Remove, the worst case is the person setting a new
  // PIN at the tablet ten seconds later.
  const [pinResettingId, setPinResettingId] = useState(null);
  const handleResetPin = async (member) => {
    setError(null);
    setPinResettingId(member.id);
    const res = await resetStaffPin(member.id);
    setPinResettingId(null);
    if (!res.success) setError('Could not reset PIN: ' + res.error);
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
  const [newIsTablet, setNewIsTablet] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [error, setError] = useState(null);
  const { items } = useStockData();
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState('staff');
  const [editDepartment, setEditDepartment] = useState('bar');
  const [editOnRota, setEditOnRota] = useState(true);
  const [editWithStock, setEditWithStock] = useState(false);
  const [editIsTablet, setEditIsTablet] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  // Keep the field in sync if the live value arrives after mount.
  useEffect(() => { setNameInput(pubName || ''); }, [pubName]);

  // Rough closing times for "close" shifts, one per weekday, shared with the
  // rota (same rotaPrefs/settings doc as the 12h/24h clock, which also sets how
  // the times are written here). Collapsed by default — it's a set-once
  // setting, and seven rows would otherwise push Staff off the screen.
  const [closeEnds, setCloseEnds] = useState({});
  const [timeFormat, setTimeFormat] = useState('12h');
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeSaved, setCloseSaved] = useState(false);
  useEffect(() => {
    if (!selectedPub?.path) return undefined;
    return subscribeToRotaSettings(selectedPub.path, (s) => {
      setCloseEnds(normaliseCloseEnds(s));
      setTimeFormat(s?.timeFormat === '24h' ? '24h' : '12h');
    }, () => {});
  }, [selectedPub?.path]);

  // Every change writes the whole seven-day map (and clears the older
  // single-value field), so what's stored always matches what's on screen —
  // no half-migrated mix of the two to reason about later.
  const saveCloseEnds = async (next) => {
    setCloseEnds(next); // optimistic; the subscription confirms it
    setError(null);
    const res = await saveRotaSettings(selectedPub.path, { closeEnds: next, closeEnd: null });
    if (!res.success) { setError('Could not save closing times: ' + res.error); return; }
    setCloseSaved(true);
    setTimeout(() => setCloseSaved(false), 2000);
  };
  const setDayCloseEnd = (dayKey, value) => saveCloseEnds({ ...closeEnds, [dayKey]: value || null });
  // "Same every day" from the first day that has a time — the common setup is
  // one closing time with a couple of late nights edited after.
  const applyToAllDays = (value) => saveCloseEnds(
    Object.fromEntries(DAY_KEYS.map((k) => [k, value || null])),
  );

  // Bar tablet: whether tapping a name asks for a PIN. Every admin sees the
  // state; only an owner may change it (the rules say so too).
  const [requirePin, setRequirePin] = useState(true);
  const [pinToggleBusy, setPinToggleBusy] = useState(false);
  useEffect(() => {
    if (!selectedPub?.path) return undefined;
    return subscribeToTabletSettings(selectedPub.path, (s) => setRequirePin(s?.requirePin !== false), () => {});
  }, [selectedPub?.path]);

  const toggleRequirePin = async (next) => {
    setPinToggleBusy(true);
    setRequirePin(next); // optimistic; the subscription confirms it
    setError(null);
    const res = await saveTabletSettings(selectedPub.path, { requirePin: next });
    setPinToggleBusy(false);
    if (!res.success) {
      setRequirePin(!next);
      setError('Could not change the PIN setting: ' + res.error);
    }
  };

  // Live request lists — shared by the tile badge and the Requests section,
  // so the number on the tile can never disagree with the queue behind it.
  const [leaveRequests, setLeaveRequests] = useState(null);
  const [shiftRequests, setShiftRequests] = useState(null);
  useEffect(() => {
    if (!selectedPub?.path) return undefined;
    const unsubLeave = subscribeToLeaveRequests(selectedPub.path, setLeaveRequests, () => {});
    const unsubShift = subscribeToShiftRequests(selectedPub.path, setShiftRequests, () => {});
    return () => { unsubLeave(); unsubShift(); };
  }, [selectedPub?.path]);
  // Needing a decision now: pending leave, claimed give-aways, accepted swaps.
  const pendingRequests = (leaveRequests || []).filter((r) => r.status === 'pending').length
    + (shiftRequests || []).filter((r) => r.status === 'claimed' || r.status === 'accepted').length;

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

  // Ticking "Tablet account" turns the row into a device rather than a person:
  // the login is generated from the venue name, it never goes on a rota, and it
  // stays plain staff — a tablet anyone can pick up must never carry a
  // manager's access. Unticking hands the fields back.
  const toggleNewIsTablet = (on) => {
    setNewIsTablet(on);
    if (on) {
      setNewEmail(nextTabletEmail(members, pubName));
      if (!newName.trim()) setNewName('Bar tablet');
      setNewRole('staff');
      setNewOnRota(false);
      setNewWithStock(false);
    } else {
      setNewEmail('');
      setNewOnRota(true);
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
    const res = await saveMember(null, {
      displayName,
      email,
      role: newIsTablet ? 'staff' : newRole,
      department: newDepartment,
      venueAccess: 'all',
      active: true,
      onRota: newIsTablet ? false : newOnRota,
      withStock: newIsTablet ? false : newWithStock,
      isTablet: newIsTablet,
    });
    if (res.success) {
      setNewName(''); setNewEmail(''); setNewRole('staff'); setNewDepartment('bar');
      setNewOnRota(true); setNewWithStock(false); setNewIsTablet(false);
    } else setError('Could not add staff: ' + res.error);
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
    setEditIsTablet(!!member.isTablet);
  };

  // Same rules as the add form, on an existing row. Turning a person INTO a
  // tablet would strand their real email, so the address is only generated
  // when the row doesn't already have one it should keep.
  const toggleEditIsTablet = (on) => {
    setEditIsTablet(on);
    if (on) {
      if (!/^tablet\d*@/.test(editEmail)) setEditEmail(nextTabletEmail(members, pubName, editingId));
      setEditRole('staff');
      setEditOnRota(false);
      setEditWithStock(false);
    }
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
    const res = await saveMember(editingId, {
      displayName,
      email,
      role: editIsTablet ? 'staff' : editRole,
      department: editDepartment,
      onRota: editIsTablet ? false : editOnRota,
      withStock: editIsTablet ? false : editWithStock,
      isTablet: editIsTablet,
    });
    if (res.success) setEditingId(null);
    else setError('Could not save staff: ' + res.error);
  };

  // Nobody removes their own staff record. It takes their sign-in with it and
  // can't be undone, so an owner doing it alone locks themselves out of the
  // account with no one left who could add them back. Their row simply has no
  // Remove link; this guard is the backstop for any other route to it.
  const isSelf = (member) => !!(currentMember && member.id === currentMember.id);

  // Removing a member deletes their sign-in with them (syncMemberAuth revokes
  // the auth user once the email goes), and there is no restore — so Remove
  // asks first. It's a dialog rather than a second tap on the same link
  // because the mistake this guards against is a stray tap, and an in-place
  // "Sure?" just puts a live control under the finger that already slipped.
  const handleRemoveMember = (member) => {
    setError(null);
    if (isSelf(member)) {
      setError("You can't remove your own account — ask another owner or manager to do it.");
      return;
    }
    setRemoving(member);
  };

  const confirmRemove = async () => {
    if (!removing || removeBusy) return;
    setRemoveBusy(true);
    const res = await deleteMember(removing.id);
    setRemoveBusy(false);
    if (res.success) setRemoving(null);
    else setError('Could not remove staff: ' + res.error);
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
  // The per-member actions read as text links, but they need a finger-sized box
  // behind them — bare 0.85rem text is a ~14px target, and one of these deletes
  // a person. Padding gives ~36px without changing how the row looks.
  const rowLink = {
    background: 'none',
    border: 'none',
    padding: '0.6rem 0.3rem',
    margin: '-0.6rem 0',
    cursor: 'pointer',
    fontSize: '0.85rem',
    textDecoration: 'underline',
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
  // Owners only — the PIN switch below weakens a control rather than
  // configuring one, so a shift manager can see the state but not flip it.
  const ownerOnly = !!(isSuperAdmin && isSuperAdmin());

  // Admin section is owner/manager only — non-admins can't reach it at all.
  if (!admin) return <Navigate to="/" replace />;

  const TILES = [
    { key: 'account', label: 'Account', desc: 'Pub name, staff & closing time', accent: colors.primary, show: true,
      icon: ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'] },
    { key: 'stock', label: 'Stock', desc: 'Stock takes, items & units', accent: colors.primary, show: admin,
      icon: ['M9 3h6a1 1 0 0 1 1 1v1h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2V4a1 1 0 0 1 1-1z', 'M9 5h6', 'M8 11h8', 'M8 15h8'] },
    { key: 'wastage', label: 'Wastage overview', desc: 'Totals & who wasted what', accent: colors.wastage, show: admin,
      icon: ['M3 3v18h18', 'M7 16v-5', 'M12 16V8', 'M17 16v-3'] },
    { key: 'rota', label: 'Rotas', desc: 'Build weekly staff rota', accent: colors.primary, show: admin, to: '/rota?edit=1',
      icon: ['M8 2v4', 'M16 2v4', 'M3 10h18', 'M5 6h14v14H5z'] },
    { key: 'timesheets', label: 'Timesheets', desc: 'Clock-ins, hours & approvals', accent: colors.primary, show: admin,
      icon: ['M12 22a10 10 0 1 0 0-20a10 10 0 0 0 0 20', 'M12 6v6l4 2'] },
    { key: 'leave', label: 'Requests', desc: 'Leave, swaps & shift offers', accent: colors.warning, show: admin,
      badge: pendingRequests ? String(pendingRequests) : undefined,
      icon: ['M8 2v4', 'M16 2v4', 'M3 10h18', 'M5 6h14v14H5z', 'M9 16l2 2 4-4'] },
    { key: 'sales', label: 'Sales', desc: 'Till sales reports', accent: colors.primary, show: admin, to: '/sales',
      icon: ['M3 3v18h18', 'M7 15l4-4 3 3 5-6'] },
  ].filter((t) => t.show);

  const STOCK_TILES = [
    // First tile on purpose: "what do I need?" is the question an owner opens
    // the stock area to answer. The record of past counts is how you check it.
    { key: 'position', label: 'Stock position', desc: "What's left & what to order", accent: colors.primary,
      icon: ['M3 3v18h18', 'M7 14l3-3 3 3 5-6', 'M17 8h3v3'] },
    { key: 'overview', label: 'Stock overview', desc: 'Current & completed stock takes', accent: colors.primary,
      icon: ['M3 3v18h18', 'M18 9l-5 5-3-3-4 4'] },
    { key: 'edit', label: 'Stock edit', desc: 'Edit items, units & import list', accent: colors.primary,
      icon: ['M12 20h9', 'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z'] },
  ];

  const SECTION_TITLES = { account: 'Account', stock: 'Stock', position: 'Stock position', overview: 'Stock overview', edit: 'Stock edit', wastage: 'Wastage overview', timesheets: 'Timesheets', leave: 'Requests' };
  // Where each section sits, so its back button returns one step rather than
  // dumping someone at the hub from two levels down.
  const PARENT_VIEW = { position: 'stock', overview: 'stock', edit: 'stock' };

  // ---- Hub: a 2-column grid of tiles into each settings section ----
  // The admin area deliberately looks different from the staff Home hub:
  // a black-and-gold banner (echoing the brand header) plus gold-tinted
  // tiles, so an owner always knows which of the two grids they're on.
  if (!view) {
    return (
      <div style={{ maxWidth: '560px', margin: '0 auto' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.85rem',
          backgroundColor: colors.headerBg, border: `1px solid ${colors.primary}`,
          borderRadius: '14px', padding: '0.9rem 1.1rem', marginBottom: '1.25rem',
        }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={colors.headerText} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.35rem', color: colors.headerText }}>Admin</h1>
            <div style={{ fontSize: '0.8rem', color: colors.headerSub }}>Owner &amp; manager tools — staff can't see this area</div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          {TILES.map((t) => (
            <Tile key={t.key} variant="admin" label={t.label} desc={t.desc} icon={t.icon} accent={t.accent} badge={t.badge} onClick={() => (t.to ? navigate(t.to) : setView(t.key))} />
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
  // The back button and ADMIN chip reuse the banner's black-and-gold look so
  // subsections stay visually part of the admin area, not the staff pages.
  const sectionHeader = (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
      <button
        onClick={() => setView(PARENT_VIEW[view] || null)}
        style={{ padding: '0.5rem 0.75rem', backgroundColor: colors.headerBg, color: colors.headerText, border: `1px solid ${colors.primary}`, borderRadius: '8px', cursor: 'pointer', fontSize: '0.9rem' }}
      >
        ← {PARENT_VIEW[view] ? SECTION_TITLES[PARENT_VIEW[view]] : 'Admin'}
      </button>
      <h1 style={{ margin: 0, fontSize: '1.5rem', color: colors.textPrimary }}>{SECTION_TITLES[view]}</h1>
      <span style={{
        marginLeft: 'auto', fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.08em',
        padding: '0.3rem 0.55rem', borderRadius: '9999px',
        backgroundColor: colors.headerBg, color: colors.headerText, border: `1px solid ${colors.primary}`,
      }}>
        ADMIN
      </span>
    </div>
  );

  // ---- Stock: a sub-hub, same shape as the admin grid one level up ----
  if (view === 'stock') {
    return (
      <div style={{ maxWidth: '560px', margin: '0 auto' }}>
        {sectionHeader}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          {STOCK_TILES.map((t) => (
            <Tile key={t.key} variant="admin" label={t.label} desc={t.desc} icon={t.icon} accent={t.accent} onClick={() => setView(t.key)} />
          ))}
        </div>
      </div>
    );
  }

  if (view === 'position') {
    return (
      <div style={{ maxWidth: '560px', margin: '0 auto' }}>
        {sectionHeader}
        {selectedPub?.path && (
          <StockPosition
            venuePath={selectedPub.path}
            items={items}
            colors={colors}
            accent={colors.primary}
            onAccent={colors.onPrimary}
          />
        )}
      </div>
    );
  }
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
        {/* List housekeeping belongs here, not on the screen someone opens to
            book a delivery in. */}
        {selectedPub?.path && (
          <CaseSizeSuggestions
            venuePath={selectedPub.path}
            items={items}
            colors={colors}
            accent={colors.primary}
            onAccent={colors.onPrimary}
            byName={userProfile?.displayName || ''}
          />
        )}
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
          <Requests
            venuePath={selectedPub.path}
            deciderName={userProfile?.displayName || ''}
            colors={colors}
            showToast={(m) => setError(m)}
            members={members}
            leave={leaveRequests}
            shift={shiftRequests}
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

      {/* Rough closing times. A "6–close" shift has no finish on the rota, so
          it used to add nothing to anyone's hours — a close-heavy week looked
          near-empty. These are when the last person actually finishes (not last
          orders), per weekday because a midweek 11:30 and a Friday 1am are
          hours apart. Close shifts count to their own day's time, marked "~" on
          the grid so nobody mistakes it for a promise. Pay comes off the clock.

          Collapsed to its summary line: it's set once and then left alone, and
          Staff is what people actually open this screen for. */}
      <div style={card}>
        <button
          type="button"
          onClick={() => setCloseOpen((v) => !v)}
          aria-expanded={closeOpen}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.75rem', width: '100%',
            background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: '0 0 0.15rem', fontSize: '1.1rem', color: colors.textPrimary }}>Closing times</h2>
            <div style={{ fontSize: '0.85rem', color: colors.textSecondary, overflowWrap: 'anywhere' }}>
              {summariseCloseEnds(closeEnds, timeFormat)}
            </div>
          </div>
          {closeSaved && !closeOpen && (
            <span style={{ color: colors.success, fontSize: '0.85rem', fontWeight: 700, flexShrink: 0 }}>Saved ✓</span>
          )}
          <span aria-hidden="true" style={{ color: colors.textSecondary, fontSize: '0.9rem', fontWeight: 700, flexShrink: 0 }}>
            {closeOpen ? '▲' : '▼'}
          </span>
        </button>

        {closeOpen && (
          <div style={{ marginTop: '1rem' }}>
            <p style={{ margin: '0 0 1rem', color: colors.textSecondary, fontSize: '0.85rem' }}>
              Roughly when the last person finishes on a close shift — cleardown included.
              Shifts rota'd as “close” have no end time, so this is what they count as in
              the rota's hours (shown with a “~” because it's an estimate). Nobody is paid
              on it: actual hours come from the clock-in and clock-out in Timesheets.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {DAY_KEYS.map((k) => (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <span style={{ width: '5.5rem', flexShrink: 0, fontSize: '0.9rem', fontWeight: 600, color: colors.textPrimary }}>
                    {DAY_NAMES[k]}
                  </span>
                  <select
                    value={closeEnds[k] || ''}
                    onChange={(e) => setDayCloseEnd(k, e.target.value)}
                    aria-label={`${DAY_NAMES[k]} closing time`}
                    style={{
                      flex: 1, minWidth: '160px', maxWidth: '230px',
                      padding: '0.6rem', fontSize: '0.95rem', borderRadius: '8px',
                      border: `2px solid ${colors.border}`, backgroundColor: colors.bgCard, color: colors.textPrimary,
                    }}
                  >
                    <option value="">Not set — adds no hours</option>
                    {CLOSE_OPTIONS.map((t) => (
                      <option key={t} value={t}>
                        {fmtClock(t, timeFormat)}{t < '12:00' ? ' (next day)' : ''}
                      </option>
                    ))}
                  </select>
                  {/* Fills the rest of the week from this day — the usual setup
                      is one time everywhere, then a later Fri/Sat on top. Shown
                      once per distinct time (on the first day using it), so a
                      mixed week offers the shortcut without seven copies of it. */}
                  {closeEnds[k]
                    && DAY_KEYS.find((other) => closeEnds[other] === closeEnds[k]) === k
                    && DAY_KEYS.some((other) => closeEnds[other] !== closeEnds[k]) && (
                    <button
                      type="button"
                      onClick={() => applyToAllDays(closeEnds[k])}
                      style={{ ...rowLink, color: colors.primary, flexShrink: 0 }}
                    >
                      Use every day
                    </button>
                  )}
                </div>
              ))}
            </div>
            {closeSaved && (
              <div style={{ marginTop: '0.75rem', color: colors.success, fontSize: '0.9rem', fontWeight: 700 }}>Saved ✓</div>
            )}
          </div>
        )}
      </div>

      {/* Bar tablet PINs. Off, the tablet is a list of names anyone can tap —
          quicker on a busy night, but nothing then separates "Sarah clocked
          in" from "someone tapped Sarah". Owners only, and the wording says
          what it costs rather than just what it does. */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: '0 0 0.25rem', fontSize: '1.1rem', color: colors.textPrimary }}>Tablet PIN</h2>
            <p style={{ margin: 0, color: colors.textSecondary, fontSize: '0.85rem', lineHeight: 1.45 }}>
              {requirePin ? (
                <>
                  On: tapping a name on the bar tablet asks for that person&apos;s 4-digit
                  PIN, so clock-ins and wastage can only be logged by the person they
                  name. They set their own the first time they use it.
                </>
              ) : (
                <>
                  <strong style={{ color: colors.warning }}>Off:</strong> anyone can tap any
                  name on the bar tablet and act as them — clock them in, log wastage
                  against them. Quicker, but the tablet&apos;s records no longer prove who
                  did what. PINs already set are kept, ready for if you switch it back on.
                </>
              )}
            </p>
            {!ownerOnly && (
              <div style={{ marginTop: '0.5rem', fontSize: '0.78rem', color: colors.textMuted }}>
                Only an owner can change this.
              </div>
            )}
          </div>
          <button
            onClick={() => ownerOnly && !pinToggleBusy && toggleRequirePin(!requirePin)}
            role="switch"
            aria-checked={requirePin}
            aria-label="Require a PIN on the bar tablet"
            disabled={!ownerOnly || pinToggleBusy}
            style={{
              width: '52px', height: '30px', borderRadius: '9999px', border: 'none', flexShrink: 0,
              cursor: ownerOnly && !pinToggleBusy ? 'pointer' : 'not-allowed',
              opacity: ownerOnly ? 1 : 0.5,
              padding: '3px', backgroundColor: requirePin ? colors.primary : colors.border,
              display: 'flex', justifyContent: requirePin ? 'flex-end' : 'flex-start',
              transition: 'background-color 0.15s',
            }}
          >
            <span style={{ width: '24px', height: '24px', borderRadius: '50%', backgroundColor: requirePin ? colors.onPrimary : '#fff', boxShadow: `0 1px 3px ${colors.shadow}` }} />
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
            style={{ ...input, minWidth: '180px', opacity: newIsTablet ? 0.7 : 1 }}
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddMember()}
            placeholder="Google email (optional)"
            readOnly={newIsTablet}
            title={newIsTablet ? "A tablet's login is generated from the pub name" : undefined}
          />
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value)}
            disabled={newIsTablet}
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
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.9rem', color: newIsTablet ? colors.textMuted : colors.textPrimary, whiteSpace: 'nowrap', cursor: newIsTablet ? 'default' : 'pointer' }}>
            <input type="checkbox" checked={newOnRota} disabled={newIsTablet} onChange={(e) => setNewOnRota(e.target.checked)} style={{ width: '18px', height: '18px' }} />
            On rota
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.9rem', color: newIsTablet ? colors.textMuted : colors.textPrimary, whiteSpace: 'nowrap', cursor: newIsTablet ? 'default' : 'pointer' }}>
            <input type="checkbox" checked={newWithStock} disabled={newIsTablet} onChange={(e) => setNewWithStock(e.target.checked)} style={{ width: '18px', height: '18px' }} />
            With stock
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.9rem', color: colors.textPrimary, whiteSpace: 'nowrap', cursor: 'pointer' }}>
            <input type="checkbox" checked={newIsTablet} onChange={(e) => toggleNewIsTablet(e.target.checked)} style={{ width: '18px', height: '18px' }} />
            Tablet account
          </label>
          <button onClick={handleAddMember} style={primaryBtn}>Add</button>
        </div>

        {newIsTablet && (
          <div style={{ margin: '-0.5rem 0 1rem', padding: '0.6rem 0.8rem', borderRadius: '8px', backgroundColor: colors.bgLight, color: colors.textSecondary, fontSize: '0.82rem', lineHeight: 1.45 }}>
            A tablet for behind the bar, not a person. Add it, then sign the tablet
            in once with <strong style={{ color: colors.textPrimary }}>{newEmail}</strong> and the initial
            password that appears in its row. It opens on the staff name cards, and
            each person taps their own name and PIN to use it.
          </div>
        )}

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
                      style={{ ...input, minWidth: '160px', opacity: editIsTablet ? 0.7 : 1 }}
                      type="email"
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit()}
                      placeholder="Google email (optional)"
                      readOnly={editIsTablet}
                    />
                    <select
                      value={editRole}
                      onChange={(e) => setEditRole(e.target.value)}
                      disabled={editIsTablet}
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
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.9rem', color: editIsTablet ? colors.textMuted : colors.textPrimary, whiteSpace: 'nowrap', cursor: editIsTablet ? 'default' : 'pointer' }}>
                      <input type="checkbox" checked={editOnRota} disabled={editIsTablet} onChange={(e) => setEditOnRota(e.target.checked)} style={{ width: '18px', height: '18px' }} />
                      On rota
                    </label>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.9rem', color: editIsTablet ? colors.textMuted : colors.textPrimary, whiteSpace: 'nowrap', cursor: editIsTablet ? 'default' : 'pointer' }}>
                      <input type="checkbox" checked={editWithStock} disabled={editIsTablet} onChange={(e) => setEditWithStock(e.target.checked)} style={{ width: '18px', height: '18px' }} />
                      With stock
                    </label>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.9rem', color: colors.textPrimary, whiteSpace: 'nowrap', cursor: 'pointer' }}>
                      <input type="checkbox" checked={editIsTablet} onChange={(e) => toggleEditIsTablet(e.target.checked)} style={{ width: '18px', height: '18px' }} />
                      Tablet account
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
                      {/* Naming your own row is what makes the missing Remove
                          link read as deliberate rather than a glitch. */}
                      {isSelf(member) && (
                        <span style={{
                          marginLeft: '0.5rem', fontSize: '0.7rem', fontWeight: 700, color: colors.primary,
                          textTransform: 'uppercase', letterSpacing: '0.04em',
                        }}>
                          you
                        </span>
                      )}
                      {/* A tablet isn't a person: role, department and rota
                          status say nothing useful about it, so the row carries
                          one chip instead of four. */}
                      {member.isTablet ? (
                        <span style={{
                          marginLeft: '0.5rem', fontSize: '0.7rem', fontWeight: 700, color: colors.primary,
                          border: `1px solid ${colors.primary}`, borderRadius: '9999px', padding: '0.05rem 0.4rem',
                          textTransform: 'uppercase', letterSpacing: '0.04em',
                        }}>
                          tablet
                        </span>
                      ) : (
                        <>
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
                        </>
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
                        style={{ ...rowLink, color: colors.primary }}
                      >
                        Edit
                      </button>
                      {member.email && (
                        <button
                          onClick={() => handleResetPassword(member)}
                          disabled={resettingId === member.id}
                          style={{ ...rowLink, color: colors.textSecondary, cursor: resettingId === member.id ? 'default' : 'pointer' }}
                        >
                          {resettingId === member.id ? 'Resetting…' : 'Reset password'}
                        </button>
                      )}
                      {/* Tablet PIN. Only offered to people (a tablet has no
                          PIN of its own) and only once one is set — until then
                          the state below says so, and there's nothing to clear. */}
                      {!member.isTablet && member.hasPin && requirePin && (
                        <button
                          onClick={() => handleResetPin(member)}
                          disabled={pinResettingId === member.id}
                          style={{ ...rowLink, color: colors.textSecondary, cursor: pinResettingId === member.id ? 'default' : 'pointer' }}
                        >
                          {pinResettingId === member.id ? 'Resetting…' : 'Reset PIN'}
                        </button>
                      )}
                      {!isSelf(member) && (
                        <button
                          onClick={() => handleRemoveMember(member)}
                          style={{ ...rowLink, color: colors.errorDark }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                  {/* Nothing to say about PINs while the tablet isn't asking
                      for them — the switch above is where that story lives. */}
                  {!member.isTablet && requirePin && (
                    <div style={{ marginTop: '0.15rem', fontSize: '0.76rem', color: member.hasPin ? colors.textSecondary : colors.textMuted }}>
                      {member.hasPin
                        ? 'Tablet PIN set'
                        : 'No tablet PIN yet — they set one the first time they tap their name on the tablet.'}
                    </div>
                  )}
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

      {/* Remove confirmation. Naming the person is the point: the failure this
          prevents is removing the wrong row, which a generic "Are you sure?"
          would sail straight through. */}
      {removing && (() => {
        const name = removing.displayName || 'this person';
        return (
          <div
            onClick={() => { if (!removeBusy) setRemoving(null); }}
            style={{ position: 'fixed', inset: 0, zIndex: 5000, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}
          >
            <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: colors.bgCard, borderRadius: '14px', boxShadow: `0 12px 40px ${colors.shadow}`, padding: '1.5rem', maxWidth: '380px', width: '100%' }}>
              <div style={{ fontWeight: 700, fontSize: '1.1rem', color: colors.error, marginBottom: '0.5rem' }}>
                Remove {name}?
              </div>
              <div style={{ fontSize: '0.88rem', color: colors.textSecondary, marginBottom: '1rem', lineHeight: 1.45 }}>
                {removing.email ? (
                  <>
                    This deletes their staff record and their sign-in
                    ({removing.email}). They won't be able to log in, and their
                    password can't be recovered — adding them back later means a
                    new one.
                  </>
                ) : (
                  <>This deletes their staff record. They'll come off the rota from now on.</>
                )}
                {' '}It can't be undone.
              </div>
              <div style={{ display: 'flex', gap: '0.6rem' }}>
                <button
                  onClick={() => setRemoving(null)}
                  disabled={removeBusy}
                  style={{ flex: 1, padding: '0.8rem', backgroundColor: colors.bgLight, color: colors.textPrimary, border: 'none', borderRadius: '10px', fontWeight: 600, fontSize: '1rem', cursor: 'pointer' }}
                >Cancel</button>
                <button
                  onClick={confirmRemove}
                  disabled={removeBusy}
                  style={{
                    flex: 1, padding: '0.8rem', backgroundColor: colors.error, color: '#fff', border: 'none',
                    borderRadius: '10px', fontWeight: 700, fontSize: '1rem',
                    cursor: removeBusy ? 'not-allowed' : 'pointer', opacity: removeBusy ? 0.5 : 1,
                  }}
                >{removeBusy ? 'Removing…' : 'Remove'}</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

export default Admin;
