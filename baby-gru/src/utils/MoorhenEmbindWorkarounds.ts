// JS-side replacements for PyKeko-added WASM bindings that silently fail to
// register at runtime due to the upstream embind silent-drop bug
// (see docs/embind-silent-drop-bug.md).
//
// Each function here mimics the API contract of the broken WASM binding so the
// JS call sites can swap in a one-line change. They rely only on pre-existing
// upstream-Moorhen bindings (`molecule_to_mmCIF_string_with_gemmi`,
// `replace_molecule_by_model_from_string`) which register correctly.

import { tokenizeMmcifRow } from "./MoorhenCovalentLinkSurgery";

interface CommandCentreLike {
    cootCommand(
        request: {
            command: string;
            commandArgs: unknown[];
            returnType: string;
            changesMolecules?: number[];
            message?: string;
        },
        promptToCancel: boolean,
    ): Promise<{ data: { result: { result: unknown } } }>;
}

// ===== get_torsion replacement =====

interface AtomCoord { x: number; y: number; z: number; }

/**
 * Find a specific atom by chain/seq/name and return its Cartn coords.
 * Parallel to findAtomInModel in MoorhenCovalentLinkSurgery but returns coords
 * instead of label_* identifiers.
 */
function findAtomCoordsInModel(
    mmcif: string,
    chain: string,
    resNo: number,
    atomName: string,
): AtomCoord | null {
    const target = atomName.trim();
    const re = /loop_\s*\n((?:\s*_atom_site\.[A-Za-z0-9_]+\s*\n)+)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(mmcif)) !== null) {
        const tags = match[1].split(/\s+/).filter(t => t.startsWith("_atom_site."));
        const idx = (col: string) => tags.indexOf(`_atom_site.${col}`);
        const iC = idx("auth_asym_id"), iS = idx("auth_seq_id"),
              iN = idx("label_atom_id"),
              iX = idx("Cartn_x"), iY = idx("Cartn_y"), iZ = idx("Cartn_z");
        if (iC < 0 || iS < 0 || iN < 0 || iX < 0 || iY < 0 || iZ < 0) continue;

        const rest = mmcif.substring(match.index + match[0].length);
        for (const rawLine of rest.split("\n")) {
            const line = rawLine.trim();
            if (!line || line.startsWith("#")) continue;
            if (line.startsWith("_") || line.startsWith("loop_") || line.startsWith("data_")) break;
            const cols = tokenizeMmcifRow(line);
            if (cols.length < tags.length) continue;
            if (cols[iC] === chain && parseInt(cols[iS], 10) === resNo && cols[iN] === target) {
                const x = parseFloat(cols[iX]), y = parseFloat(cols[iY]), z = parseFloat(cols[iZ]);
                if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) return null;
                return { x, y, z };
            }
        }
    }
    return null;
}

/** Vector ops for the torsion calc. */
const sub = (a: AtomCoord, b: AtomCoord): AtomCoord => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross = (a: AtomCoord, b: AtomCoord): AtomCoord => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
});
const dot = (a: AtomCoord, b: AtomCoord): number => a.x * b.x + a.y * b.y + a.z * b.z;
const norm = (a: AtomCoord): number => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);

/**
 * Dihedral angle (degrees) for the four atoms p1-p2-p3-p4 via the standard
 * cross-product formula.
 */
function dihedralDegrees(p1: AtomCoord, p2: AtomCoord, p3: AtomCoord, p4: AtomCoord): number {
    const b1 = sub(p2, p1), b2 = sub(p3, p2), b3 = sub(p4, p3);
    const n1 = cross(b1, b2), n2 = cross(b2, b3);
    const b2n = norm(b2);
    const m1 = cross(n1, { x: b2.x / b2n, y: b2.y / b2n, z: b2.z / b2n });
    return Math.atan2(dot(m1, n2), dot(n1, n2)) * 180 / Math.PI;
}

/**
 * JS-side replacement for the broken `get_torsion` WASM binding.
 *
 * @param mmcif current model mmCIF (from molecule_to_mmCIF_string_with_gemmi)
 * @param residueCid `//CHAIN/RESNO` (atom name ignored if present)
 * @param atomQuad four atom names, typically padded ` CA `-style — leading
 *                 and trailing spaces are trimmed automatically
 * @returns torsion in degrees, or null if any of the four atoms wasn't found
 */
export function getTorsionFromMmcif(
    mmcif: string,
    residueCid: string,
    atomQuad: string[],
): number | null {
    const m = /^\/\/([^/]+)\/(-?\d+)(?:\/.+)?$/.exec(residueCid.trim());
    if (!m || atomQuad.length !== 4) return null;
    const chain = m[1], resNo = parseInt(m[2], 10);
    const coords: AtomCoord[] = [];
    for (const an of atomQuad) {
        const c = findAtomCoordsInModel(mmcif, chain, resNo, an);
        if (!c) return null;
        coords.push(c);
    }
    return dihedralDegrees(coords[0], coords[1], coords[2], coords[3]);
}

/**
 * Convenience: fetch the model mmCIF and compute one torsion. Used by the
 * EditPhiPsi panel to replace the broken `get_torsion` cootCommand call.
 */
export async function getTorsionJs(
    commandCentre: CommandCentreLike,
    molNo: number,
    residueCid: string,
    atomQuad: string[],
): Promise<number | null> {
    const r: any = await commandCentre.cootCommand({
        returnType: "string",
        command: "molecule_to_mmCIF_string_with_gemmi",
        commandArgs: [molNo],
    }, false);
    const mmcif: string = r?.data?.result?.result || "";
    if (!mmcif) return null;
    return getTorsionFromMmcif(mmcif, residueCid, atomQuad);
}

// ===== add_water_at_position replacement =====

interface SolventChainInfo {
    chainId: string;
    highestSeqNum: number;
}

/**
 * Scan the model atom_site loop for the highest-seqNum HOH residue in any
 * solvent-only chain. If multiple solvent chains exist, picks the one with
 * the highest seqNum (matches the C++ impl's behavior). Returns null if no
 * HOH residues exist — caller should fall back to a generic chain id.
 */
function findSolventChain(mmcif: string): SolventChainInfo | null {
    const re = /loop_\s*\n((?:\s*_atom_site\.[A-Za-z0-9_]+\s*\n)+)/g;
    let match: RegExpExecArray | null;
    let best: SolventChainInfo | null = null;
    const chainResidues = new Map<string, Set<string>>();  // chain -> set of comp_ids
    const chainHohMax = new Map<string, number>();         // chain -> max HOH seqNum

    while ((match = re.exec(mmcif)) !== null) {
        const tags = match[1].split(/\s+/).filter(t => t.startsWith("_atom_site."));
        const idx = (c: string) => tags.indexOf(`_atom_site.${c}`);
        const iC = idx("auth_asym_id"), iS = idx("auth_seq_id"),
              iComp = idx("label_comp_id");
        if (iC < 0 || iS < 0 || iComp < 0) continue;

        const rest = mmcif.substring(match.index + match[0].length);
        for (const rawLine of rest.split("\n")) {
            const line = rawLine.trim();
            if (!line || line.startsWith("#")) continue;
            if (line.startsWith("_") || line.startsWith("loop_") || line.startsWith("data_")) break;
            const cols = tokenizeMmcifRow(line);
            if (cols.length < tags.length) continue;
            const chain = cols[iC], comp = cols[iComp];
            const seq = parseInt(cols[iS], 10);
            if (Number.isNaN(seq)) continue;
            if (!chainResidues.has(chain)) chainResidues.set(chain, new Set());
            chainResidues.get(chain)!.add(comp);
            if (comp === "HOH") {
                const cur = chainHohMax.get(chain) ?? -Infinity;
                if (seq > cur) chainHohMax.set(chain, seq);
            }
        }
    }
    // A solvent-only chain has just HOH (and maybe a few other waters like DOD)
    const solventOnly = new Set(["HOH", "DOD", "WAT", "H2O"]);
    for (const [chain, comps] of chainResidues.entries()) {
        const onlySolvent = [...comps].every(c => solventOnly.has(c));
        if (!onlySolvent) continue;
        const maxSeq = chainHohMax.get(chain) ?? 0;
        if (best === null || maxSeq > best.highestSeqNum) {
            best = { chainId: chain, highestSeqNum: maxSeq };
        }
    }
    return best;
}

/**
 * Find which atom_site loop in the mmCIF is the model's main one, and pull
 * the tag list (column names) so we can format an appended row matching that
 * loop's column order. Picks the FIRST atom_site loop encountered (Coot only
 * produces one).
 */
function readAtomSiteTags(mmcif: string): string[] | null {
    const m = /loop_\s*\n((?:\s*_atom_site\.[A-Za-z0-9_]+\s*\n)+)/.exec(mmcif);
    if (!m) return null;
    return m[1].split(/\s+/).filter(t => t.startsWith("_atom_site."));
}

/**
 * Build a fresh atom_site row matching the existing tag order. Unknown
 * columns get `.` (mmCIF null). Required-for-our-case fields are the
 * coordinates, comp_id/atom_id/auth_seq_id/auth_asym_id.
 */
function formatAtomSiteRow(tags: string[], fields: Record<string, string>): string {
    return tags.map(t => {
        const key = t.replace("_atom_site.", "");
        const v = fields[key];
        if (v === undefined || v === "") return ".";
        if (/[\s'"]/.test(v)) return `'${v.replace(/'/g, "''")}'`;
        return v;
    }).join(" ");
}

/**
 * Append a new HOH atom_site row to the model mmCIF. Insert just before the
 * next non-atom_site directive after the loop. If the loop is the last block
 * in the file, append at the end.
 */
function appendAtomSiteRow(mmcif: string, newRow: string): string {
    const m = /loop_\s*\n((?:\s*_atom_site\.[A-Za-z0-9_]+\s*\n)+)/.exec(mmcif);
    if (!m) return mmcif;
    const after = mmcif.substring(m.index + m[0].length);
    const lines = after.split("\n");
    let insertAt = lines.length;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line.startsWith("#")) continue;
        if (line.startsWith("_") || line.startsWith("loop_") || line.startsWith("data_")) {
            insertAt = i;
            break;
        }
    }
    lines.splice(insertAt, 0, newRow);
    return mmcif.substring(0, m.index + m[0].length) + lines.join("\n");
}

/**
 * Find the highest atom_site.id in the mmCIF (auto-increment seed for the
 * new water).
 */
function findMaxAtomId(mmcif: string): number {
    const re = /loop_\s*\n((?:\s*_atom_site\.[A-Za-z0-9_]+\s*\n)+)/g;
    let match: RegExpExecArray | null;
    let max = 0;
    while ((match = re.exec(mmcif)) !== null) {
        const tags = match[1].split(/\s+/).filter(t => t.startsWith("_atom_site."));
        const idI = tags.indexOf("_atom_site.id");
        if (idI < 0) continue;
        const rest = mmcif.substring(match.index + match[0].length);
        for (const rawLine of rest.split("\n")) {
            const line = rawLine.trim();
            if (!line || line.startsWith("#")) continue;
            if (line.startsWith("_") || line.startsWith("loop_") || line.startsWith("data_")) break;
            const cols = tokenizeMmcifRow(line);
            if (cols.length < tags.length) continue;
            const id = parseInt(cols[idI], 10);
            if (!Number.isNaN(id) && id > max) max = id;
        }
    }
    return max;
}

/**
 * JS-side replacement for the broken `add_water_at_position` WASM binding.
 * Returns the CID of the new water (matching the C++ impl's contract:
 * `/1/<chain>/<seqNum>`), or null if the surgery failed.
 *
 * Workflow:
 *  1. Export model as mmCIF
 *  2. Find the solvent chain + highest HOH seqNum (or pick chain "X" if no
 *     solvent chain exists)
 *  3. Append a new HETATM HOH row with the next seqNum and the requested coords
 *  4. Re-import via replace_molecule_by_model_from_string
 */
export async function addWaterAtPositionJs(
    commandCentre: CommandCentreLike,
    molNo: number,
    x: number, y: number, z: number,
): Promise<string | null> {
    const r: any = await commandCentre.cootCommand({
        returnType: "string",
        command: "molecule_to_mmCIF_string_with_gemmi",
        commandArgs: [molNo],
    }, false);
    const mmcif: string = r?.data?.result?.result || "";
    if (!mmcif) return null;

    const tags = readAtomSiteTags(mmcif);
    if (!tags) return null;

    const solvent = findSolventChain(mmcif);
    const chainId = solvent?.chainId ?? "X";
    const newSeq = (solvent?.highestSeqNum ?? 0) + 1;
    const newAtomId = findMaxAtomId(mmcif) + 1;

    const fmt = (v: number, decimals = 3) => {
        if (Number.isNaN(v) || !Number.isFinite(v)) return ".";
        return v.toFixed(decimals);
    };

    const fields: Record<string, string> = {
        group_PDB: "HETATM",
        id: String(newAtomId),
        type_symbol: "O",
        label_atom_id: "O",
        label_alt_id: ".",
        label_comp_id: "HOH",
        label_asym_id: ".",
        label_entity_id: ".",
        label_seq_id: ".",
        pdbx_PDB_ins_code: "?",
        Cartn_x: fmt(x),
        Cartn_y: fmt(y),
        Cartn_z: fmt(z),
        occupancy: "1",
        B_iso_or_equiv: fmt(20.0, 2),
        pdbx_formal_charge: "?",
        auth_seq_id: String(newSeq),
        auth_comp_id: "HOH",
        auth_asym_id: chainId,
        auth_atom_id: "O",
        pdbx_PDB_model_num: "1",
    };

    const newRow = formatAtomSiteRow(tags, fields);
    const modified = appendAtomSiteRow(mmcif, newRow);

    await commandCentre.cootCommand({
        returnType: "status",
        command: "replace_molecule_by_model_from_string",
        commandArgs: [molNo, modified],
        changesMolecules: [molNo],
    }, false);

    return `/1/${chainId}/${newSeq}`;
}

// === exported for unit tests ===
export const __testing = {
    findAtomCoordsInModel,
    dihedralDegrees,
    findSolventChain,
    readAtomSiteTags,
    formatAtomSiteRow,
    appendAtomSiteRow,
    findMaxAtomId,
};
