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

// ===== set_phi_psi replacement =====
//
// Backbone phi/psi editor. Mirrors molecules-container-set-phi-psi.cc:
//   phi (axis N->CA): rotate residue i's C-side atoms (everything except the
//                     amide N and any H bonded to N). C(i)-N(i+1) stretches.
//   psi (axis CA->C): rotate residue i's carbonyl O + OXT, AND residue i+1's
//                     amide N (+H). CA(i+1) onward stays put, N(i+1)-CA(i+1)
//                     stretches.

const AMIDE_NAMES = new Set([
    "N", "H", "HN", "H1", "H2", "H3", "D", "D1", "D2", "D3",
]);

interface AtomSiteParsed {
    tags: string[];
    rows: string[][];
    iChain: number;
    iSeq: number;
    iAtom: number;
    iX: number;
    iY: number;
    iZ: number;
    loopStart: number;     // start of "loop_\n"
    headerEnd: number;     // end of tag block (where rows begin)
    rowsEnd: number;       // index in mmcif where rows end (next directive starts)
}

/**
 * Parse the first atom_site loop in the mmCIF into structured rows so we can
 * mutate coords in place. Returns null if no atom_site loop is found or if
 * required columns are missing.
 */
function parseAtomSiteLoop(mmcif: string): AtomSiteParsed | null {
    const m = /loop_\s*\n((?:\s*_atom_site\.[A-Za-z0-9_]+\s*\n)+)/.exec(mmcif);
    if (!m) return null;
    const tags = m[1].split(/\s+/).filter(t => t.startsWith("_atom_site."));
    const idx = (c: string) => tags.indexOf(`_atom_site.${c}`);
    const iChain = idx("auth_asym_id"), iSeq = idx("auth_seq_id"),
          iAtom = idx("label_atom_id"),
          iX = idx("Cartn_x"), iY = idx("Cartn_y"), iZ = idx("Cartn_z");
    if (iChain < 0 || iSeq < 0 || iAtom < 0 || iX < 0 || iY < 0 || iZ < 0) return null;

    const loopStart = m.index;
    const headerEnd = m.index + m[0].length;
    const rest = mmcif.substring(headerEnd);
    const rows: string[][] = [];
    let scanPos = 0;
    const lines = rest.split("\n");
    let rowsEndOffset = rest.length;
    for (let li = 0; li < lines.length; li++) {
        const raw = lines[li];
        const line = raw.trim();
        scanPos += raw.length + 1;
        if (!line || line.startsWith("#")) continue;
        if (line.startsWith("_") || line.startsWith("loop_") || line.startsWith("data_")) {
            // The current line is the start of the next directive
            rowsEndOffset = scanPos - raw.length - 1;
            break;
        }
        const cols = tokenizeMmcifRow(line);
        if (cols.length < tags.length) continue;
        rows.push(cols);
    }
    const rowsEnd = headerEnd + rowsEndOffset;
    return { tags, rows, iChain, iSeq, iAtom, iX, iY, iZ, loopStart, headerEnd, rowsEnd };
}

function emitAtomSiteLoop(mmcif: string, parsed: AtomSiteParsed): string {
    const header = mmcif.substring(parsed.loopStart, parsed.headerEnd);
    const rowText = parsed.rows.map(r =>
        r.map(v => {
            if (v === "" || v == null) return ".";
            if (/[\s'"]/.test(v)) return `'${v.replace(/'/g, "''")}'`;
            return v;
        }).join(" ")
    ).join("\n");
    return mmcif.substring(0, parsed.loopStart) + header + rowText + "\n" +
           mmcif.substring(parsed.rowsEnd);
}

/** Rodrigues rotation: rotate a vector v (relative to origin) about a unit
 *  axis by angle theta (radians). */
function rotateAroundAxis(v: AtomCoord, axis: AtomCoord, theta: number): AtomCoord {
    const c = Math.cos(theta), s = Math.sin(theta);
    const d = dot(axis, v);
    const cr = cross(axis, v);
    return {
        x: v.x * c + cr.x * s + axis.x * d * (1 - c),
        y: v.y * c + cr.y * s + axis.y * d * (1 - c),
        z: v.z * c + cr.z * s + axis.z * d * (1 - c),
    };
}

/**
 * JS-side replacement for the broken `set_phi_psi` WASM binding.
 *
 * Mirrors the C++ impl exactly: local edit only, neighbours fixed, peptide
 * bond to the untouched neighbour stretches. Caller should real-space refine
 * the zone after.
 */
export async function setPhiPsiJs(
    commandCentre: CommandCentreLike,
    molNo: number,
    residueCid: string,
    phiDegrees: number,
    psiDegrees: number,
): Promise<number> {
    const m = /^\/\/([^/]+)\/(-?\d+)(?:\/.+)?$/.exec(residueCid.trim());
    if (!m) return 0;
    const chain = m[1], resNo = parseInt(m[2], 10);

    const r: any = await commandCentre.cootCommand({
        returnType: "string",
        command: "molecule_to_mmCIF_string_with_gemmi",
        commandArgs: [molNo],
    }, false);
    const mmcif: string = r?.data?.result?.result || "";
    if (!mmcif) return 0;

    const parsed = parseAtomSiteLoop(mmcif);
    if (!parsed) return 0;

    // Index atoms by (chain, resNo, atomName) for the residue + neighbours.
    type RowRef = { row: string[]; coord: AtomCoord };
    const lookup = new Map<string, RowRef>();
    for (const row of parsed.rows) {
        if (row[parsed.iChain] !== chain) continue;
        const seq = parseInt(row[parsed.iSeq], 10);
        if (seq !== resNo - 1 && seq !== resNo && seq !== resNo + 1) continue;
        const x = parseFloat(row[parsed.iX]);
        const y = parseFloat(row[parsed.iY]);
        const z = parseFloat(row[parsed.iZ]);
        if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) continue;
        lookup.set(`${seq}/${row[parsed.iAtom]}`, { row, coord: { x, y, z } });
    }

    const getC = (key: string): AtomCoord | null => lookup.get(key)?.coord ?? null;
    const N_i  = getC(`${resNo}/N`);
    const CA_i = getC(`${resNo}/CA`);
    const C_i  = getC(`${resNo}/C`);
    const C_prev = getC(`${resNo - 1}/C`);
    const N_next = getC(`${resNo + 1}/N`);

    // === Apply phi rotation ===
    if (N_i && CA_i && C_i && C_prev) {
        const currentPhi = dihedralDegrees(C_prev, N_i, CA_i, C_i) * Math.PI / 180;
        // Empirical sign: rotating C(i) by +theta about (CA - N) decreases the
        // dihedral by theta (verified on 8FD9 GLU 500). To achieve a change of
        // (target - current), rotate by -(target - current) = current - target.
        const deltaPhi = currentPhi - phiDegrees * Math.PI / 180;
        // Axis: N -> CA, normalized; origin: N
        const ax = sub(CA_i, N_i);
        const axn = norm(ax);
        if (axn > 1e-6) {
            const axis = { x: ax.x / axn, y: ax.y / axn, z: ax.z / axn };
            for (const [key, ref] of lookup.entries()) {
                const [seqStr, nm] = key.split("/");
                if (parseInt(seqStr, 10) !== resNo) continue;
                if (AMIDE_NAMES.has(nm)) continue;  // skip amide N/H stays
                const rel = sub(ref.coord, N_i);
                const rot = rotateAroundAxis(rel, axis, deltaPhi);
                ref.coord = { x: N_i.x + rot.x, y: N_i.y + rot.y, z: N_i.z + rot.z };
                ref.row[parsed.iX] = ref.coord.x.toFixed(3);
                ref.row[parsed.iY] = ref.coord.y.toFixed(3);
                ref.row[parsed.iZ] = ref.coord.z.toFixed(3);
            }
        }
    }

    // === Re-fetch coords after phi rotation, since CA/C of residue i may have moved ===
    const N_i2  = getC(`${resNo}/N`);
    const CA_i2 = getC(`${resNo}/CA`);
    const C_i2  = getC(`${resNo}/C`);
    const N_next2 = N_next;  // residue i+1 N hasn't been touched yet

    // === Apply psi rotation ===
    if (N_i2 && CA_i2 && C_i2 && N_next2) {
        const currentPsi = dihedralDegrees(N_i2, CA_i2, C_i2, N_next2) * Math.PI / 180;
        // Same empirical sign convention as phi: rotation +theta about (C - CA)
        // decreases psi by theta, so we rotate by current - target.
        const deltaPsi = currentPsi - psiDegrees * Math.PI / 180;
        // Axis: CA -> C, normalized; origin: CA
        const ax = sub(C_i2, CA_i2);
        const axn = norm(ax);
        if (axn > 1e-6) {
            const axis = { x: ax.x / axn, y: ax.y / axn, z: ax.z / axn };
            // residue i: O and OXT only
            for (const [key, ref] of lookup.entries()) {
                const [seqStr, nm] = key.split("/");
                if (parseInt(seqStr, 10) !== resNo) continue;
                if (nm !== "O" && nm !== "OXT") continue;
                const rel = sub(ref.coord, CA_i2);
                const rot = rotateAroundAxis(rel, axis, deltaPsi);
                ref.coord = { x: CA_i2.x + rot.x, y: CA_i2.y + rot.y, z: CA_i2.z + rot.z };
                ref.row[parsed.iX] = ref.coord.x.toFixed(3);
                ref.row[parsed.iY] = ref.coord.y.toFixed(3);
                ref.row[parsed.iZ] = ref.coord.z.toFixed(3);
            }
            // residue i+1: amide atoms only
            for (const [key, ref] of lookup.entries()) {
                const [seqStr, nm] = key.split("/");
                if (parseInt(seqStr, 10) !== resNo + 1) continue;
                if (!AMIDE_NAMES.has(nm)) continue;
                const rel = sub(ref.coord, CA_i2);
                const rot = rotateAroundAxis(rel, axis, deltaPsi);
                ref.coord = { x: CA_i2.x + rot.x, y: CA_i2.y + rot.y, z: CA_i2.z + rot.z };
                ref.row[parsed.iX] = ref.coord.x.toFixed(3);
                ref.row[parsed.iY] = ref.coord.y.toFixed(3);
                ref.row[parsed.iZ] = ref.coord.z.toFixed(3);
            }
        }
    }

    const modified = emitAtomSiteLoop(mmcif, parsed);
    await commandCentre.cootCommand({
        returnType: "status",
        command: "replace_molecule_by_model_from_string",
        commandArgs: [molNo, modified],
        changesMolecules: [molNo],
    }, false);
    return 1;
}

// ===== get_ncs_ghost_matrix replacement =====
//
// Kabsch superposition via Horn's quaternion method. Returns the 4x4 transform
// (16 floats, space-separated, row-major) that maps copy chain CA atoms onto
// master chain CA atoms. Pairing by residue number (intersection).

interface Mat3 { m: number[]; }  // row-major: 9 numbers
interface Mat4 { m: number[]; }  // row-major: 16 numbers

function symmetricMatrixLargestEigen4(M: number[]): { eigenvalue: number; eigenvector: number[] } {
    // Jacobi rotation on a 4x4 symmetric matrix. Converges in O(n^2) sweeps.
    const n = 4;
    const A = M.slice();  // copy, 16 entries row-major
    const V = new Array(n * n).fill(0);
    for (let i = 0; i < n; i++) V[i * n + i] = 1;

    for (let sweep = 0; sweep < 50; sweep++) {
        // Sum of squares of off-diagonal entries
        let off = 0;
        for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p * n + q] * A[p * n + q];
        if (off < 1e-20) break;

        for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
            const apq = A[p * n + q];
            if (Math.abs(apq) < 1e-15) continue;
            const app = A[p * n + p], aqq = A[q * n + q];
            const theta = (aqq - app) / (2 * apq);
            const t = (theta >= 0)
                ? 1 / (theta + Math.sqrt(1 + theta * theta))
                : 1 / (theta - Math.sqrt(1 + theta * theta));
            const c = 1 / Math.sqrt(1 + t * t);
            const s = t * c;
            A[p * n + p] = app - t * apq;
            A[q * n + q] = aqq + t * apq;
            A[p * n + q] = A[q * n + p] = 0;
            for (let i = 0; i < n; i++) {
                if (i !== p && i !== q) {
                    const aip = A[i * n + p], aiq = A[i * n + q];
                    A[i * n + p] = A[p * n + i] = c * aip - s * aiq;
                    A[i * n + q] = A[q * n + i] = s * aip + c * aiq;
                }
                const vip = V[i * n + p], viq = V[i * n + q];
                V[i * n + p] = c * vip - s * viq;
                V[i * n + q] = s * vip + c * viq;
            }
        }
    }
    // Largest eigenvalue
    let imax = 0;
    for (let i = 1; i < n; i++) if (A[i * n + i] > A[imax * n + imax]) imax = i;
    const eigvec = [V[0 * n + imax], V[1 * n + imax], V[2 * n + imax], V[3 * n + imax]];
    return { eigenvalue: A[imax * n + imax], eigenvector: eigvec };
}

/**
 * Kabsch superposition via Horn's quaternion method. Given two arrays of
 * paired 3D coords (refs[i] paired with movs[i]), returns the 4x4 transform
 * (row-major, 16 floats) that maps movs onto refs.
 */
function kabschSuperpose(refs: AtomCoord[], movs: AtomCoord[]): number[] | null {
    if (refs.length !== movs.length || refs.length < 3) return null;
    const n = refs.length;

    // Centroids
    let crx = 0, cry = 0, crz = 0, cmx = 0, cmy = 0, cmz = 0;
    for (let i = 0; i < n; i++) {
        crx += refs[i].x; cry += refs[i].y; crz += refs[i].z;
        cmx += movs[i].x; cmy += movs[i].y; cmz += movs[i].z;
    }
    crx /= n; cry /= n; crz /= n; cmx /= n; cmy /= n; cmz /= n;

    // Sums of products
    let Sxx = 0, Sxy = 0, Sxz = 0, Syx = 0, Syy = 0, Syz = 0, Szx = 0, Szy = 0, Szz = 0;
    for (let i = 0; i < n; i++) {
        const rx = refs[i].x - crx, ry = refs[i].y - cry, rz = refs[i].z - crz;
        const mx = movs[i].x - cmx, my = movs[i].y - cmy, mz = movs[i].z - cmz;
        Sxx += mx * rx; Sxy += mx * ry; Sxz += mx * rz;
        Syx += my * rx; Syy += my * ry; Syz += my * rz;
        Szx += mz * rx; Szy += mz * ry; Szz += mz * rz;
    }

    // Horn's N matrix (4x4, symmetric)
    const N = [
        Sxx + Syy + Szz,  Syz - Szy,        Szx - Sxz,        Sxy - Syx,
        Syz - Szy,        Sxx - Syy - Szz,  Sxy + Syx,        Szx + Sxz,
        Szx - Sxz,        Sxy + Syx,        -Sxx + Syy - Szz, Syz + Szy,
        Sxy - Syx,        Szx + Sxz,        Syz + Szy,        -Sxx - Syy + Szz,
    ];
    const eig = symmetricMatrixLargestEigen4(N);
    const [qw, qx, qy, qz] = eig.eigenvector;

    // Rotation matrix from quaternion
    const R = [
        qw * qw + qx * qx - qy * qy - qz * qz,  2 * (qx * qy - qw * qz),           2 * (qx * qz + qw * qy),
        2 * (qx * qy + qw * qz),                 qw * qw - qx * qx + qy * qy - qz * qz, 2 * (qy * qz - qw * qx),
        2 * (qx * qz - qw * qy),                 2 * (qy * qz + qw * qx),               qw * qw - qx * qx - qy * qy + qz * qz,
    ];
    const tx = crx - (R[0] * cmx + R[1] * cmy + R[2] * cmz);
    const ty = cry - (R[3] * cmx + R[4] * cmy + R[5] * cmz);
    const tz = crz - (R[6] * cmx + R[7] * cmy + R[8] * cmz);
    return [
        R[0], R[1], R[2], tx,
        R[3], R[4], R[5], ty,
        R[6], R[7], R[8], tz,
        0,    0,    0,    1,
    ];
}

/** Extract Cα coords for a chain, indexed by auth_seq_id, in residue-number order. */
function extractCaCoords(mmcif: string, chain: string): Map<number, AtomCoord> {
    const out = new Map<number, AtomCoord>();
    const re = /loop_\s*\n((?:\s*_atom_site\.[A-Za-z0-9_]+\s*\n)+)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(mmcif)) !== null) {
        const tags = match[1].split(/\s+/).filter(t => t.startsWith("_atom_site."));
        const idx = (c: string) => tags.indexOf(`_atom_site.${c}`);
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
            if (cols[iC] !== chain) continue;
            if (cols[iN] !== "CA") continue;
            const seq = parseInt(cols[iS], 10);
            const x = parseFloat(cols[iX]);
            const y = parseFloat(cols[iY]);
            const z = parseFloat(cols[iZ]);
            if (Number.isNaN(seq) || Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) continue;
            out.set(seq, { x, y, z });
        }
    }
    return out;
}

/**
 * JS-side replacement for the broken `get_ncs_ghost_matrix` WASM binding.
 * Returns the 4x4 transformation matrix (16 space-separated floats, row-major)
 * mapping copy chain Cα atoms onto master chain Cα atoms, or the empty string
 * on failure.
 */
export async function getNcsGhostMatrixJs(
    commandCentre: CommandCentreLike,
    molNo: number,
    masterChain: string,
    copyChain: string,
): Promise<string> {
    const r: any = await commandCentre.cootCommand({
        returnType: "string",
        command: "molecule_to_mmCIF_string_with_gemmi",
        commandArgs: [molNo],
    }, false);
    const mmcif: string = r?.data?.result?.result || "";
    if (!mmcif) return "";

    const masterCa = extractCaCoords(mmcif, masterChain);
    const copyCa = extractCaCoords(mmcif, copyChain);
    if (masterCa.size === 0 || copyCa.size === 0) return "";

    const refs: AtomCoord[] = [], movs: AtomCoord[] = [];
    for (const [seq, mc] of masterCa.entries()) {
        const cc = copyCa.get(seq);
        if (cc) { refs.push(mc); movs.push(cc); }
    }
    if (refs.length < 3) return "";

    const matrix = kabschSuperpose(refs, movs);
    if (!matrix) return "";
    return matrix.map(v => v.toFixed(6)).join(" ");
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
    parseAtomSiteLoop,
    emitAtomSiteLoop,
    rotateAroundAxis,
    kabschSuperpose,
    extractCaCoords,
};
