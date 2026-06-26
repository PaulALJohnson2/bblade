/**
 * AuthContext — passwordless email-OTP sign-in + per-account authorization.
 *
 * (Migrated from Firebase Google sign-in to AWS Cognito via Amplify.)
 *
 * Flow:
 *   1. User enters their email → we send a one-time code (requestLoginCode).
 *      Existing Cognito users get an EMAIL_OTP sign-in challenge; brand-new
 *      emails are self-signed-up (random password they never see) with autoSignIn,
 *      so both new and returning users complete with a single emailed code.
 *   2. User enters the code (confirmLoginCode) → Cognito signs them in → the Hub
 *      'signedIn' event fires → we check the account's `members` for one whose
 *      `email` matches (the allowlist). Match → authorized with that role. No
 *      match → access denied + signed out. (Bootstrap: if no member has an email
 *      yet, the first signed-in user is allowed, so you can't lock yourself out.)
 *   3. Once authorized, the tenant's live data (venue, account, members) loads.
 *
 * Tenant is still the hardcoded ACCOUNT_ID/VENUE_ID (single pub, no switcher).
 * Counts are attributed to the signed-in user. StockTaking consumes useAuth()
 * unchanged.
 */

import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  signIn,
  confirmSignIn,
  signUp,
  confirmSignUp,
  autoSignIn,
  signOut,
  getCurrentUser,
  fetchUserAttributes,
} from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';
import { ACCOUNT_ID, VENUE_ID, venuePath } from '../config/app';
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

// Cognito requires a password on self-sign-up even for passwordless users; we
// generate a strong random one the user never needs (they always sign in by OTP).
const randomPassword = () => {
  const bytes = new Uint8Array(24);
  (globalThis.crypto || window.crypto).getRandomValues(bytes);
  const base = btoa(String.fromCharCode(...bytes)).replace(/[^a-zA-Z0-9]/g, '');
  return `Aa1!${base}`; // guarantees upper/lower/number/symbol for the default policy
};

export const AuthProvider = ({ children }) => {
  const PATH = venuePath(ACCOUNT_ID, VENUE_ID);

  // ---- auth state ----
  const [currentUser, setCurrentUser] = useState(null);
  const [authorized, setAuthorized] = useState(false);
  const [role, setRole] = useState('staff');
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  // ---- tenant data (loaded once authorized) ----
  const [venueName, setVenueName] = useState('');
  const [accountName, setAccountName] = useState('');
  const [entitlements, setEntitlements] = useState({});
  const [members, setMembers] = useState([]);

  // Check the signed-in Cognito user against the member allowlist.
  const authorizeUser = async () => {
    try {
      const attrs = await fetchUserAttributes();
      const { userId } = await getCurrentUser();
      const email = attrs.email || '';
      const user = { uid: userId, email, displayName: email };

      const res = await getMembers(ACCOUNT_ID);
      if (!res.success) {
        // Don't silently treat a failed access check as a bootstrap; surface it.
        throw new Error(res.error || 'permission-denied');
      }
      const list = res.data;
      const withEmail = list.filter((m) => m.email);
      const match = list.find(
        (m) => m.email && email && m.email.toLowerCase() === email.toLowerCase()
      );

      if (withEmail.length === 0 || match) {
        // Authorized (matched member, or bootstrap when no allowlist exists yet)
        setRole(match?.role || 'owner');
        setCurrentUser(user);
        setAuthorized(true);
        setAuthError(null);
      } else {
        setAuthError(
          'Access denied — this email is not authorised. Ask an administrator to add you.'
        );
        await signOut();
        setCurrentUser(null);
        setAuthorized(false);
      }
    } catch (err) {
      console.error('Authorization error:', err);
      setAuthError('Could not verify access. Please try again.');
      try { await signOut(); } catch { /* already signed out */ }
      setCurrentUser(null);
      setAuthorized(false);
    }
  };

  // Resume an existing session on load, and react to sign-in / sign-out events.
  useEffect(() => {
    let active = true;

    (async () => {
      try {
        await getCurrentUser(); // throws if not signed in
        if (active) await authorizeUser();
      } catch {
        if (active) {
          setCurrentUser(null);
          setAuthorized(false);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    const stopListen = Hub.listen('auth', ({ payload }) => {
      if (payload.event === 'signedIn') {
        authorizeUser();
      } else if (payload.event === 'signedOut') {
        setCurrentUser(null);
        setAuthorized(false);
        setRole('staff');
      }
    });

    return () => { active = false; stopListen(); };
  }, []);

  // Live tenant data — only while authorized.
  useEffect(() => {
    if (!authorized) {
      setVenueName(''); setAccountName(''); setEntitlements({}); setMembers([]);
      return;
    }
    const unsubVenue = subscribeToVenue(PATH, (d) => setVenueName(d?.name || ''), (e) => console.error(e));
    const unsubAcct = subscribeToAccount(ACCOUNT_ID, (d) => {
      setAccountName(d?.name || '');
      setEntitlements(d?.entitlements || {});
    }, (e) => console.error(e));
    const unsubMembers = subscribeToMembers(ACCOUNT_ID, (list) => setMembers(list || []), (e) => console.error(e));
    return () => { unsubVenue(); unsubAcct(); unsubMembers(); };
  }, [authorized, PATH]);

  // ---- auth actions ----

  // Step 1: email the user a one-time code. Returns { success, mode } where mode
  // is 'signup' (new user) or 'signin' (existing user) — confirmLoginCode needs it.
  //
  // We sign up FIRST: Cognito's "prevent user existence errors" makes signIn
  // silently return a fake challenge for unknown emails (no email sent), whereas
  // signUp gives a deterministic UsernameExistsException for known ones. So we
  // try to create the user (emails a verification code), and only fall back to a
  // sign-in OTP challenge when the account already exists.
  const requestLoginCode = async (email) => {
    setAuthError(null);
    const username = email.trim().toLowerCase();
    try {
      await signUp({
        username,
        password: randomPassword(),
        options: { userAttributes: { email: username }, autoSignIn: true },
      });
      return { success: true, mode: 'signup' };
    } catch (error) {
      // Already registered → send a sign-in one-time code instead.
      if (error?.name === 'UsernameExistsException') {
        try {
          const out = await signIn({
            username,
            options: { authFlowType: 'USER_AUTH', preferredChallenge: 'EMAIL_OTP' },
          });
          return { success: true, mode: 'signin', nextStep: out?.nextStep?.signInStep };
        } catch (siErr) {
          return { success: false, error: siErr.message };
        }
      }
      return { success: false, error: error.message };
    }
  };

  // Step 2: verify the code. `mode` comes from requestLoginCode. On success the
  // Hub 'signedIn' event triggers authorizeUser().
  const confirmLoginCode = async (email, code, mode) => {
    setAuthError(null);
    const username = email.trim().toLowerCase();
    try {
      if (mode === 'signup') {
        await confirmSignUp({ username, confirmationCode: code });
        await autoSignIn();
      } else {
        await confirmSignIn({ challengeResponse: code });
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  };

  const logout = async () => {
    await signOut();
  };

  // ---- bound writers for the current tenant ----
  const saveVenue = (data) => saveVenueSvc(PATH, data);
  const saveAccount = (data) => saveAccountSvc(ACCOUNT_ID, data);
  const saveMember = (memberId, data) => saveMemberSvc(ACCOUNT_ID, memberId, data);
  const deleteMember = (memberId) => deleteMemberSvc(ACCOUNT_ID, memberId);

  // Counts are attributed to the signed-in user.
  const displayName = currentUser?.displayName || currentUser?.email || 'Staff';

  const value = {
    currentUser,
    userProfile: { displayName, role },
    authorized,
    loading,
    authError,
    clearAuthError: () => setAuthError(null),
    requestLoginCode,
    confirmLoginCode,
    logout,

    // Tenant context
    accountId: ACCOUNT_ID,
    accountName,
    entitlements,
    selectedPub: { id: VENUE_ID, accountId: ACCOUNT_ID, name: venueName, path: PATH },
    accessiblePubs: [{ id: VENUE_ID, accountId: ACCOUNT_ID, name: venueName, path: PATH }],

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
