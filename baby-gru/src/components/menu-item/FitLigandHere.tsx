// v0.2.41: "Ligand → Find ligand here…" — wraps Coot's
// `fit_ligand_right_here` which takes a ligand molecule + map + view
// centre and fits the ligand into the nearest density blob.
//
// Use case: after loading a ligand from SMILES (or as a separate
// molecule), navigate to the empty pocket (Fo-Fc positive blob), open
// this dialog, pick the ligand molecule, click Ok. Coot tries several
// orientations of the ligand against the blob nearest the current
// view centre and slots in the best fit. Quicker than jiggle-fit + RSR
// for "fit this ligand into THIS density".

import { useDispatch, useSelector } from "react-redux";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCommandCentre } from "../../InstanceManager";
import { moorhen } from "../../types/moorhen";
import { MoorhenButton, MoorhenMoleculeSelect, MoorhenSlider, MoorhenToggle } from "../inputs";
import { MoorhenMapSelect } from "../inputs/Selector/MoorhenMapSelect";
import { MoorhenStack } from "../interface-base";
import { enqueueSnackbar } from "@/store/";

export const FitLigandHere = () => {
    const commandCentre = useCommandCentre();
    const dispatch = useDispatch();
    const maps = useSelector((state: moorhen.State) => state.maps);
    const molecules = useSelector((state: moorhen.State) => state.molecules.moleculeList);
    const originState = useSelector((state: moorhen.State) => state.glRef.origin);

    const proteinSelectRef = useRef<HTMLSelectElement | null>(null);
    const ligandSelectRef = useRef<HTMLSelectElement | null>(null);
    const mapSelectRef = useRef<HTMLSelectElement | null>(null);

    const [nRmsd, setNRmsd] = useState<number>(4.8);
    const [useConformers, setUseConformers] = useState<boolean>(true);
    const [nConformers, setNConformers] = useState<number>(10);

    // Default selections to the first / smallest sensible candidates.
    useEffect(() => {
        if (molecules.length > 0 && !proteinSelectRef.current?.value) {
            // Heuristic: largest molecule by atom count = protein. (Coot
            // wants a protein imol just for the model context; the fit
            // operates on the ligand against the map.)
            const sorted = [...molecules].sort((a, b) => ((b as any).atomCount || 0) - ((a as any).atomCount || 0));
            if (proteinSelectRef.current) (proteinSelectRef.current as any).value = String(sorted[0].molNo);
            // Ligand default: smallest molecule (typically the freshly
            // loaded SMILES ligand).
            if (ligandSelectRef.current) (ligandSelectRef.current as any).value = String(sorted[sorted.length - 1].molNo);
        }
    }, [molecules.length]);

    const onCompleted = useCallback(async () => {
        const proteinMolNo = parseInt(proteinSelectRef.current?.value || "");
        const ligandMolNo = parseInt(ligandSelectRef.current?.value || "");
        const mapMolNo = parseInt(mapSelectRef.current?.value || "");
        if (!Number.isFinite(proteinMolNo) || !Number.isFinite(ligandMolNo) || !Number.isFinite(mapMolNo)) {
            dispatch(enqueueSnackbar({ message: "Pick a protein, a ligand, and a map.", variant: "warning" }));
            return;
        }
        if (proteinMolNo === ligandMolNo) {
            dispatch(enqueueSnackbar({ message: "Protein and ligand can't be the same molecule.", variant: "warning" }));
            return;
        }
        // glRef.origin is the NEGATED view centre (Moorhen convention; see
        // feedback_centre_on_gemmi_atoms_trap). Flip to world space.
        const x = -originState[0];
        const y = -originState[1];
        const z = -originState[2];

        try {
            const resp: any = await commandCentre.current!.cootCommand(
                {
                    command: "fit_ligand_right_here",
                    returnType: "vector_int",
                    commandArgs: [
                        proteinMolNo, mapMolNo, ligandMolNo,
                        x, y, z,
                        nRmsd,
                        useConformers,
                        Math.max(0, Math.min(100, Math.round(nConformers))),
                    ],
                },
                false
            );
            const newMolIndices = resp?.data?.result?.result || resp?.data?.result || [];
            const n = Array.isArray(newMolIndices) ? newMolIndices.length : 0;
            if (n > 0) {
                dispatch(enqueueSnackbar({
                    message: `Fitted ligand into density (${n} new molecule${n > 1 ? "s" : ""} created). ` +
                        `Original ligand at molNo ${ligandMolNo} unchanged.`,
                    variant: "success",
                    autoHideDuration: 8000,
                }));
            } else {
                dispatch(enqueueSnackbar({
                    message: "No fits returned. Try increasing No. of conformers, lowering n_rmsd, or centring the view more precisely on the blob.",
                    variant: "info",
                    autoHideDuration: 8000,
                }));
            }
        } catch (e: any) {
            dispatch(enqueueSnackbar({
                message: `Fit failed: ${e?.message || e}`,
                variant: "error",
            }));
        }
    }, [commandCentre, dispatch, originState, nRmsd, useConformers, nConformers]);

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
                    label="Ligand molecule"
                    allowAny={false}
                />
                <MoorhenMapSelect ref={mapSelectRef} maps={maps} />
            </MoorhenStack>
            <div style={{ padding: "0 0.5rem", fontSize: "0.85rem", color: "#495057", marginBottom: 6 }}>
                Coot fits the ligand into the density blob nearest the current view centre.
                Centre on the Fo-Fc peak you want filled before clicking Ok.
            </div>
            <MoorhenSlider
                sliderTitle="n RMSD"
                minVal={2}
                maxVal={10}
                showMinMaxVal={false}
                logScale={false}
                stepButtons={0.2}
                externalValue={nRmsd}
                setExternalValue={setNRmsd}
                decimalPlaces={1}
            />
            <MoorhenToggle
                label="Use conformers (search multiple ligand torsion sets)"
                checked={useConformers}
                onChange={() => setUseConformers(!useConformers)}
            />
            <MoorhenSlider
                sliderTitle="No. of conformers"
                minVal={0}
                maxVal={50}
                showMinMaxVal={false}
                logScale={false}
                stepButtons={5}
                externalValue={nConformers}
                setExternalValue={setNConformers}
                decimalPlaces={0}
            />
            <MoorhenButton onClick={onCompleted}>Ok</MoorhenButton>
        </>
    );
};
