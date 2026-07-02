/**
 * BBlade Cloud Functions — Auth allowlist enforcement.
 *
 * Two Identity Platform *blocking functions* make the members allowlist the
 * source of truth for who may authenticate at all:
 *
 *   - gateUserCreation (beforeUserCreated): blocks a Firebase account from ever
 *     being created for an email that isn't on the allowlist (e.g. someone
 *     requesting an email-link to a random address, or a first Google sign-in).
 *   - gateUserSignIn (beforeUserSignedIn): blocks sign-in for anyone not on the
 *     allowlist (covers accounts created before this, or members later removed),
 *     and stamps { accountId, role } session claims for use in Firestore rules.
 *
 * Requires: Blaze plan + Firebase Authentication with Identity Platform.
 * Deploy with:  firebase deploy --only functions
 *
 * NOTE: ACCOUNT_ID and SUPER_ADMINS are duplicated from src/config/app.js —
 * keep them in sync. (Single-tenant today; when multi-tenant, resolve the
 * account from the email's membership instead of a constant.)
 */

const { beforeUserCreated, beforeUserSignedIn, HttpsError } = require('firebase-functions/v2/identity');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();

const ACCOUNT_ID = 'HBBEnX7bxP9wWASvFKMC';
const SUPER_ADMINS = ['contact@pauljohnson.me', 'barblade3@gmail.com'];

/**
 * Decide whether an email may access the account, and with what claims.
 * Mirrors the client authorization in AuthContext:
 *  - super-admins always allowed (platform staff),
 *  - bootstrap: if no member has an email yet, allow the first user as owner,
 *  - otherwise the email must match a member.
 */
async function resolveAccess(email) {
  const lower = String(email || '').toLowerCase();
  if (lower && SUPER_ADMINS.includes(lower)) {
    return { allowed: true, claims: { accountId: ACCOUNT_ID, role: 'owner', platformAdmin: true } };
  }
  const snap = await db.collection(`accounts/${ACCOUNT_ID}/members`).get();
  const members = snap.docs.map((d) => d.data());
  const withEmail = members.filter((m) => m.email);
  const match = members.find((m) => m.email && String(m.email).toLowerCase() === lower);

  if (withEmail.length === 0) {
    return { allowed: true, claims: { accountId: ACCOUNT_ID, role: 'owner' } }; // bootstrap
  }
  if (match) {
    return { allowed: true, claims: { accountId: ACCOUNT_ID, role: match.role || 'staff' } };
  }
  return { allowed: false };
}

const DENIED = 'This email is not authorised for BBlade. Ask an administrator to add you.';

exports.gateUserCreation = beforeUserCreated(async (event) => {
  const email = event.data && event.data.email;
  const { allowed } = await resolveAccess(email);
  if (!allowed) throw new HttpsError('permission-denied', DENIED);
});

exports.gateUserSignIn = beforeUserSignedIn(async (event) => {
  const email = event.data && event.data.email;
  const { allowed, claims } = await resolveAccess(email);
  if (!allowed) throw new HttpsError('permission-denied', DENIED);
  return { sessionClaims: claims };
});
