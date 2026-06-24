import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getAnalytics, isSupported as analyticsIsSupported } from "firebase/analytics";

// Bar Blade — Firebase project config.
// authDomain is set to the Hosting domain (not the default *.firebaseapp.com)
// so the Google sign-in handler runs same-origin as the app. This avoids the
// "missing initial state" error caused by browser storage partitioning when the
// auth handler lives on a different domain (Safari/iOS, mobile). Firebase
// Hosting serves the handler at /__/auth automatically.
const firebaseConfig = {
  apiKey: "AIzaSyCUD-4Vgc9y93-QadFb_9CI6z8w_C--ElI",
  authDomain: "bar-blade.web.app",
  projectId: "bar-blade",
  storageBucket: "bar-blade.firebasestorage.app",
  messagingSenderId: "208876986340",
  appId: "1:208876986340:web:0ac25698d97fc19cabb1f1",
  measurementId: "G-8R333SCJPW",
};

const app = initializeApp(firebaseConfig);

// Firestore — the data backend for the stock module.
const db = getFirestore(app);

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
