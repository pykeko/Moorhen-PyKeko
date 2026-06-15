// v0.2.39: top-menu entry "Ligand → Make covalent…" that opens the
// covalent-link declaration panel WITHOUT requiring a right-click on a
// Cys SG. After the user picks any ligand atom in the viewer:
//   1. resolve the ligand residue from the click
//   2. find the closest Cys SG to that residue via
//      findNearestCysSgToLigand (MoorhenCovalentLinkSurgery.ts)
//   3. fetch the ligand's chem_comp dict and run suggestCbAtom
//      (MoorhenCovalentLinkDetector.ts) to identify the likely warhead
//      family + Cβ atom
//   4. open the LinkPanel with both CIDs pre-filled — the panel's
//      existing detector auto-select effect picks the matching link
//      template for free, so the user just clicks Declare.
//
// Either pre-fill can be wrong; the user can override both before declaring.

import { useCallback, useEffect, useRef, useState } from "react";
import Draggable from "react-draggable";
import { useDispatch, useSelector } from "react-redux";
import { useCommandCentre } from "../../InstanceManager";
import { usePauseClickAwayListener } from "../../hooks/pauseClickAwayListener";
import { moorhen } from "../../types/moorhen";
import { cidToSpec } from "../../utils/utils";
import { findNearestCysSgToLigand } from "../../utils/MoorhenCovalentLinkSurgery";
import { suggestCbAtom } from "../../utils/MoorhenCovalentLinkDetector";
import { parseChemCompFromDict } from "../../utils/MoorhenCovalentLinkDictParser";
import { LinkPanel } from "../context-menu/MoorhenCovalentLinkButton";
import { enqueueSnackbar } from "@/store/";

export const MakeCovalentMenuItem = () => {
    const dispatch = useDispatch();
    const commandCentre = useCommandCentre();
    const molecules = useSelector((state: moorhen.State) => state.molecules.moleculeList);
    const [picking, setPicking] = useState(true);
    const [resolved, setResolved] = useState<{
        molecule: moorhen.Molecule;
        sgCid: string;
        cbCid: string;
        sgSourceLabel: string;
    } | null>(null);
    const [status, setStatus] = useState<string>("Left-click any atom on the ligand you want bonded to Cys SG.");
    const [showOverlay, setShowOverlay] = useState<boolean>(true);
    const [pauseClickAwayListener, resumeClickAwayListener] = usePauseClickAwayListener();
    const dragNodeRef = useRef<HTMLDivElement>(null);

    // Arm a one-shot atomClicked listener while in "picking" mode.
    // Pause the click-away listener (same pattern as the right-click panel
    // and MoorhenCidInputForm) so the synthetic click after canvas
    // mousedown doesn't dismiss us.
    useEffect(() => {
        if (!picking) return;
        pauseClickAwayListener();
        const onAtomClicked = async (evt: any) => {
            try {
                const pickedCid: string | undefined = evt?.detail?.label;
                if (!pickedCid) return;
                const spec = cidToSpec(pickedCid);
                if (!spec?.chain_id || spec.res_no === undefined || !spec.atom_name) {
                    setStatus(`Could not parse picked CID: ${pickedCid}`);
                    return;
                }
                const cbShort = `//${spec.chain_id}/${spec.res_no}/${String(spec.atom_name).trim()}`;
                // Find the molecule the picked atom belongs to. cidToSpec
                // strips the model index; we have to find the molecule by
                // walking its chains. Simplest heuristic: the picked
                // molecule from the atomClicked event has the molNo on it.
                const molNoFromEvt = evt?.detail?.molecule?.molNo as number | undefined;
                const molecule = molNoFromEvt != null
                    ? molecules.find(m => m.molNo === molNoFromEvt)
                    // Fallback: first molecule (single-molecule case).
                    : molecules.find(m => !(m as any).isMap);
                if (!molecule) {
                    setStatus("Could not resolve molecule for picked atom.");
                    return;
                }
                setStatus("Resolving nearest Cys SG and suggesting Cβ…");

                // Export the current model so we can walk it.
                const resp: any = await commandCentre.current!.cootCommand(
                    { returnType: "string", command: "molecule_to_mmCIF_string_with_gemmi", commandArgs: [molecule.molNo] },
                    false
                );
                const mmcif: string = resp?.data?.result?.result || resp?.data?.result || "";

                // Find the residue 3-letter code from the picked CID. We
                // already have chain + resNo; the comp can be looked up
                // from any atom_site row in the model.
                const compRe = new RegExp(`(?:ATOM|HETATM)\\s+\\S+\\s+\\S+\\s+(?:'([^']+)'|(\\S+))\\s+\\S+\\s+(\\S+)[\\s\\S]*?\\b${spec.res_no}\\b\\s+${spec.chain_id}\\b`);
                const compMatch = compRe.exec(mmcif);
                const ligComp = compMatch?.[3] || "";

                // Look up the closest Cys SG to the picked ligand.
                let sgCid = "";
                let sgSourceLabel = "(none within 8 Å)";
                if (ligComp) {
                    const nearestSg = findNearestCysSgToLigand(
                        mmcif, { chain: spec.chain_id, resNo: spec.res_no as number, comp: ligComp }
                    );
                    if (nearestSg) {
                        sgCid = nearestSg.cid;
                        sgSourceLabel = `closest to ligand, ${nearestSg.distance.toFixed(2)} Å`;
                    }
                }

                // Auto-suggest the Cβ by walking the ligand dict — overrides
                // the user's pick if the detector finds a better candidate.
                let finalCbCid = cbShort;
                const dict = ligComp ? (molecule as any).ligandDicts?.[ligComp] : null;
                if (dict) {
                    try {
                        const graph = parseChemCompFromDict(dict, ligComp);
                        if (graph) {
                            const suggested = await suggestCbAtom(ligComp, graph.atoms, graph.bonds);
                            if (suggested?.atomMap?.cb) {
                                finalCbCid = `//${spec.chain_id}/${spec.res_no}/${suggested.atomMap.cb}`;
                            }
                        }
                    } catch (e) {
                        console.warn("[make-covalent] Cβ suggestion failed:", e);
                    }
                }

                if (!sgCid) {
                    setStatus("No Cys SG within 8 Å of the picked ligand. Right-click a Cys SG to start from there instead.");
                    return;
                }

                document.removeEventListener("atomClicked", onAtomClicked);
                resumeClickAwayListener();
                setResolved({
                    molecule, sgCid, cbCid: finalCbCid, sgSourceLabel,
                });
                setPicking(false);
            } catch (e: any) {
                setStatus(`Pick failed: ${e?.message || e}`);
            }
        };
        document.addEventListener("atomClicked", onAtomClicked);
        return () => {
            document.removeEventListener("atomClicked", onAtomClicked);
            resumeClickAwayListener();
        };
    }, [picking, commandCentre, molecules, pauseClickAwayListener, resumeClickAwayListener]);

    // After resolution, show the LinkPanel with everything pre-filled.
    if (resolved && !picking) {
        return (
            <LinkPanel
                molecule={resolved.molecule}
                sgCid={resolved.sgCid}
                initialCbCid={resolved.cbCid}
                sgCidSourceLabel={resolved.sgSourceLabel}
                commandCentre={commandCentre}
                setShowOverlay={setShowOverlay}
                urlPrefix="MoorhenAssets"
            />
        );
    }

    // Picking state — small floating prompt.
    return (
        <Draggable handle=".pykeko-makecov-header" nodeRef={dragNodeRef}>
            <div ref={dragNodeRef} style={{
                position: "fixed", top: 80, right: 16, zIndex: 2000,
                background: "white", border: "1px solid #ccc",
                borderRadius: 8, minWidth: 340, maxWidth: 420,
                boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            }}>
                <div className="pykeko-makecov-header" style={{
                    cursor: "move", userSelect: "none",
                    background: "#e9ecef", borderTopLeftRadius: 8, borderTopRightRadius: 8,
                    padding: "8px 12px", display: "flex", alignItems: "center", gap: 10,
                    fontSize: "0.95rem", color: "#212529", fontWeight: 600,
                    borderBottom: "1px solid #ced4da",
                }} title="Drag to reposition">
                    <span style={{ fontSize: "1rem", color: "#868e96", letterSpacing: "-2px" }}>⋮⋮</span>
                    <span>Make covalent</span>
                </div>
                <div style={{ padding: 12, fontSize: "0.9rem", color: "#495057", lineHeight: 1.4 }}>
                    {status}
                </div>
            </div>
        </Draggable>
    );
};
