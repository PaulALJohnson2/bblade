import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// PWA safeguard: after a deploy the new service worker (autoUpdate → skipWaiting)
// claims this already-open page, which left the app running half-swapped against
// a fresh cache — the state that was bouncing Google sign-in back to /login.
// When the controller actually changes (an update, not the first install), do one
// clean reload so the page reloads fresh under the new worker. The `reloading`
// guard makes it a single reload, never a loop.
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller; // false on first-ever visit
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return; // skip the initial claim; reload once on updates
    reloading = true;
    window.location.reload();
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
