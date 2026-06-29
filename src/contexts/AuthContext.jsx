/**
 * AuthContext — Google sign-in + per-account authorization.
 *
 * Flow:
 *   1. User signs in with Google (Firebase Auth).
 *   2. We check the account's `members` for one whose `email` matches — that's
 *      the allowlist. Match → authorized (with the member's role). No match →
 *      access denied + signed out. (Bootstrap: if no member has an email yet,
 *      the first signed-in user is allowed, so you can't lock yourself out.)
 *   3. Once authorized, the tenant's live data (venue, account, members) loads.
 *
 * Tenant is still the hardcoded ACCOUNT_ID/VENUE_ID (single pub, no switcher).
 * Counts are attributed to the signed-in user. StockTaking consumes useAuth()
 * unchanged.
 */

import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { auth } from '../firebase/config';
import { ACCOUNT_ID, VENUE_ID, venuePath, isSuperAdminEmail } from '../config/app';
import {
  subscribeToVenue,
  saveVenue as saveVenueSvc,
  subscribeToAccount,
  saveAccount as saveAccountSvc,
  subscribeToMembers,
  getMembers,
  saveMember as saveMemberSvc,
  deleteMember as deleteMemberSvc,
} from '../services/apiService';

const AuthContext = createContext({});

export const useAuth = () => useContext(AuthContext);

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

// Popups are unreliable on mobile (iOS Safari blocks them); use a full-page
// redirect there instead. The auth handler is same-origin (authDomain = the
// Hosting domain), so redirect completes without the storage-partition error.
const isMobileDevice = () =>
  typeof navigator !== 'undefined' &&
  /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(navigator.userAgent);

export const AuthProvider = ({ children }) => {
  // ---- active tenant (super-admins can switch; everyone else stays on the
  // default account/venue). Derived path drives every tenant subscription. ----
  const [activeAccountId, setActiveAccountId] = useState(ACCOUNT_ID);
  const [activeVenueId, setActiveVenueId] = useState(VENUE_ID);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const PATH = venuePath(activeAccountId, activeVenueId);

  // ---- auth state ----
  const [currentUser, setCurrentUser] = useState(null);
  const [authorized, setAuthorized] = useState(false);
  const [role, setRole] = useState('staff');
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);
  // Preferred display name resolved from the matched Member record (falls back
  // to the Google profile name / email). Drives count attribution + the header.
  const [memberName, setMemberName] = useState('');

  // ---- tenant data (loaded once authorized) ----
  const [venueName, setVenueName] = useState('');
  const [accountName, setAccountName] = useState('');
  const [entitlements, setEntitlements] = useState({});
  const [members, setMembers] = useState([]);

  // Listen for Google sign-in / sign-out and authorize against members.
  useEffect(() => {
    // Complete a redirect sign-in (mobile) and surface any error from it.
    getRedirectResult(auth).catch((err) => {
      console.error('Redirect sign-in error:', err);
      setAuthError('Sign-in failed. Please try again.');
    });

    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setCurrentUser(null);
        setAuthorized(false);
        setRole('staff');
        setMemberName('');
        setIsPlatformAdmin(false);
        setLoading(false);
        return;
      }

      try {
        // Ensure the auth token is minted before any Firestore read, otherwise
        // a redirect sign-in can fire reads before the token attaches and get
        // permission-denied.
        await user.getIdToken();

        // Platform super-admins: full access to any account, no member check.
        // They land on their last-opened account (localStorage), else the default.
        if (isSuperAdminEmail(user.email)) {
          setIsPlatformAdmin(true);
          try {
            const saved = JSON.parse(localStorage.getItem('bb_active_tenant') || 'null');
            if (saved?.accountId && saved?.venueId) {
              setActiveAccountId(saved.accountId);
              setActiveVenueId(saved.venueId);
            }
          } catch { /* ignore bad localStorage */ }
          setRole('owner');
          setMemberName('');
          setCurrentUser(user);
          setAuthorized(true);
          setAuthError(null);
          return; // finally{} clears loading
        }

        // Normal user → default account, authorize against its members.
        setIsPlatformAdmin(false);
        setActiveAccountId(ACCOUNT_ID);
        setActiveVenueId(VENUE_ID);
        const res = await getMembers(ACCOUNT_ID);
        if (!res.success) {
          // Don't silently treat a failed access check as a bootstrap; surface it.
          throw new Error(res.error || 'permission-denied');
        }
        const list = res.data;
        const withEmail = list.filter((m) => m.email);
        const match = list.find(
          (m) => m.email && user.email && m.email.toLowerCase() === user.email.toLowerCase()
        );

        if (withEmail.length === 0 || match) {
          // Authorized (matched member, or bootstrap when no allowlist exists yet)
          setRole(match?.role || 'owner');
          // Prefer the member's real name; fall back to Google name / email.
          setMemberName(match?.displayName || '');
          setCurrentUser(user);
          setAuthorized(true);
          setAuthError(null);
        } else {
          setAuthError(
            'Access denied — this Google account is not authorised. Ask an administrator to add you.'
          );
          await signOut(auth);
          setCurrentUser(null);
          setAuthorized(false);
        }
      } catch (err) {
        console.error('Authorization error:', err);
        setAuthError('Could not verify access. Please try again.');
        await signOut(auth);
        setCurrentUser(null);
        setAuthorized(false);
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, []);

  // Live tenant data — only while authorized.
  useEffect(() => {
    if (!authorized) {
      setVenueName(''); setAccountName(''); setEntitlements({}); setMembers([]);
      return;
    }
    const unsubVenue = subscribeToVenue(PATH, (d) => setVenueName(d?.name || ''), (e) => console.error(e));
    const unsubAcct = subscribeToAccount(activeAccountId, (d) => {
      setAccountName(d?.name || '');
      setEntitlements(d?.entitlements || {});
    }, (e) => console.error(e));
    const unsubMembers = subscribeToMembers(activeAccountId, (list) => setMembers(list || []), (e) => console.error(e));
    return () => { unsubVenue(); unsubAcct(); unsubMembers(); };
  }, [authorized, PATH, activeAccountId]);

  // ---- auth actions ----
  const loginWithGoogle = async () => {
    setAuthError(null);
    // Popup-first on every device. Redirect sign-in is fragile with a service
    // worker / installed PWA (the redirect can lose its pending state and bounce
    // back to login), so we only fall back to redirect when popups are genuinely
    // unavailable (blocked, or an embedded webview that can't open one).
    try {
      await signInWithPopup(auth, googleProvider);
      return { success: true };
    } catch (error) {
      if (error?.code === 'auth/popup-closed-by-user' || error?.code === 'auth/cancelled-popup-request') {
        return { success: false, error: 'cancelled' };
      }
      if (error?.code === 'auth/popup-blocked' || error?.code === 'auth/operation-not-supported-in-this-environment') {
        try {
          await signInWithRedirect(auth, googleProvider);
          return { success: true };
        } catch (redirectErr) {
          return { success: false, error: redirectErr.message };
        }
      }
      return { success: false, error: error.message };
    }
  };

  const logout = async () => {
    await signOut(auth);
  };

  // ---- bound writers for the current (active) tenant ----
  const saveVenue = (data) => saveVenueSvc(PATH, data);
  const saveAccount = (data) => saveAccountSvc(activeAccountId, data);
  const saveMember = (memberId, data) => saveMemberSvc(activeAccountId, memberId, data);
  const deleteMember = (memberId) => deleteMemberSvc(activeAccountId, memberId);

  // ---- super-admin: switch which account/venue the app is operating on ----
  const switchTenant = (accountId, venueId) => {
    if (!isPlatformAdmin || !accountId || !venueId) return;
    setActiveAccountId(accountId);
    setActiveVenueId(venueId);
    try { localStorage.setItem('bb_active_tenant', JSON.stringify({ accountId, venueId })); } catch { /* ignore */ }
  };

  // Counts are attributed to the signed-in user. Prefer the member record's name
  // (set by an admin) over the Google profile name so attribution shows real names.
  const displayName = memberName || currentUser?.displayName || currentUser?.email || 'Staff';

  const value = {
    currentUser,
    userProfile: { displayName, role },
    authorized,
    loading,
    authError,
    clearAuthError: () => setAuthError(null),
    loginWithGoogle,
    logout,

    // Tenant context (active account/venue — switchable by super-admins)
    accountId: activeAccountId,
    accountName,
    entitlements,
    selectedPub: { id: activeVenueId, accountId: activeAccountId, name: venueName, path: PATH },
    accessiblePubs: [{ id: activeVenueId, accountId: activeAccountId, name: venueName, path: PATH }],

    // Platform (super-admin)
    isPlatformAdmin,
    switchTenant,
    activeAccountId,
    activeVenueId,

    // Venue + account settings
    pubName: venueName,
    saveVenue,
    saveAccount,

    // Members (staff)
    members,
    saveMember,
    deleteMember,

    // Role helpers — derived from the signed-in member's role.
    canAccessStock: () => true,
    canEdit: () => true,
    isSuperAdmin: () => role === 'owner',
    isAdmin: () => role === 'owner' || role === 'manager',
    isStockRole: () => false,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
