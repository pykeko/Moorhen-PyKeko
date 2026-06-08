// PyKeko covalent-ligand workflow — orchestrator
//
// Ties the detector + library + cootCommand calls into one function the
// UI layer can invoke. Given the user's right-click on a Cys SG + the
// identified ligand atom, this:
//
//   1. Pulls the ligand's chem_comp atoms + bonds from the WASM
//   2. Runs the warhead detector to classify the family + build atom map
//   3. Substitutes placeholders into the link CIF
//   4. Loads the substituted CIF via cootCommand("read_dictionary_string")
//   5. Inserts a _struct_conn record into the model mmCIF — this is the
//      JS-side surgery path that replaces the original make_covalent_link
//      WASM call, which silently fails to register at runtime due to the
//      embind silent-drop bug (see feedback_moorhen_embind_silent_drop.md).
//      Refmac auto-detects covalent links from struct_conn + matching
//      _chem_link in the loaded dictionary.
//
// References:
//   ~/Moorhen/docs/covalent-ligand-plan.md §5 ("The architecture")
//   ./MoorhenCovalentLinkLibrary.ts (substitution)
//   ./MoorhenCovalentLinkDetector.ts (classification)

import {
    buildSubstitutedLinkCif,
    LigandAtom,
    LigandBond,
    CovLinkAtomMap,
    CovLinkRegistryEntry,
} from "./MoorhenCovalentLinkLibrary";
import { detectWarheadFamily } from "./MoorhenCovalentLinkDetector";
import {
    parseCid,
    findAtomInModel,
    appendStructConnLoop,
} from "./MoorhenCovalentLinkSurgery";

/**
 * Minimal command-centre surface — matches whatever real callers pass.
 * Keeps this file decoupled from the rest of Moorhen so the unit tests
 * can mock just this shape.
 */
export interface CootCommandCentre {
    cootCommand(
        request: {
            command: string;
            commandArgs: unknown[];
            returnType: string;
            changesMolecules?: number[];
            message?: string;
        },
        promptToCancel: boolean
    ): Promise<{ data: { result: { result: unknown } } }>;
}

export interface CovalentLinkRequest {
    /** Ligand 3- or 5-char CCD code. */
    lig: string;
    /** Molecule index containing both the Cys and the ligand. */
    molNo: number;
    /** Atom CID for the Cys SG (e.g. "//A/481/SG"). */
    sgCid: string;
    /** Atom CID for the ligand Cβ atom (e.g. "//A/801/C19"). */
    cbCid: string;
    /** Ligand atom list + bonds (from chem_comp or RDKit). */
    atoms: LigandAtom[];
    bonds: LigandBond[];
    /** Index of Cβ in the atoms array. */
    cbIdx: number;
    /** If true, skip the WASM calls; just report what would have happened. */
    dryRun?: boolean;
}

export interface CovalentLinkResult {
    /** True if the detector + substitution succeeded. */
    success: boolean;
    /** Family + variant that matched, or null if no match. */
    entry: CovLinkRegistryEntry | null;
    /** Resolved atom map (the substituted ligand atom names). */
    atomMap: CovLinkAtomMap | null;
    /** Fully substituted link CIF (the text that was loaded). */
    cifText: string | null;
    /** True if the struct_conn injection succeeded — the link is in augmentedMmcif. */
    linkDeclared: boolean;
    /**
     * Current model mmCIF with the new _struct_conn loop appended. Pass to
     * refmacat (or save to disk and run refmac externally) — Coot's in-WASM
     * storage strips connection metadata on import, so this text is the only
     * place the link survives.
     */
    augmentedMmcif: string | null;
    /** Human-readable description of what happened (for UI + logs). */
    message: string;
    /** Error message if anything failed. */
    error?: string;
}

/**
 * Top-level orchestrator. Call this from the right-click context menu.
 *
 * Order of operations matters: read_dictionary_string MUST succeed before
 * make_covalent_link_using_cids, because Coot's restraint-build code reads
 * the chem_link from the loaded geometry. If the dictionary load fails,
 * we abort before declaring the link to avoid a half-applied state.
 *
 * The WASM commands return 1 on success / 0 on failure (per the new
 * binding's signature). We surface those into success bools so the UI
 * can show appropriate toasts.
 */
export async function declareCovalentLink(
    request: CovalentLinkRequest,
    commandCentre: CootCommandCentre
): Promise<CovalentLinkResult> {
    // Step 1+2: classify + atom-name map
    const detected = await detectWarheadFamily(
        request.lig,
        request.atoms,
        request.bonds,
        request.cbIdx
    );
    if (!detected) {
        return {
            success: false,
            entry: null,
            atomMap: null,
            cifText: null,
            linkDeclared: false,
            augmentedMmcif: null,
            message: `No matching warhead family for ${request.lig} — ` +
                `the bond graph at Cβ doesn't match any registered template.`,
            error: "no_warhead_match",
        };
    }

    // Step 3: substitute the link CIF
    let cifText: string;
    try {
        cifText = await buildSubstitutedLinkCif(detected.entry, detected.atomMap);
    } catch (err) {
        return {
            success: false,
            entry: detected.entry,
            atomMap: detected.atomMap,
            cifText: null,
            linkDeclared: false,
            augmentedMmcif: null,
            message: `Detector matched ${detected.entry.id} but the link CIF ` +
                `template could not be substituted: ${String(err)}`,
            error: "substitution_failed",
        };
    }

    if (request.dryRun) {
        return {
            success: true,
            entry: detected.entry,
            atomMap: detected.atomMap,
            cifText,
            linkDeclared: false,
            augmentedMmcif: null,
            message: `Dry-run: matched ${detected.entry.id} ` +
                `(${detected.entry.name}). Substituted CIF is ${cifText.length} bytes. ` +
                `Set dryRun=false to declare the link in the WASM.`,
        };
    }

    // Step 4: load the substituted CIF via read_dictionary_string
    try {
        const dictResponse = await commandCentre.cootCommand(
            {
                message: "coot_command",
                command: "read_dictionary_string",
                returnType: "status",
                commandArgs: [cifText, request.molNo],
                changesMolecules: [request.molNo],
            },
            false
        );
        // read_dictionary_string returns 0 on success (per CCP4-ML conventions);
        // anything else means the load failed.
        const dictStatus = (dictResponse?.data?.result?.result as number) ?? -1;
        if (dictStatus !== 0 && dictStatus !== 1) {
            return {
                success: false,
                entry: detected.entry,
                atomMap: detected.atomMap,
                cifText,
                linkDeclared: false,
                augmentedMmcif: null,
                message: `read_dictionary_string returned ${dictStatus} — ` +
                    `the substituted link CIF was rejected by the WASM. ` +
                    `Inspect the CIF text in the result and check the placeholder ` +
                    `substitution worked correctly.`,
                error: "dictionary_load_failed",
            };
        }
    } catch (err) {
        return {
            success: false,
            entry: detected.entry,
            atomMap: detected.atomMap,
            cifText,
            linkDeclared: false,
            augmentedMmcif: null,
            message: `WASM rejected the link CIF: ${String(err)}`,
            error: "dictionary_load_threw",
        };
    }

    // Step 5: JS-side struct_conn surgery (replaces broken make_covalent_link WASM call)
    //
    // We can't call make_covalent_link_using_cids — that binding is silently
    // dropped by the embind layer at runtime. Instead we:
    //   a. Export the current model as mmCIF
    //   b. Look up label_asym_id / label_seq_id / label_comp_id for both atoms
    //   c. Append a _struct_conn loop_ row referencing both atoms + the link id
    //   d. Return the augmented mmCIF for the caller to use
    //
    // We INTENTIONALLY do NOT write the modified mmCIF back to Coot via
    // replace_molecule_by_model_from_string — Coot's gemmi→mmdb conversion
    // strips _struct_conn at import time AND its mmCIF/PDB writers strip
    // LINK records at export time. The link survives only in this returned
    // text. Downstream callers (refmacat, save-to-disk, external refmac)
    // consume augmentedMmcif directly.
    const linkName = detected.entry.id;
    const sg = parseCid(request.sgCid);
    const cb = parseCid(request.cbCid);
    if (!sg || !cb) {
        return {
            success: false, entry: detected.entry, atomMap: detected.atomMap, cifText,
            linkDeclared: false, augmentedMmcif: null,
            message: `Could not parse atom CIDs: sg=${request.sgCid}, cb=${request.cbCid}. ` +
                `Expected //CHAIN/RESNO/ATOM format.`,
            error: "cid_parse_failed",
        };
    }

    let modelMmcif: string;
    try {
        const exportResponse = await commandCentre.cootCommand(
            {
                message: "coot_command",
                command: "molecule_to_mmCIF_string_with_gemmi",
                returnType: "string",
                commandArgs: [request.molNo],
            },
            false
        );
        modelMmcif = (exportResponse?.data?.result?.result as string) ?? "";
        if (!modelMmcif) {
            return {
                success: false, entry: detected.entry, atomMap: detected.atomMap, cifText,
                linkDeclared: false, augmentedMmcif: null,
                message: `molecule_to_mmCIF_string_with_gemmi returned empty — ` +
                    `can't perform _struct_conn surgery without the current model text.`,
                error: "model_export_failed",
            };
        }
    } catch (err) {
        return {
            success: false, entry: detected.entry, atomMap: detected.atomMap, cifText,
            linkDeclared: false, augmentedMmcif: null,
            message: `Failed to export current model as mmCIF: ${String(err)}`,
            error: "model_export_threw",
        };
    }

    const sgInfo = findAtomInModel(modelMmcif, sg);
    const cbInfo = findAtomInModel(modelMmcif, cb);
    if (!sgInfo) {
        return {
            success: false, entry: detected.entry, atomMap: detected.atomMap, cifText,
            linkDeclared: false, augmentedMmcif: null,
            message: `Cys SG atom ${request.sgCid} not found in model's atom_site loop.`,
            error: "sg_atom_not_found",
        };
    }
    if (!cbInfo) {
        return {
            success: false, entry: detected.entry, atomMap: detected.atomMap, cifText,
            linkDeclared: false, augmentedMmcif: null,
            message: `Ligand Cβ atom ${request.cbCid} not found in model's atom_site loop.`,
            error: "cb_atom_not_found",
        };
    }

    const augmentedMmcif = appendStructConnLoop(modelMmcif, {
        id: `pk_${linkName}_${sgInfo.auth_seq_id}_${cbInfo.auth_seq_id}`,
        conn_type_id: "covale",
        ptnr1: { ...sgInfo, atom: sg.atom },
        ptnr2: { ...cbInfo, atom: cb.atom },
        ccp4_link_id: linkName,
    });

    return {
        success: true,
        entry: detected.entry,
        atomMap: detected.atomMap,
        cifText,
        linkDeclared: true,
        augmentedMmcif,
        message: `Declared ${detected.entry.id} covalent link between ` +
            `${request.sgCid} and ${request.cbCid}. The augmented mmCIF (${augmentedMmcif.length} bytes) ` +
            `is in result.augmentedMmcif. Pass it to refmacat or save it to disk — ` +
            `Coot's in-WASM storage strips connection metadata, so the link survives ` +
            `only in this returned text.`,
    };
}

