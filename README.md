# Bar Blade — Stock

The first module of **Bar Blade**, a suite of operational tools for independent
pubs. This is the standalone stock-taking app, detached from the P&L Dashboard. Mobile-first
workflow for counting bar & kitchen inventory in resumable sessions, with
per-item unit parsing (kegs/tenths/cases/loose, etc.), session history, and a
printable/PDF stock-take report.

> **Status:** early scaffold for a separate venture. **Authentication has been
> removed for now** — the app runs against a single hardcoded pub with no login.
> Auth and multi-pub support will be added back later (see *Re-adding auth* below).

## Stack

- React 19 + Vite
- Firebase Firestore (real-time listeners) — **no** Auth/Storage/Functions yet
- No other backend; all data access is in `src/firebase/firestoreService.js`

## One-time setup

1. **Create a new Firebase project** (this is a brand-new backend, separate from
   the original P&L app — do not reuse `accounts-37e8d`):
   - <https://console.firebase.google.com> → *Add project*
   - In the project, create a **Web app** and copy its config object.
   - Enable **Cloud Firestore** (*Build → Firestore Database → Create database*).

2. **Wire in the config:**
   - Paste your web config values into `src/firebase/config.js` (replace the
     `REPLACE_ME` placeholders).
   - Put your project id into `.firebaserc` (replace `REPLACE_ME`).

3. **Install dependencies:**
   ```bash
   npm install
   ```

## Run locally

```bash
npm run dev          # http://localhost:3000
```

## Deploy Firestore rules + indexes

Requires the Firebase CLI (`npm i -g firebase-tools`, then `firebase login`).

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

> ⚠️ **Security:** because there is no auth yet, `firestore.rules` currently
> allows anyone to read/write the stock collections. Keep the project private
> and lock the rules down before any public/real-data use.

## Build & host (optional)

```bash
npm run build                # outputs to dist/
firebase deploy --only hosting
```

## Seeding stock items

The app starts empty — add items in-app via **+ Add Item** (top right).

To bulk-seed from the bundled list (`src/data/dukeStockList.json`), call
`importStockList(PUB.id, items)` from `src/firebase/firestoreService.js`.
**Note:** `importStockList` **deletes all existing items first**, then writes the
list. Only use it on an empty/expendable dataset. (A small one-off import button
can be wired up if you want this in the UI.)

## Project layout

```
src/
├── pages/StockTaking.jsx        # the whole stock UI (copied verbatim from P&L)
├── firebase/
│   ├── config.js                # Firebase init (FILL IN your project config)
│   └── firestoreService.js      # stock-only Firestore CRUD + sessions
├── services/apiService.js       # re-export layer over firestoreService
├── contexts/AuthContext.jsx     # STUB — no auth; single hardcoded pub
├── config/app.js                # the hardcoded PUB { id, name }
├── hooks/useTheme.js            # dark-mode hook (localStorage + system pref)
├── utils/
│   ├── theme.js                 # colour tokens for inline styles
│   └── stockUnitUtils.js        # unit parsing / count formatting
├── data/dukeStockList.json      # optional seed list
├── App.jsx                      # minimal shell (header + theme toggle)
├── App.css / index.css          # styles + CSS theming variables
└── main.jsx
```

## Data model

```
pubs/{pubId}/stockItems/{itemId}      # inventory items
pubs/{pubId}/stockSessions/{sessionId} # counting sessions (counts, history)
```

`pubId` is the hardcoded `PUB.id` (`'main'`) from `src/config/app.js`. The
pub-scoped paths are kept deliberately so multi-pub support drops back in
without a data migration.

## Re-adding auth later

Auth was removed in three places; restoring it means:

1. `src/contexts/AuthContext.jsx` — replace the fixed stub `value` with real
   Firebase Auth state (Google sign-in, user profile, role helpers,
   `selectedPub`). `StockTaking.jsx` consumes `useAuth()` and needs **no**
   changes.
2. `src/firebase/config.js` — re-add `getAuth(app)` (and Storage/Functions if
   needed).
3. `firestore.rules` — swap `if true` for authenticated + role/pub checks.

`StockTaking.jsx` already calls `canAccessStock()`, `canEdit()`, `isAdmin()`,
`isSuperAdmin()` and reads `selectedPub` — so a fuller AuthContext is the only
moving part.
