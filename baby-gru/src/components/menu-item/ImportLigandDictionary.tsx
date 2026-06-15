import { TextField } from "@mui/material";
import Draggable from "react-draggable";
import { useDispatch, useSelector, useStore } from "react-redux";
import { useCallback, useEffect, useRef, useState } from "react";
import { RootState, enqueueSnackbar } from "@/store/";
import { parseCifDict } from "@/utils/MoorhenFileLoading";
import { useCommandCentre, usePaths } from "../../InstanceManager";
import { triggerUpdate } from "../../store/moleculeMapUpdateSlice";
import { addMolecule } from "../../store/moleculesSlice";
import { setOrigin } from "../../store/glRefSlice";
import { removeMolecule } from "../../store/moleculesSlice";
import { libcootApi } from "../../types/libcoot";
import { moorhen } from "../../types/moorhen";
import { MoorhenMolecule } from "../../utils/MoorhenMolecule";
import { centreOnGemmiAtoms } from "../../utils/utils";
import { MoorhenButton, MoorhenFileInput, MoorhenSelect, MoorhenTextInput, MoorhenToggle } from "../inputs";
import { MoorhenMoleculeSelect } from "../inputs";
import { MoorhenInfoCard, MoorhenStack } from "../interface-base";

const ImportLigandDictionary = (props: {
    id: string;
    menuItemText: string;
    createInstance: boolean;
    setCreateInstance: React.Dispatch<React.SetStateAction<boolean>>;
    panelContent: React.JSX.Element;
    fetchLigandDict: () => Promise<string>;
    addToMoleculeValueRef: React.MutableRefObject<number>;
    addToMolecule: string;
    setAddToMolecule: React.Dispatch<React.SetStateAction<string>>;
    tlc: string;
    createRef: React.MutableRefObject<boolean>;
    moleculeSelectRef: React.RefObject<HTMLSelectElement>;
    addToRef: React.RefObject<HTMLSelectElement>;
    moleculeSelectValueRef: React.MutableRefObject<string>;
    // PyKeko: optional placement/fit refs. When set, after creating the ligand
    // molecule we (a) optionally re-position it at the highest positive Fo-Fc
    // peak in the active difference map, and (b) optionally run jiggle-fit +
    // real-space refine against the active map to settle it into the density.
    // Both refs are read at action time so the underlying state can change
    // mid-modal without stale-closure issues.
    placeAtRef?: React.MutableRefObject<"molecule_centre" | "rotation_centre" | "peak">;
    fitToDensityRef?: React.MutableRefObject<boolean>;
}) => {
    const dispatch = useDispatch();
    const defaultBondSmoothness = useSelector((state: moorhen.State) => state.sceneSettings.defaultBondSmoothness);
    const backgroundColor = useSelector((state: moorhen.State) => state.sceneSettings.backgroundColor);
    const molecules = useSelector((state: moorhen.State) => state.molecules.moleculeList);
    const store = useStore<RootState>();
    const commandCentre = useCommandCentre();
    const monomerLibraryPath = usePaths().monomerLibraryPath;
    const {
        createInstance,
        setCreateInstance,
        addToMolecule,
        fetchLigandDict,
        panelContent,
        setAddToMolecule,
        tlc,
        createRef,
        moleculeSelectRef,
        addToRef,
        moleculeSelectValueRef,
        addToMoleculeValueRef,
        menuItemText,
        id,
        placeAtRef,
        fitToDensityRef,
    } = props;

    const originState = useSelector((state: moorhen.State) => state.glRef.origin);

    const handleFileContent = useCallback(
        async (fileContent: string) => {
            let newMolecule: moorhen.Molecule;
            let selectedMoleculeIndex: number;
            const molNosToUpdate: number[] = [];

            if (moleculeSelectValueRef.current) {
                selectedMoleculeIndex = parseInt(moleculeSelectValueRef.current);
                const selectedMolecule = molecules.find(molecule => molecule.molNo === selectedMoleculeIndex);
                if (typeof selectedMolecule !== "undefined") {
                    await selectedMolecule.addDict(fileContent);
                    await selectedMolecule.redraw();
                    molNosToUpdate.push(selectedMolecule.molNo);
                }
            } else {
                selectedMoleculeIndex = -999999;
                await commandCentre.current.cootCommand(
                    {
                        returnType: "status",
                        command: "read_dictionary_string",
                        commandArgs: [fileContent, selectedMoleculeIndex],
                        changesMolecules: [],
                    },
                    false
                );
                await Promise.all(
                    molecules.map(molecule => {
                        molecule.cacheLigandDict(fileContent);
                        molNosToUpdate.push(molecule.molNo);
                        return molecule.redraw();
                    })
                );
            }

            if (createRef.current) {
                const instanceName = tlc;
                // PyKeko: resolve placement BEFORE asking Coot to instantiate
                // the monomer. `placementWorld` is in world-space coordinates;
                // `get_monomer_and_position_at` takes world-space directly
                // (the upstream call site `commandArgs: [..., ...originState.map(c => -c)]`
                // works because that flips the already-negated `originState`
                // BACK to world — net effect: pass world coords).
                //
                // v0.2.15: default placement is now the **centre of the
                // active protein molecule** rather than the camera's rotation
                // centre — `originState` ≠ the structure's centre when the
                // user hasn't done an explicit "centre on" (e.g. on `pykeko
                // 7sj3` startup the rotation centre stays near the unit-cell
                // origin even though the camera auto-fits to the protein).
                // Result in v0.2.14: ligand correctly landed at the rotation
                // centre, which was often dozens of Å from the protein.
                // Reported as "partially overlaps with positive density but
                // nowhere near the protein molecules".
                //
                // v0.2.12 bug fixed in v0.2.14: had `placement` in world
                // space and then ALSO negated it in commandArgs below, so
                // Coot received `-world` and placed the ligand at the mirror
                // across (0,0,0).
                let placementWorld: [number, number, number] = await computePlacement();
                let pickedPeak: { x: number; y: number; z: number; sigma: number } | null = null;
                if (placeAtRef?.current === "peak") {
                    pickedPeak = await pickFoFcPeak();
                    if (pickedPeak) {
                        // difference_map_peaks already returns world-space
                        // coords (same frame as moveMoleculeHere / setOrigin's
                        // negated input).
                        placementWorld = [pickedPeak.x, pickedPeak.y, pickedPeak.z];
                    } else {
                        dispatch(enqueueSnackbar({ message: "No Fo-Fc peak found (need a difference map loaded with positive density above the threshold); falling back to the active molecule's centre.", variant: "warning" }));
                    }
                }
                // v0.2.29-v0.2.38 had a covalent-placement seed here (when
                // the user enabled "Form covalent bond to Cys SG" inside the
                // SMILES dialog, this block pre-offset placement so Cβ
                // landed on the Cys-CB→SG axis). v0.2.39 decoupled Step 1
                // (place ligand) from Step 2 (declare covalent) — Step 1
                // is now pure placement, so this block is gone. The
                // `seedCovalentPlacement` helper in MoorhenCovalentPlacement.ts
                // stays in tree; a future Step 2 enhancement could call it
                // to snap a ligand into a sensible covalent pose at declare
                // time, but that's not on the v0.2.39 path.
                const result = (await commandCentre.current.cootCommand(
                    {
                        returnType: "status",
                        command: "get_monomer_and_position_at",
                        // World-space coords — no negation here. (`originState`
                        // is the negated rotation centre; the upstream code
                        // applies `.map(c => -c)` to flip it to world before
                        // calling — equivalent to what we pass here.)
                        commandArgs: [instanceName, selectedMoleculeIndex, placementWorld[0], placementWorld[1], placementWorld[2]],
                    },
                    true
                )) as moorhen.WorkerResponse<number>;
                if (result.data.result.status === "Completed") {
                    newMolecule = new MoorhenMolecule(commandCentre, store, monomerLibraryPath);
                    newMolecule.molNo = result.data.result.result;
                    newMolecule.name = instanceName;
                    newMolecule.setBackgroundColour(backgroundColor);
                    newMolecule.defaultBondOptions.smoothness = defaultBondSmoothness;
                    newMolecule.coordsFormat = "mmcif";
                    await Promise.all([newMolecule.fetchDefaultColourRules(), newMolecule.addDict(fileContent)]);
                    await newMolecule.fetchIfDirtyAndDraw("CBs");
                    dispatch(addMolecule(newMolecule));
                    // PyKeko: re-centre the view on what just landed so the
                    // user can see it without hunting. Snapping to the
                    // placement target (rather than the resulting ligand atoms,
                    // which are around the placement target anyway) is fine.
                    dispatch(setOrigin([-placementWorld[0], -placementWorld[1], -placementWorld[2]]));
                    // PyKeko: if requested, settle the ligand into density.
                    // Two-step: jiggle-fit with blur (~500 trials, B=200) lands
                    // it in the local minimum, then RSR (mode ALL) on the
                    // single residue tightens geometry against the map. Skipped
                    // gracefully if no active map exists.
                    if (fitToDensityRef?.current) {
                        await fitLigandIntoDensity(newMolecule);
                    }
                    if (addToMoleculeValueRef.current !== -1) {
                        const toMolecule = molecules.find(molecule => molecule.molNo === addToMoleculeValueRef.current);
                        if (typeof toMolecule !== "undefined") {
                            molNosToUpdate.push(toMolecule.molNo);
                            const otherMolecules = [newMolecule];
                            await toMolecule.mergeMolecules(otherMolecules, true);
                            await toMolecule.redraw();
                            // PyKeko v0.2.15: the user picked "...add to <X>",
                            // not "...add to X AND keep a standalone". Upstream
                            // mergeMolecules(otherMolecules, doHide=true) only
                            // hides the standalone; it stays in moleculeList
                            // visible:false, looks like a duplicate on the
                            // Models panel and re-shows on the next redraw.
                            // Actually delete it so the merge is the *only*
                            // copy of the ligand the user has.
                            try {
                                await (newMolecule as any).delete?.();
                            } catch { /* best effort — delete failed = standalone stays hidden but present */ }
                            dispatch(removeMolecule(newMolecule));
                        } else {
                            await newMolecule.redraw();
                        }
                    }
                }
            }

            [...new Set(molNosToUpdate)].map(molNo => dispatch(triggerUpdate(molNo)));

            // v0.2.29-v0.2.38 had a one-shot atomClicked listener wired up
            // here that auto-declared a covalent link once the ligand was
            // placed. v0.2.39 decoupled SMILES placement (Step 1) from
            // covalent declaration (Step 2) — the user now triggers the
            // declaration explicitly from "Ligand → Make covalent…" or
            // by right-clicking a Cys SG. No listener wired here anymore.
        },
        [moleculeSelectValueRef, createRef, molecules, commandCentre, tlc, backgroundColor, defaultBondSmoothness, addToMoleculeValueRef, originState, placeAtRef, fitToDensityRef, store, dispatch]
    );

    // PyKeko v0.2.15: resolve the default placement target — the centre of
    // the active protein molecule's atoms (NOT the camera's rotation centre).
    // Sequence: (1) prefer the molecule the user picked in "Make monomer
    // available to" if that's a real molecule; (2) else the first loaded
    // molecule; (3) else fall back to the camera rotation centre (which is
    // what `originState.map(c => -c)` resolves to, matching pre-v0.2.15
    // behaviour for the empty-scene corner case).
    const computePlacement = useCallback(async (): Promise<[number, number, number]> => {
        const fallbackToRotationCentre = (): [number, number, number] =>
            [-originState[0], -originState[1], -originState[2]];
        if (placeAtRef?.current === "rotation_centre") {
            return fallbackToRotationCentre();
        }
        // Resolve which molecule to centre on.
        const pickedMolNo = (() => {
            const v = moleculeSelectValueRef.current;
            if (v === null || v === undefined || v === "" || v === "-999999") return null;
            const n = parseInt(v);
            return Number.isFinite(n) ? n : null;
        })();
        const target = pickedMolNo !== null
            ? molecules.find(m => m.molNo === pickedMolNo)
            : (molecules.find(m => !!m && (m as any).atomCount > 0) ?? molecules[0]);
        if (!target) return fallbackToRotationCentre();
        try {
            const atoms = await (target as any).gemmiAtomsForCid?.("/*/*/*/*");
            if (atoms && atoms.length > 0) {
                // GOTCHA: centreOnGemmiAtoms returns the **negated** centroid
                // (it returns `[-x/n, -y/n, -z/n]`, see utils.ts). The name is
                // misleading — the returned value is what you'd pass to
                // `setOrigin(...)`, which is the negated-world convention.
                // We need world-space coords for get_monomer_and_position_at,
                // so negate it back. (This was the v0.2.15-pre-build bug:
                // CDP probe showed Coot receiving (-31, 35, -0.01) instead of
                // (31, -35, 0.01) — same mirror-across-origin symptom as
                // v0.2.12, different source.)
                const [nx, ny, nz] = centreOnGemmiAtoms(atoms);
                return [-nx, -ny, -nz];
            }
        } catch (e) {
            console.warn("computePlacement: gemmiAtomsForCid failed on", target.name, e);
        }
        return fallbackToRotationCentre();
    }, [molecules, originState, moleculeSelectValueRef, placeAtRef]);

    // PyKeko: pick the highest positive Fo-Fc peak across loaded difference
    // maps. Returns world-space (x,y,z) + sigma estimate, or null when no
    // suitable peak exists. Uses Coot's `difference_map_peaks` (the same
    // command the difference-peak cycler uses for the keyboard 'p' shortcut).
    const pickFoFcPeak = useCallback(async (): Promise<{ x: number; y: number; z: number; sigma: number } | null> => {
        const maps = store.getState().maps as moorhen.Map[];
        const diffMaps = maps.filter(m => (m as any).isDifference);
        if (diffMaps.length === 0) return null;
        // Need a protein molecule to anchor the search; pick the first non-
        // ligand molecule loaded. Bail if none present.
        const proteinMol = molecules[0];
        if (!proteinMol) return null;
        // 3σ is the conventional "interesting" threshold — high enough to
        // skip ripple noise, low enough that a typical un-modelled ligand
        // peak (4-8σ) will still come up. Same default the validation tools
        // use.
        const sigmaThreshold = 3.0;
        let best: { x: number; y: number; z: number; sigma: number } | null = null;
        for (const dmap of diffMaps) {
            try {
                const resp = (await commandCentre.current.cootCommand(
                    {
                        returnType: "interesting_places_data",
                        command: "difference_map_peaks",
                        commandArgs: [(dmap as any).molNo, proteinMol.molNo, sigmaThreshold],
                    },
                    false
                )) as moorhen.WorkerResponse<libcootApi.InterestingPlaceDataJS[]>;
                const peaks = resp.data.result.result || [];
                // Positive peaks only — we're placing a ligand into UN-modelled
                // density, not subtracting modelled-but-absent atoms.
                for (const p of peaks) {
                    if ((p as any).featureValue <= 0) continue;
                    // `featureValue` is in raw map-density units, NOT σ.
                    // The σ threshold passed to difference_map_peaks already
                    // filtered everything below 3σ before we got the list, so
                    // ranking by raw featureValue == ranking by σ here (both
                    // monotonic since `σ = featureValue / map_rmsd`). We
                    // stash it as `sigma` for the comparator's name without
                    // bothering to divide.
                    const score = (p as any).featureValue;
                    if (!best || score > best.sigma) {
                        best = { x: (p as any).coordX, y: (p as any).coordY, z: (p as any).coordZ, sigma: score };
                    }
                }
            } catch (e) {
                console.warn("difference_map_peaks failed for map", (dmap as any).molNo, e);
            }
        }
        return best;
    }, [molecules, commandCentre, store]);

    // PyKeko: jiggle-fit-with-blur then RSR the freshly-placed ligand against
    // the active map. Mirrors Coot 0.9's "fit ligand here" pipeline. Defaults
    // (B=200, trials=500, scale=3) come from Moorhen's RandomJiggleBlur menu.
    const fitLigandIntoDensity = useCallback(async (ligand: moorhen.Molecule) => {
        const activeMap = store.getState().generalStates.activeMap as moorhen.Map;
        if (!activeMap) {
            dispatch(enqueueSnackbar({ message: "Skipped auto-fit: no active map. Pick one from the Maps panel and try Ligand → Find ligand…", variant: "info" }));
            return;
        }
        try {
            await commandCentre.current.cootCommand(
                {
                    returnType: "status",
                    command: "fit_to_map_by_random_jiggle_with_blur_using_cid",
                    commandArgs: [ligand.molNo, (activeMap as any).molNo, "//", 200, 500, 3],
                },
                true
            );
            (ligand as any).setAtomsDirty?.(true);
            await ligand.redraw();
            // Final RSR pass — same call the Find-ligand modal's Refine button
            // uses (mode ALL refines every residue in the ligand-only molecule,
            // which is just our single residue).
            await (ligand as any).refineResiduesUsingAtomCid?.("//", "ALL", 4000, true);
            dispatch(enqueueSnackbar({ message: `Ligand auto-fit into density (jiggle + RSR against ${(activeMap as any).name || "active map"}).`, variant: "success" }));
        } catch (e) {
            dispatch(enqueueSnackbar({ message: `Auto-fit failed: ${String((e as any)?.message || e)}`, variant: "error" }));
        }
    }, [commandCentre, dispatch, store]);

    const popoverContent = (
        <>
            {panelContent}
            <MoorhenStack inputGrid>
                <MoorhenMoleculeSelect
                    molecules={molecules}
                    allowAny={true}
                    ref={moleculeSelectRef}
                    label="Make monomer available to"
                    selected={molecules.length > 0 ? (molecules[0].molNo as number) : undefined}
                    onChange={evt => {
                        // eslint-disable-next-line react-hooks/react-compiler
                        moleculeSelectValueRef.current = evt.target.value;
                    }}
                />

                <MoorhenToggle
                    label="Create instance on read"
                    checked={createInstance}
                    onChange={() => setCreateInstance(!createInstance)}
                />
                {createInstance ? (
                    <MoorhenSelect
                        disabled={!createInstance}
                        ref={addToRef}
                        value={addToMolecule}
                        onChange={e => {
                            setAddToMolecule(e.target.value);
                            addToMoleculeValueRef.current = parseInt(e.target.value);
                        }}
                    >
                        <option key={-1} value={"-1"}>
                            {createInstance ? "...create new molecule" : ""}
                        </option>
                        {molecules.map(molecule => (
                            <option key={molecule.molNo} value={molecule.molNo}>
                                ...add to {molecule.name}
                            </option>
                        ))}
                    </MoorhenSelect>
                ) : (
                    <div />
                )}
            </MoorhenStack>
        </>
    );

    const onCompleted = useCallback(async () => {
        const ligandDict = await fetchLigandDict();
        if (ligandDict) {
            handleFileContent(ligandDict);
        } else {
            console.log("Unable to get ligand dict...");
        }
    }, [handleFileContent, fetchLigandDict]);

    // v0.2.39: pin the dialog to the top-right corner so it doesn't cover
    // the atoms the user wants to fit / pick. Same Draggable + position:fixed
    // pattern as the right-click covalent panel (MoorhenCovalentLinkButton.tsx)
    // — fixed escapes the popover host's absolute container, drag handle
    // (the grey header) lets the user move it anywhere without dismissing.
    const dragNodeRef = useRef<HTMLDivElement>(null);
    return (
        <Draggable handle=".pykeko-smiles-header" nodeRef={dragNodeRef}>
        <div ref={dragNodeRef} style={{
            position: "fixed", top: 80, right: 16, zIndex: 2000,
            background: "white", border: "1px solid #ccc",
            borderRadius: 8, minWidth: 420, maxWidth: 520, boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            padding: 0,
        }}>
            <div className="pykeko-smiles-header" style={{
                cursor: "move", userSelect: "none",
                background: "#e9ecef", borderTopLeftRadius: 8, borderTopRightRadius: 8,
                padding: "8px 12px", display: "flex", alignItems: "center", gap: 10,
                fontSize: "0.95rem", color: "#212529", fontWeight: 600,
                borderBottom: "1px solid #ced4da",
            }} title="Drag to reposition">
                <span style={{ fontSize: "1rem", color: "#868e96", letterSpacing: "-2px" }}>⋮⋮</span>
                <span>{props.menuItemText}</span>
            </div>
            <div style={{ padding: 12 }}>
                {popoverContent}
                <MoorhenButton onClick={onCompleted}>Ok</MoorhenButton>
            </div>
        </div>
        </Draggable>
    );
};

export const SMILESToLigand = () => {
    const commandCentre = useCommandCentre();
    const dispatch = useDispatch();
    const store = useStore<RootState>();
    const molecules = useSelector((state: moorhen.State) => state.molecules.moleculeList);
    const [smile, setSmile] = useState<string>("");
    // PDB CCD codes are strictly 3 chars (A-Z 0-9). Default to "LIG" (the
    // de-facto Coot / Phenix / Refmac generic-ligand code). When LIG is
    // already taken by a previously loaded ligand, auto-suffix to LI1,
    // LI2, …, LI9, LIA, …, LIZ until we find one that's free. User can
    // override.
    const [tlc, setTlc] = useState<string>(() => {
        const taken = new Set<string>();
        for (const m of molecules || []) {
            const dicts = (m as any).ligandDicts || {};
            for (const k of Object.keys(dicts)) taken.add(k);
        }
        if (!taken.has("LIG")) return "LIG";
        for (const ch of "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
            const cand = "LI" + ch;
            if (!taken.has(cand)) return cand;
        }
        return "LIG"; // exhausted alphabet — user will override
    });
    const [createInstance, setCreateInstance] = useState<boolean>(true);
    const [addToMolecule, setAddToMolecule] = useState<string>("");
    const [conformerCount, setConformerCount] = useState<number>(10);
    const [iterationCount, setIterationCount] = useState<number>(100);
    const [source, setSource] = useState<string>("smiles");
    // PyKeko (v0.2.12): placement + auto-fit choices for the freshly-created
    // ligand. v0.2.15 default: "molecule_centre" — the centroid of the
    // active protein's atoms. v0.2.12-v0.2.14 defaulted to "rotation_centre"
    // (the camera's pivot) which is often not on the protein on freshly-
    // loaded scenes; users reported "ligand lands nowhere near the protein".
    // "peak" + fit-on is the Coot 0.9 "Fit ligand here" UX.
    const [placeAt, setPlaceAt] = useState<"molecule_centre" | "rotation_centre" | "peak">("molecule_centre");
    const [fitToDensity, setFitToDensity] = useState<boolean>(false);

    // v0.2.39: covalent attachment is now a separate Step 2 (right-click
    // a Cys SG, or "Ligand → Make covalent…" menu entry). The SMILES
    // dialog is pure Step 1 — place the ligand, jiggle/RSR it, that's it.

    const createRef = useRef<boolean>(true);
    useEffect(() => { createRef.current = createInstance; }, [createInstance]);
    const moleculeSelectRef = useRef<null | HTMLSelectElement>(null);
    const moleculeSelectValueRef = useRef<null | string>(null);
    const addToRef = useRef<null | HTMLSelectElement>(null);
    const addToMoleculeValueRef = useRef<null | number>(null);
    const conformerCountRef = useRef<number>(10);
    const iterationCountRef = useRef<number>(100);
    const sourceSelectRef = useRef<HTMLSelectElement | null>(null);
    // PyKeko: the wrapper reads these at action time, so the popover can be
    // re-toggled without stale-closure issues during the round-trip.
    const placeAtRef = useRef<"molecule_centre" | "rotation_centre" | "peak">("molecule_centre");
    useEffect(() => { placeAtRef.current = placeAt; }, [placeAt]);
    const fitToDensityRef = useRef<boolean>(false);
    useEffect(() => { fitToDensityRef.current = fitToDensity; }, [fitToDensity]);

    const collectedProps = {
        smile,
        setSmile,
        tlc,
        setTlc,
        createInstance,
        setCreateInstance,
        addToMolecule,
        setAddToMolecule,
        createRef,
        moleculeSelectRef,
        addToRef,
        addToMoleculeValueRef,
        moleculeSelectValueRef,
        placeAtRef,
        fitToDensityRef,
    };

    const smilesToPDB = async (): Promise<string> => {
        let smilesText = "";
        const sourceValue = sourceSelectRef.current.value;
        if (sourceValue === "pubchem") {
            try {
                const molSearchUrl = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/" + encodeURIComponent(smile) + "/cids/TXT";
                const moleculeSearchResponse = await fetch(molSearchUrl);
                if (!moleculeSearchResponse.ok) {
                    console.warn(`PubChem name→CID lookup failed for "${smile}" (HTTP ${moleculeSearchResponse.status})`);
                    return;
                }
                const moleculeIds = (await moleculeSearchResponse.text()).trim();
                if (!moleculeIds) {
                    console.warn(`PubChem returned no CID for "${smile}"`);
                    return;
                }
                const firstCid = moleculeIds.split("\n")[0].trim();
                const smilesSearchUrl = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/" + firstCid + "/property/CanonicalSMILES/TXT";
                const smilesResponse = await fetch(smilesSearchUrl);
                if (!smilesResponse.ok) {
                    console.warn(`PubChem CID→SMILES lookup failed for CID ${firstCid} (HTTP ${smilesResponse.status})`);
                    return;
                }
                smilesText = (await smilesResponse.text()).trim();
            } catch (err) {
                console.warn("PubChem lookup threw:", err);
                return;
            }
        } else if (sourceValue === "chembl") {
            // ChEMBL: search by synonym then fall back to molecule_synonym=NAME.
            // ChEMBL's SMILES is often the more pharmacologically-clean form for
            // approved drugs / known inhibitors, where PubChem might return a
            // tautomer or an isotope-labelled variant from a particular submitter.
            try {
                const searchUrl = "https://www.ebi.ac.uk/chembl/api/data/molecule/search.json?q=" + encodeURIComponent(smile) + "&limit=1";
                const r = await fetch(searchUrl);
                if (!r.ok) {
                    console.warn(`ChEMBL search failed for "${smile}" (HTTP ${r.status})`);
                    return;
                }
                const data = await r.json();
                const mols = data?.molecules || [];
                const hit = mols[0];
                const cs = hit?.molecule_structures?.canonical_smiles;
                if (!cs) {
                    console.warn(`ChEMBL returned no canonical_smiles for "${smile}"`);
                    return;
                }
                smilesText = cs.trim();
            } catch (err) {
                console.warn("ChEMBL lookup threw:", err);
                return;
            }
        } else {
            smilesText = smile;
        }

        if (!smilesText) {
            console.log("Empty smile, do nothing...");
            return;
        }

        let n_conformer: number;
        let n_iteration: number;
        try {
            n_conformer = conformerCountRef.current;
            n_iteration = iterationCountRef.current;
        } catch (err) {
            console.log(err);
            return;
        }

        if (
            isNaN(n_conformer) ||
            n_conformer < 0 ||
            n_conformer === Infinity ||
            isNaN(n_iteration) ||
            n_iteration < 0 ||
            n_iteration === Infinity
        ) {
            console.log("Unable to parse n_conformer / n_iteration count into a valid int...");
            return;
        }

        const response = (await commandCentre.current.cootCommand(
            {
                command: "smiles_to_pdb",
                commandArgs: [smilesText, tlc, n_conformer, n_iteration],
                returnType: "str_str_pair",
            },
            true
        )) as moorhen.WorkerResponse<libcootApi.PairType<string, string>>;
        const result = response.data.result.result.second;

        if (result) {
            return result;
        }

        // PyKeko: smiles_to_pdb's RDKit-WASM path fails on some exotic
        // chemistries (boron centres, certain charged species, weird
        // tautomers). Falls back to a local AceDRG install via IPC when
        // available. Browser builds skip this — window.__moorhenControl
        // is undefined outside the Electron wrapper.
        const ctl = (window as any).__moorhenControl;
        if (ctl && typeof ctl.acedrgSmiles === "function") {
            try {
                const r = await ctl.acedrgSmiles(smilesText, tlc);
                if (r?.ok && r.cif) {
                    console.log(`AceDRG fallback succeeded for ${tlc} (${r.cif.length} bytes)`);
                    return r.cif;
                }
                if (r?.notInstalled) {
                    console.warn("AceDRG fallback unavailable: " + r.error);
                } else {
                    console.warn("AceDRG fallback failed: " + (r?.error || "unknown"));
                }
            } catch (err) {
                console.warn("AceDRG fallback threw:", err);
            }
        }
        console.log("Error creating molecule... Wrong SMILES?");
    };

    const handleSourceChange = async evt => {
        setSource(evt.target.value);
    };

    const panelContent = (
        <MoorhenStack inputGrid>
            <span>
                Source...
                <MoorhenInfoCard
                    infoText={
                        <em>
                            By default, a structure will be created from a user inputted SMILES string. Alternatively, a molecule name
                            can be looked up via PubChem (broad coverage) or ChEMBL (cleaner SMILES for approved drugs and known
                            inhibitors). For ambiguous names, try both — they sometimes pick different tautomers / stereo forms.
                        </em>
                    }
                />
            </span>
            <MoorhenSelect ref={sourceSelectRef} value={source} onChange={handleSourceChange}>
                <option value={"smiles"}>SMILES</option>
                <option value={"pubchem"}>PubChem search</option>
                <option value={"chembl"}>ChEMBL search</option>
            </MoorhenSelect>
            <MoorhenTextInput
                text={smile}
                label={source === "smiles" ? "Enter SMILES string" : "Enter molecule name"}
                onChange={e => {
                    setSmile(e.target.value);
                }}
            />
            <MoorhenTextInput
                label="3-letter code (PDB CCD; A-Z 0-9)"
                text={tlc}
                onChange={e => {
                    // Force uppercase, drop non-alphanumeric, cap at 3 chars.
                    // The PDB chem_comp ID is a fixed 3-char field in mmCIF/PDB.
                    setTlc(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3));
                }}
            />
            <TextField
                style={{ margin: "0.5rem", width: "9rem" }}
                id="conformer-count"
                label="No. of conformers"
                type="number"
                variant="standard"
                error={isNaN(conformerCount) || conformerCount < 0 || conformerCount === Infinity}
                value={conformerCount}
                onChange={evt => {
                    conformerCountRef.current = parseInt(evt.target.value);
                    setConformerCount(parseInt(evt.target.value));
                }}
            />
            <TextField
                style={{ margin: "0.5rem", width: "9rem" }}
                id="iteration-count"
                label="No. of iterations"
                type="number"
                variant="standard"
                error={isNaN(iterationCount) || iterationCount < 0 || iterationCount === Infinity}
                value={iterationCount}
                onChange={evt => {
                    iterationCountRef.current = parseInt(evt.target.value);
                    setIterationCount(parseInt(evt.target.value));
                }}
            />
            {/* PyKeko: placement + auto-fit controls. Visually grouped so users see them
                next to "Create instance" — that's the toggle they govern. The labels read
                imperatively ("Place at…", "Auto-fit…") rather than as nouns so the choices
                line up grammatically with the rest of the modal. */}
            <span>
                Place at...
                <MoorhenInfoCard
                    infoText={
                        <em>
                            Where to put the new ligand molecule.
                            "Active molecule centre" (default, v0.2.15+) places it at the
                            centroid of the selected protein's atoms — what you usually
                            want when adding a ligand to a structure.
                            "View centre" uses the camera's rotation centre (what upstream
                            Moorhen / v0.2.12-0.2.14 did) — only useful if you've explicitly
                            navigated the camera to where the ligand should go.
                            "Nearest Fo-Fc peak" picks the strongest positive blob in the
                            active difference map (3σ threshold) — Coot 0.9.x's "Fit ligand
                            here" workflow. Falls back to the molecule centre if no diff
                            map is loaded.
                        </em>
                    }
                />
            </span>
            <MoorhenSelect value={placeAt} onChange={e => setPlaceAt(e.target.value as "molecule_centre" | "rotation_centre" | "peak")}>
                <option value={"molecule_centre"}>Active molecule centre (default)</option>
                <option value={"rotation_centre"}>View centre</option>
                <option value={"peak"}>Nearest positive Fo-Fc peak</option>
            </MoorhenSelect>
            <MoorhenToggle
                label="Auto-fit to active map (jiggle + RSR)"
                checked={fitToDensity}
                onChange={() => setFitToDensity(!fitToDensity)}
            />

            {/* v0.2.39: the covalent attachment section that lived here in
                v0.2.29–v0.2.38 was removed. The SMILES dialog is now Step 1
                (place + fit ligand) only; declare-covalent is Step 2
                (right-click the Cys SG or use Ligand → Make covalent…). */}
        </MoorhenStack>
    );

    return (
        <ImportLigandDictionary
            id="smiles-to-ligand-menu-item"
            menuItemText="From SMILES..."
            panelContent={panelContent}
            fetchLigandDict={smilesToPDB}
            {...collectedProps}
        />
    );
};

export const ImportDictionary = () => {
    const tlcsOfFileRef = useRef<{ comp_id: string; dict_contents: string }[]>([]);
    const moleculeSelectRef = useRef<null | HTMLSelectElement>(null);
    const moleculeSelectValueRef = useRef<null | string>(null);
    const addToRef = useRef<null | HTMLSelectElement>(null);
    const addToMoleculeValueRef = useRef<null | number>(null);
    const tlcSelectRef = useRef<null | HTMLSelectElement>(null);
    const createRef = useRef<boolean>(false);
    const molecules = useSelector((state: RootState) => state.molecules.moleculeList);

    const [tlc, setTlc] = useState<string>("");
    const [addToMolecule, setAddToMolecule] = useState<string>("");
    const [createInstance, setCreateInstance] = useState<boolean>(false);
    // Keep createRef in sync with the toggle state
    useEffect(() => { createRef.current = createInstance; }, [createInstance]);
    // Default the molecule-select ref to the first molecule (matches the default selected option)
    useEffect(() => {
        if (molecules.length > 0 && (moleculeSelectValueRef.current === null || moleculeSelectValueRef.current === undefined)) {
            moleculeSelectValueRef.current = String(molecules[0].molNo);
        }
    }, [molecules]);
    const [validDictFile, setValidDictFile] = useState<boolean>(true);
    const [tlcsOfFile, setTlcsOfFile] = useState<{ comp_id: string; dict_contents: string }[]>([]);
    const dispatch = useDispatch();

    const collectedProps = {
        tlc,
        setTlc,
        createInstance,
        setCreateInstance,
        addToMolecule,
        setAddToMolecule,
        createRef,
        moleculeSelectRef,
        addToRef,
        addToMoleculeValueRef,
        moleculeSelectValueRef,
    };

    const panelContent = (
        <>
            <MoorhenStack inputGrid style={{ margin: "0.2rem" }}>
            <MoorhenFileInput
                onChange={async (e: React.ChangeEvent<HTMLInputElement>) => {
                    const tlcs = await parseCifDict(e.target.files[0]);
                    if (tlcs.length > 0) {
                        tlcsOfFileRef.current = tlcs;
                        setTlcsOfFile(tlcs);
                        setTlc(tlcs[0].comp_id);
                        setValidDictFile(true);
                    } else {
                        setValidDictFile(false);
                    }
                }}
            /><div/>
            {!validDictFile && (<><span>Unable to parse</span><div/></>)}
            <MoorhenSelect
                label={"Monomer identifier"}
                ref={tlcSelectRef}
                value={tlc}
                onChange={newVal => {
                    setTlc(newVal.target.value);
                }}
            >
                {tlcsOfFile.map(tlcOfFile => (
                    <option key={tlcOfFile.comp_id} value={tlcOfFile.comp_id}>
                        {tlcOfFile.comp_id}
                    </option>
                ))}
            </MoorhenSelect>
            </MoorhenStack>
        </>
    );

    const fetchLigandDict = async (): Promise<string> => {
        if (tlc) {
            const ligandInfo = tlcsOfFileRef.current.find(lig => lig.comp_id === tlc);
            if (ligandInfo) {
                return ligandInfo.dict_contents;
            } else {
                console.warn(`Unable to parse ligand dictionary`);
                dispatch(enqueueSnackbar({ message: "Unable to import ligand", variant: "error" }));
            }
        }
    };

    return (
        <ImportLigandDictionary
            id="import-dict-menu-item"
            menuItemText="Import dictionary..."
            panelContent={panelContent}
            fetchLigandDict={fetchLigandDict}
            {...collectedProps}
        />
    );
};
