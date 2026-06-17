// v0.2.41: "Ligand → Search for ligand sites…" — wraps Coot's
// `fit_ligand` which searches the whole map for ligand-shaped blobs
// and returns multiple fit poses ranked by score.
//
// Use case: a multi-copy ligand scene (e.g. 6JX0 has three osimertinib
// copies in the same crystal). Open this dialog, pick the ligand and
// the map, click Ok — Coot identifies several high-density blobs and
// tries fitting the ligand into each one. Each successful fit becomes
// a new molecule; the user can pick the best.
//
// More expensive than "Find ligand here" (the search range is the
// whole map, not just the closest blob), but doesn't require centring
// the view first.

import { useDispatch, useSelector } from "react-redux";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCommandCentre } from "../../InstanceManager";
import { moorhen } from "../../types/moorhen";
import { MoorhenButton, MoorhenMoleculeSelect, MoorhenSlider, MoorhenToggle } from "../inputs";
import { MoorhenMapSelect } from "../inputs/Selector/MoorhenMapSelect";
import { MoorhenStack } from "../interface-base";
import { enqueueSnackbar } from "@/store/";

export const FitLigandSearch = () => {
    const commandCentre = useCommandCentre();
    const dispatch = useDispatch();
    const maps = useSelector((state: moorhen.State) => state.maps);
    const molecules = useSelector((state: moorhen.State) => state.molecules.moleculeList);

    const proteinSelectRef = useRef<HTMLSelectElement | null>(null);
    const ligandSelectRef = useRef<HTMLSelectElement | null>(null);
    const mapSelectRef = useRef<HTMLSelectElement | null>(null);

    const [nRmsd, setNRmsd] = useState<number>(4.8);
    const [useConformers, setUseConformers] = useState<boolean>(true);
    const [nConformers, setNConformers] = useState<number>(10);

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
        const mapMolNo = parseInt(mapSelectRef.current?.value || "");
        if (!Number.isFinite(proteinMolNo) || !Number.isFinite(ligandMolNo) || !Number.isFinite(mapMolNo)) {
            dispatch(enqueueSnackbar({ message: "Pick a protein, a ligand, and a map.", variant: "warning" }));
            return;
        }
        if (proteinMolNo === ligandMolNo) {
            dispatch(enqueueSnackbar({ message: "Protein and ligand can't be the same molecule.", variant: "warning" }));
            return;
        }
        try {
            dispatch(enqueueSnackbar({
                message: "Searching whole map for ligand sites (this can take a minute)…",
                variant: "info",
                autoHideDuration: 5000,
            }));
            const resp: any = await commandCentre.current!.cootCommand(
                {
                    command: "fit_ligand",
                    returnType: "vector_fit_ligand_info_t",
                    commandArgs: [
                        proteinMolNo, mapMolNo, ligandMolNo,
                        nRmsd,
                        useConformers,
                        Math.max(0, Math.min(100, Math.round(nConformers))),
                    ],
                },
                false
            );
            const fits = resp?.data?.result?.result || resp?.data?.result || [];
            const n = Array.isArray(fits) ? fits.length : 0;
            if (n > 0) {
                // Each fit_ligand_info_t carries the new molNo + score; report
                // counts and let the user inspect the new molecules in the
                // model list.
                dispatch(enqueueSnackbar({
                    message: `Found ${n} ligand site${n > 1 ? "s" : ""}. New molecules appear in the model list — inspect each, keep the best fit(s), delete the rest.`,
                    variant: "success",
                    autoHideDuration: 10000,
                }));
            } else {
                dispatch(enqueueSnackbar({
                    message: "No sites found. Try lowering n_rmsd (e.g. 3.5) or check that the map has visible positive density above threshold.",
                    variant: "info",
                    autoHideDuration: 8000,
                }));
            }
        } catch (e: any) {
            dispatch(enqueueSnackbar({
                message: `Search failed: ${e?.message || e}`,
                variant: "error",
            }));
        }
    }, [commandCentre, dispatch, nRmsd, useConformers, nConformers]);

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
                Coot scans the whole map for density blobs that fit the ligand. Useful for multi-copy scenes (e.g. 3 copies of a drug in one crystal).
            </div>
            <MoorhenSlider
                sliderTitle="n RMSD (signal threshold)"
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
