import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import reportWebVitals from './reportWebVitals';
import { ErrorBoundary } from './ErrorBoundary';

// Cleanse any leftover vite-plugin-pwa service worker from earlier installs.
// PyKeko v0.2.22 and earlier shipped with VitePWA enabled, which registered a
// workbox SW on the localhost:51823 origin. The SW persists across reinstalls
// and serves the previous version's cached bundle on first launch after upgrade
// — so new releases appear "broken" until the user reloads.
//
// v0.2.24 added an unregister-on-launch step but the page had ALREADY loaded
// the old bundle through the still-active SW before this code ran. v0.2.25
// upgrades the cleanup: if we detect any pre-existing SW registrations, force
// a hard reload AFTER unregistering, so launch #1 fully resets to the new
// bundle. Drops a sentinel on sessionStorage to avoid a reload loop if the
// reload itself somehow keeps detecting registrations.
if (typeof navigator !== "undefined" && navigator.serviceWorker) {
    const RELOADED_SENTINEL = "__pk_sw_reload_done";
    const alreadyReloaded = (() => {
        try { return sessionStorage.getItem(RELOADED_SENTINEL) === "1"; }
        catch (e) { return true; }
    })();
    navigator.serviceWorker.getRegistrations().then(async (regs) => {
        if (regs.length === 0) return;
        await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
        if (typeof caches !== "undefined") {
            const names = await caches.keys().catch(() => [] as string[]);
            await Promise.all(names.map((n) => caches.delete(n).catch(() => false)));
        }
        if (!alreadyReloaded) {
            try { sessionStorage.setItem(RELOADED_SENTINEL, "1"); } catch (e) {}
            window.location.reload();
        }
    }).catch(() => {});
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
