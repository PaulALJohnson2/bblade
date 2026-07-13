/**
 * AuthContext — Google / email-link sign-in + per-account authorization.
 *
 * Authorization is enforced SERVER-SIDE: accounts are provisioned from the
 * members list by the syncMemberAuth Cloud Function (self sign-up is disabled
 * project-wide), and the gateUserSignIn blocking function rejects any sign-in
 * that isn't a provisioned member or super-admin. So by the time a user reaches
 * this context they ARE authorized — we just read { accountId, role } from the
 * ID token claims. No Firestore read in the critical path: nothing to race,
 * and it works offline from the cached token.
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
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '../firebase/config';
import { ACCOUNT_ID, VENUE_ID, venuePath, isSuperAdminEmail } from '../config/app';
import {
  subscribeToVenue,
  saveVenue as saveVenueSvc,
  subscribeToAccount,
  saveAccount as saveAccountSvc,
  subscribeToMembers,
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
  // True while finishing an email-link sign-in (page opened via the link).
  const [completingEmailLink, setCompletingEmailLink] = useState(
    () => typeof window !== 'undefined' && isSignInWithEmailLink(auth, window.location.href),
  );
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
        setIsPlatformAdmin(false);
        setLoading(false);
        return;
      }

      try {
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
          setCurrentUser(user);
          setAuthorized(true);
          setAuthError(null);
          return; // finally{} clears loading
        }

        // Anyone else who completed sign-in was allowed by the server gate
        // (gateUserSignIn), which stamped { accountId, role } claims when the
        // account was provisioned from the members list. Read them from the
        // token — cached, offline-safe, no Firestore read to race or fail.
        let token = await user.getIdTokenResult();
        if (!token.claims.accountId) {
          // Session predates provisioning — refresh once to pick up the
          // claims stamped by the backfill / their first gated sign-in.
          token = await user.getIdTokenResult(true);
        }

        if (token.claims.accountId) {
          setIsPlatformAdmin(false);
          setActiveAccountId(token.claims.accountId);
          setActiveVenueId(VENUE_ID);
          setRole(token.claims.role || 'staff');
          setCurrentUser(user);
          setAuthorized(true);
          setAuthError(null);
          // Remember the verified authorization so a persisted login still
          // restores when the next launch can't refresh the token (offline /
          // dead-signal cellars) — see the catch below.
          try {
            localStorage.setItem('bb_auth_ok', JSON.stringify({
              uid: user.uid, accountId: token.claims.accountId, role: token.claims.role || 'staff',
            }));
          } catch { /* storage unavailable — fallback just won't apply */ }
        } else {
          // Shouldn't happen (the server gate rejects non-members before the
          // sign-in completes), but fail closed if it ever does.
          setAuthError(
            'Access denied — this account is not authorised. Ask an administrator to add you.'
          );
          try { localStorage.removeItem('bb_auth_ok'); } catch { /* ignore */ }
          await signOut(auth);
          setCurrentUser(null);
          setAuthorized(false);
        }
      } catch (err) {
        // Token refresh failed — almost always offline (expired cached token
        // needs the network to renew). The login itself is still persisted by
        // Firebase, so restore the last authorization we verified for this
        // same user instead of bouncing them to the login screen. Firestore
        // works from its offline cache; the server re-checks everything on
        // reconnect. Only unknown users (never verified here) are held back.
        let cached = null;
        try { cached = JSON.parse(localStorage.getItem('bb_auth_ok') || 'null'); } catch { /* ignore */ }
        if (cached?.uid === user.uid && cached?.accountId) {
          console.warn('Token refresh failed; restoring cached authorization (offline?):', err?.message);
          setIsPlatformAdmin(false);
          setActiveAccountId(cached.accountId);
          setActiveVenueId(VENUE_ID);
          setRole(cached.role || 'staff');
          setCurrentUser(user);
          setAuthorized(true);
          setAuthError(null);
        } else {
          // Keep the Firebase session — signing out would burn a one-time
          // email link — so a retry / reload can complete without a fresh sign-in.
          console.error('Authorization error:', err);
          setAuthError('Could not verify access. Please check your connection and try again.');
          setCurrentUser(null);
          setAuthorized(false);
        }
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, []);

  // Live tenant data — only while authorized.
  const [membersLoaded, setMembersLoaded] = useState(false);
  useEffect(() => {
    if (!authorized) {
      setVenueName(''); setAccountName(''); setEntitlements({}); setMembers([]); setMembersLoaded(false);
      return;
    }
    const unsubVenue = subscribeToVenue(PATH, (d) => setVenueName(d?.name || ''), (e) => console.error(e));
    const unsubAcct = subscribeToAccount(activeAccountId, (d) => {
      setAccountName(d?.name || '');
      setEntitlements(d?.entitlements || {});
    }, (e) => console.error(e));
    const unsubMembers = subscribeToMembers(activeAccountId, (list) => { setMembers(list || []); setMembersLoaded(true); }, (e) => console.error(e));
    return () => { unsubVenue(); unsubAcct(); unsubMembers(); };
  }, [authorized, PATH, activeAccountId]);

  // Complete an email-link sign-in when the page is opened via the link. Once
  // signed in, onAuthStateChanged above authorizes against the members allowlist.
  useEffect(() => {
    if (!isSignInWithEmailLink(auth, window.location.href)) return;
    let email = window.localStorage.getItem('emailForSignIn');
    if (!email) {
      // Link opened outside the requesting browser — the address travels in
      // the continue URL (see sendEmailLink), so no need to ask for it.
      email = new URLSearchParams(window.location.search).get('email');
    }
    if (!email) {
      // Last resort (older links without the email param).
      email = window.prompt('Please confirm your email to finish signing in');
    }
    if (!email) { setCompletingEmailLink(false); return; }
    setLoading(true);
    signInWithEmailLink(auth, email, window.location.href)
      .then(() => {
        window.localStorage.removeItem('emailForSignIn');
        // Strip the one-time code params from the URL.
        window.history.replaceState({}, '', '/login');
      })
      .catch((err) => {
        console.error('Email link sign-in failed:', err);
        setAuthError('That sign-in link is invalid or has expired. Please request a new one.');
        setLoading(false);
      })
      .finally(() => setCompletingEmailLink(false));
  }, []);

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

  // Password sign-in. Runs entirely inside the current context (browser OR
  // installed PWA), so the session lands where the user actually is — unlike
  // an email link, which opens in the system browser.
  const loginWithPassword = async (email, password) => {
    setAuthError(null);
    try {
      await signInWithEmailAndPassword(auth, String(email).trim(), password);
      return { success: true };
    } catch (error) {
      const code = error?.code || '';
      if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found' || code === 'auth/invalid-email') {
        return { success: false, error: "Wrong email or password. If you haven't set a password yet, use “Set / reset my password” below." };
      }
      if (code === 'auth/too-many-requests') {
        return { success: false, error: 'Too many attempts — wait a few minutes or reset your password.' };
      }
      return { success: false, error: error.message };
    }
  };

  // "Set your password" — Firebase's reset-password email also sets the FIRST
  // password on accounts provisioned without one, so this covers both first-time
  // setup and forgotten passwords.
  const sendPasswordSetEmail = async (email) => {
    try {
      await sendPasswordResetEmail(auth, String(email).trim(), { url: `${window.location.origin}/login` });
      return { success: true };
    } catch (error) {
      console.error('sendPasswordSetEmail failed:', error);
      return { success: false, error: error.message };
    }
  };

  // Email-link (passwordless) sign-in: email the user a one-time link. Access is
  // still gated by the members allowlist when they complete sign-in.
  const sendEmailLink = async (email) => {
    setAuthError(null);
    try {
      // Carry the email in the continue URL so completing the link never has
      // to prompt for it — the link may open in a different browser/profile
      // than the one that requested it (e.g. from a mail app), where the
      // localStorage copy doesn't exist. The link's one-time code is bound to
      // this email, so Firebase still rejects any mismatch.
      const actionCodeSettings = {
        url: `${window.location.origin}/login?email=${encodeURIComponent(email)}`,
        handleCodeInApp: true,
      };
      await sendSignInLinkToEmail(auth, email, actionCodeSettings);
      window.localStorage.setItem('emailForSignIn', email);
      return { success: true };
    } catch (error) {
      console.error('sendEmailLink failed:', error);
      return { success: false, error: error.message };
    }
  };

  const logout = async () => {
    try { localStorage.removeItem('bb_auth_ok'); } catch { /* ignore */ }
    await signOut(auth);
  };

  // ---- bound writers for the current (active) tenant ----
  const saveVenue = (data) => saveVenueSvc(PATH, data);
  const saveAccount = (data) => saveAccountSvc(activeAccountId, data);
  const saveMember = (memberId, data) => saveMemberSvc(activeAccountId, memberId, data);
  const deleteMember = (memberId) => deleteMemberSvc(activeAccountId, memberId);

  // ---- password self-service (callable Cloud Functions) ----
  // The signed-in user sets their own password (forced first-sign-in change or a
  // later voluntary one); the server clears the must-change flag + stored value.
  const changeMyPassword = async (newPassword) => {
    try {
      await httpsCallable(functions, 'changeInitialPassword')({ newPassword });
      await auth.currentUser?.getIdToken(true); // refresh token (emailVerified flip)
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  };
  // Manager action: (re)generate a member's initial password. The new password
  // arrives back on the member doc (live) and is also returned here.
  const resetMemberPassword = async (memberId) => {
    try {
      const res = await httpsCallable(functions, 'resetMemberPassword')({ memberId });
      return { success: true, initialPassword: res?.data?.initialPassword };
    } catch (error) {
      return { success: false, error: error.message };
    }
  };

  // ---- super-admin: switch which account/venue the app is operating on ----
  const switchTenant = (accountId, venueId) => {
    if (!isPlatformAdmin || !accountId || !venueId) return;
    setActiveAccountId(accountId);
    setActiveVenueId(venueId);
    try { localStorage.setItem('bb_active_tenant', JSON.stringify({ accountId, venueId })); } catch { /* ignore */ }
  };

  // The signed-in user's own member record (matched by email from the live
  // members subscription). Drives display name and per-member feature flags.
  const currentMember = members.find(
    (m) => m.email && currentUser?.email && m.email.toLowerCase() === currentUser.email.toLowerCase()
  ) || null;

  // Counts are attributed to the signed-in user. Prefer the member record's name
  // (set by an admin) over the Google profile name so attribution shows real names.
  const displayName = currentMember?.displayName || currentUser?.displayName || currentUser?.email || 'Staff';

  // Which stock sections this user may see, from their member department:
  // bar → bar only, kitchen → kitchen only, both → both. Owners/managers and
  // super-admins (no member record) are never restricted; same brief grace
  // while the members list loads as canAccessStock.
  const department = currentMember?.department || 'bar';
  const allowedSections =
    role === 'owner' || role === 'manager' || !currentMember || department === 'both'
      ? ['bar', 'kitchen']
      : [department];

  const value = {
    currentUser,
    userProfile: { displayName, role },
    authorized,
    loading,
    authError,
    clearAuthError: () => setAuthError(null),
    loginWithGoogle,
    loginWithPassword,
    sendPasswordSetEmail,
    sendEmailLink,
    completingEmailLink,
    logout,

    // Password self-service. mustChangePassword forces the change screen after a
    // first sign-in with an admin-issued initial password.
    changeMyPassword,
    resetMemberPassword,
    mustChangePassword: !!currentMember?.mustChangePassword,

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

    // The signed-in user's member record (null for super-admins / until loaded).
    currentMember,
    // Stock sections this user may see (['bar'], ['kitchen'] or both).
    allowedSections,

    // Role helpers — derived from the signed-in member's role + flags.
    // canAccessStock: owners/managers always; staff need the member's
    // "With stock" tick. While the members list is still loading we allow
    // rather than bounce a legitimate deep link — it settles in a moment.
    canAccessStock: () =>
      role === 'owner' || role === 'manager' || !membersLoaded || !!currentMember?.withStock,
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
