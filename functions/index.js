/**
 * BBlade Cloud Functions — Auth provisioning + allowlist enforcement.
 *
 * Users can NEVER create their own Firebase account: sign-up is disabled
 * project-wide (Authentication → Settings → User actions → "Prevent create").
 * Instead, membership drives auth:
 *
 *   - syncMemberAuth (Firestore trigger on accounts/{accountId}/members/{memberId}):
 *     when an admin saves a member with an email, we create (or update) the
 *     Firebase Auth user for that email and stamp { accountId, role } custom
 *     claims. Removing the member (or their email) deletes the auth user, which
 *     revokes their access. Admin-SDK creation bypasses the sign-up block.
 *
 *   - gateUserSignIn (beforeUserSignedIn): allows a sign-in only when the auth
 *     record carries the accountId claim (i.e. it was provisioned from a member)
 *     or the email is a platform super-admin. Falls back to a one-time members
 *     lookup for accounts that predate provisioning, stamping the claims so the
 *     next sign-in is claim-only. Also copies the claims into sessionClaims.
 *
 *   - gateUserCreation (beforeUserCreated): defence in depth. Client sign-up is
 *     already blocked project-wide, so this only fires if that toggle is ever
 *     switched off; it enforces the same membership rule.
 *
 * Requires: Blaze plan + Firebase Authentication with Identity Platform.
 * Deploy with:  firebase deploy --only functions
 *
 * NOTE: ACCOUNT_ID and SUPER_ADMINS are duplicated from src/config/app.js —
 * keep them in sync. (Single-tenant today; when multi-tenant, resolve the
 * account from the email's membership instead of a constant.)
 */

const { beforeUserCreated, beforeUserSignedIn, HttpsError } = require('firebase-functions/v2/identity');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const logger = require('firebase-functions/logger');

initializeApp();
const db = getFirestore();

const ACCOUNT_ID = 'HBBEnX7bxP9wWASvFKMC';
const SUPER_ADMINS = ['contact@pauljohnson.me', 'barblade3@gmail.com'];

const normEmail = (email) => String(email || '').trim().toLowerCase();
const isSuperAdmin = (email) => SUPER_ADMINS.includes(normEmail(email));

// ---------------------------------------------------------------------------
// Provisioning: members/{memberId} ⇄ Firebase Auth users
// ---------------------------------------------------------------------------

exports.syncMemberAuth = onDocumentWritten('accounts/{accountId}/members/{memberId}', async (event) => {
  const { accountId } = event.params;
  const before = event.data?.before?.exists ? event.data.before.data() : null;
  const after = event.data?.after?.exists ? event.data.after.data() : null;
  const beforeEmail = normEmail(before?.email);
  const afterEmail = normEmail(after?.email);
  const auth = getAuth();

  // Email removed or changed → revoke the old address's account (unless it's a
  // super-admin, or the account belongs to a different tenant's provisioning).
  if (beforeEmail && beforeEmail !== afterEmail && !isSuperAdmin(beforeEmail)) {
    try {
      const user = await auth.getUserByEmail(beforeEmail);
      if (user.customClaims?.accountId === accountId) {
        await auth.deleteUser(user.uid);
        logger.info(`Revoked auth user for removed member email ${beforeEmail}`);
      }
    } catch (err) {
      if (err.code !== 'auth/user-not-found') throw err;
    }
  }

  if (!afterEmail) return;

  // Ensure an auth user exists for the member's email, with fresh claims.
  let user;
  try {
    user = await auth.getUserByEmail(afterEmail);
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err;
    user = await auth.createUser({
      email: afterEmail,
      displayName: after.displayName || undefined,
      // Not pre-verified: Google / the email link proves ownership at sign-in.
      emailVerified: false,
    });
    logger.info(`Provisioned auth user for member ${afterEmail}`);
  }

  const claims = { accountId, role: after.role || 'staff' };
  const existing = user.customClaims || {};
  if (existing.accountId !== claims.accountId || existing.role !== claims.role) {
    await auth.setCustomUserClaims(user.uid, { ...existing, ...claims });
    logger.info(`Set claims for ${afterEmail}: ${JSON.stringify(claims)}`);
  }
});

// ---------------------------------------------------------------------------
// Sign-in gate
// ---------------------------------------------------------------------------

/**
 * Legacy fallback: decide access from the members collection, for auth users
 * created before provisioning existed (they have no claims yet). Mirrors the
 * client authorization in AuthContext, including the first-user bootstrap.
 */
async function resolveMemberAccess(email) {
  const lower = normEmail(email);
  const snap = await db.collection(`accounts/${ACCOUNT_ID}/members`).get();
  const members = snap.docs.map((d) => d.data());
  const withEmail = members.filter((m) => m.email);
  const match = members.find((m) => normEmail(m.email) === lower && lower);

  if (withEmail.length === 0) {
    return { allowed: true, claims: { accountId: ACCOUNT_ID, role: 'owner' } }; // bootstrap
  }
  if (match) {
    return { allowed: true, claims: { accountId: ACCOUNT_ID, role: match.role || 'staff' } };
  }
  return { allowed: false };
}

const DENIED = 'This email is not authorised for BBlade. Ask an administrator to add you.';

exports.gateUserSignIn = beforeUserSignedIn(async (event) => {
  const email = normEmail(event.data && event.data.email);

  if (isSuperAdmin(email)) {
    logger.info(`Sign-in allowed (super-admin): ${email}`);
    return { sessionClaims: { accountId: ACCOUNT_ID, role: 'owner', platformAdmin: true } };
  }

  // Provisioned member: the auth record carries the claims.
  const claims = (event.data && event.data.customClaims) || {};
  if (claims.accountId) {
    logger.info(`Sign-in allowed (claims): ${email}`);
    return { sessionClaims: { accountId: claims.accountId, role: claims.role || 'staff' } };
  }

  // Pre-provisioning auth user: check membership once and stamp the claims so
  // future sign-ins are claim-only.
  const { allowed, claims: resolved } = await resolveMemberAccess(email);
  if (!allowed) {
    logger.warn(`Sign-in DENIED (not a member): ${email}`);
    throw new HttpsError('permission-denied', DENIED);
  }
  logger.info(`Sign-in allowed (member lookup, claims stamped): ${email}`);
  try {
    await getAuth().setCustomUserClaims(event.data.uid, resolved);
  } catch (err) {
    logger.warn(`Could not stamp claims for ${email}: ${err.message}`);
  }
  return { sessionClaims: resolved };
});

// Defence in depth only: project-wide "Prevent create (sign-up)" already blocks
// client-driven account creation before this runs (Admin SDK creation skips
// blocking functions entirely). Enforces the same rule if that toggle is off.
exports.gateUserCreation = beforeUserCreated(async (event) => {
  const email = normEmail(event.data && event.data.email);
  if (isSuperAdmin(email)) return;
  const { allowed } = await resolveMemberAccess(email);
  if (!allowed) throw new HttpsError('permission-denied', DENIED);
});
