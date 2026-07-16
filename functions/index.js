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
 * keep them in sync. ACCOUNT_ID is now only the original tenant's id, used as
 * the fallback for users signed in before claims were stamped: the callables
 * resolve the account from the caller's token (see resolveTargetAccount) and
 * syncMemberAuth takes it from the document path, so both work for any account.
 * resolveMemberAccess is the one place still tied to it — it's the legacy
 * pre-claims sign-in path only.
 */

const { beforeUserCreated, beforeUserSignedIn, HttpsError } = require('firebase-functions/v2/identity');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError: CallableError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const logger = require('firebase-functions/logger');

initializeApp();
const db = getFirestore();

const ACCOUNT_ID = 'HBBEnX7bxP9wWASvFKMC';

// Platform super-admins (BBlade staff) live in Firestore at platform/config
// { superAdmins: [email, ...] } so they can be changed without a redeploy. The
// bootstrap list is a resilience fallback used ONLY when that doc is missing or
// unreadable — so a bad edit or a transient error can never lock the platform
// owners out. The doc is the source of truth for everyone else.
const BOOTSTRAP_SUPER_ADMINS = ['contact@pauljohnson.me', 'barblade3@gmail.com'];

const normEmail = (email) => String(email || '').trim().toLowerCase();

async function isSuperAdmin(email) {
  const e = normEmail(email);
  if (!e) return false;
  try {
    const snap = await db.doc('platform/config').get();
    if (snap.exists && Array.isArray(snap.data().superAdmins)) {
      return snap.data().superAdmins.map(normEmail).includes(e);
    }
    return BOOTSTRAP_SUPER_ADMINS.includes(e); // doc missing / malformed
  } catch (err) {
    logger.warn(`superAdmins config read failed, using bootstrap: ${err.message}`);
    return BOOTSTRAP_SUPER_ADMINS.includes(e);
  }
}

// ---------------------------------------------------------------------------
// Initial passwords: a readable "Adjective-Noun-123" an admin can relay by
// hand (no email delivery — see the sign-in email deliverability issues with
// iCloud). The user is forced to change it on first sign-in.
// ---------------------------------------------------------------------------
const PW_ADJECTIVES = [
  'Brave', 'Sunny', 'Clever', 'Happy', 'Swift', 'Bright', 'Calm', 'Bold', 'Lucky', 'Merry',
  'Nimble', 'Quiet', 'Royal', 'Cosy', 'Jolly', 'Keen', 'Witty', 'Grand', 'Amber', 'Silver',
  'Golden', 'Mellow', 'Breezy', 'Cheery', 'Frosty', 'Spicy', 'Zesty', 'Plucky', 'Dapper', 'Snappy',
];
const PW_NOUNS = [
  'Otter', 'Falcon', 'Maple', 'River', 'Harbor', 'Comet', 'Willow', 'Badger', 'Heron', 'Pebble',
  'Meadow', 'Anchor', 'Cedar', 'Robin', 'Thistle', 'Copper', 'Lantern', 'Marble', 'Sparrow', 'Beacon',
  'Cobble', 'Ferret', 'Juniper', 'Kestrel', 'Bramble', 'Nutmeg', 'Puffin', 'Quill', 'Tulip', 'Walnut',
];
// Mobile-friendly: all lowercase, no separators or symbols (no shift / symbol
// keyboard), digits 2–9 only (no 0/1 to avoid o/l confusion when read aloud).
// e.g. "braveotter472".
function generateMemorablePassword() {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)].toLowerCase();
  const digit = () => String(2 + Math.floor(Math.random() * 8)); // 2–9
  return `${pick(PW_ADJECTIVES)}${pick(PW_NOUNS)}${digit()}${digit()}${digit()}`;
}

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
  if (beforeEmail && beforeEmail !== afterEmail && !(await isSuperAdmin(beforeEmail))) {
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
    // New member → generate a memorable initial password, surface it on the
    // member doc for the admin to relay, and flag that it must be changed on
    // first sign-in. (Writing back re-triggers this function, but the user then
    // exists so we don't loop.)
    const initialPassword = generateMemorablePassword();
    user = await auth.createUser({
      email: afterEmail,
      displayName: after.displayName || undefined,
      emailVerified: false,
      password: initialPassword,
    });
    logger.info(`Provisioned auth user for member ${afterEmail} with an initial password`);
    await event.data.after.ref.update({ initialPassword, mustChangePassword: true });
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

  if (await isSuperAdmin(email)) {
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
  if (await isSuperAdmin(email)) return;
  const { allowed } = await resolveMemberAccess(email);
  if (!allowed) throw new HttpsError('permission-denied', DENIED);
});

// ---------------------------------------------------------------------------
// Password self-service (callables)
// ---------------------------------------------------------------------------

/**
 * The account a callable acts on. A platform admin operates inside whichever
 * tenant they've opened, so they may name one; everyone else is pinned to the
 * account in their own token, whatever the client asked for. ACCOUNT_ID is the
 * fallback only for legacy users signed in before claims were stamped.
 */
async function resolveTargetAccount(request, requested) {
  const claimAccount = request.auth.token.accountId || ACCOUNT_ID;
  const platform = request.auth.token.platformAdmin === true
    || (await isSuperAdmin(request.auth.token.email));
  const asked = String(requested || '').trim();
  if (platform) return asked || claimAccount;
  if (asked && asked !== claimAccount) {
    throw new CallableError('permission-denied', 'That member is not in your account.');
  }
  return claimAccount;
}

/** Clear the initial-password flag + stored value on the member(s) for an email. */
async function clearInitialPassword(email, accountId) {
  const snap = await db.collection(`accounts/${accountId}/members`).where('email', '==', email).get();
  await Promise.all(snap.docs.map((d) => d.ref.update({
    mustChangePassword: false,
    initialPassword: FieldValue.delete(),
  })));
}

/**
 * The signed-in user sets their own password (used for the forced first-sign-in
 * change, and any later voluntary change). Clears the must-change flag and the
 * stored initial password so the admin no longer sees it.
 */
exports.changeInitialPassword = onCall(async (request) => {
  if (!request.auth) throw new CallableError('unauthenticated', 'Sign in first.');
  const newPassword = String((request.data && request.data.newPassword) || '');
  if (newPassword.length < 8) {
    throw new CallableError('invalid-argument', 'Password must be at least 8 characters.');
  }
  await getAuth().updateUser(request.auth.uid, { password: newPassword, emailVerified: true });
  // Their own account, from their own token — never the client's word for it.
  await clearInitialPassword(normEmail(request.auth.token.email), request.auth.token.accountId || ACCOUNT_ID);
  logger.info(`Password changed by ${request.auth.token.email}`);
  return { success: true };
});

/**
 * Manager action: (re)generate a memorable initial password for a member —
 * for someone who never set one, was locked out, or forgot it. Sets it on the
 * auth user and flags a forced change on next sign-in.
 */
exports.resetMemberPassword = onCall(async (request) => {
  if (!request.auth) throw new CallableError('unauthenticated', 'Sign in first.');
  const role = request.auth.token.role;
  if (!(await isSuperAdmin(request.auth.token.email)) && role !== 'owner' && role !== 'manager') {
    throw new CallableError('permission-denied', 'Only managers can reset passwords.');
  }
  const memberId = String((request.data && request.data.memberId) || '');
  if (!memberId) throw new CallableError('invalid-argument', 'memberId is required.');

  const accountId = await resolveTargetAccount(request, request.data && request.data.accountId);
  const ref = db.doc(`accounts/${accountId}/members/${memberId}`);
  const doc = await ref.get();
  if (!doc.exists) throw new CallableError('not-found', 'Member not found.');
  const email = normEmail(doc.data().email);
  if (!email) throw new CallableError('failed-precondition', 'This member has no email to sign in with.');

  let user;
  try {
    user = await getAuth().getUserByEmail(email);
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err;
    user = await getAuth().createUser({ email, emailVerified: false });
  }
  const initialPassword = generateMemorablePassword();
  await getAuth().updateUser(user.uid, { password: initialPassword });
  await ref.update({ initialPassword, mustChangePassword: true });
  logger.info(`Initial password reset for ${email} by ${request.auth.token.email}`);
  return { success: true, initialPassword };
});
