/**
 * App configuration for Bar Blade (the suite) — Stock module.
 *
 * Multi-tenant, multi-product data model (no auth yet, so the current tenant is
 * hardcoded to the auto-generated IDs created at onboarding):
 *
 *   accounts/{accountId}                      ← the customer (tenant boundary)
 *     ├─ name, ownerUid, plan, entitlements:{ stock, bookings, … }
 *     ├─ members/{memberId}                    ← staff identity + role + venueAccess
 *     └─ venues/{venueId}                      ← a pub/site (generic "venue")
 *          ├─ name
 *          ├─ stockItems/{itemId}              ← (Stock module) { …, accountId, venueId }
 *          └─ stockSessions/{sessionId}        ← (Stock module)
 *
 * Three ownership tiers — ACCOUNT (tenant + shared master data: members, later
 * guests/suppliers) → VENUE (site-scoped) → PRODUCT (a tool's collections under
 * the venue). Future tools (Bookings, Rotas, …) slot in as new collections under
 * the venue. The stock service layer is account-agnostic: it takes a VENUE PATH,
 * so wiring real auth later only touches AuthContext.
 *
 * IDs are Firestore auto-IDs (not human slugs). These two become the signed-in
 * user's account + selected venue once auth + a venue switcher land.
 */

export const ACCOUNT_ID = 'HBBEnX7bxP9wWASvFKMC';
export const VENUE_ID = 'XtX2rcDcvvc2z2dpMGFS';

/**
 * Platform super-admins (BBlade staff). These emails get cross-account access:
 * they can see all accounts, create new ones, and switch into any account to
 * operate it — regardless of any account's member allowlist. Client-side gate
 * (matches the current security posture; tighten with custom claims later).
 */
export const SUPER_ADMINS = [
  'contact@pauljohnson.me',
  'barblade3@gmail.com',
];

export const isSuperAdminEmail = (email) =>
  !!email && SUPER_ADMINS.includes(String(email).toLowerCase());

/** Firestore path to a venue document. */
export const venuePath = (accountId = ACCOUNT_ID, venueId = VENUE_ID) =>
  `accounts/${accountId}/venues/${venueId}`;

/** Extract { accountId, venueId } from a venue path (for stamping docs). */
export const idsFromVenuePath = (path) => {
  const p = String(path).split('/');
  return { accountId: p[1], venueId: p[3] };
};
