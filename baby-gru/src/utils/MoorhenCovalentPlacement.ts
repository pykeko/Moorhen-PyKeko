// PyKeko covalent-ligand workflow — geometry seed for SMILES-time placement
//
// When the user enables "Form covalent bond to Cys SG" in the SMILES dialog,
// we want the new ligand to land somewhere sensible relative to the picked
// Cys — specifically, with its Cβ atom on the (Cys-CB → SG) axis extended,
// at the canonical post-reaction bond distance (1.78 Å for F2 vinyl-thioether
// sp2 Cβ, 1.81 Å for F1 saturated thioether sp3 Cβ). Without this seed,
// `get_monomer_and_position_at` drops the ligand at whatever the user picked
// from the "Place at..." dropdown (molecule centre / view centre / Fo-Fc
// peak), which is often nowhere near the Cys — they then have to hunt the
// ligand to find Cβ to click for the link declaration.
//
// Strategy: rather than translating after placement, we PRE-OFFSET the
// placement target. `get_monomer_and_position_at` places the centroid of
// the RDKit-generated 3D conformer at the given world coords; so if we
// pass `(target_Cβ - dict_internal_offset_from_centroid_to_Cβ)`, the
// centroid lands there and Cβ ends up exactly at target_Cβ. One-shot, no
// follow-up translate needed.
//
// Inputs needed:
//   - protein molecule (to read Cys CB + SG world coords)
//   - sgCid (the picked Cys SG short-form CID)
//   - ligand dict text (to read Cβ 3D coords and centroid)
//   - cbAtomName (the detector's atomMap.cb output — e.g. "C1" for ibrutinib)
//   - family ("F1" or "F2" — picks the canonical bond length)
//
// Output: world-space (x, y, z) to pass as placement for
// get_monomer_and_position_at. Returns null on any lookup failure; caller
// then falls back to the user's selected "Place at..." behaviour.

import { tokenizeMmcifRow } from "./MoorhenCovalentLinkSurgery";

export interface CovalentPlacementInput {
    proteinMolecule: any;
    sgCid: string;                          // "//A/481/SG"
    ligandDictText: string;
    lig: string;                            // ligand TLC, e.g. "IBR"
    cbAtomName: string;                     // "C1" / "C19" / etc.
    family: "F1" | "F2" | "F3" | "F4" | "F5" | "F6";
}

export interface CovalentPlacementResult {
    /** World-space (x, y, z) to pass to get_monomer_and_position_at. */
    placement: [number, number, number];
    /** Target Cβ world position the seed is solving for (for diagnostics). */
    targetCb: [number, number, number];
    /** Local-frame offset (centroid - Cβ) inside the dict (for diagnostics). */
    offset: [number, number, number];
}

/** Canonical post-reaction S–Cβ bond length, by warhead family.
 *  F2 (vinyl thioether, sp²): 1.78 Å.
 *  F1 (saturated acrylamide thioether, sp³): 1.81 Å.
 *  F3 (chloroacetamide SN2 product, sp³): 1.81 Å (same as F1).
 *  F4 (β-hydroxy thioether from epoxide opening, sp³): 1.81 Å.
 *  F5 (maleimide 3-thiosuccinimide, sp³): 1.81 Å.
 *  F6 (hemithioketal, sp³): 1.83 Å — slightly longer than other sp³
 *      thioethers due to the polar geminal -OH neighbour weakening
 *      the S-C bond.
 */
function bondLengthForFamily(family: "F1" | "F2" | "F3" | "F4" | "F5" | "F6"): number {
    if (family === "F2") return 1.78;
    if (family === "F6") return 1.83;
    return 1.81;
}

/**
 * Build the placement world coords that put the new ligand's Cβ atom on
 * the (Cys-CB → SG) axis extended past SG by the canonical S–Cβ bond
 * length. Returns null if any required atom can't be located.
 */
export async function seedCovalentPlacement(
    input: CovalentPlacementInput
): Promise<CovalentPlacementResult | null> {
    const { proteinMolecule, sgCid, ligandDictText, lig, cbAtomName, family } = input;

    // 1. Read Cys SG world coords from the picked CID.
    //    Cys CB lives in the same residue with atom_name "CB" — substitute
    //    SG → CB in the short-form CID to address it.
    const sgAtoms = await readWorldCoordsFromMolecule(proteinMolecule, sgCid);
    if (!sgAtoms) return null;
    const cbCid = sgCid.replace(/\/SG\s*$/i, "/CB");
    const cysCbAtoms = await readWorldCoordsFromMolecule(proteinMolecule, cbCid);
    if (!cysCbAtoms) return null;

    // 2. Compute the (CB → SG) unit vector and extend past SG by the
    //    canonical S–Cβ bond length to get the target Cβ position.
    const dx = sgAtoms[0] - cysCbAtoms[0];
    const dy = sgAtoms[1] - cysCbAtoms[1];
    const dz = sgAtoms[2] - cysCbAtoms[2];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < 0.5) {
        // Degenerate — CB and SG identical, the Cys residue must be missing
        // an atom. Bail rather than divide by ~0.
        return null;
    }
    const ux = dx / dist, uy = dy / dist, uz = dz / dist;
    const bondLen = bondLengthForFamily(family);
    const targetCb: [number, number, number] = [
        sgAtoms[0] + ux * bondLen,
        sgAtoms[1] + uy * bondLen,
        sgAtoms[2] + uz * bondLen,
    ];

    // 3. Read the ligand dict's atoms with 3D coords, compute the
    //    centroid - Cβ offset in the dict's local frame.
    const localGeom = readDictLocalGeometry(ligandDictText, lig, cbAtomName);
    if (!localGeom) return null;
    const { centroid, cb: cbLocal } = localGeom;
    const offset: [number, number, number] = [
        centroid[0] - cbLocal[0],
        centroid[1] - cbLocal[1],
        centroid[2] - cbLocal[2],
    ];

    // 4. Placement = target_Cβ + (centroid - Cβ). Centroid lands at
    //    placement; Cβ lands at placement - offset = target_Cβ.
    const placement: [number, number, number] = [
        targetCb[0] + offset[0],
        targetCb[1] + offset[1],
        targetCb[2] + offset[2],
    ];

    return { placement, targetCb, offset };
}

/**
 * Pull world-space coords for a single atom from a Moorhen molecule using
 * the existing gemmiAtomsForCid helper. Returns null if the CID resolves to
 * zero atoms or the call throws.
 */
async function readWorldCoordsFromMolecule(
    molecule: any,
    cid: string
): Promise<[number, number, number] | null> {
    try {
        const atoms = await molecule.gemmiAtomsForCid?.(cid);
        if (!atoms || atoms.length === 0) return null;
        const a = atoms[0];
        if (typeof a.x !== "number" || typeof a.y !== "number" || typeof a.z !== "number") return null;
        return [a.x, a.y, a.z];
    } catch (e) {
        console.warn(`[covalent-placement] gemmiAtomsForCid(${cid}) failed:`, e);
        return null;
    }
}

/**
 * Read a chem_comp dict's _chem_comp_atom loop, extract x/y/z coords for
 * every atom, compute the centroid (mean of all atoms with finite coords)
 * and the Cβ position. Returns null if cb atom isn't present or the loop
 * has no coord columns.
 *
 * Local helper rather than re-using `parseChemCompFromDict` because that
 * parser was scoped to name + element only — extending the public shape
 * for one consumer would have been more disruptive than this 30-liner.
 */
function readDictLocalGeometry(
    cifText: string,
    lig: string,
    cbAtomName: string
): { centroid: [number, number, number]; cb: [number, number, number] } | null {
    const blockRe = new RegExp(`(^|\\n)data_comp_${escapeRe(lig)}\\b`);
    const m = cifText.match(blockRe);
    if (!m) return null;
    const blockStart = (m.index ?? 0) + (m[1] ? 1 : 0);
    const nextRe = /(^|\n)data_/g;
    nextRe.lastIndex = blockStart + 1;
    const next = nextRe.exec(cifText);
    const blockEnd = next ? next.index + (next[1] ? 1 : 0) : cifText.length;
    const block = cifText.slice(blockStart, blockEnd);

    // Find the _chem_comp_atom loop.
    const loopRe = /loop_\s*\n((?:\s*_chem_comp_atom\.[A-Za-z0-9_]+\s*\n)+)/g;
    const lm = loopRe.exec(block);
    if (!lm) return null;
    const tags = lm[1]
        .split(/\s+/)
        .filter((t) => t.startsWith("_chem_comp_atom."))
        .map((t) => t.slice("_chem_comp_atom.".length));
    const idxName = tags.indexOf("atom_id");
    // Coot/RDKit dicts use x/y/z OR pdbx_model_Cartn_x_ideal (the "ideal"
    // coordinates from the RDKit 3D conformer). The plain x/y/z are the
    // CCP4 conventional fields and what we want when present.
    const idxX = pickCoordIdx(tags, ["x", "pdbx_model_Cartn_x_ideal"]);
    const idxY = pickCoordIdx(tags, ["y", "pdbx_model_Cartn_y_ideal"]);
    const idxZ = pickCoordIdx(tags, ["z", "pdbx_model_Cartn_z_ideal"]);
    if (idxName < 0 || idxX < 0 || idxY < 0 || idxZ < 0) return null;

    let sx = 0, sy = 0, sz = 0, n = 0;
    let cbHit: [number, number, number] | null = null;
    const rest = block.slice(lm.index + lm[0].length);
    for (const rawLine of rest.split("\n")) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        if (line.startsWith("_") || line.startsWith("loop_") || line.startsWith("data_")) break;
        const cols = tokenizeMmcifRow(line);
        if (cols.length < tags.length) continue;
        const x = parseFloat(cols[idxX]);
        const y = parseFloat(cols[idxY]);
        const z = parseFloat(cols[idxZ]);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
        sx += x; sy += y; sz += z; n++;
        if (cols[idxName] === cbAtomName) {
            cbHit = [x, y, z];
        }
    }
    if (n === 0 || !cbHit) return null;
    return { centroid: [sx / n, sy / n, sz / n], cb: cbHit };
}

function pickCoordIdx(tags: string[], names: string[]): number {
    for (const n of names) {
        const i = tags.indexOf(n);
        if (i >= 0) return i;
    }
    return -1;
}

function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
