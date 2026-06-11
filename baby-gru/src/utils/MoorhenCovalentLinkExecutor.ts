// Shared end-to-end covalent-link declaration logic. Called by both:
//   - the right-click "Declare covalent link" context-menu button, and
//   - the new SMILES-time covalent attachment flow in the Ligand → From SMILES
//     dialog (post-merge).
//
// Inputs are kept minimal so either entry path can build them. The executor:
//   1. Fetches the link CIF + mod2 (using the registry entry the caller picked)
//   2. Loads the substituted link CIF into Coot's dictionary (so refmacat sees
//      the chem_link at refinement time)
//   3. Exports the current model as mmCIF
//   4. Resolves the label_* identifiers for both atoms
//   5. Appends a _struct_conn loop_ row pointing at both atoms
//   6. Triggers a browser download of the augmented mmCIF (the refmac handoff)
//   7. (Live-display) applies the mod2 to the in-memory ligand dict and reloads
//      via molecule.addDict + redraw — so the viewer reflects the post-reaction
//      bond orders (F2 alkyne→vinyl: C≡C→C=C, F1 alkene→saturated: C=C→C-C)
//      without waiting for a refmacat round-trip.
//
// The mod2 step is BEST-EFFORT: if the ligand's chem_comp dict isn't cached
// (rare — molecule.addDict caches whatever's loaded) or atom-name resolution
// fails, the executor logs and continues. The struct_conn surgery is what
// matters for refinement; live-display is a UX nicety.
//
// Why the right-click button doesn't just call this directly today (without
// the live-display piece): the previous button used user-typed CID + linkId
// without running the detector, so it lacked the atom-name map (Cα, Cγ, HCB,
// etc.) needed to substitute mod2 placeholders. This executor takes the dict
// CIF + cbIdx and runs the detector to fill the map.

import {
    buildSubstitutedLinkCif,
    CovLinkRegistryEntry,
    ensureRegistryLoaded,
    applyAtomMap,
    loadLinkCifTemplate,
} from "./MoorhenCovalentLinkLibrary";
import { detectWarheadFamily } from "./MoorhenCovalentLinkDetector";
import { parseChemCompFromDict } from "./MoorhenCovalentLinkDictParser";
import {
    parseCid,
    findAtomInModel,
    appendStructConnLoop,
    CidParts,
} from "./MoorhenCovalentLinkSurgery";
import {
    applyMod2ToLigandDict,
    parseMod2,
} from "./MoorhenCovalentLinkMod2Applier";

export interface CovalentLinkExecuteRequest {
    /** The Moorhen molecule containing BOTH Cys and ligand (post-merge). */
    molecule: any;
    /** Cys SG short-form CID, e.g. "//A/481/SG". */
    sgCid: string;
    /** Ligand atom short-form CID for the Cβ, e.g. "//A/801/C19". */
    cbCid: string;
    /** Registry entry id (CYS-YNA-post / CYS-ACR-pre / etc.). Picked by user
     * or auto-detected by caller. */
    linkId: string;
    /** Optional family hint for the detector when the alkene/vinyl bond-order
     * ambiguity comes up (caBondOrder === 2). Matches the user's dropdown pick. */
    preferFamily?: "F1" | "F2";
    /** URL prefix to MoorhenAssets/cov-links/. Used to fetch templates. */
    urlPrefix: string;
    /** Command centre for cootCommand calls. */
    commandCentre: any;
    /** Whether to trigger a browser download of the augmented mmCIF. */
    download: boolean;
    /** Filename for the download (ignored if download=false). */
    downloadName?: string;
}

export interface CovalentLinkExecuteResult {
    ok: boolean;
    /** Status message suitable for showing in a snackbar / status line. */
    message: string;
    /** Augmented mmCIF text on success (the refmac handoff). */
    augmentedMmcif?: string;
    /** Resolved label_* / auth_* info for both atoms on success. */
    sgInfo?: {
        label_asym_id: string;
        label_seq_id: string;
        label_comp_id: string;
        auth_asym_id: string;
        auth_seq_id: string;
    };
    cbInfo?: CovalentLinkExecuteResult["sgInfo"];
    /** Whether the live-display dict-update step ran successfully. False is
     * not a hard failure — the link is still declared, refmacat will work. */
    liveDisplayUpdated?: boolean;
}

/**
 * Run the full covalent-link declaration pipeline. See the module-level
 * comment for the step list.
 */
export async function executeCovalentLink(
    request: CovalentLinkExecuteRequest
): Promise<CovalentLinkExecuteResult> {
    const { molecule, sgCid, cbCid, linkId, preferFamily, urlPrefix, commandCentre, download, downloadName } = request;

    const sg = parseCid(sgCid);
    const cb = parseCid(cbCid.trim());
    if (!sg || !cb) {
        return { ok: false, message: `Atom CID parse failed: sg=${sgCid} cb=${cbCid}` };
    }

    // Look up the registry entry the caller picked.
    const registry = await ensureRegistryLoaded(`${urlPrefix}/cov-links`);
    const entry = registry.warheads.find((w) => w.id === linkId);
    if (!entry) {
        return { ok: false, message: `Unknown link template "${linkId}"` };
    }

    // Resolve the ligand TLC + cbIdx by inspecting the ligand's cached dict.
    // The dict is needed for two reasons: (a) building the placeholder atom
    // map for the link CIF, (b) computing the modified dict for live display.
    const ligTlc = await resolveLigandTlc(commandCentre, molecule, cb);
    if (!ligTlc) {
        return { ok: false, message: `Could not resolve ligand TLC for atom ${cbCid}` };
    }
    const ligandDict: string | undefined = molecule.ligandDicts?.[ligTlc];
    if (!ligandDict) {
        return { ok: false, message: `No chem_comp dict cached for ligand ${ligTlc}. Load the ligand via the SMILES dialog or Import dictionary before declaring the link.` };
    }
    const ligandGraph = parseChemCompFromDict(ligandDict, ligTlc);
    if (!ligandGraph) {
        return { ok: false, message: `Could not parse chem_comp for ${ligTlc} from cached dict` };
    }
    const cbIdx = ligandGraph.atoms.findIndex((a) => a.name === cb.atom);
    if (cbIdx < 0) {
        return { ok: false, message: `Cβ atom "${cb.atom}" not found in ligand ${ligTlc}'s chem_comp` };
    }
    const detected = await detectWarheadFamily(
        ligTlc,
        ligandGraph.atoms,
        ligandGraph.bonds,
        cbIdx,
        preferFamily ?? (entry.family as "F1" | "F2")
    );
    if (!detected) {
        return { ok: false, message: `Detector found no matching warhead family for ${ligTlc} at ${cb.atom}` };
    }
    // Warn if the detected entry disagrees with the user's pick — proceed
    // with the user's pick (they may know something the detector doesn't).
    if (detected.entry.id !== entry.id) {
        console.warn(
            `[covalent] detector wanted ${detected.entry.id} but user picked ${entry.id}; proceeding with user's pick`
        );
    }

    // 1+2. Fetch + load the substituted link CIF.
    let linkCifText: string;
    try {
        linkCifText = await buildSubstitutedLinkCif(entry, detected.atomMap, `${urlPrefix}/cov-links`);
    } catch (err: any) {
        return { ok: false, message: `Failed to build substituted link CIF: ${err?.message || err}` };
    }
    try {
        await commandCentre.current.cootCommand(
            {
                returnType: "status",
                command: "read_dictionary_string",
                commandArgs: [linkCifText, molecule.molNo],
                changesMolecules: [molecule.molNo],
            },
            false
        );
    } catch (err: any) {
        return { ok: false, message: `Loading link CIF into Coot failed: ${err?.message || err}` };
    }

    // 3. Export current model.
    const modelResp: any = await commandCentre.current.cootCommand(
        {
            returnType: "string",
            command: "molecule_to_mmCIF_string_with_gemmi",
            commandArgs: [molecule.molNo],
        },
        false
    );
    const modelMmcif: string = modelResp?.data?.result?.result || "";
    if (!modelMmcif) {
        return { ok: false, message: "Model export returned empty" };
    }

    // 4. Resolve atoms in the model.
    const sgInfo = findAtomInModel(modelMmcif, sg);
    if (!sgInfo) {
        return { ok: false, message: `Atom ${sgCid} not found in model atom_site loop` };
    }
    const cbInfo = findAtomInModel(modelMmcif, cb);
    if (!cbInfo) {
        return { ok: false, message: `Atom ${cbCid} not found in model atom_site loop` };
    }

    // 5. Append struct_conn row.
    const augmented = appendStructConnLoop(modelMmcif, {
        id: `pk_${linkId}_${sgInfo.auth_seq_id}_${cbInfo.auth_seq_id}`,
        conn_type_id: "covale",
        ptnr1: { ...sgInfo, atom: sg.atom },
        ptnr2: { ...cbInfo, atom: cb.atom },
        ccp4_link_id: linkId,
    });

    // 6. Trigger download (refmac handoff).
    if (download) {
        const safeName = downloadName
            ? downloadName.replace(/[^A-Za-z0-9_.-]/g, "_")
            : `${(molecule.name || "model").replace(/[^A-Za-z0-9_.-]/g, "_")}_covalent_${linkId}.cif`;
        const blob = new Blob([augmented], { type: "chemical/x-mmcif" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = safeName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    // 7. Live-display: apply mod2 to the ligand's chem_comp dict + reload + redraw.
    let liveDisplayUpdated = false;
    try {
        const mod2Source = entry.mod2_variant === "post"
            ? linkCifText  // the post-product mod2 is inline in the link CIF
            : await loadLinkCifTemplate(entry.mod2_cif!, `${urlPrefix}/cov-links`);
        // Substitute placeholders in the mod2 text (alkyne / alkene variants
        // came from a separate file that hasn't been substituted yet).
        const substitutedMod2 = applyAtomMap(mod2Source, detected.atomMap);
        const parsedMod2 = parseMod2(substitutedMod2);
        if (parsedMod2.atomOps.length === 0 && parsedMod2.bondOps.length === 0) {
            console.warn(`[covalent] mod2 for ${entry.id} parsed empty — no live-display update`);
        } else {
            const modifiedDict = applyMod2ToLigandDict(ligandDict, parsedMod2, ligTlc);
            await molecule.addDict(modifiedDict);
            await molecule.redraw();
            liveDisplayUpdated = true;
        }
    } catch (err: any) {
        // Non-fatal — log and continue. The link is still declared.
        console.warn(`[covalent] live-display mod2 update failed (non-fatal):`, err);
    }

    return {
        ok: true,
        message:
            `Declared ${linkId}: ${sgInfo.label_comp_id} ${sgInfo.auth_seq_id} ${sg.atom} → ` +
            `${cbInfo.label_comp_id} ${cbInfo.auth_seq_id} ${cb.atom}.` +
            (download ? " Augmented mmCIF downloaded — pass to refmac externally." : "") +
            (liveDisplayUpdated ? " Bond orders updated in viewer." : ""),
        augmentedMmcif: augmented,
        sgInfo,
        cbInfo,
        liveDisplayUpdated,
    };
}

/**
 * Resolve the 3-letter (or longer) component code for the ligand residue
 * containing the picked Cβ atom. Walks the molecule's atom data via Coot's
 * mmCIF export — no Moorhen-specific helpers needed.
 */
async function resolveLigandTlc(
    commandCentre: any,
    molecule: any,
    cb: CidParts
): Promise<string | null> {
    try {
        const resp: any = await commandCentre.current.cootCommand(
            {
                returnType: "string",
                command: "molecule_to_mmCIF_string_with_gemmi",
                commandArgs: [molecule.molNo],
            },
            false
        );
        const mmcif: string = resp?.data?.result?.result || "";
        if (!mmcif) return null;
        const atomInfo = findAtomInModel(mmcif, cb);
        return atomInfo?.label_comp_id ?? null;
    } catch (err) {
        console.warn("[covalent] resolveLigandTlc threw:", err);
        return null;
    }
}
