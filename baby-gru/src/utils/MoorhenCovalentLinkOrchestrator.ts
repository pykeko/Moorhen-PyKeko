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
//   5. Declares the covalent link via cootCommand("make_covalent_link_using_cids")
//
// The new bindings (make_covalent_link*, delete_covalent_link*) shipped in
// 5cb2c638; this code path will start working once the WASM is rebuilt
// with apply.sh applied. Until then the orchestrator can dry-run through
// steps 1-3 (detector + substitution) and report what it would have done.
//
// References:
//   ~/Moorhen/docs/covalent-ligand-plan.md §5 ("The architecture")
//   ./MoorhenCovalentLinkLibrary.ts (substitution)
//   ./MoorhenCovalentLinkDetector.ts (classification)
//   ~/Moorhen-dev/coot-patches/molecules-container-make-covalent-link.cc

import {
    buildSubstitutedLinkCif,
    LigandAtom,
    LigandBond,
    CovLinkAtomMap,
    CovLinkRegistryEntry,
} from "./MoorhenCovalentLinkLibrary";
import { detectWarheadFamily } from "./MoorhenCovalentLinkDetector";

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
    /** Optional plane-id of the ligand's amide plane (mod2 deletion target). */
    amidePlane?: string;
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
    /** True if the link was actually declared in the WASM (post-rebuild). */
    linkDeclared: boolean;
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
        request.cbIdx,
        request.amidePlane
    );
    if (!detected) {
        return {
            success: false,
            entry: null,
            atomMap: null,
            cifText: null,
            linkDeclared: false,
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
            message: `WASM rejected the link CIF: ${String(err)}`,
            error: "dictionary_load_threw",
        };
    }

    // Step 5: declare the link with make_covalent_link_using_cids
    const linkName = detected.entry.id; // informational; Refmac matches by chem
    try {
        const linkResponse = await commandCentre.cootCommand(
            {
                message: "coot_command",
                command: "make_covalent_link_using_cids",
                returnType: "status",
                commandArgs: [request.molNo, request.sgCid, request.cbCid, linkName],
                changesMolecules: [request.molNo],
            },
            false
        );
        const linkStatus = (linkResponse?.data?.result?.result as number) ?? 0;
        if (linkStatus === 1) {
            return {
                success: true,
                entry: detected.entry,
                atomMap: detected.atomMap,
                cifText,
                linkDeclared: true,
                message: `Declared ${detected.entry.id} covalent link between ` +
                    `${request.sgCid} and ${request.cbCid}. The link record will ` +
                    `be written to _struct_conn on next save, and refinement will ` +
                    `auto-pick-up the link restraints.`,
            };
        }
        return {
            success: false,
            entry: detected.entry,
            atomMap: detected.atomMap,
            cifText,
            linkDeclared: false,
            message: `make_covalent_link_using_cids returned ${linkStatus} — ` +
                `the WASM accepted the dictionary but couldn't apply the link. ` +
                `Common causes: atom CID resolution failure, atoms in different ` +
                `models, or the link binding hasn't been rebuilt yet ` +
                `(apply.sh + WASM rebuild required for the new binding to be live).`,
            error: "link_apply_failed",
        };
    } catch (err) {
        return {
            success: false,
            entry: detected.entry,
            atomMap: detected.atomMap,
            cifText,
            linkDeclared: false,
            message: `WASM rejected the make_covalent_link call: ${String(err)}. ` +
                `This may be because the make_covalent_link binding isn't yet ` +
                `available in the running WASM — apply.sh + rebuild required.`,
            error: "link_apply_threw",
        };
    }
}
