import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import reportWebVitals from './reportWebVitals';
import { ErrorBoundary } from './ErrorBoundary';

// Cleanse any leftover vite-plugin-pwa service worker from earlier installs.
// PyKeko v0.2.22 and earlier shipped with VitePWA enabled, which registered a
// workbox SW on the localhost:51823 origin. The SW persists across reinstalls
// and serves the previous version's cached bundle on first launch after upgrade
// — so new releases appear "broken" until the user reloads (the stale-cache
// trap that bit every PyKeko upgrade pre-v0.2.23). v0.2.23 disables VitePWA at
// build time; this block unregisters any pre-existing registration on the
// renderer's next launch so users transitioning from v0.2.22 stop hitting it.
if (typeof navigator !== "undefined" && navigator.serviceWorker) {
    navigator.serviceWorker.getRegistrations().then((regs) => {
        for (const reg of regs) reg.unregister();
    }).catch(() => {});
    if (typeof caches !== "undefined") {
        caches.keys().then((names) => {
            for (const n of names) if (n.includes("workbox") || n.startsWith("pwa-")) caches.delete(n);
        }).catch(() => {});
    }
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ErrorBoundary >
      <App />
    </ErrorBoundary>
 </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
