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
import { useStore } from "react-redux";
import { useTimeCapsule } from "../InstanceManager/hooks";
import { moorhensession } from "../protobuf/MoorhenSession";

const AUTOSAVE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export const MoorhenAutosaveManager = () => {
  const store = useStore();
  const timeCapsule = useTimeCapsule();
  const lastSavedByteLenRef = useRef<number>(-1);
  const inFlightRef = useRef<boolean>(false);

  useEffect(() => {
    // Only useful in the desktop wrapper — needs the __moorhenControl bridge
    // for the write IPC. Browser build has no autosave path.
    const ctrl = (typeof window !== "undefined") ? (window as any).__moorhenControl : null;
    if (!ctrl || typeof ctrl.autosave !== "function") {
      console.debug("[MoorhenAutosaveManager] __moorhenControl.autosave unavailable — skipping");
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
  }, [store, timeCapsule]);

  return null;
};
