// Right-click context-menu button: declare a covalent link between the
// right-clicked atom (typically a Cys SG) and a ligand atom the user types.
//
// On submit, the panel:
//   1. Fetches the chosen link CIF template from public/MoorhenAssets/cov-links/
//   2. Loads it into the WASM via read_dictionary_string (so Refmac sees the chem_link)
//   3. Exports the current model as mmCIF
//   4. Injects a _struct_conn loop_ row pointing at both atoms with ccp4_link_id
//   5. Triggers a browser download of the augmented mmCIF
//
// Why not call make_covalent_link in the WASM: that binding is silently dropped
// at runtime — see feedback_moorhen_embind_silent_drop.md. Coot's mmCIF/PDB
// writers also strip connection metadata, so the link survives only in the
// downloaded file. The user feeds that file to refmacat externally.

import { useCallback, useEffect, useRef, useState } from "react";
import Draggable from "react-draggable";
import { useCommandCentre } from "../../InstanceManager";
import { usePauseClickAwayListener } from "../../hooks/pauseClickAwayListener";
import { moorhen } from "../../types/moorhen";
import { MoorhenContextButtonBase, ContextButtonProps } from "./MoorhenContextButtonBase";
import { executeCovalentLink } from "../../utils/MoorhenCovalentLinkExecutor";
import { parseChemCompFromDict } from "../../utils/MoorhenCovalentLinkDictParser";
import { detectWarheadFamily } from "../../utils/MoorhenCovalentLinkDetector";
import { parseCid, findAtomInModel } from "../../utils/MoorhenCovalentLinkSurgery";
import { cidToSpec } from "../../utils/utils";

interface LinkRegistryItem {
    id: string;
    name: string;
    family: string;
    link_cif: string;
}

export const LinkPanel = (props: {
    molecule: moorhen.Molecule;
    sgCid: string;
    commandCentre: React.RefObject<moorhen.CommandCentre>;
    setShowOverlay: React.Dispatch<React.SetStateAction<boolean>>;
    urlPrefix: string;
    // v0.2.39: optional pre-fills used by the menu-driven entry point
    // (Ligand → Make covalent…). When set, the panel opens with the SG
    // and Cβ already chosen; the detector auto-select effect runs once
    // cbCid is non-empty, so the warhead template selects itself for free.
    initialCbCid?: string;
    sgCidSourceLabel?: string;
}) => {
    const { molecule, sgCid, commandCentre, setShowOverlay, urlPrefix, initialCbCid, sgCidSourceLabel } = props;
    const [cbCid, setCbCid] = useState(initialCbCid ?? "");
    const [linkId, setLinkId] = useState("");
    const [registry, setRegistry] = useState<LinkRegistryItem[]>([]);
    const [picking, setPicking] = useState(false);
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState("");
    const [statusKind, setStatusKind] = useState<"info" | "error" | "success">("info");
    // Set after a successful declare so the "Refine with REFMAC5…" button
    // knows what paths to pass refmac5. Null until the bond is declared.
    const [savedModelCif, setSavedModelCif] = useState<string | null>(null);
    const [savedLinkCif, setSavedLinkCif] = useState<string | null>(null);
    const [savedModelPdb, setSavedModelPdb] = useState<string | null>(null);
    const [refmacBusy, setRefmacBusy] = useState(false);
    // v0.2.30 dropdown auto-prefilter: once the user has picked or typed a Cβ
    // CID, we run the detector against the ligand's chem_comp dict and stash
    // the detected entry id here. The dropdown then auto-selects it and
    // de-emphasises the entries from the OTHER family (still selectable so
    // the user can override).
    const [detectedEntryId, setDetectedEntryId] = useState<string | null>(null);
    // The popover's MoorhenClickAwayListener listens on "click", so the browser-
    // synthesized click that follows the canvas mousedown gets routed to the
    // listener AFTER atomClicked has fired — but the listener doesn't know that
    // and treats the canvas click as outside-the-popover, dismissing the entire
    // panel before the user sees the picked CID. Pause it while picking is
    // active (same pattern MoorhenCidInputForm uses); resume in onAtomClicked,
    // in stopPicking-on-cancel, and in the hook's own unmount cleanup.
    const [pauseClickAwayListener, resumeClickAwayListener] = usePauseClickAwayListener();

    // Load the cov-links registry on mount.
    //
    // urlPrefix defaults to "MoorhenAssets" (see MoorhenWebComponent.tsx:76 —
    // it's the assets-dir prefix, NOT a server-root prefix). So the URL is
    // ${urlPrefix}/cov-links/index.json, NOT ${urlPrefix}/MoorhenAssets/...
    // which doubles the prefix; the static server falls back to index.html
    // for the missing path, and JSON.parse chokes on "<!doctype" (the bug
    // that bit a fresh v0.2.21 install).
    useEffect(() => {
        (async () => {
            try {
                const url = `${urlPrefix}/cov-links/index.json`;
                const resp = await fetch(url);
                if (!resp.ok) {
                    setStatus(`Could not load cov-links registry (${resp.status} from ${url})`);
                    setStatusKind("error");
                    return;
                }
                const text = await resp.text();
                if (text.trimStart().startsWith("<")) {
                    setStatus(`Registry URL ${url} returned HTML — wrong assets path`);
                    setStatusKind("error");
                    return;
                }
                const data = JSON.parse(text);
                const items: LinkRegistryItem[] = (data?.warheads || []).map((w: any) => ({
                    id: w.id, name: w.name, family: w.family, link_cif: w.link_cif,
                }));
                setRegistry(items);
                if (items.length > 0) setLinkId(items[0].id);
            } catch (e: any) {
                setStatus(`Registry load failed: ${e?.message || e}`);
                setStatusKind("error");
            }
        })();
    }, [urlPrefix]);

    // Click-to-pick: listen for one atomClicked event when the user hits the
    // "Pick ligand atom" button. Same pattern used by MoorhenCreateAcedrgLinkModal
    // and MoorhenVectorsModal — the canvas (mgWebGL) dispatches "atomClicked" on
    // document with detail.label = the atom CID.
    //
    // The label format from parseAtomInfoLabel is
    //   /<mol_name>/<chain>/<res_no>(<res_name>)/<atom>[:<altloc>]
    // (mol_name is the file name like "8FD9", NOT the integer molNo). Use the
    // existing cidToSpec helper instead of a hand-rolled regex so the format
    // can't drift — earlier I had `^\/\d+\/...` which expected an integer
    // mol_no and never matched, so the picked CID silently fell through.
    useEffect(() => {
        if (!picking) return;
        const onAtomClicked = (evt: any) => {
            const pickedCid = evt?.detail?.label as string | undefined;
            if (!pickedCid) { setPicking(false); resumeClickAwayListener(); return; }
            try {
                const spec = cidToSpec(pickedCid);
                if (!spec?.chain_id || spec.res_no === undefined || !spec.atom_name) {
                    setStatus(`Could not parse picked CID: ${pickedCid}`);
                    setStatusKind("error");
                    setPicking(false);
                    resumeClickAwayListener();
                    return;
                }
                const short = `//${spec.chain_id}/${spec.res_no}/${String(spec.atom_name).trim()}`;
                setCbCid(short);
                setStatus(`Picked: ${short}`);
                setStatusKind("info");
            } catch (e: any) {
                setStatus(`Pick parse error: ${e?.message || e}`);
                setStatusKind("error");
            }
            setPicking(false);
            resumeClickAwayListener();
        };
        document.addEventListener("atomClicked", onAtomClicked, { once: true });
        return () => {
            document.removeEventListener("atomClicked", onAtomClicked);
        };
    }, [picking, resumeClickAwayListener]);

    // v0.2.30: when the user picks/types a Cβ CID and the registry is loaded,
    // run the detector to pre-select the matching warhead-template entry.
    // Skipped when the user already manually picked a different entry (we
    // check `linkId` against the last detected entry to detect manual override).
    const lastDetectedRef = useRef<string | null>(null);
    useEffect(() => {
        if (!cbCid.trim() || registry.length === 0) return;
        const cb = parseCid(cbCid.trim());
        if (!cb) return;
        let cancelled = false;
        (async () => {
            try {
                // Export model + find the residue containing the picked atom
                // so we have the ligand TLC (label_comp_id).
                const modelResp: any = await commandCentre.current.cootCommand({
                    returnType: "string",
                    command: "molecule_to_mmCIF_string_with_gemmi",
                    commandArgs: [molecule.molNo],
                } as any, false);
                const modelMmcif: string = modelResp?.data?.result?.result || "";
                if (!modelMmcif) return;
                const cbInfo = findAtomInModel(modelMmcif, cb);
                if (!cbInfo) return;
                const tlc = cbInfo.label_comp_id;
                if (!tlc) return;
                const dict = (molecule as any).ligandDicts?.[tlc];
                if (!dict) return;
                const graph = parseChemCompFromDict(dict, tlc);
                if (!graph) return;
                const cbIdx = graph.atoms.findIndex((a) => a.name === cb.atom);
                if (cbIdx < 0) return;
                // Try detector without family hint first; if it matches, use that.
                // Otherwise try F1 hint (covers the order-2 ambiguity case).
                let detected = await detectWarheadFamily(tlc, graph.atoms, graph.bonds, cbIdx);
                if (!detected) {
                    detected = await detectWarheadFamily(tlc, graph.atoms, graph.bonds, cbIdx, "F1");
                }
                if (cancelled || !detected) return;
                const detectedId = detected.entry.id;
                setDetectedEntryId(detectedId);
                // Auto-select unless the user already manually picked a
                // different entry SINCE the last detection ran (i.e. the
                // current linkId was set by the user, not by us).
                const manuallyOverridden = lastDetectedRef.current !== null
                    && linkId !== lastDetectedRef.current
                    && linkId !== "";
                if (!manuallyOverridden) {
                    setLinkId(detectedId);
                }
                lastDetectedRef.current = detectedId;
            } catch (e) {
                // Detection is best-effort — log and let the user pick manually.
                console.warn("[covalent] auto-detect failed:", e);
            }
        })();
        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cbCid, registry.length, molecule, commandCentre]);

    const submit = useCallback(async () => {
        if (!cbCid.trim() || !linkId) return;
        setBusy(true);
        setStatus("Working…");
        setStatusKind("info");
        try {
            // Pick the family hint from the registry entry the user selected
            // (the override dropdown). The executor's detector uses this to
            // resolve the F1-vs-F2 ambiguity at bond order 2 (vinyl thioether
            // vs alkene pre-Michael) and falls back to F2-first heuristics
            // otherwise.
            const entry = registry.find((r) => r.id === linkId);
            const preferFamily = entry?.family as "F1" | "F2" | undefined;

            const result = await executeCovalentLink({
                molecule,
                sgCid,
                cbCid: cbCid.trim(),
                linkId,
                preferFamily,
                urlPrefix,
                commandCentre,
                download: true,
            });
            if (!result.ok) {
                setStatus(result.message);
                setStatusKind("error");
                setBusy(false);
                return;
            }
            setStatus(result.message);
            setStatusKind("success");
            setBusy(false);
            // Keep the panel open so the user can click "Refine with REFMAC5…".
            // If the IPC bridge isn't available (browser build), or the model
            // didn't save, fall back to auto-dismiss after a few seconds.
            if (result.savedCifPath) {
                setSavedModelCif(result.savedCifPath);
                setSavedLinkCif(result.savedLinkCifPath ?? null);
                setSavedModelPdb(result.savedModelPdbPath ?? null);
            } else {
                setTimeout(() => setShowOverlay(false), 3500);
            }
        } catch (e: any) {
            setStatus(`Failed: ${e?.message || String(e)}`);
            setStatusKind("error");
            setBusy(false);
        }
    }, [cbCid, linkId, sgCid, registry, urlPrefix, commandCentre, molecule.molNo, molecule.name, setShowOverlay]);

    // Spawn refmac5 — works whether or not a covalent bond has been
    // declared yet. The user may want to refine the protein-ligand
    // complex first (e.g. before the covalent bond is declared, to
    // settle the ligand pose), declare the bond, and refine again to
    // pull SG-Cβ to canonical distance.
    //
    // XYZIN priority: savedModelPdb (post-declare, has LINKR + good
    // atom-id column alignment) → savedModelCif (post-declare, mmCIF
    // padding may bite refmac) → export current model directly
    // (pre-declare path).
    const runRefmac = useCallback(async () => {
        const api: any = (typeof window !== "undefined") ? (window as any).MoorhenControlApi : null;
        if (!api?.pickMtzFile || !api?.runRefmacat) {
            setStatus("REFMAC5 spawn requires PyKeko desktop build");
            setStatusKind("error");
            return;
        }
        const ctrl: any = (typeof window !== "undefined") ? (window as any).__moorhenControl : null;
        try {
            setRefmacBusy(true);
            setStatus("Pick your MTZ…");
            setStatusKind("info");
            const picked = await api.pickMtzFile();
            if (picked?.canceled) {
                setStatus("Cancelled — pick an MTZ to refine");
                setStatusKind("info");
                setRefmacBusy(false);
                return;
            }
            if (!picked?.ok || !picked?.path) {
                setStatus(`MTZ picker failed: ${picked?.error || "no path"}`);
                setStatusKind("error");
                setRefmacBusy(false);
                return;
            }
            // Resolve XYZIN. If we already have a saved augmented PDB
            // from a prior declare, use it. Otherwise export the current
            // model and save to disk so refmac has something to read.
            let xyzin = savedModelPdb || savedModelCif;
            if (!xyzin) {
                if (!ctrl?.saveTextFile) {
                    setStatus("REFMAC5 requires saving a model file; IPC bridge unavailable");
                    setStatusKind("error");
                    setRefmacBusy(false);
                    return;
                }
                setStatus("Exporting current model…");
                const pdbResp: any = await commandCentre.current!.cootCommand(
                    { returnType: "string", command: "molecule_to_PDB_string", commandArgs: [molecule.molNo] },
                    false
                );
                const pdbText: string = pdbResp?.data?.result?.result || pdbResp?.data?.result || "";
                if (!pdbText) {
                    setStatus("Model export returned empty");
                    setStatusKind("error");
                    setRefmacBusy(false);
                    return;
                }
                const safeBase = (molecule.name || "model").replace(/[^A-Za-z0-9_.-]/g, "_");
                const r = await ctrl.saveTextFile(pdbText, `${safeBase}.pdb`, null);
                if (!r?.ok || !r?.path) {
                    setStatus(`Pre-refmac model save failed: ${r?.error || "no path"}`);
                    setStatusKind("error");
                    setRefmacBusy(false);
                    return;
                }
                xyzin = r.path;
            }
            setStatus("Running REFMAC5 (this may take a minute)…");
            const res = await api.runRefmacat(xyzin, picked.path, savedLinkCif || null, 5);
            if (!res?.ok) {
                if (res?.notInstalled) {
                    setStatus("REFMAC5 not found — install CCP4 or set REFMAC5_BIN");
                } else {
                    setStatus(`REFMAC5 failed: ${res?.error || "unknown"}`);
                }
                setStatusKind("error");
                setRefmacBusy(false);
                return;
            }
            // Load the refined PDB back into Moorhen. Electron's
            // renderer can't fetch `file://` from the http://localhost
            // origin the SPA is served from, so we read the file via
            // IPC (refinedPdbText is included in the runRefmacat result
            // as of v0.2.40) and load via loadCoordsFromString.
            if (res.refinedPdbText && api.loadCoordsFromString) {
                try {
                    await api.loadCoordsFromString(
                        res.refinedPdbText,
                        `refined_${linkId || molecule.name || "model"}`
                    );
                } catch (e: any) {
                    console.warn("[covalent] refined-model reload failed:", e);
                }
            }
            setStatus(`Refined: ${res.refinedPdb}`);
            setStatusKind("success");
            setRefmacBusy(false);
        } catch (e: any) {
            setStatus(`REFMAC5 spawn error: ${e?.message || e}`);
            setStatusKind("error");
            setRefmacBusy(false);
        }
    }, [savedModelCif, savedModelPdb, savedLinkCif, linkId, molecule.molNo, molecule.name, commandCentre]);

    const statusColor = statusKind === "error" ? "#e03131" : statusKind === "success" ? "#2f9e44" : "#495057";

    // Render at a fixed viewport position (top-right) rather than at the
    // right-click coordinates. The context-menu wrapper is position:absolute
    // at the click site, which would otherwise drop the panel directly on
    // the atoms the user is trying to pick next. position:fixed escapes the
    // absolute parent's coordinate frame and pins us to the viewport corner
    // — but keeps the DOM hierarchy intact, so the popover's ClickAwayListener
    // still treats clicks inside the panel as inside the popover.
    //
    // Still draggable: the grey header bar with the grab dots acts as the drag
    // handle (cursor: move on hover), so the user can move it anywhere they
    // want without dismissing it.
    const dragNodeRef = useRef<HTMLDivElement>(null);

    return (
        <Draggable handle=".pykeko-covlink-header" nodeRef={dragNodeRef}>
        <div ref={dragNodeRef} style={{
            position: "fixed", top: 80, right: 16, zIndex: 2000,
            background: "white", border: "1px solid #ccc",
            borderRadius: 8, minWidth: 420, maxWidth: 520, boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        }}>
            <div className="pykeko-covlink-header" style={{
                cursor: "move", userSelect: "none",
                background: "#e9ecef", borderTopLeftRadius: 8, borderTopRightRadius: 8,
                padding: "8px 12px", display: "flex", alignItems: "center", gap: 10,
                fontSize: "0.95rem", color: "#212529", fontWeight: 600,
                borderBottom: "1px solid #ced4da",
            }} title="Drag to reposition">
                <span style={{ fontSize: "1rem", color: "#868e96", letterSpacing: "-2px" }}>⋮⋮</span>
                <span>Declare covalent link</span>
            </div>
            <div style={{ padding: 16 }}>
            <div style={{ marginBottom: 10 }}>
                <label style={{ display: "block", fontSize: "0.85rem", color: "#495057" }}>Cys SG {sgCidSourceLabel ? `(${sgCidSourceLabel})` : "(from right-click)"}</label>
                <code style={{ fontSize: "0.95rem", color: "#212529" }}>{sgCid}</code>
            </div>
            <div style={{ marginBottom: 10 }}>
                <label style={{ display: "block", fontSize: "0.85rem", color: "#495057" }}>Ligand atom</label>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <button
                        onClick={() => {
                            pauseClickAwayListener();
                            setPicking(true);
                            setStatus("Left-click any atom in the 3D viewer…");
                            setStatusKind("info");
                        }}
                        disabled={busy || picking}
                        style={{
                            padding: "6px 12px", fontSize: "0.9rem",
                            background: picking ? "#fff3bf" : "#e7f5ff",
                            color: "#1971c2", border: "1px solid #4dabf7", borderRadius: 6,
                            cursor: busy ? "not-allowed" : "pointer", whiteSpace: "nowrap",
                        }}
                    >
                        {picking ? "Left-click an atom…" : "Pick in viewer"}
                    </button>
                    <input
                        style={{ flex: 1, padding: "6px 8px", fontSize: "0.95rem", fontFamily: "monospace" }}
                        value={cbCid}
                        onChange={(e) => setCbCid(e.target.value)}
                        placeholder="//A/801/C19  (or type)"
                        disabled={busy || picking}
                    />
                </div>
            </div>
            <div style={{ marginBottom: 12 }}>
                <label style={{ display: "block", fontSize: "0.85rem", color: "#495057" }}>
                    Link template
                    {detectedEntryId && (
                        <span style={{ marginLeft: 6, color: "#2f9e44", fontSize: "0.75rem" }}>
                            (auto-detected: {detectedEntryId})
                        </span>
                    )}
                </label>
                <select
                    style={{ width: "100%", padding: "6px 8px", fontSize: "0.95rem" }}
                    value={linkId}
                    onChange={(e) => setLinkId(e.target.value)}
                    disabled={busy || registry.length === 0}
                >
                    {registry.length === 0 && <option value="">(loading registry…)</option>}
                    {registry.map((r) => {
                        // De-emphasise entries from the OTHER warhead family
                        // once we've auto-detected one. Still selectable, just
                        // visually demoted so the user sees the recommended
                        // entry first.
                        const detectedFamily = detectedEntryId
                            ? registry.find((e) => e.id === detectedEntryId)?.family
                            : null;
                        const dim = detectedFamily && r.family !== detectedFamily;
                        return (
                            <option key={r.id} value={r.id}
                                style={dim ? { color: "#adb5bd" } : undefined}>
                                {r.id} — {r.family} — {r.name}
                            </option>
                        );
                    })}
                </select>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                    style={{
                        padding: "8px 14px", fontSize: "0.95rem",
                        background: busy || !cbCid.trim() || !linkId ? "#adb5bd" : "#4dabf7",
                        color: "white", border: "none", borderRadius: 6,
                        cursor: busy || !cbCid.trim() || !linkId ? "not-allowed" : "pointer",
                    }}
                    onClick={submit}
                    disabled={busy || !cbCid.trim() || !linkId}
                >
                    {busy ? "Working…" : "Declare + download"}
                </button>
                <button
                    style={{
                        padding: "8px 14px", fontSize: "0.95rem",
                        background: "#e9ecef", color: "#495057", border: "none", borderRadius: 6, cursor: "pointer",
                    }}
                    onClick={() => {
                        if (picking) resumeClickAwayListener();
                        setShowOverlay(false);
                    }}
                    disabled={busy || refmacBusy}
                >{savedModelCif ? "Close" : "Cancel"}</button>
            </div>
            <div style={{
                marginTop: 10, padding: "8px 10px", background: "#f1f3f5",
                borderRadius: 6, fontSize: "0.85rem",
            }}>
                <div style={{ marginBottom: 6, color: "#495057" }}>
                    {savedModelCif
                        ? "Augmented CIF saved. Refine against your data MTZ to pull SG↔Cβ to canonical distance:"
                        : "Refine the current model against your data MTZ (use before or after declaring the bond):"}
                </div>
                <button
                    style={{
                        padding: "6px 12px", fontSize: "0.9rem",
                        background: refmacBusy ? "#adb5bd" : "#51cf66",
                        color: "white", border: "none", borderRadius: 5,
                        cursor: refmacBusy ? "not-allowed" : "pointer",
                    }}
                    onClick={runRefmac}
                    disabled={refmacBusy}
                >
                    {refmacBusy
                        ? "Running REFMAC5…"
                        : savedModelCif
                            ? "Refine with REFMAC5…"
                            : "Refine with REFMAC5 (uses link CIF if declared)…"}
                </button>
            </div>
            {status && (
                <div style={{ marginTop: 10, fontSize: "0.85rem", color: statusColor }}>{status}</div>
            )}
            </div>
        </div>
        </Draggable>
    );
};

export const MoorhenCovalentLinkButton = (props: ContextButtonProps) => {
    const commandCentre = useCommandCentre();

    const open = useCallback(async (mol: moorhen.Molecule, atom: moorhen.ResidueSpec) => {
        const atomName = (atom as any).atom_name || "SG";
        const sgCid = `//${atom.chain_id}/${atom.res_no}/${atomName.trim()}`;
        props.setOverlayContents(
            <LinkPanel
                molecule={mol}
                sgCid={sgCid}
                commandCentre={commandCentre}
                setShowOverlay={props.setShowOverlay}
                urlPrefix={props.urlPrefix}
            />
        );
        setTimeout(() => props.setShowOverlay(true), 50);
    }, [props, commandCentre]);

    return (
        <MoorhenContextButtonBase
            icon={<span style={{ fontSize: "1.3rem", color: "#fa5252", lineHeight: 1, fontWeight: 700 }}>⛓</span>}
            toolTipLabel="Declare covalent link to ligand"
            needsAtomData={true}
            nonCootCommand={open}
            {...props}
        />
    );
};
