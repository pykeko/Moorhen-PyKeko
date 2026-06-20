// v0.2.47: "Ligand → Refine with DIMPLE…" — wraps CCP4's `dimple`,
// the auto-pipeline that runs molecular-replacement-or-rigid-body +
// restrained refinement + optional ligand fitting end-to-end.
//
// Workflow: user has a partially-built or apo model loaded, plus a
// co-crystal MTZ on disk. Optionally they've also loaded a ligand
// (via the SMILES dialog, which caches the chem_comp dict). They
// click this dialog → pick MTZ → dimple runs in the background
// (minutes) → final.pdb + final.mtz land in an output dir → load
// the refined model back into PyKeko.
//
// Difference vs the in-app REFMAC5 spawn on the covalent panel:
// dimple does FAR more than refmac. It picks the right number of
// rigid-body cycles, switches to MR if R-factor is high, runs
// findligand if a ligand CIF was supplied, places waters, then
// refines. End result is "I have a co-crystal MTZ → I have a
// refined complex" in one click, exactly the early-stage drug-
// discovery workflow.

import { useDispatch, useSelector } from "react-redux";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCommandCentre } from "../../InstanceManager";
import { moorhen } from "../../types/moorhen";
import { MoorhenButton, MoorhenMoleculeSelect, MoorhenSlider } from "../inputs";
import { MoorhenStack } from "../interface-base";
import { enqueueSnackbar } from "@/store/";

export const RefineDimple = () => {
    const commandCentre = useCommandCentre();
    const dispatch = useDispatch();
    const molecules = useSelector((state: moorhen.State) => state.molecules.moleculeList);

    const proteinSelectRef = useRef<HTMLSelectElement | null>(null);
    const ligandSelectRef = useRef<HTMLSelectElement | null>(null);

    const [restrCycles, setRestrCycles] = useState<number>(8);
    const [mrThreshold, setMrThreshold] = useState<number>(0.4);
    const [useLigand, setUseLigand] = useState<boolean>(false);
    const [busy, setBusy] = useState<boolean>(false);

    useEffect(() => {
        if (molecules.length > 0 && !proteinSelectRef.current?.value) {
            // Same zombie-filter as FitLigandHere — `deleteCid('/*/*/*/*', m)`
            // empties atoms but doesn't drop the molecule from the slice.
            const real = molecules.filter(m => ((m as any).atomCount || 0) > 0);
            if (real.length === 0) return;
            const sorted = [...real].sort((a, b) => ((b as any).atomCount || 0) - ((a as any).atomCount || 0));
            if (proteinSelectRef.current) (proteinSelectRef.current as any).value = String(sorted[0].molNo);
            if (ligandSelectRef.current && sorted.length > 1) {
                (ligandSelectRef.current as any).value = String(sorted[sorted.length - 1].molNo);
            }
        }
    }, [molecules.length]);

    const onCompleted = useCallback(async () => {
        const proteinMolNo = parseInt(proteinSelectRef.current?.value || "");
        if (!Number.isFinite(proteinMolNo)) {
            dispatch(enqueueSnackbar({ message: "Pick a protein molecule.", variant: "warning" }));
            return;
        }
        const api: any = (typeof window !== "undefined") ? (window as any).MoorhenControlApi : null;
        if (!api?.pickMtzFile || !api?.runDimple || !api?.saveTextFile) {
            dispatch(enqueueSnackbar({
                message: "DIMPLE refinement requires PyKeko desktop (IPC bridge unavailable).",
                variant: "error",
            }));
            return;
        }

        setBusy(true);
        try {
            // 1. MTZ picker.
            const picked = await api.pickMtzFile();
            if (picked?.canceled) { setBusy(false); return; }
            if (!picked?.ok || !picked?.path) {
                dispatch(enqueueSnackbar({ message: `MTZ picker failed: ${picked?.error || "no path"}`, variant: "error" }));
                setBusy(false);
                return;
            }

            // 2. Export protein to PDB text, write to disk so dimple can read it.
            const protResp: any = await commandCentre.current!.cootCommand(
                { returnType: "string", command: "molecule_to_PDB_string", commandArgs: [proteinMolNo] },
                false
            );
            const proteinPdbText: string = protResp?.data?.result?.result || protResp?.data?.result || "";
            if (!proteinPdbText) {
                dispatch(enqueueSnackbar({ message: "Failed to export protein model.", variant: "error" }));
                setBusy(false);
                return;
            }
            const proteinMol = molecules.find(m => m.molNo === proteinMolNo);
            const proteinName = ((proteinMol as any)?.name || `model_${proteinMolNo}`).replace(/[^A-Za-z0-9_.-]/g, "_");
            const modelSave = await api.saveTextFile(proteinPdbText, `${proteinName}_for_dimple.pdb`, null);
            if (!modelSave?.ok || !modelSave?.path) {
                dispatch(enqueueSnackbar({ message: `Could not save model to disk: ${modelSave?.error || "no path"}`, variant: "error" }));
                setBusy(false);
                return;
            }

            // 3. Optionally export the ligand's chem_comp dict to disk too.
            let ligandCifPath: string | null = null;
            if (useLigand) {
                const ligandMolNo = parseInt(ligandSelectRef.current?.value || "");
                if (!Number.isFinite(ligandMolNo) || ligandMolNo === proteinMolNo) {
                    dispatch(enqueueSnackbar({ message: "Pick a separate ligand molecule.", variant: "warning" }));
                    setBusy(false);
                    return;
                }
                const ligResp: any = await commandCentre.current!.cootCommand(
                    { returnType: "string", command: "molecule_to_PDB_string", commandArgs: [ligandMolNo] },
                    false
                );
                const ligandPdbText: string = ligResp?.data?.result?.result || ligResp?.data?.result || "";
                const compMatch = ligandPdbText.match(/^(?:HETATM|ATOM)\s+\S+\s+\S+\s+(\S+)/m) ||
                                  ligandPdbText.match(/^(?:HETATM|ATOM)\s.{12,17}(\S{3})/m);
                const compId = compMatch?.[1]?.trim() || "";
                const ligandMol = molecules.find(m => m.molNo === ligandMolNo);
                const ligandCifText: string = (ligandMol as any)?.ligandDicts?.[compId] || "";
                if (!compId || !ligandCifText) {
                    dispatch(enqueueSnackbar({
                        message: `No chem_comp dict cached for the ligand. Load it via the SMILES dialog first.`,
                        variant: "error",
                        autoHideDuration: 9000,
                    }));
                    setBusy(false);
                    return;
                }
                const cifSave = await api.saveTextFile(ligandCifText, `${compId}_for_dimple.cif`, null);
                if (!cifSave?.ok || !cifSave?.path) {
                    dispatch(enqueueSnackbar({ message: `Could not save ligand CIF: ${cifSave?.error || "no path"}`, variant: "error" }));
                    setBusy(false);
                    return;
                }
                ligandCifPath = cifSave.path;
            }

            // 4. Spawn dimple.
            dispatch(enqueueSnackbar({
                message: `Running dimple (${restrCycles} restr-cycles${useLigand ? " + ligand fit" : ""}; typically 2–10 min). Progress in the log console.`,
                variant: "info",
                autoHideDuration: 10000,
            }));
            const res = await api.runDimple({
                modelPath: modelSave.path,
                mtzPath: picked.path,
                ligandCifPath,
                restrCycles,
                mrThreshold,
            });
            if (!res?.ok) {
                if (res?.notInstalled) {
                    dispatch(enqueueSnackbar({
                        message: "dimple not found — install CCP4 or set DIMPLE_BIN.",
                        variant: "error",
                    }));
                } else {
                    dispatch(enqueueSnackbar({
                        message: `dimple failed: ${res?.error || "unknown"} (log: ${res?.logPath || "—"})`,
                        variant: "error",
                        autoHideDuration: 12000,
                    }));
                }
                setBusy(false);
                return;
            }

            // 5. Load the refined model back.
            if (res.finalPdbText) {
                await api.loadCoordsFromString(res.finalPdbText, `${proteinName}_dimple_refined`);
                dispatch(enqueueSnackbar({
                    message: `dimple done. Refined model loaded; output dir ${res.outDir}. Refined MTZ also at ${res.finalMtz ?? "(missing)"}.`,
                    variant: "success",
                    autoHideDuration: 12000,
                }));
            } else {
                dispatch(enqueueSnackbar({
                    message: `dimple finished but final.pdb couldn't be read (${res.outDir}). Check ${res.logPath}.`,
                    variant: "warning",
                    autoHideDuration: 10000,
                }));
            }
        } catch (e: any) {
            dispatch(enqueueSnackbar({ message: `DIMPLE error: ${e?.message || e}`, variant: "error" }));
        } finally {
            setBusy(false);
        }
    }, [commandCentre, dispatch, molecules, restrCycles, mrThreshold, useLigand]);

    return (
        <>
            <MoorhenStack inputGrid>
                <MoorhenMoleculeSelect
                    ref={proteinSelectRef}
                    molecules={molecules}
                    label="Protein / apo model"
                    allowAny={false}
                />
                {useLigand && (
                    <MoorhenMoleculeSelect
                        ref={ligandSelectRef}
                        molecules={molecules}
                        label="Ligand (with chem_comp dict)"
                        allowAny={false}
                    />
                )}
            </MoorhenStack>
            <div style={{ padding: "0 0.5rem", fontSize: "0.85rem", color: "#495057", marginBottom: 6, lineHeight: 1.4 }}>
                Drives CCP4's <code>dimple</code> auto-pipeline: rigid-body / MR (if R is high)
                + restrained refinement, optionally placing a ligand into the strongest
                Fo-Fc blob. You'll be asked for the MTZ after Ok; the refined model loads
                back into PyKeko when it's done. Typical runtime: a few minutes.
            </div>
            <div style={{ padding: "0 0.5rem", marginBottom: 8 }}>
                <label style={{ fontSize: "0.9rem", display: "flex", alignItems: "center", gap: 6 }}>
                    <input type="checkbox" checked={useLigand} onChange={(e) => setUseLigand(e.target.checked)} />
                    Also fit a ligand from its cached chem_comp dict
                </label>
            </div>
            <MoorhenSlider
                sliderTitle="Restrained-refinement cycles"
                minVal={1}
                maxVal={20}
                showMinMaxVal={false}
                logScale={false}
                stepButtons={1}
                externalValue={restrCycles}
                setExternalValue={setRestrCycles}
                decimalPlaces={0}
            />
            <MoorhenSlider
                sliderTitle="R-factor threshold for MR (above → run molecular replacement)"
                minVal={0.2}
                maxVal={0.6}
                showMinMaxVal={false}
                logScale={false}
                stepButtons={0.05}
                externalValue={mrThreshold}
                setExternalValue={setMrThreshold}
                decimalPlaces={2}
            />
            <MoorhenButton onClick={onCompleted} disabled={busy}>
                {busy ? "Running dimple…" : "Ok"}
            </MoorhenButton>
        </>
    );
};
