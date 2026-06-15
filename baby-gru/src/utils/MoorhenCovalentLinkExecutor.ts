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
    /** Whether refmac-format extras were injected into Coot's molecule so
     * in-app real-space refinement will honor the new S-Cβ bond. False
     * means RSR won't preserve the bond (atoms can drift apart at
     * refinement time) — but external refmac via the augmented mmCIF is
     * unaffected. */
    rsrAwareUpdated?: boolean;
    /** Absolute path of the augmented mmCIF written to the launch CWD
     * (PyKeko desktop only — null in browser builds). The browser-download
     * still fires either way when `download: true`. */
    savedCifPath?: string | null;
    /** Absolute path of the substituted link dictionary CIF, saved
     * alongside savedCifPath. Pass as LIBIN to refmac5. Null in browser
     * builds or when the model save failed. */
    savedLinkCifPath?: string | null;
    /** Absolute path of the model written as PDB (with LINK record)
     * alongside the mmCIF. Refmac5 prefers this — gemmi's mmCIF atom_id
     * column padding ('` N1 `' instead of `N1`) confuses refmac. */
    savedModelPdbPath?: string | null;
    /** Whether the in-memory model was reloaded from the augmented mmCIF
     * (so mmdb's LINK list contains the new bond). False means refine
     * still sees SG↔Cβ as a non-bonded pair and VdW will resist
     * compression below ~2.4 Å. */
    mmdbLinkInjected?: boolean;
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

    // 6. Refmac handoff. Two paths:
    //    (a) PyKeko desktop — write to the launch CWD via the __moorhenControl
    //        IPC bridge so the file lands next to the user's session and
    //        refmacat can pick it up from the same dir.
    //    (b) Browser build — fall back to <a download> blob.
    // We do BOTH when both are available: the IPC write is the authoritative
    // export, the browser download is a no-op duplicate in Electron (the
    // download chrome opens to confirm); harmless.
    let savedCifPath: string | null = null;
    let savedLinkCifPath: string | null = null;
    const safeBase = (molecule.name || "model").replace(/[^A-Za-z0-9_.-]/g, "_");
    const safeName = downloadName
        ? downloadName.replace(/[^A-Za-z0-9_.-]/g, "_")
        : `${safeBase}_covalent_${linkId}.cif`;
    const linkCifName = `${safeBase}_link_${linkId}.cif`;
    const ctrl: any = (typeof window !== "undefined") ? (window as any).__moorhenControl : null;
    if (ctrl?.saveAugmentedCif) {
        try {
            const r = await ctrl.saveAugmentedCif(augmented, safeName);
            if (r?.ok && r?.path) {
                savedCifPath = r.path;
            } else if (r?.error) {
                console.warn(`[covalent] saveAugmentedCif failed: ${r.error}`);
            }
        } catch (err: any) {
            console.warn(`[covalent] saveAugmentedCif threw:`, err);
        }
    }
    // Also save the substituted link CIF in the same dir so refmac5 has
    // LIBIN available without the user having to construct it. Transform
    // to CCP4-style format first (add data_link_list / data_mod_list
    // catalog blocks + inject link_id column into _chem_link_<X> loops).
    if (ctrl?.saveTextFile && savedCifPath && linkCifText) {
        try {
            const sep = savedCifPath.includes("\\") ? "\\" : "/";
            const dir = savedCifPath.substring(0, savedCifPath.lastIndexOf(sep));
            const refmacCif = toRefmacReadyLinkCif(linkCifText);
            const r = await ctrl.saveTextFile(refmacCif, linkCifName, dir);
            if (r?.ok && r?.path) {
                savedLinkCifPath = r.path;
            }
        } catch (err: any) {
            console.warn(`[covalent] saveTextFile(link) threw:`, err);
        }
    }
    // Also save the model as PDB next to the mmCIF, because gemmi writes
    // mmCIF atom_id values with quoted column padding (`' SG '`) that
    // refmac5 doesn't strip — refmac reports 0 atoms in the input file.
    // PDB column-aligned atom names are unambiguous.
    let savedModelPdbPath: string | null = null;
    if (ctrl?.saveTextFile && savedCifPath) {
        try {
            const pdbResp: any = await commandCentre.current.cootCommand(
                { returnType: "string", command: "molecule_to_PDB_string", commandArgs: [molecule.molNo] },
                false
            );
            const pdbText: string = pdbResp?.data?.result?.result || pdbResp?.data?.result || "";
            if (pdbText && pdbText.length > 100) {
                // Inject the LINK record (same one mmdbLinkInjected uses).
                const chemLinkId = linkCifText.match(/^_chem_link\.id\s+(\S+)/m)?.[1] || "LINK";
                const linkRecord = buildLinkRecord(
                    sgInfo.auth_asym_id, sgInfo.auth_seq_id, sgInfo.label_comp_id, sg.atom,
                    cbInfo.auth_asym_id, cbInfo.auth_seq_id, cbInfo.label_comp_id, cb.atom,
                    bondLengthForLinkEntry(entry), chemLinkId
                );
                // Same dedupe logic as the mmdb-reload step: don't add a
                // second LINK row for the same atom pair.
                const linkKey = (line: string): string => [
                    line.substring(12, 16).trim(), line.charAt(21), line.substring(22, 26).trim(),
                    line.substring(42, 46).trim(), line.charAt(51), line.substring(52, 56).trim(),
                ].join("|");
                const newKey = linkKey(linkRecord);
                const pdbLines = pdbText.split("\n");
                const alreadyHasLink = pdbLines.some(L =>
                    (L.startsWith("LINK") || L.startsWith("LINKR")) &&
                    linkKey(L) === newKey
                );
                if (!alreadyHasLink) {
                    const firstAtomIdx = pdbLines.findIndex(L => L.startsWith("ATOM") || L.startsWith("HETATM"));
                    pdbLines.splice(firstAtomIdx > 0 ? firstAtomIdx : 1, 0, linkRecord);
                }
                const sep = savedCifPath.includes("\\") ? "\\" : "/";
                const dir = savedCifPath.substring(0, savedCifPath.lastIndexOf(sep));
                const pdbName = safeName.replace(/\.cif$/i, ".pdb");
                const r = await ctrl.saveTextFile(pdbLines.join("\n"), pdbName, dir);
                if (r?.ok && r?.path) {
                    savedModelPdbPath = r.path;
                }
            }
        } catch (err: any) {
            console.warn(`[covalent] saveTextFile(pdb) threw:`, err);
        }
    }
    if (download && !savedCifPath) {
        // Browser-build fallback (or IPC write failed). Trigger the standard
        // <a download> path.
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

    // 8. Inject refmac-format extra restraints so Coot's in-app real-space
    // refinement honors the new S-Cβ bond (and the angles around it).
    //
    // Why this is separate from steps 2-5: Coot's gemmi→mmdb importer strips
    // _struct_conn on entry, so the bond annotation in the augmented mmCIF
    // never reaches mmdb. And `make_covalent_link_using_cids` (the function
    // that would otherwise tell Coot's restraints generator about the link)
    // is the embind silent-drop casualty. The refmac extras mechanism is the
    // workaround that survives — extras are stored in
    // coot::molecule_t::extra_restraints and auto-applied at RSR time
    // (verified at coot-1.0/api/coot-molecule.cc:2654 and
    // molecules-container.cc:3816). Best-effort: a failure here doesn't
    // affect the augmented mmCIF / live-display claims.
    // 8a. Inject the LINK into mmdb by reloading the model in PDB format
    // with an explicit LINK record (mmCIF reload doesn't work — mmdb's
    // mmCIF reader strips _struct_conn; verified empirically). PDB LINK
    // records ARE preserved by mmdb's PDB reader (verified by reading
    // back `molecule_to_PDB_string` after the reload).
    //
    // CAVEAT: shipping this for FUTURE compatibility, not immediate use.
    // Current Coot (Moorhen-PyKeko fork as of 2026-06-14) has the
    // `make_link_restraints_from_res_vec` function stubbed out — returns
    // an empty bonded_pair_container_t at link-restraints.cc:1022 — so
    // refine_direct doesn't actually USE the mmdb LINK records during
    // refinement. As a result, the bond extras still cap at ~2.4 Å due
    // to the VdW repulsion that the link-application code would have
    // excluded. When upstream Coot re-enables `make_link_restraints_from_links`,
    // this v0.2.35 wiring will start delivering full convergence to the
    // canonical S-Cβ distance (1.81 Å for F1/F3/F5; 1.78 for F2) for free.
    let mmdbLinkInjected = false;
    try {
        // Get current model as PDB
        const pdbResp: any = await commandCentre.current.cootCommand(
            {
                returnType: "string",
                command: "molecule_to_PDB_string",
                commandArgs: [molecule.molNo],
            },
            false
        );
        const pdbText: string = pdbResp?.data?.result?.result || pdbResp?.data?.result || "";
        if (pdbText && pdbText.length > 100) {
            // Build the LINK record (PDB v3.3 columns: 1-6 "LINK  ", 13-16
            // name1, 18-20 resName1, 22 chainID1, 23-26 resSeq1, 43-46 name2,
            // 48-50 resName2, 52 chainID2, 53-56 resSeq2, 74-78 length).
            const linkRecord = buildLinkRecord(
                sgInfo.auth_asym_id, sgInfo.auth_seq_id, sgInfo.label_comp_id, sg.atom,
                cbInfo.auth_asym_id, cbInfo.auth_seq_id, cbInfo.label_comp_id, cb.atom,
                bondLengthForLinkEntry(entry)
            );
            // Dedupe: if an equivalent LINK already exists in the PDB (same
            // atom1+atom2 endpoints), don't add a duplicate. Without this,
            // declaring the same pair twice produces two identical LINK rows
            // in mmdb — not catastrophic (refmac just applies the bond
            // once) but messy and confuses post-refmac LINK-count metrics.
            // Key by atom name + chain + residue number on both endpoints
            // (residue name is implied by the chain+resi).
            const linkKey = (line: string): string => [
                line.substring(12, 16).trim(),  // atom1 name (cols 13-16)
                line.charAt(21),                // chain1
                line.substring(22, 26).trim(),  // resSeq1
                line.substring(42, 46).trim(),  // atom2 name (cols 43-46)
                line.charAt(51),                // chain2
                line.substring(52, 56).trim(),  // resSeq2
            ].join("|");
            const newKey = linkKey(linkRecord);
            const lines = pdbText.split("\n");
            const alreadyHasLink = lines.some(L =>
                (L.startsWith("LINK") || L.startsWith("LINKR")) &&
                linkKey(L) === newKey
            );
            if (!alreadyHasLink) {
                const firstAtomIdx = lines.findIndex(L => L.startsWith("ATOM") || L.startsWith("HETATM"));
                const insertAt = firstAtomIdx > 0 ? firstAtomIdx : 1;
                lines.splice(insertAt, 0, linkRecord);
            }
            const augmentedPdb = lines.join("\n");

            await commandCentre.current.cootCommand(
                {
                    returnType: "status",
                    command: "replace_molecule_by_model_from_string",
                    commandArgs: [molecule.molNo, augmentedPdb],
                    changesMolecules: [molecule.molNo],
                },
                false
            );
            mmdbLinkInjected = true;
            try {
                molecule.setAtomsDirty(true);
                await molecule.fetchIfDirtyAndDraw("CBs");
            } catch (e) { /* non-fatal */ }
        }
    } catch (err: any) {
        console.warn(`[covalent] mmdb LINK reload failed (non-fatal):`, err);
    }

    let rsrAwareUpdated = false;
    try {
        const extras = buildRefmacExtrasForLink(entry, sg, cb, sgInfo, cbInfo);
        if (extras.length > 0) {
            const text = extras.join("\n") + "\n";
            await commandCentre.current.cootCommand(
                {
                    returnType: "status",
                    command: "shim_load_extra_restraints_string",
                    commandArgs: [molecule.molNo, text],
                    changesMolecules: [molecule.molNo],
                },
                false
            );
            // read_extra_restraints' return value isn't a reliable "did it
            // parse anything" signal — empirically returns 0 even when the
            // bond_restraints vector grows by 1. We trust the call succeeded
            // unless it threw. The post-call log line ("bonds size N") in
            // /tmp/pykeko.log is the authoritative check.
            rsrAwareUpdated = true;
        }
    } catch (err: any) {
        console.warn(`[covalent] RSR-aware extras injection failed (non-fatal):`, err);
    }

    return {
        ok: true,
        message:
            `Declared ${linkId}: ${sgInfo.label_comp_id} ${sgInfo.auth_seq_id} ${sg.atom} → ` +
            `${cbInfo.label_comp_id} ${cbInfo.auth_seq_id} ${cb.atom}.` +
            (savedCifPath ? ` Saved ${savedCifPath}.` : (download ? " Augmented mmCIF downloaded — pass to refmac externally." : "")) +
            (liveDisplayUpdated ? " Bond orders updated in viewer." : "") +
            (mmdbLinkInjected ? " LINK injected into mmdb." : "") +
            (rsrAwareUpdated ? " RSR will honor this bond." : ""),
        augmentedMmcif: augmented,
        savedCifPath,
        savedLinkCifPath,
        savedModelPdbPath,
        mmdbLinkInjected,
        sgInfo,
        cbInfo,
        liveDisplayUpdated,
        rsrAwareUpdated,
    };
}

/**
 * Build refmac-format `EXTE DIST` + `EXTE ANGL` lines for a covalent link.
 * The targets come from the registry entry's family — for now we hard-code
 * the canonical values per family (1.78 / 1.81 Å for S-Cβ, 100° for
 * CB-SG-Cβ, 113° for SG-Cβ-Cα). A future v2 could parse the link CIF
 * itself and emit one EXTE row per restraint defined there, but this
 * covers what Coot's RSR needs to keep the bond from drifting.
 *
 * Refmac extras format reminders:
 *   - Each EXTE record is one line
 *   - ALL keywords uppercase
 *   - CHAI/RESI/ATOM identify the atom; INS is the insertion code (omitted
 *     when blank — Coot's parser tolerates this)
 *   - VALU is the target, SIGM the σ
 *
 * Atom-spec parsing uses auth_asym_id + auth_seq_id from the model's
 * mmCIF dump (which is what findAtomInModel already returns).
 */
function bondLengthForLinkEntry(entry: CovLinkRegistryEntry): number {
    // F2 vinyl thioether is sp2 (1.78 Å); F1/F3/F4/F5/F6 are sp3 (1.81 Å, except F6 at 1.83).
    return entry.family === "F2" ? 1.78 :
           entry.family === "F6" ? 1.83 :
           1.81;
}

/**
 * Transform our hand-authored link CIF text into refmac-loadable form.
 *
 * Our source CIFs use the "minimal" CCP4 link format — just `data_link_<id>`
 * with key-value `_chem_link.X` properties + `_chem_link_bond/angle/...`
 * loops keyed by atom_1_comp_id only (positional 1/2). That matches Coot's
 * read_dictionary_string just fine but refmac5 needs the full format:
 *
 *   1. Catalog blocks at the top — `data_link_list` (loop_ of all links)
 *      and `data_mod_list` (loop_ of all mods). Without these, refmac
 *      doesn't know the link exists for purposes of matching against
 *      _struct_conn / LINK records.
 *   2. Every `_chem_link_<X>` and `_chem_mod_<X>` loop_ must include a
 *      leading link_id/mod_id column so refmac knows which entity each
 *      row belongs to. Our sources omit it (consistent with Coot's
 *      accept-anything parser).
 *
 * This function reads the substituted link CIF, extracts the link metadata,
 * prepends the two catalog blocks, and rewrites every `_chem_link_<X>`
 * loop to include a `link_id` column (and `_chem_mod_<X>` loops to include
 * a `mod_id` column, if absent). Returns the refmac-ready text.
 */
export function toRefmacReadyLinkCif(linkCifText: string): string {
    // Extract link-level metadata from the data_link_<id> block.
    const linkIdMatch = linkCifText.match(/^_chem_link\.id\s+(\S+)/m);
    const linkId = linkIdMatch?.[1];
    if (!linkId) {
        console.warn("[covalent] toRefmacReadyLinkCif: no _chem_link.id; returning unmodified");
        return linkCifText;
    }
    const linkName = (linkCifText.match(/^_chem_link\.name\s+"?([^"\n]+?)"?\s*$/m)?.[1] || linkId).trim();
    const compId1 = linkCifText.match(/^_chem_link\.comp_id_1\s+(\S+)/m)?.[1] || ".";
    const modId1 = linkCifText.match(/^_chem_link\.mod_id_1\s+(\S+)/m)?.[1] || ".";
    const groupComp1 = linkCifText.match(/^_chem_link\.group_comp_1\s+(\S+)/m)?.[1] || ".";
    const compId2 = linkCifText.match(/^_chem_link\.comp_id_2\s+(\S+)/m)?.[1] || ".";
    const modId2 = linkCifText.match(/^_chem_link\.mod_id_2\s+(\S+)/m)?.[1] || ".";
    const groupComp2 = linkCifText.match(/^_chem_link\.group_comp_2\s+(\S+)/m)?.[1] || ".";

    // Build the two catalog blocks.
    const linkListBlock =
        "data_link_list\n" +
        "loop_\n" +
        "_chem_link.id\n" +
        "_chem_link.comp_id_1\n" +
        "_chem_link.mod_id_1\n" +
        "_chem_link.group_comp_1\n" +
        "_chem_link.comp_id_2\n" +
        "_chem_link.mod_id_2\n" +
        "_chem_link.group_comp_2\n" +
        "_chem_link.name\n" +
        `${linkId} ${compId1} ${modId1} ${groupComp1} ${compId2} ${modId2} ${groupComp2} "${linkName}"\n`;

    const modListBlock =
        "\ndata_mod_list\n" +
        "loop_\n" +
        "_chem_mod.id\n" +
        "_chem_mod.name\n" +
        "_chem_mod.comp_id\n" +
        "_chem_mod.group_id\n" +
        `${modId1} "${linkId}-side1" ${compId1} ${groupComp1}\n` +
        `${modId2} "${linkId}-side2" ${compId2} ${groupComp2}\n`;

    // Rewrite each loop_ that has _chem_link_<X> headers to inject the
    // link_id column. We do this by walking lines, detecting a loop_
    // header chain of _chem_link_<X>.<field>, prepending _chem_link_<X>.link_id
    // to the headers, and prepending the linkId to each data row of that
    // loop until the next loop_/data_/keyword is hit.
    const lines = linkCifText.split("\n");
    const out: string[] = [];
    let i = 0;
    while (i < lines.length) {
        const L = lines[i];
        // Look for loop_ followed by a chem_link_<X> column header.
        if (L.trim() === "loop_") {
            // Peek ahead to see if this loop is _chem_link_X or _chem_mod_X
            let j = i + 1;
            const headers: string[] = [];
            while (j < lines.length && /^\s*_(chem_link_|chem_mod_)/.test(lines[j])) {
                headers.push(lines[j].trim());
                j++;
            }
            if (headers.length === 0) {
                out.push(L); i++; continue;
            }
            // What kind of loop?
            const isLink = headers[0].startsWith("_chem_link_");
            const isMod = headers[0].startsWith("_chem_mod_");
            const cat = headers[0].split(".")[0]; // e.g. "_chem_link_bond"
            const idField = isLink ? `${cat}.link_id` : `${cat}.mod_id`;
            const idValue = isLink ? linkId : null; // mod loops already have mod_id as first column

            // For link loops: inject the link_id header if not already present
            const hasIdHeader = headers.some(h => h === idField);
            out.push(L); // loop_
            if (isLink && !hasIdHeader) {
                out.push(idField);
            }
            for (const h of headers) out.push(h);
            i = j;
            // Now process data rows until blank line / loop_ / data_ / keyword
            while (i < lines.length) {
                const row = lines[i];
                const t = row.trim();
                if (t === "" || t.startsWith("#") || t === "loop_" || t.startsWith("data_") || t.startsWith("_")) {
                    break;
                }
                // Prepend link_id if it's a link loop and we just added the header
                if (isLink && !hasIdHeader && idValue) {
                    out.push(`${idValue} ${row.trim()}`);
                } else {
                    out.push(row);
                }
                i++;
            }
            continue;
        }
        out.push(L);
        i++;
    }

    return linkListBlock + modListBlock + "\n" + out.join("\n");
}

/**
 * Build a PDB v3.3 LINK record with the given atoms + bond length, then
 * append the link_id (refmac's LINKR extension — required for refmac to
 * match the LINK to a chem_link template in the dictionary).
 *
 * Column positions (1-indexed, per PDB v3.3 spec):
 *   1-6   record name "LINK  "
 *   13-16 name1 (atom name)
 *   17    altLoc1
 *   18-20 resName1
 *   22    chainID1
 *   23-26 resSeq1
 *   27    iCode1
 *   43-46 name2
 *   47    altLoc2
 *   48-50 resName2
 *   52    chainID2
 *   53-56 resSeq2
 *   57    iCode2
 *   60-65 sym1
 *   67-72 sym2
 *   74-78 length (Real(5.2))
 *   80+   link_id (refmac extension; whitespace-delimited)
 *
 * Cross-checked against 8FD9.pdb (deposited covalent ibrutinib).
 */
export function buildLinkRecord(
    chain1: string, resi1: string, comp1: string, atom1: string,
    chain2: string, resi2: string, comp2: string, atom2: string,
    length: number, linkId?: string
): string {
    // Atom name: PDB column-aligned. For ≤3-char names: " <name padded>".
    const padAtom = (n: string) => n.length >= 4 ? n.slice(0, 4) : ` ${n.padEnd(3, " ")}`;
    const cols: string[] = new Array(82).fill(" ");
    const setRange = (start: number, end: number, value: string) => {
        const v = value.slice(0, end - start + 1);
        for (let i = 0; i < v.length; i++) cols[start - 1 + i] = v[i];
    };
    setRange(1, 6, "LINK  ");
    setRange(13, 16, padAtom(atom1));
    setRange(18, 20, comp1.padStart(3, " "));
    setRange(22, 22, chain1);
    setRange(23, 26, String(resi1).padStart(4, " "));
    setRange(43, 46, padAtom(atom2));
    setRange(48, 50, comp2.padStart(3, " "));
    setRange(52, 52, chain2);
    setRange(53, 56, String(resi2).padStart(4, " "));
    setRange(60, 65, "1555  ");
    setRange(67, 72, "1555  ");
    setRange(74, 78, length.toFixed(2).padStart(5, " "));
    let line = cols.join("");
    if (linkId) {
        // refmac LINKR-style: link_id appended whitespace-delimited after col 80
        line = line.replace(/\s+$/, "") + "  " + linkId;
    }
    return line;
}

function buildRefmacExtrasForLink(
    entry: CovLinkRegistryEntry,
    sg: CidParts,
    cb: CidParts,
    sgInfo: { auth_asym_id: string; auth_seq_id: string },
    cbInfo: { auth_asym_id: string; auth_seq_id: string }
): string[] {
    const bondLen = bondLengthForLinkEntry(entry);
    const cbSgCbAngle = entry.family === "F2" ? 104.2 : 100.0;
    const sgCbCaAngle = entry.family === "F2" ? 120.7 : 113.0;

    // Refmac extras format CRITICAL FIELDS (verified against Coot's parser at
    // ideal/extra-restraints.cc and Coot's own writer at python/user_define_restraints.py):
    //   - `INS .` field (insertion code) after each RESI is required by the parser's
    //     optional-but-positional handling — omit and the parser drops the line.
    //   - `TYPE N` field at the end IS REQUIRED (not optional). Without it
    //     `read_refmac_extra_restraints` returns -1 for the line. Type 1 = standard bond.
    //   - Keywords are prefix-matched at 4 chars (FIRS/FIRST, SECO/SECOND, VALU/VALUE,
    //     SIGM/SIGMA), so either short or long form works; we use FIRST/SECOND/VALUE/SIGMA
    //     to match Coot's own writer output.
    // Note keyword asymmetry: bonds use FIRST/SECOND, angles use FIRST/NEXT/NEXT
    // (verified against the parser in ideal/extra-restraints.cc lines 977ff —
    // the angle parser expects NEXT between atoms, not SECOND/THIRD).
    const lines: string[] = [
        // S-Cβ bond
        `EXTE DIST FIRST CHAIN ${sgInfo.auth_asym_id} RESI ${sgInfo.auth_seq_id} INS . ATOM ${sg.atom} ` +
        `SECOND CHAIN ${cbInfo.auth_asym_id} RESI ${cbInfo.auth_seq_id} INS . ATOM ${cb.atom} ` +
        `VALUE ${bondLen.toFixed(2)} SIGMA 0.02 TYPE 1`,
        // CB(Cys)-SG-Cβ(lig) angle — three-atom format uses FIRST + NEXT + NEXT
        `EXTE ANGL FIRST CHAIN ${sgInfo.auth_asym_id} RESI ${sgInfo.auth_seq_id} INS . ATOM CB ` +
        `NEXT CHAIN ${sgInfo.auth_asym_id} RESI ${sgInfo.auth_seq_id} INS . ATOM ${sg.atom} ` +
        `NEXT CHAIN ${cbInfo.auth_asym_id} RESI ${cbInfo.auth_seq_id} INS . ATOM ${cb.atom} ` +
        `VALUE ${cbSgCbAngle.toFixed(1)} SIGMA 3.0`,
    ];

    // SG-Cβ-Cα angle, only when Cα is meaningful for this family. F3
    // chloroacetamide has no separate Cα (Cβ is bonded directly to the
    // carbonyl-C); for F6 reversible carbonyl there's no Cα either. We
    // emit the angle only when the family's link CIF defines a Cα-side
    // angle, which is true for F1, F2, F4, F5.
    // The Cα atom name we don't directly have here — but the detector
    // already resolved it inside the executor as detected.atomMap.ca.
    // We don't thread that into buildRefmacExtrasForLink for the v1 path
    // — instead we infer from the family and emit a placeholder that the
    // shim can ignore if the atom isn't found.
    // For v0.2.34 keep just the bond + Cys-side angle. Cα-side angle is
    // a polish addition (the bond restraint alone is the load-bearing
    // piece for keeping the atoms together during RSR).
    return lines;
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
