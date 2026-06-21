// PyKeko v0.3 — View → Quick views...
//
// One-click toggles for the daily-driver visibility recipes that PyMOL
// users expect under their fingertips:
//   - Hide solvent / Show solvent
//   - Hide hydrogens / Show hydrogens
//   - Show only pocket  (sticks for `byres polymer within 5 of organic`,
//                        cartoon for the rest, ligand as sticks)
//   - Reset view  (cartoon everywhere, sticks for ligands, all visible)
//
// Each chip dispatches one or more PyMOL commands through the existing
// translator -- no new bridge code, no destructive edits. The selection
// algebra (#7) and the translator's already-fluent grammar do the work.

import { useCallback, useState } from "react";
import { useDispatch } from "react-redux";
import { MoorhenButton } from "../inputs";
import { MoorhenStack } from "../interface-base";
import { enqueueSnackbar } from "@/store/";

export const QuickViewsMenuItem = () => {
    const dispatch = useDispatch();
    const [busy, setBusy] = useState<boolean>(false);

    const runPyMol = useCallback(async (script: string, message?: string) => {
        const api: any = (typeof window !== "undefined") ? (window as any).MoorhenControlApi : null;
        if (!api?.runPymol) {
            dispatch(enqueueSnackbar({ message: "PyMOL translator not ready.", variant: "error" }));
            return;
        }
        setBusy(true);
        try {
            const r = await api.runPymol(script);
            if (r?.ok === false) {
                dispatch(enqueueSnackbar({ message: `Failed: ${r?.error || "unknown"}`, variant: "error" }));
            } else if (message) {
                dispatch(enqueueSnackbar({ message, variant: "info", autoHideDuration: 3000 }));
            }
        } finally { setBusy(false); }
    }, [dispatch]);

    return (
        <MoorhenStack gap="0.4rem" style={{ minWidth: 320 }}>
            <div style={{ fontSize: "0.85rem", color: "#495057", marginBottom: 2 }}>
                Common visibility recipes. Each fires one or more PyMOL
                commands through the in-app translator.
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                <MoorhenButton onClick={() => runPyMol("hide everything, solvent", "Solvent hidden")} disabled={busy}>
                    Hide solvent
                </MoorhenButton>
                <MoorhenButton onClick={() => runPyMol("show lines, solvent", "Solvent shown")} disabled={busy}>
                    Show solvent
                </MoorhenButton>

                <MoorhenButton onClick={() => runPyMol("hide everything, hydro", "Hydrogens hidden")} disabled={busy}>
                    Hide hydrogens
                </MoorhenButton>
                <MoorhenButton onClick={() => runPyMol("show sticks, hydro", "Hydrogens shown")} disabled={busy}>
                    Show hydrogens
                </MoorhenButton>
            </div>

            <hr style={{ margin: "4px 0", border: "none", borderTop: "1px solid #dee2e6" }} />

            <MoorhenButton
                onClick={() => runPyMol(
                    "hide everything; show cartoon, polymer; show sticks, byres polymer within 5 of organic; show sticks, organic",
                    "Pocket view applied",
                )}
                disabled={busy}
            >
                Show only pocket
            </MoorhenButton>

            <MoorhenButton
                onClick={() => runPyMol(
                    "show everything; show cartoon, polymer; show sticks, organic",
                    "Default view restored",
                )}
                disabled={busy}
            >
                Reset to default view
            </MoorhenButton>

            <div style={{ fontSize: "11px", color: "#868e96", lineHeight: 1.4, marginTop: 4 }}>
                Tip: each chip is a small PyMOL script. To customise — e.g. a
                different pocket radius or your own preferred default rep — copy
                the command from `/tmp/pykeko.log` (or open the in-app console
                with ⌘`) into a recipe of your own.
            </div>
        </MoorhenStack>
    );
};
