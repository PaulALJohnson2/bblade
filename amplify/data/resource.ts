import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

/**
 * Bar Blade data model (migrated from Firestore).
 *
 * Firestore was a path hierarchy:
 *   accounts/{accountId}
 *     ├─ members/{memberId}
 *     └─ venues/{venueId}
 *          ├─ stockItems/{itemId}
 *          └─ stockSessions/{sessionId}
 *
 * AppSync/DynamoDB is flat, so parent ownership is kept as scalar `accountId` /
 * `venueId` fields plus a secondary index on each, which gives us the same
 * "list all children of this parent" query the Firestore subcollections gave us.
 *
 * Authorization mirrors the OLD Firestore rules exactly: any signed-in user may
 * read/write all data. Per-tenant isolation is still enforced client-side (the
 * member allowlist in AuthContext), same as before. Proper per-account lockdown
 * (owner/group-based rules) is future work — see the note in firestore.rules.
 *
 * Amplify auto-adds `id`, `createdAt`, `updatedAt` to every model.
 */
const schema = a.schema({
  // accounts/{accountId} — the customer / tenant boundary.
  Account: a
    .model({
      name: a.string(),
      ownerUid: a.string(),
      plan: a.string(),
      // JSON stored as a string (encoded/decoded in stockService) — AWSJSON via
      // the data client mangles populated values (amplify-data issue #474).
      entitlements: a.string(), // JSON: { stock, bookings, … }
    })
    .authorization((allow) => [allow.authenticated()]),

  // accounts/{accountId}/members/{memberId} — staff identity + access.
  Member: a
    .model({
      accountId: a.id().required(),
      displayName: a.string(),
      email: a.string(),
      role: a.enum(['owner', 'manager', 'staff']),
      venueAccess: a.string(), // JSON: [venueId] | 'all' (see entitlements note)
      active: a.boolean(),
    })
    .secondaryIndexes((index) => [index('accountId')])
    .authorization((allow) => [allow.authenticated()]),

  // accounts/{accountId}/venues/{venueId} — a pub / site.
  Venue: a
    .model({
      accountId: a.id().required(),
      name: a.string(),
    })
    .secondaryIndexes((index) => [index('accountId')])
    .authorization((allow) => [allow.authenticated()]),

  // venues/{venueId}/stockItems/{itemId} — inventory.
  StockItem: a
    .model({
      accountId: a.string(),
      venueId: a.id().required(),
      name: a.string(),
      section: a.enum(['bar', 'kitchen']),
      category: a.string(),
      categorySuggested: a.string(),
      productCode: a.string(),
      costPrice: a.float(),
      unitCost: a.float(),
      wholeUnit: a.string(),
      partUnit: a.string(),
      unit: a.string(),
      quantity: a.float(),
      archived: a.boolean(),
      lastCountedAt: a.datetime(),
    })
    .secondaryIndexes((index) => [index('venueId')])
    .authorization((allow) => [allow.authenticated()]),

  // venues/{venueId}/stockSessions/{sessionId} — counting sessions.
  // `counts` is the nested { itemId -> {...} } map, kept as JSON (it was a
  // dynamic Firestore map). status/section etc. mirror the old document.
  StockSession: a
    .model({
      accountId: a.string(),
      venueId: a.id().required(),
      createdBy: a.string(),
      createdByName: a.string(),
      status: a.enum(['in_progress', 'completed']),
      section: a.string(),
      counts: a.string(), // JSON: { itemId -> {...} } (see entitlements note)
      completedAt: a.datetime(),
    })
    .secondaryIndexes((index) => [index('venueId')])
    .authorization((allow) => [allow.authenticated()]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});
