import { initializeApp } from "firebase/app";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getAnalytics, isSupported as analyticsIsSupported } from "firebase/analytics";

// Bar Blade — Firebase project config.
// authDomain must run the Google sign-in handler SAME-ORIGIN as the app, or the
// redirect/popup loses its state and bounces back to login (storage partitioning
// on mobile). The app is served from multiple Firebase Hosting domains
// (bblade.live and bar-blade.web.app), each of which serves /__/auth — so we set
// authDomain to the current host when it's one of those, and fall back to
// bar-blade.web.app elsewhere (e.g. localhost dev, where popup works cross-domain).
const HOSTING_AUTH_DOMAINS = new Set([
  'bblade.live',
  'www.bblade.live',
  'bar-blade.web.app',
  'bar-blade.firebaseapp.com',
]);
const currentHost = typeof window !== 'undefined' ? window.location.hostname : '';
const authDomain = HOSTING_AUTH_DOMAINS.has(currentHost) ? currentHost : 'bar-blade.web.app';

const firebaseConfig = {
  apiKey: "AIzaSyCUD-4Vgc9y93-QadFb_9CI6z8w_C--ElI",
  authDomain,
  projectId: "bar-blade",
  storageBucket: "bar-blade.firebasestorage.app",
  messagingSenderId: "208876986340",
  appId: "1:208876986340:web:0ac25698d97fc19cabb1f1",
  measurementId: "G-8R333SCJPW",
};

const app = initializeApp(firebaseConfig);

// Firestore — the data backend for the stock module.
// Durable offline persistence (IndexedDB): the stock list is cached on the
// device, reads work with no signal, and counts are queued and survive reloads
// / tab eviction, syncing when connectivity returns — essential for counting in
// underground cellars. Multi-tab manager keeps several open tabs consistent.
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

// Authentication — Google sign-in.
const auth = getAuth(app);

// Analytics — only initialised in supported (browser) environments so it never
// breaks local dev or the build. Safe to ignore the returned promise.
let analytics = null;
analyticsIsSupported()
  .then((ok) => {
    if (ok) analytics = getAnalytics(app);
  })
  .catch(() => {});

export { app, db, auth, analytics };
