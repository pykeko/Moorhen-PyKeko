// v0.2.42: "Ligand → Find ligand sites…" — wraps CCP4's findligand
// (Coot 0.9 desktop's ligand-fit tool) to search a map for
// ligand-shaped density blobs.
//
// History: v0.2.41 tried to wrap Coot 1.x's WASM-side
// fit_ligand_right_here. The function compiles and the clustering
// runs (Coot's verbose log shows correct cluster identification),
// but the final wligand fit returns an empty vector — wligand
// appears to be broken in the Coot 1.x WASM build. v0.2.42 replaces
// the WASM call with an IPC shim that drives CCP4's standalone
// findligand binary, which works correctly out of the box.
//
// User flow:
//   1. Load protein + Fo-Fc map (typically refmac output with
//      DELFWT/PHDELWT columns).
//   2. Load a ligand from SMILES (the SMILES dialog also drops the
//      chem_comp dict into Moorhen, which we need for fitting).
//   3. Open this dialog, pick protein + ligand + MTZ via file picker,
//      click Ok.
//   4. findligand returns N candidate fits (one per cluster). Each
//      becomes a new molecule in the model list; the user picks the
//      best fit(s) and deletes the rest.

import { useDispatch, useSelector } from "react-redux";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCommandCentre } from "../../InstanceManager";
import { moorhen } from "../../types/moorhen";
import { MoorhenButton, MoorhenMoleculeSelect, MoorhenSlider, MoorhenToggle } from "../inputs";
import { MoorhenStack } from "../interface-base";
import { enqueueSnackbar } from "@/store/";

export const FitLigandHere = () => {
    const commandCentre = useCommandCentre();
    const dispatch = useDispatch();
    const molecules = useSelector((state: moorhen.State) => state.molecules.moleculeList);

    const proteinSelectRef = useRef<HTMLSelectElement | null>(null);
    const ligandSelectRef = useRef<HTMLSelectElement | null>(null);

    const [sigma, setSigma] = useState<number>(3.0);
    const [clusters, setClusters] = useState<number>(5);
    const [samples, setSamples] = useState<number>(10);
    const [flexible, setFlexible] = useState<boolean>(true);
    const [busy, setBusy] = useState<boolean>(false);

    useEffect(() => {
        if (molecules.length > 0 && !proteinSelectRef.current?.value) {
            const sorted = [...molecules].sort((a, b) => ((b as any).atomCount || 0) - ((a as any).atomCount || 0));
            if (proteinSelectRef.current) (proteinSelectRef.current as any).value = String(sorted[0].molNo);
            if (ligandSelectRef.current) (ligandSelectRef.current as any).value = String(sorted[sorted.length - 1].molNo);
        }
    }, [molecules.length]);

    const onCompleted = useCallback(async () => {
        const proteinMolNo = parseInt(proteinSelectRef.current?.value || "");
        const ligandMolNo = parseInt(ligandSelectRef.current?.value || "");
        if (!Number.isFinite(proteinMolNo) || !Number.isFinite(ligandMolNo)) {
            dispatch(enqueueSnackbar({ message: "Pick both a protein and a ligand molecule.", variant: "warning" }));
            return;
        }
        if (proteinMolNo === ligandMolNo) {
            dispatch(enqueueSnackbar({ message: "Protein and ligand can't be the same molecule.", variant: "warning" }));
            return;
        }
        const api: any = (typeof window !== "undefined") ? (window as any).MoorhenControlApi : null;
        if (!api?.pickMtzFile || !api?.runFindLigand) {
            dispatch(enqueueSnackbar({
                message: "Ligand fitting requires PyKeko desktop (IPC bridge unavailable).",
                variant: "error",
            }));
            return;
        }

        setBusy(true);
        try {
            // 1. MTZ picker (same pattern as the refmac flow).
            const picked = await api.pickMtzFile();
            if (picked?.canceled) {
                setBusy(false);
                return;
            }
            if (!picked?.ok || !picked?.path) {
                dispatch(enqueueSnackbar({ message: `MTZ picker failed: ${picked?.error || "no path"}`, variant: "error" }));
                setBusy(false);
                return;
            }

            // 2. Export protein and ligand to PDB text.
            const protResp: any = await commandCentre.current!.cootCommand(
                { returnType: "string", command: "molecule_to_PDB_string", commandArgs: [proteinMolNo] },
                false
            );
            const proteinPdbText: string = protResp?.data?.result?.result || protResp?.data?.result || "";
            const ligResp: any = await commandCentre.current!.cootCommand(
                { returnType: "string", command: "molecule_to_PDB_string", commandArgs: [ligandMolNo] },
                false
            );
            const ligandPdbText: string = ligResp?.data?.result?.result || ligResp?.data?.result || "";

            if (!proteinPdbText || !ligandPdbText) {
                dispatch(enqueueSnackbar({ message: "Failed to export protein or ligand model.", variant: "error" }));
                setBusy(false);
                return;
            }

            // 3. Identify the ligand's comp_id (3-letter code) from its
            // PDB and pull the cached chem_comp dict from the molecule.
            const compMatch = ligandPdbText.match(/^HETATM\s+\S+\s+\S+\s+(\S+)/m) ||
                              ligandPdbText.match(/^HETATM\s.{12,17}(\S{3})/m);
            const compId = compMatch?.[1]?.trim() || "";
            const ligandMol = molecules.find(m => m.molNo === ligandMolNo);
            const ligandCifText: string = (ligandMol as any)?.ligandDicts?.[compId] || "";
            if (!ligandCifText) {
                dispatch(enqueueSnackbar({
                    message: `No chem_comp dict cached for ligand "${compId}". Load the ligand via the SMILES dialog (which generates the dict) or Import dictionary first.`,
                    variant: "error",
                    autoHideDuration: 10000,
                }));
                setBusy(false);
                return;
            }

            // 4. Spawn findligand.
            dispatch(enqueueSnackbar({
                message: `Running findligand (searching for up to ${clusters} ligand sites — typically 30s to a few minutes)…`,
                variant: "info",
                autoHideDuration: 8000,
            }));
            const res = await api.runFindLigand({
                proteinPdbText, mtzPath: picked.path,
                fCol: "DELFWT", phiCol: "PHDELWT",
                ligandPdbText, ligandCifText,
                sigma, clusters, samples, flexible,
            });
            if (!res?.ok) {
                if (res?.notInstalled) {
                    dispatch(enqueueSnackbar({
                        message: "findligand not found — install CCP4 or set FINDLIGAND_BIN.",
                        variant: "error",
                    }));
                } else {
                    dispatch(enqueueSnackbar({
                        message: `findligand failed: ${res?.error || "unknown"}`,
                        variant: "error",
                    }));
                }
                setBusy(false);
                return;
            }

            // 5. Load each fitted ligand as a new molecule.
            const fits = res.fittedLigands || [];
            for (const fit of fits) {
                try {
                    await api.loadCoordsFromString(
                        fit.pdbText,
                        `${compId}_fit_c${fit.clusterIdx}s${fit.sampleIdx}`
                    );
                } catch (e: any) {
                    console.warn("[findligand] load fit failed:", e);
                }
            }

            if (fits.length > 0) {
                dispatch(enqueueSnackbar({
                    message: `findligand placed ${fits.length} candidate fit${fits.length > 1 ? "s" : ""} into the model list. Inspect each, keep the best, delete the rest.`,
                    variant: "success",
                    autoHideDuration: 12000,
                }));
            } else {
                dispatch(enqueueSnackbar({
                    message: "findligand ran but produced no fits. Try lowering sigma or check that the map has visible positive density above threshold.",
                    variant: "info",
                    autoHideDuration: 10000,
                }));
            }
        } catch (e: any) {
            dispatch(enqueueSnackbar({ message: `Fit error: ${e?.message || e}`, variant: "error" }));
        } finally {
            setBusy(false);
        }
    }, [commandCentre, dispatch, molecules, sigma, clusters, samples, flexible]);

    return (
        <>
            <MoorhenStack inputGrid>
                <MoorhenMoleculeSelect
                    ref={proteinSelectRef}
                    molecules={molecules}
                    label="Protein molecule"
                    allowAny={false}
                />
                <MoorhenMoleculeSelect
                    ref={ligandSelectRef}
                    molecules={molecules}
                    label="Ligand molecule (with chem_comp dict)"
                    allowAny={false}
                />
            </MoorhenStack>
            <div style={{ padding: "0 0.5rem", fontSize: "0.85rem", color: "#495057", marginBottom: 6, lineHeight: 1.4 }}>
                Uses CCP4's <code>findligand</code> (Coot 0.9 desktop binary).
                Requires CCP4 installed locally and your MTZ on disk (you'll pick it after Ok).
                The ligand must have a cached chem_comp dict — typically that
                means it was loaded via the SMILES dialog or Import dictionary.
            </div>
            <MoorhenSlider
                sliderTitle="σ (search threshold; lower = more sensitive)"
                minVal={1.5}
                maxVal={8}
                showMinMaxVal={false}
                logScale={false}
                stepButtons={0.5}
                externalValue={sigma}
                setExternalValue={setSigma}
                decimalPlaces={1}
            />
            <MoorhenSlider
                sliderTitle="Max clusters (separate density blobs to try)"
                minVal={1}
                maxVal={20}
                showMinMaxVal={false}
                logScale={false}
                stepButtons={1}
                externalValue={clusters}
                setExternalValue={setClusters}
                decimalPlaces={0}
            />
            <MoorhenToggle
                label="Flexible (torsion-sampled conformers)"
                checked={flexible}
                onChange={() => setFlexible(!flexible)}
            />
            <MoorhenSlider
                sliderTitle="No. of conformer samples (per cluster)"
                minVal={1}
                maxVal={50}
                showMinMaxVal={false}
                logScale={false}
                stepButtons={5}
                externalValue={samples}
                setExternalValue={setSamples}
                decimalPlaces={0}
            />
            <MoorhenButton onClick={onCompleted} disabled={busy}>
                {busy ? "Running findligand…" : "Ok"}
            </MoorhenButton>
        </>
    );
};
