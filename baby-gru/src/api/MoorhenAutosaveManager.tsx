// @ts-nocheck
// MoorhenAutosaveManager — PyKeko v0.3.7
//
// Renderer-side scheduler that periodically encodes the current session and
// hands the protobuf bytes to the main-process autosave IPC. Mounted
// alongside MoorhenControlBridge; uses the same hooks (useTimeCapsule,
// useStore) plus the __moorhenControl transport for the write.
//
// Design:
//   - Interval: 5 minutes (300s).
//   - Guard: skip write if 0 molecules loaded.
//   - Change signal: compare current encoded byteLen to lastSavedByteLen;
//     if identical, skip the write. Byte-length is a cheap proxy for state
//     hash — a molecule add/remove, rep add/remove, colour rule change, or
//     saved-selection change all move the number. False negatives (a change
//     that keeps byteLen exactly the same) are extremely rare; false
//     positives (saving on an inert change) are harmless.
//   - Filename base: first molecule's `.name` (sanitised main-side).
//   - Filename timestamp is added main-side, so we never overwrite our own
//     files.
//   - Cleanup: clearInterval on unmount.
//
// Not covered here (cycles 3-4):
//   - On-startup recovery detection + toast
//   - Preferences toggle to disable autosave
//   - Menu item File → Recover autosave
//
// This scheduler is enabled unconditionally for now; cycle 4 will gate on a
// preference.

import { useEffect, useRef } from "react";
import { useDispatch, useSelector, useStore } from "react-redux";
import { useTimeCapsule } from "../InstanceManager/hooks";
import { moorhensession } from "../protobuf/MoorhenSession";
import { enqueueSnackbar } from "@/store";
import type { RootState } from "../store/MoorhenReduxStore";

const AUTOSAVE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const RECOVERY_RECENT_MS = 24 * 60 * 60 * 1000; // last 24 h

export const MoorhenAutosaveManager = () => {
  const store = useStore();
  const dispatch = useDispatch();
  const timeCapsule = useTimeCapsule();
  const lastSavedByteLenRef = useRef<number>(-1);
  const inFlightRef = useRef<boolean>(false);
  // Toggle in Preferences → Backups → "Autosave session every 5 minutes"
  // (backupSettings.enablePykekoAutosave). Null-ish means the preference
  // hasn't hydrated yet — treat as enabled (matches PreferencesList default).
  const enabled = useSelector((state: RootState) =>
    (state.backupSettings as any).enablePykekoAutosave !== false);

  // Recovery toast on startup — one-shot. Fires even when autosave is
  // disabled, so a user who turned autosave off later still learns that
  // an old autosave exists to recover from.
  useEffect(() => {
    const ctrl = (typeof window !== "undefined") ? (window as any).__moorhenControl : null;
    if (!ctrl || typeof ctrl.autosaveList !== "function") return;
    let cancelled = false;
    (async () => {
      try {
        const r = await ctrl.autosaveList();
        if (cancelled) return;
        if (!r?.ok || !r?.entries?.length) return;
        const newest = r.entries[0];
        const age = Date.now() - Number(newest.mtimeMs || 0);
        if (age > RECOVERY_RECENT_MS) return;
        const mins = Math.max(1, Math.round(age / 60000));
        dispatch(enqueueSnackbar({
          message: `Autosave from ${mins} min ago available — File → Recover autosave`,
          variant: "info",
          autoHideDuration: 12000,
        }));
      } catch (e) {
        // silent — recovery hint is best-effort
      }
    })();
    return () => { cancelled = true; };
  }, [dispatch]);

  useEffect(() => {
    // Only useful in the desktop wrapper — needs the __moorhenControl bridge
    // for the write IPC. Browser build has no autosave path.
    const ctrl = (typeof window !== "undefined") ? (window as any).__moorhenControl : null;
    if (!ctrl || typeof ctrl.autosave !== "function") {
      console.debug("[MoorhenAutosaveManager] __moorhenControl.autosave unavailable — skipping");
      return;
    }
    if (!enabled) {
      console.debug("[MoorhenAutosaveManager] autosave disabled in preferences — skipping");
      return;
    }

    const tick = async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        // Guard: no molecules → nothing to preserve
        const state: any = store.getState();
        const mols = state?.molecules?.moleculeList ?? [];
        if (!mols.length) return;

        // Guard: TimeCapsule not yet wired
        if (!timeCapsule?.current?.fetchSession) return;

        const sessionObj = await timeCapsule.current.fetchSession(false); // lean; no MTZ
        // Encode via protobuf (same code path as saveSessionDesktop)
        const message = moorhensession.Session.create(sessionObj);
        const bytes = moorhensession.Session.encode(message).finish();

        // Skip if state hash (via byte length) hasn't changed since last save
        if (bytes.length === lastSavedByteLenRef.current) return;

        // Filename base: use first molecule's name. Main sanitises + timestamps.
        const suggestedBase = String(mols[0]?.name || "session");
        const r = await ctrl.autosave(bytes, suggestedBase);
        if (r?.ok) {
          lastSavedByteLenRef.current = bytes.length;
          console.debug(`[MoorhenAutosaveManager] wrote ${r.path} (${bytes.length.toLocaleString()} bytes)`);
        } else {
          console.warn(`[MoorhenAutosaveManager] autosave failed: ${r?.error || "unknown"}`);
        }
      } catch (e: any) {
        console.warn("[MoorhenAutosaveManager] tick error:", e?.message || e);
      } finally {
        inFlightRef.current = false;
      }
    };

    const id = setInterval(tick, AUTOSAVE_INTERVAL_MS);
    // Also run once on mount after a short warmup — but only after the app
    // has settled (skip the first 60s so the initial load doesn't dispatch
    // a save before the user has done anything).
    const initial = setTimeout(tick, 60_000);

    return () => {
      clearInterval(id);
      clearTimeout(initial);
    };
  // Re-arm when the enable toggle flips. Store/timeCapsule refs are stable.
  }, [store, timeCapsule, enabled]);

  return null;
};
