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

const { setGlobalOptions } = require('firebase-functions/v2');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { beforeUserCreated, beforeUserSignedIn, HttpsError } = require('firebase-functions/v2/identity');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError: CallableError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { randomBytes, scryptSync, timingSafeEqual } = require('node:crypto');
const logger = require('firebase-functions/logger');

// Everything runs beside the data. The database is in europe-west2 (London),
// and these functions were in us-central1 — so every read inside a callable was
// a transatlantic round trip, and the ones that make three of them took whole
// seconds. The pub is in London too, so the caller's hop shortens as well.
//
// The exception below is not a choice: Identity Platform only runs blocking
// functions in us-central1, so gateUserSignIn and gateUserCreation are pinned
// there explicitly (they'd otherwise inherit this default and fail to deploy).
// They do at most one Firestore read, on sign-in, so the cost lands in the
// right place.
const BLOCKING_REGION = 'us-central1';
setGlobalOptions({ region: 'europe-west2' });

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

  // Member removed outright → their tablet PIN goes with them. Nothing reads an
  // orphaned hash, but a removed person's secret has no reason to outlive them
  // (and the id could be reused).
  if (before && !after) {
    await db.doc(`accounts/${accountId}/memberSecrets/${event.params.memberId}`).delete()
      .catch((err) => logger.warn(`Could not clear PIN for removed member: ${err.message}`));
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

  // `tablet` marks the shared bar-tablet logins (a member with the "Tablet
  // account" tick). It rides in the token so the rules can tell a device from a
  // person — a tablet sits signed in behind the bar all night, so it's kept out
  // of stock counts even though a person unlocks it with their PIN.
  const claims = { accountId, role: after.role || 'staff', tablet: !!after.isTablet };
  const existing = user.customClaims || {};
  if (existing.accountId !== claims.accountId
    || existing.role !== claims.role
    || !!existing.tablet !== claims.tablet) {
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

exports.gateUserSignIn = beforeUserSignedIn({ region: BLOCKING_REGION }, async (event) => {
  const email = normEmail(event.data && event.data.email);

  if (await isSuperAdmin(email)) {
    logger.info(`Sign-in allowed (super-admin): ${email}`);
    return { sessionClaims: { accountId: ACCOUNT_ID, role: 'owner', platformAdmin: true } };
  }

  // Provisioned member: the auth record carries the claims. `tablet` travels
  // with them — the session claims are what the rules see, so dropping it here
  // would leave a bar tablet indistinguishable from a person.
  const claims = (event.data && event.data.customClaims) || {};
  if (claims.accountId) {
    logger.info(`Sign-in allowed (claims): ${email}`);
    return {
      sessionClaims: {
        accountId: claims.accountId,
        role: claims.role || 'staff',
        tablet: claims.tablet === true,
      },
    };
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
exports.gateUserCreation = beforeUserCreated({ region: BLOCKING_REGION }, async (event) => {
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
  const asked = String(requested || '').trim();
  // Fast path, and the only one that matters for the bar tablet: the caller is
  // asking about their own account (or hasn't said), so the answer is the same
  // whoever they are. Checking for super-admin here would cost a read of
  // platform/config on every single call — which is a round trip to another
  // continent's worth of latency for a question with a foregone answer.
  if (!asked || asked === claimAccount) return claimAccount;
  const platform = request.auth.token.platformAdmin === true
    || (await isSuperAdmin(request.auth.token.email));
  if (!platform) {
    throw new CallableError('permission-denied', 'That member is not in your account.');
  }
  return asked;
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

// ---------------------------------------------------------------------------
// Staff PINs (the bar tablet)
//
// A tablet behind the bar is signed in as one shared member all night; the PIN
// is what says which PERSON is using it, so every clock-in and wastage entry
// carries the right name. PINs therefore have to be verified somewhere the
// staff can't reach: a 4-digit hash sitting on a member doc (readable by every
// member) is 10,000 guesses — cracked in the time it takes to open a console.
// So the hash lives at accounts/{accountId}/memberSecrets/{memberId}, which the
// rules deny to every client, and only these callables (Admin SDK, rules
// bypassed) can touch it.
//
// Guessing at the pad is capped instead: five wrong tries locks that person's
// PIN for fifteen minutes, which puts 10,000 combinations far out of reach of
// anyone standing at the bar.
// ---------------------------------------------------------------------------

const PIN_RE = /^\d{4}$/;
const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCK_MS = 15 * 60 * 1000;

const secretRef = (accountId, memberId) => db.doc(`accounts/${accountId}/memberSecrets/${memberId}`);
const memberRef = (accountId, memberId) => db.doc(`accounts/${accountId}/members/${memberId}`);

/** scrypt hash of a PIN with a fresh 16-byte salt. Both returned as hex. */
function hashPin(pin) {
  const salt = randomBytes(16).toString('hex');
  return { algo: 'scrypt', salt, hash: scryptSync(String(pin), salt, 32).toString('hex') };
}

/** Constant-time check of a PIN against a stored { salt, hash }. */
function pinMatches(pin, secret) {
  if (!secret || !secret.salt || !secret.hash) return false;
  const candidate = scryptSync(String(pin), secret.salt, 32);
  const stored = Buffer.from(secret.hash, 'hex');
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}

/** Who is being acted on, and where — no reads on the common path. */
async function pinTarget(request, data) {
  if (!request.auth) throw new CallableError('unauthenticated', 'Sign in first.');
  const memberId = String((data && data.memberId) || '').trim();
  if (!memberId) throw new CallableError('invalid-argument', 'memberId is required.');
  const accountId = await resolveTargetAccount(request, data && data.accountId);
  return { accountId, memberId };
}

/**
 * As above, plus the member document — for the calls that actually need it
 * (setting and clearing a PIN both write to it). Kept off the verify path: a
 * PIN check needs the secret and nothing else, and this is the one call that
 * happens with somebody standing there waiting for it.
 */
async function requireMember(request, data) {
  const { accountId, memberId } = await pinTarget(request, data);
  const snap = await memberRef(accountId, memberId).get();
  if (!snap.exists) throw new CallableError('not-found', 'That person is no longer on the staff list.');
  return { accountId, memberId, member: snap.data() || {} };
}

const isManagerCaller = async (request) => request.auth.token.role === 'owner'
  || request.auth.token.role === 'manager'
  || request.auth.token.platformAdmin === true
  || (await isSuperAdmin(request.auth.token.email));

/**
 * Set a person's PIN — the first time they tap their card on the tablet. Once
 * set it can't be overwritten from the pad: changing it goes through a manager
 * reset, so nobody can walk up and quietly take over a colleague's card.
 */
exports.setStaffPin = onCall(async (request) => {
  const pin = String((request.data && request.data.pin) || '');
  if (!PIN_RE.test(pin)) throw new CallableError('invalid-argument', 'A PIN is 4 digits.');
  const { accountId, memberId } = await pinTarget(request, request.data);

  // Both reads at once, then both writes at once — they don't depend on each
  // other, and each round trip is a real fraction of the wait at the pad.
  const ref = secretRef(accountId, memberId);
  const [memberSnap, secretSnap] = await Promise.all([
    memberRef(accountId, memberId).get(),
    ref.get(),
  ]);
  if (!memberSnap.exists) {
    throw new CallableError('not-found', 'That person is no longer on the staff list.');
  }
  if (secretSnap.exists) {
    throw new CallableError('already-exists', 'That person already has a PIN. A manager can reset it.');
  }
  await Promise.all([
    ref.set({
      ...hashPin(pin),
      attempts: 0,
      lockedUntil: null,
      setAt: FieldValue.serverTimestamp(),
      setByUid: request.auth.uid,
    }),
    memberRef(accountId, memberId).update({ hasPin: true }),
  ]);
  logger.info(`PIN set for member ${memberId} (${(memberSnap.data() || {}).displayName || '?'}) by ${request.auth.token.email || request.auth.uid}`);
  return { success: true };
});

/**
 * Check a PIN at the tablet's pad. Counts wrong tries and locks the card for
 * fifteen minutes after five, so the pad can't be worked through by hand.
 */
exports.verifyStaffPin = onCall(async (request) => {
  // Keep-warm ping (see keepPinWarm below). Answered before anything else
  // happens: it takes no arguments, touches no data and tells the caller
  // nothing — its only job is to have started this container, so the first
  // person at the pad tonight isn't the one paying for the cold start. The
  // function is publicly reachable either way; all this changes is that an
  // anonymous POST gets a cheap "warm" instead of a logged auth failure.
  if (request.data && request.data.warm === true) return { warm: true };

  const pin = String((request.data && request.data.pin) || '');
  const { accountId, memberId } = await pinTarget(request, request.data);

  // One read, then the hash. A member who has been removed has no secret left
  // (syncMemberAuth deletes it), so this also covers "no longer on the staff
  // list" without a second lookup to prove it.
  const ref = secretRef(accountId, memberId);
  const snap = await ref.get();
  if (!snap.exists) throw new CallableError('failed-precondition', 'No PIN set yet.');
  const secret = snap.data() || {};

  const lockedUntil = secret.lockedUntil ? secret.lockedUntil.toMillis() : 0;
  if (lockedUntil > Date.now()) {
    throw new CallableError('resource-exhausted', 'Too many wrong tries. Try again in a few minutes.');
  }

  if (!PIN_RE.test(pin) || !pinMatches(pin, secret)) {
    // The lock window starts from the attempt that trips it; earlier attempts
    // are only cleared by getting it right (or a manager reset), so five wrong
    // tries spread over an evening still lock the card.
    const attempts = (secret.attempts || 0) + 1;
    await ref.update({
      attempts,
      lockedUntil: attempts >= PIN_MAX_ATTEMPTS
        ? new Date(Date.now() + PIN_LOCK_MS)
        : (secret.lockedUntil || null),
    });
    logger.warn(`Wrong PIN for member ${memberId} (attempt ${attempts})`);
    throw new CallableError('permission-denied', attempts >= PIN_MAX_ATTEMPTS
      ? 'Too many wrong tries. Try again in a few minutes.'
      : 'That PIN is not right.');
  }

  if (secret.attempts) await ref.update({ attempts: 0, lockedUntil: null });
  return { success: true };
});

/**
 * Manager action: clear a PIN — forgotten, locked out, or a card that needs
 * handing to someone else. The next tap on that card sets a fresh one.
 */
exports.resetStaffPin = onCall(async (request) => {
  if (!request.auth) throw new CallableError('unauthenticated', 'Sign in first.');
  if (!(await isManagerCaller(request))) {
    throw new CallableError('permission-denied', 'Only managers can reset a PIN.');
  }
  const { accountId, memberId, member } = await requireMember(request, request.data);
  await Promise.all([
    secretRef(accountId, memberId).delete(),
    memberRef(accountId, memberId).update({ hasPin: FieldValue.delete() }),
  ]);
  logger.info(`PIN reset for member ${memberId} (${member.displayName || '?'}) by ${request.auth.token.email}`);
  return { success: true };
});

/**
 * Keep the PIN check warm through opening hours.
 *
 * Functions scale to zero, and a cold start is a second or two — which lands
 * on whoever taps their name first, standing at the bar holding a crate. A
 * ping every five minutes keeps one instance up. This is deliberately cheaper
 * than minInstances: idle containers aren't billed, only the ping's own
 * runtime, so it costs pennies a month rather than pounds.
 *
 * Hours are the pub's, in the pub's timezone: from mid-morning through to 2am,
 * which covers the close shifts clocking out. Outside that the first tap pays
 * the cold start, and there's nobody there to mind.
 */
exports.keepPinWarm = onSchedule({
  schedule: '*/5 0-2,9-23 * * *',
  timeZone: 'Europe/London',
  retryCount: 0, // a missed ping costs one cold start; retrying it is pointless
}, async () => {
  const project = process.env.GCLOUD_PROJECT || 'bar-blade';
  const url = `https://europe-west2-${project}.cloudfunctions.net/verifyStaffPin`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { warm: true } }),
    });
    if (!res.ok) logger.warn(`Keep-warm ping returned ${res.status}`);
  } catch (err) {
    logger.warn(`Keep-warm ping failed: ${err.message}`);
  }
});

// ---------------------------------------------------------------------------
// Account deletion (super-admin only)
// ---------------------------------------------------------------------------

/**
 * Delete a customer account outright: every venue and all its data, the member
 * list, and the sign-in of every member provisioned for it. Irreversible —
 * there is no soft-delete or restore, so the client confirms before calling.
 *
 * Sign-ins go first: a member whose auth user outlives the account keeps a
 * token carrying its accountId. Super-admins are skipped — they're only ever
 * visiting, and their own sign-in must survive. Rules can't express recursion,
 * so this has to be Admin SDK work rather than a client delete.
 */
exports.deleteAccount = onCall(async (request) => {
  if (!request.auth) throw new CallableError('unauthenticated', 'Sign in first.');
  const caller = normEmail(request.auth.token.email);
  const platform = request.auth.token.platformAdmin === true || (await isSuperAdmin(caller));
  if (!platform) throw new CallableError('permission-denied', 'Only platform admins can delete accounts.');

  const accountId = String((request.data && request.data.accountId) || '').trim();
  if (!accountId) throw new CallableError('invalid-argument', 'accountId is required.');
  // The platform's home account: every super-admin's token points at it and
  // their member docs live there, so deleting it would lock them out of BBlade.
  if (accountId === ACCOUNT_ID) {
    throw new CallableError('failed-precondition', 'The platform’s own account cannot be deleted.');
  }

  const ref = db.doc(`accounts/${accountId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new CallableError('not-found', 'That account no longer exists.');
  const name = (snap.data() || {}).name || accountId;

  const members = await db.collection(`accounts/${accountId}/members`).get();
  let revoked = 0;
  for (const d of members.docs) {
    const email = normEmail((d.data() || {}).email);
    if (!email || (await isSuperAdmin(email))) continue;
    try {
      const u = await getAuth().getUserByEmail(email);
      // Only if this account is the one that provisioned them — never take out
      // an auth user that belongs to a different tenant.
      if (u.customClaims?.accountId === accountId) { await getAuth().deleteUser(u.uid); revoked += 1; }
    } catch (err) {
      if (err.code !== 'auth/user-not-found') throw err;
    }
  }

  await db.recursiveDelete(ref);
  logger.info(`Account ${accountId} ("${name}") deleted by ${caller}; ${revoked} sign-in(s) revoked`);
  return { success: true, revoked };
});
