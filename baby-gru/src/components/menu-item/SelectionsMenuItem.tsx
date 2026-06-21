// PyKeko v0.3 — Selections panel (Edit → Selections...).
//
// Ad-hoc selection-algebra evaluator + saved-selections manager. Type an
// expression in the top textarea -> live count + CID preview. Save the
// expression by name for re-use across launches; saved names can be
// referenced inside other expressions ("pocket and resi 481").
//
// Quick actions on the current selection:
//   - Centre view on the first matching atom
//   - Copy CIDs to clipboard (for pasting into PyMOL commands / REPL)
//   - Save under a name
//
// Grammar reference is intentionally repeated in a small help box at
// the bottom of the panel so users can discover the syntax without
// reading docs.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { moorhen } from "../../types/moorhen";
import { MoorhenButton } from "../inputs";
import { MoorhenStack } from "../interface-base";
import { enqueueSnackbar, setSavedSelection, removeSavedSelection } from "@/store/";

export const SelectionsMenuItem = () => {
    const dispatch = useDispatch();
    const savedByName = useSelector((state: moorhen.State) => (state as any).savedSelections?.byName || {});
    const savedNames = useMemo(() => Object.keys(savedByName).sort(), [savedByName]);

    const [expr, setExpr] = useState<string>("byres polymer within 5 of organic");
    const [saveName, setSaveName] = useState<string>("");
    const [count, setCount] = useState<number | null>(null);
    const [cids, setCids] = useState<string[]>([]);
    const [error, setError] = useState<string>("");
    const [busy, setBusy] = useState<boolean>(false);

    const evaluate = useCallback(async () => {
        const api: any = (typeof window !== "undefined") ? (window as any).MoorhenControlApi : null;
        if (!api?.evaluateSelection) {
            setError("Selection API not ready yet.");
            return;
        }
        setBusy(true);
        try {
            const r = await api.evaluateSelection(expr);
            if (r?.ok) { setError(""); setCount(r.count); setCids(r.cids || []); }
            else { setError(r?.error || "Unknown error"); setCount(null); setCids([]); }
        } finally { setBusy(false); }
    }, [expr]);

    // Auto-evaluate on expr changes, debounced.
    useEffect(() => {
        const t = setTimeout(evaluate, 300);
        return () => clearTimeout(t);
    }, [expr, evaluate]);

    const onSave = useCallback(() => {
        const name = saveName.trim();
        if (!name) { setError("Enter a name to save under."); return; }
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
            setError("Name must start with a letter or underscore, then letters/digits/underscores only.");
            return;
        }
        if (error || count === null) {
            setError("Fix the expression before saving.");
            return;
        }
        dispatch(setSavedSelection({ name, expression: expr }));
        dispatch(enqueueSnackbar({
            message: `Saved selection "${name}" (${count} atoms). Use it by typing "${name}" in any expression.`,
            variant: "success",
        }));
        setSaveName("");
    }, [saveName, expr, count, error, dispatch]);

    const onLoad = useCallback((name: string) => {
        const s = savedByName[name];
        if (s) setExpr(s.expression);
    }, [savedByName]);

    const onDelete = useCallback((name: string) => {
        dispatch(removeSavedSelection(name));
    }, [dispatch]);

    const onCentre = useCallback(async () => {
        if (cids.length === 0) return;
        const api: any = (typeof window !== "undefined") ? (window as any).MoorhenControlApi : null;
        // The first CID's first residue is the target. Cheap parse.
        const first = cids[0];
        const m = first.match(/^\/(\d+)\/([^/]+)\/([0-9]+)/);
        if (!m) { dispatch(enqueueSnackbar({ message: "Could not parse first CID for centring.", variant: "warning" })); return; }
        const [, mol, ch, res] = m;
        if (api?.goToResidue) await api.goToResidue(`/${mol}/${ch}/${res}`, Number(mol));
    }, [cids, dispatch]);

    const onCopy = useCallback(async () => {
        const txt = cids.join("\n");
        try {
            if (typeof navigator !== "undefined" && navigator.clipboard) {
                await navigator.clipboard.writeText(txt);
                dispatch(enqueueSnackbar({ message: `${cids.length} CIDs copied to clipboard.`, variant: "info", autoHideDuration: 4000 }));
            }
        } catch (e: any) {
            dispatch(enqueueSnackbar({ message: `Copy failed: ${e?.message || e}`, variant: "error" }));
        }
    }, [cids, dispatch]);

    return (
        <MoorhenStack gap="0.5rem" style={{ minWidth: 460 }}>
            <div style={{ fontSize: "0.85rem", color: "#495057" }}>
                Selection expression (PyMOL-style):
            </div>
            <textarea
                value={expr}
                onChange={(e) => setExpr(e.target.value)}
                rows={2}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                style={{
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    fontSize: "12.5px",
                    padding: "5px 8px",
                    border: "1px solid #adb5bd",
                    borderRadius: 4,
                    width: "100%",
                    resize: "vertical",
                }}
            />
            <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: "0.85rem" }}>
                <span style={{ color: error ? "#c92a2a" : "#37b24d", minWidth: 100 }}>
                    {busy ? "evaluating…" : error ? `error` : (count !== null ? `${count} atoms` : "—")}
                </span>
                <MoorhenButton onClick={onCentre} disabled={!cids.length || !!error}>Centre</MoorhenButton>
                <MoorhenButton onClick={onCopy} disabled={!cids.length || !!error}>Copy CIDs</MoorhenButton>
            </div>
            {error && (
                <div style={{ background: "#fff0f0", border: "1px solid #f9b0b0", padding: "5px 8px", borderRadius: 4, fontSize: "12px", color: "#a02020", whiteSpace: "pre-wrap" }}>
                    {error}
                </div>
            )}
            {cids.length > 0 && !error && (
                <details>
                    <summary style={{ cursor: "pointer", fontSize: "0.85rem", color: "#495057" }}>
                        Show CIDs ({cids.length})
                    </summary>
                    <div style={{
                        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                        fontSize: "11px",
                        maxHeight: 120, overflowY: "auto",
                        padding: "4px 6px", background: "#f8f9fa", border: "1px solid #dee2e6", borderRadius: 4,
                    }}>
                        {cids.slice(0, 50).map((c, i) => <div key={i}>{c}</div>)}
                        {cids.length > 50 && <div style={{ color: "#868e96" }}>… {cids.length - 50} more</div>}
                    </div>
                </details>
            )}

            <hr style={{ margin: "6px 0", border: "none", borderTop: "1px solid #dee2e6" }} />

            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                    type="text"
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                    placeholder="name to save as (e.g. pocket)"
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    style={{
                        flex: 1,
                        fontFamily: "inherit",
                        fontSize: "12px",
                        padding: "3px 6px",
                        border: "1px solid #adb5bd",
                        borderRadius: 4,
                    }}
                />
                <MoorhenButton onClick={onSave} disabled={!saveName.trim() || !!error}>Save</MoorhenButton>
            </div>

            {savedNames.length > 0 && (
                <div>
                    <div style={{ fontSize: "0.85rem", color: "#495057", marginBottom: 4 }}>
                        Saved selections (click to load, × to delete):
                    </div>
                    <div style={{ maxHeight: 140, overflowY: "auto", border: "1px solid #dee2e6", borderRadius: 4 }}>
                        {savedNames.map((name) => (
                            <div key={name} style={{
                                display: "flex",
                                alignItems: "center",
                                padding: "3px 6px",
                                borderBottom: "1px solid #e9ecef",
                                fontSize: "12px",
                                gap: 6,
                            }}>
                                <button
                                    onClick={() => onLoad(name)}
                                    style={{
                                        background: "none", border: "none",
                                        cursor: "pointer", padding: 0,
                                        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                                        fontWeight: 600, color: "#1971c2",
                                        minWidth: 80, textAlign: "left",
                                    }}
                                >
                                    {name}
                                </button>
                                <span style={{
                                    flex: 1,
                                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                                    fontSize: "11.5px", color: "#495057",
                                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                }}>
                                    {savedByName[name].expression}
                                </span>
                                <button
                                    onClick={() => onDelete(name)}
                                    style={{
                                        background: "none", border: "none",
                                        cursor: "pointer", color: "#868e96",
                                        fontSize: "14px", padding: "0 4px",
                                    }}
                                    title={`Delete "${name}"`}
                                >×</button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <details>
                <summary style={{ cursor: "pointer", fontSize: "0.85rem", color: "#495057" }}>
                    Grammar quick reference
                </summary>
                <div style={{ fontSize: "11.5px", color: "#495057", padding: "4px 0", lineHeight: 1.5 }}>
                    <div><b>Combine:</b> <code>and</code>, <code>or</code>, <code>not</code>, <code>(...)</code></div>
                    <div><b>Expand:</b> <code>byres</code> &lt;expr&gt; (whole residues), <code>byobj</code> &lt;expr&gt; (whole molecule)</div>
                    <div><b>Distance:</b> &lt;outer&gt; <code>within</code> R <code>of</code> &lt;inner&gt;</div>
                    <div><b>Picks:</b> <code>chain A</code>, <code>resi 100-200</code>, <code>resn ALA+GLY</code>, <code>name CA+CB</code></div>
                    <div><b>Numeric:</b> <code>b &gt; 50</code>, <code>q &lt; 0.5</code></div>
                    <div><b>Classes:</b> <code>polymer</code>, <code>organic</code>, <code>solvent</code>, <code>water</code>, <code>metals</code>, <code>hydro</code>, <code>protein</code>, <code>nucleic</code></div>
                    <div><b>Saved:</b> reference any saved selection by bare name (e.g. <code>pocket and resi 481</code>)</div>
                </div>
            </details>
        </MoorhenStack>
    );
};
