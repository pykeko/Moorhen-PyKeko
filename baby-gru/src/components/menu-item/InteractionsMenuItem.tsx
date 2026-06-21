// PyKeko v0.3 — View → Interactions...
//
// Four checkbox toggles for the four interaction overlays:
//   H-bonds  / Salt bridges / Disulfides / Clashes
// Each maps to a vectors-slice id-prefix and is rendered/cleared independently.
// Optional selection-algebra scope so detection runs only on a sub-region
// (e.g. "byres polymer within 6 of organic" -> only pocket interactions).
//
// State is local to the panel for now; future iterations could persist
// per-molecule overlay toggles in the .pykeko session schema.

import { useCallback, useState } from "react";
import { useDispatch } from "react-redux";
import { MoorhenButton } from "../inputs";
import { MoorhenStack } from "../interface-base";
import { enqueueSnackbar } from "@/store/";

type OverlayKey = "hbond" | "salt" | "disulfide" | "clash";

const LABELS: Record<OverlayKey, { label: string; tip: string; color: string }> = {
    hbond:     { label: "H-bonds",      tip: "Donor-acceptor pairs at 2.5-3.5 A",                    color: "#fcd34d" },
    salt:      { label: "Salt bridges", tip: "Arg/Lys/His N+ <-> Glu/Asp O- within 4 A",             color: "#669cff" },
    disulfide: { label: "Disulfides",   tip: "Cys SG-SG within 2.3 A (excludes intra-residue)",      color: "#fde047" },
    clash:     { label: "Clashes",      tip: "Overlap > 0.4 A vs sum of vdW radii (excl. hydrogens)", color: "#ff5577" },
};

export const InteractionsMenuItem = () => {
    const dispatch = useDispatch();
    const [enabled, setEnabled] = useState<Record<OverlayKey, boolean>>({
        hbond: true, salt: true, disulfide: true, clash: false,
    });
    const [selection, setSelection] = useState<string>("");
    const [busy, setBusy] = useState<boolean>(false);
    const [counts, setCounts] = useState<Partial<Record<OverlayKey, number>>>({});

    const apply = useCallback(async () => {
        const api: any = (typeof window !== "undefined") ? (window as any).MoorhenControlApi : null;
        if (!api?.showInteractions || !api?.hideInteractions) {
            dispatch(enqueueSnackbar({ message: "Interaction API not ready.", variant: "error" }));
            return;
        }
        setBusy(true);
        try {
            // First hide types the user turned off, then show types they turned on.
            const off = (Object.keys(enabled) as OverlayKey[]).filter(k => !enabled[k]);
            if (off.length) await api.hideInteractions(off);
            const on = (Object.keys(enabled) as OverlayKey[]).filter(k => enabled[k]);
            if (on.length) {
                const r = await api.showInteractions({ types: on, selection: selection.trim() || undefined });
                if (r?.ok) {
                    setCounts(r.counts || {});
                    const summary = on.map(k => `${LABELS[k].label}: ${r.counts[k] ?? 0}`).join(" · ");
                    dispatch(enqueueSnackbar({ message: summary, variant: "success", autoHideDuration: 6000 }));
                } else {
                    dispatch(enqueueSnackbar({ message: `Detection failed: ${r?.error || "unknown"}`, variant: "error" }));
                }
            } else {
                setCounts({});
            }
        } finally { setBusy(false); }
    }, [enabled, selection, dispatch]);

    const clearAll = useCallback(async () => {
        const api: any = (typeof window !== "undefined") ? (window as any).MoorhenControlApi : null;
        if (api?.hideInteractions) await api.hideInteractions();
        setCounts({});
    }, []);

    return (
        <MoorhenStack gap="0.6rem" style={{ minWidth: 360 }}>
            <div style={{ fontSize: "0.85rem", color: "#495057" }}>
                Detect and draw interaction overlays from the loaded structure.
                Each toggle renders independently as a coloured pseudobond.
            </div>
            <MoorhenStack gap="0.2rem">
                {(Object.keys(LABELS) as OverlayKey[]).map(k => (
                    <label
                        key={k}
                        title={LABELS[k].tip}
                        style={{
                            display: "flex", alignItems: "center", gap: 8,
                            fontSize: "13px", cursor: "pointer", userSelect: "none",
                        }}
                    >
                        <input
                            type="checkbox"
                            checked={enabled[k]}
                            onChange={(e) => setEnabled({ ...enabled, [k]: e.target.checked })}
                        />
                        <span style={{
                            display: "inline-block",
                            width: 14, height: 14,
                            background: LABELS[k].color,
                            border: "1px solid #495057", borderRadius: 2,
                        }} />
                        <span>{LABELS[k].label}</span>
                        {counts[k] !== undefined && (
                            <span style={{ color: "#868e96", marginLeft: "auto", fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>
                                {counts[k]} bonds
                            </span>
                        )}
                    </label>
                ))}
            </MoorhenStack>

            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                    type="text"
                    value={selection}
                    onChange={(e) => setSelection(e.target.value)}
                    placeholder='Restrict to selection (optional, e.g. "byres polymer within 6 of organic")'
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    style={{
                        flex: 1, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                        fontSize: "11.5px", padding: "3px 6px",
                        border: "1px solid #adb5bd", borderRadius: 4,
                    }}
                />
            </div>

            <div style={{ display: "flex", gap: 8 }}>
                <MoorhenButton onClick={apply} disabled={busy}>
                    {busy ? "Detecting..." : "Apply"}
                </MoorhenButton>
                <MoorhenButton onClick={clearAll} disabled={busy}>
                    Clear all
                </MoorhenButton>
            </div>

            <div style={{ fontSize: "11px", color: "#868e96", lineHeight: 1.4 }}>
                Tip: leave the selection blank to detect across the whole loaded scene.
                Clashes off by default because they're noisy in unrefined models.
            </div>
        </MoorhenStack>
    );
};
