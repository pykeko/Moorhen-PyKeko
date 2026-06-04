import { TextField } from "@mui/material";
import { useDispatch, useSelector, useStore } from "react-redux";
import { useCallback, useEffect, useRef, useState } from "react";
import { RootState, enqueueSnackbar } from "@/store/";
import { parseCifDict } from "@/utils/MoorhenFileLoading";
import { useCommandCentre, usePaths } from "../../InstanceManager";
import { triggerUpdate } from "../../store/moleculeMapUpdateSlice";
import { addMolecule } from "../../store/moleculesSlice";
import { setOrigin } from "../../store/glRefSlice";
import { libcootApi } from "../../types/libcoot";
import { moorhen } from "../../types/moorhen";
import { MoorhenMolecule } from "../../utils/MoorhenMolecule";
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
    placeAtRef?: React.MutableRefObject<"origin" | "peak">;
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
                // BACK to world — net effect: pass world coords). Falls back
                // to view centre if no diff map exists or the peak search
                // comes up empty.
                //
                // **v0.2.12 bug fixed in v0.2.14**: I had `placement` in
                // world space and then ALSO negated it in commandArgs below,
                // so Coot received `-world` and placed the ligand at the
                // mirror across (0,0,0) — far from the protein. Symptom:
                // "the ligand ends up in the same spot every time, very
                // distant from where it was intended" regardless of which
                // Place-at option was chosen, because the peak path silently
                // falls back to view-centre when no diff map is loaded.
                let placementWorld: [number, number, number] = [-originState[0], -originState[1], -originState[2]];
                let pickedPeak: { x: number; y: number; z: number; sigma: number } | null = null;
                if (placeAtRef?.current === "peak") {
                    pickedPeak = await pickFoFcPeak();
                    if (pickedPeak) {
                        // difference_map_peaks already returns world-space
                        // coords (same frame as moveMoleculeHere / setOrigin's
                        // negated input).
                        placementWorld = [pickedPeak.x, pickedPeak.y, pickedPeak.z];
                    } else {
                        dispatch(enqueueSnackbar({ message: "No Fo-Fc peak found (need a difference map loaded with positive density above the threshold); placing at view centre.", variant: "warning" }));
                    }
                }
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
                    // PyKeko: if we placed at a peak, recentre the view there
                    // so the user can SEE what just landed. Skipped when no
                    // peak was found — view stays where it was.
                    if (pickedPeak) {
                        dispatch(setOrigin([-pickedPeak.x, -pickedPeak.y, -pickedPeak.z]));
                    }
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
                        } else {
                            await newMolecule.redraw();
                        }
                    }
                }
            }

            [...new Set(molNosToUpdate)].map(molNo => dispatch(triggerUpdate(molNo)));
        },
        [moleculeSelectValueRef, createRef, molecules, commandCentre, tlc, backgroundColor, defaultBondSmoothness, addToMoleculeValueRef, originState, placeAtRef, fitToDensityRef]
    );

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

    return (
        <>
            {popoverContent}
            <MoorhenButton onClick={onCompleted}>Ok</MoorhenButton>
        </>
    );
};

export const SMILESToLigand = () => {
    const commandCentre = useCommandCentre();
    const [smile, setSmile] = useState<string>("");
    const [tlc, setTlc] = useState<string>("NewLig");
    const [createInstance, setCreateInstance] = useState<boolean>(true);
    const [addToMolecule, setAddToMolecule] = useState<string>("");
    const [conformerCount, setConformerCount] = useState<number>(10);
    const [iterationCount, setIterationCount] = useState<number>(100);
    const [source, setSource] = useState<string>("smiles");
    // PyKeko (v0.2.12): placement + auto-fit choices for the freshly-created
    // ligand. Defaults: "origin" + fit-off match upstream Moorhen's behaviour;
    // "peak" + fit-on is the "Fit ligand here" Coot 0.9 UX.
    const [placeAt, setPlaceAt] = useState<"origin" | "peak">("origin");
    const [fitToDensity, setFitToDensity] = useState<boolean>(false);

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
    const placeAtRef = useRef<"origin" | "peak">("origin");
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
        if (sourceSelectRef.current.value === "pubchem") {
            const molSearchUrl = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/" + smile + "/cids/TXT";
            console.log(molSearchUrl);
            const moleculeSearchResponse = await fetch(molSearchUrl);
            const moleculeIds = await moleculeSearchResponse.text();
            const smilesSearchUrl =
                "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/" + moleculeIds.split("\n")[0] + "/property/CanonicalSMILES/TXT";
            const smilesResponse = await fetch(smilesSearchUrl);
            const pubchemSmiles = await smilesResponse.text();
            console.log(pubchemSmiles);
            smilesText = pubchemSmiles;
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
        } else {
            console.log("Error creating molecule... Wrong SMILES?");
        }
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
                            By default, a structure will be created from a user inputted SMILES string. Alternatively, a molecule name can
                            be used in which case the SMILES string will be generated by searching PubChem.
                        </em>
                    }
                />
            </span>
            <MoorhenSelect ref={sourceSelectRef} value={source} onChange={handleSourceChange}>
                <option value={"smiles"}>SMILES</option>
                <option value={"pubchem"}>PubChem search</option>
            </MoorhenSelect>
            <MoorhenTextInput
                text={smile}
                label={source === "smiles" ? "Enter SMILES string" : "Enter molecule name"}
                onChange={e => {
                    setSmile(e.target.value);
                }}
            />
            <MoorhenTextInput
                label="Assign a name"
                text={tlc}
                onChange={e => {
                    setTlc(e.target.value);
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
                            Where to put the new ligand molecule. "View centre" drops it at
                            the rotation centre (what upstream Moorhen does). "Nearest
                            Fo-Fc peak" picks the strongest positive blob in the active
                            difference map (3σ threshold) — Coot 0.9.x's "Fit ligand here"
                            workflow. Needs a difference map to be loaded; falls back to
                            view centre if none.
                        </em>
                    }
                />
            </span>
            <MoorhenSelect value={placeAt} onChange={e => setPlaceAt(e.target.value as "origin" | "peak")}>
                <option value={"origin"}>View centre (default)</option>
                <option value={"peak"}>Nearest positive Fo-Fc peak</option>
            </MoorhenSelect>
            <MoorhenToggle
                label="Auto-fit to active map (jiggle + RSR)"
                checked={fitToDensity}
                onChange={() => setFitToDensity(!fitToDensity)}
            />
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
