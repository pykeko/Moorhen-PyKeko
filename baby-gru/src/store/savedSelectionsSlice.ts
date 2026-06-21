// PyKeko v0.3 — saved selections store.
//
// Persists across launches via localStorage and is included in .pykeko
// session files so saved selections survive a session round-trip on a
// different machine. Each saved selection is just (name, expression);
// the expression is re-parsed and re-evaluated at use time, so the
// underlying CIDs follow whatever the structure looks like now.

import { createSlice } from "@reduxjs/toolkit";

const LS_KEY = "pykeko.savedSelections";

export interface SavedSelection {
    name: string;
    expression: string;
    // Optional one-line note for the user's own reference.
    note?: string;
}

function loadFromLocalStorage(): Record<string, SavedSelection> {
    try {
        if (typeof window === "undefined") return {};
        const raw = window.localStorage?.getItem(LS_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") return parsed;
    } catch { /* ignore */ }
    return {};
}

function persist(state: Record<string, SavedSelection>) {
    try {
        if (typeof window !== "undefined") {
            window.localStorage?.setItem(LS_KEY, JSON.stringify(state));
        }
    } catch { /* ignore */ }
}

const initialState: { byName: Record<string, SavedSelection> } = {
    byName: loadFromLocalStorage(),
};

const slice = createSlice({
    name: "savedSelections",
    initialState,
    reducers: {
        // API
        setSavedSelection(state, action: { payload: SavedSelection; type: string }) {
            state.byName[action.payload.name] = action.payload;
            persist(state.byName);
        },
        // API
        removeSavedSelection(state, action: { payload: string; type: string }) {
            delete state.byName[action.payload];
            persist(state.byName);
        },
        // API
        clearSavedSelections(state) {
            state.byName = {};
            persist(state.byName);
        },
        // API -- bulk replace, used by .pykeko restore
        replaceSavedSelections(state, action: { payload: Record<string, SavedSelection>; type: string }) {
            state.byName = action.payload || {};
            persist(state.byName);
        },
    },
});

export const { setSavedSelection, removeSavedSelection, clearSavedSelections, replaceSavedSelections } = slice.actions;
export default slice.reducer;
