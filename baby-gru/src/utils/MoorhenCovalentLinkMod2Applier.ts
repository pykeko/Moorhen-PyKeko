// Applies a CCP4-ML mod2 block to a ligand's chem_comp dictionary in place,
// producing a new dict CIF text suitable for read_dictionary_string.
//
// Why this exists: the link CIF + mod2 system encodes the post-reaction
// chemistry (e.g. F2 alkyne→vinyl: Cα≡Cβ → Cα=Cβ + new H on Cα + retype sp→sp2)
// at refmacat refinement time, but Coot's in-Moorhen viewer draws ligand bonds
// from the chem_comp dictionary's _chem_comp_bond.value_order field — which is
// frozen at the pre-reaction state until something updates it. After declaring
// a covalent link we apply the mod2's transformations directly to the loaded
// ligand chem_comp, then re-call read_dictionary_string with the modified text
// and trigger a redraw. Result: the alkyne stops rendering as triple bond and
// shows up as the vinyl-thioether double bond the user actually sees in vivo.
//
// Feasibility note: Coot's init_refmac_mon_lib bumps a read_number on every
// import_cif_dictionary call, and mon_lib_add_chem_comp's loop calls
// clear_dictionary_residue() when an existing entry has an OLDER read_number.
// So the second read_dictionary_string for the same comp_id cleanly replaces
// the original. Per-molecule (imol_enc=molNo) scoping means the override is
// scoped to this molecule — the canonical CCD entry stays available for other
// molecules in the session that might reference the same TLC.
//
// Mod2 functions supported:
//   - delete <ATOM>      removes an _chem_comp_atom row + every _chem_comp_bond
//                        row that references it.
//   - add <ATOM_ID> ...  appends a new _chem_comp_atom row. Caller is responsible
//                        for also adding any bond rows that connect the new atom
//                        (via the link CIF for inter-residue bonds, or via an
//                        extra "add" bond entry in the mod2 for intra-residue
//                        bonds — currently the F1/F2 mod2s rely on the carbonyl
//                        amide H-bond network already being in place).
//   - change <ATOM_ID>   updates the type_symbol / type_energy / partial_charge
//                        for an existing atom row.
// Bond functions:
//   - change <a1> <a2>   updates the value_order + value_dist of the existing
//                        bond between a1 and a2. Throws if no such bond exists.
//
// NOT supported: bond add, bond delete (not used by F1/F2 mod2 blocks).
// Extend here if F3-F6 land.
//
// The mod2 CIF text must already have its placeholder tokens substituted
// (use applyAtomMap from MoorhenCovalentLinkLibrary first).

import { tokenizeMmcifRow } from "./MoorhenCovalentLinkSurgery";

interface Mod2AtomOp {
    function: "delete" | "add" | "change";
    atom_id: string;
    new_atom_id?: string;
    new_type_symbol?: string;
    new_type_energy?: string;
    new_partial_charge?: string;
}

interface Mod2BondOp {
    function: "change" | "add" | "delete";
    atom_id_1: string;
    atom_id_2: string;
    new_type?: string;
    new_value_dist?: string;
    new_value_dist_esd?: string;
}

interface ParsedMod2 {
    modId: string;
    atomOps: Mod2AtomOp[];
    bondOps: Mod2BondOp[];
}

/** Parse a substituted mod2 CIF text and return the operation list. */
export function parseMod2(mod2Cif: string): ParsedMod2 {
    const lines = mod2Cif.split("\n");
    let modId = "";
    const atomOps: Mod2AtomOp[] = [];
    const bondOps: Mod2BondOp[] = [];

    let inLoop = false;
    let loopKind: "atom" | "bond" | "" = "";
    let columns: string[] = [];

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;

        const mDataMod = line.match(/^data_mod_(\S+)$/);
        if (mDataMod) {
            modId = mDataMod[1];
            inLoop = false;
            loopKind = "";
            continue;
        }

        if (line === "loop_") {
            inLoop = true;
            loopKind = "";
            columns = [];
            continue;
        }

        if (line.startsWith("_chem_mod_atom.")) {
            if (inLoop) {
                loopKind = "atom";
                columns.push(line.slice("_chem_mod_atom.".length));
            }
            continue;
        }

        if (line.startsWith("_chem_mod_bond.")) {
            if (inLoop) {
                loopKind = "bond";
                columns.push(line.slice("_chem_mod_bond.".length));
            }
            continue;
        }

        // Other tag = end of this loop's data rows
        if (line.startsWith("_") || line.startsWith("data_")) {
            inLoop = false;
            loopKind = "";
            columns = [];
            continue;
        }

        if (!inLoop) continue;

        // Data row inside a loop_
        const cols = tokenizeMmcifRow(line);
        if (cols.length < columns.length) continue;
        const get = (col: string) => {
            const i = columns.indexOf(col);
            return i >= 0 ? cols[i] : "";
        };

        if (loopKind === "atom") {
            const fn = get("function").toLowerCase();
            if (fn === "delete" || fn === "add" || fn === "change") {
                atomOps.push({
                    function: fn,
                    atom_id: get("atom_id"),
                    new_atom_id: get("new_atom_id"),
                    new_type_symbol: get("new_type_symbol"),
                    new_type_energy: get("new_type_energy"),
                    new_partial_charge: get("new_partial_charge"),
                });
            }
        } else if (loopKind === "bond") {
            const fn = get("function").toLowerCase();
            if (fn === "change" || fn === "add" || fn === "delete") {
                bondOps.push({
                    function: fn,
                    atom_id_1: get("atom_id_1"),
                    atom_id_2: get("atom_id_2"),
                    new_type: get("new_type"),
                    new_value_dist: get("new_value_dist"),
                    new_value_dist_esd: get("new_value_dist_esd"),
                });
            }
        }
    }

    return { modId, atomOps, bondOps };
}

/**
 * Apply a parsed mod2 to a ligand chem_comp dictionary CIF text. Returns the
 * modified dict text. The caller passes this to read_dictionary_string +
 * setAtomsDirty + redraw to update the in-Moorhen display.
 *
 * The ligand dict's data block looks like:
 *   data_comp_<LIG>
 *   loop_
 *   _chem_comp_atom.comp_id
 *   _chem_comp_atom.atom_id
 *   _chem_comp_atom.type_symbol
 *   _chem_comp_atom.type_energy
 *   _chem_comp_atom.partial_charge
 *   ...row data rows...
 *   loop_
 *   _chem_comp_bond.comp_id
 *   _chem_comp_bond.atom_id_1
 *   _chem_comp_bond.atom_id_2
 *   _chem_comp_bond.type
 *   _chem_comp_bond.value_dist
 *   _chem_comp_bond.value_dist_esd
 *   ...bond rows...
 *
 * Column order varies by writer — we look them up by tag name not position.
 */
export function applyMod2ToLigandDict(
    ligandDictCif: string,
    mod2: ParsedMod2,
    lig: string
): string {
    // Locate the data_comp_<LIG> block. Operate on that subset only.
    const blockRe = new RegExp(`(^|\\n)data_comp_${escapeReForLiteral(lig)}\\b`);
    const blockMatch = ligandDictCif.match(blockRe);
    if (!blockMatch) {
        throw new Error(`ligand dict has no data_comp_${lig} block`);
    }
    const blockStart = (blockMatch.index ?? 0) + (blockMatch[1] ? 1 : 0);
    // The block extends until the next data_ header (or EOF). For
    // chem_comp dicts the chem_comp_atom and chem_comp_bond loops live
    // inside this block.
    const nextDataRe = /(^|\n)data_/g;
    nextDataRe.lastIndex = blockStart + 1;
    const next = nextDataRe.exec(ligandDictCif);
    const blockEnd = next ? next.index + (next[1] ? 1 : 0) : ligandDictCif.length;

    const before = ligandDictCif.slice(0, blockStart);
    const after = ligandDictCif.slice(blockEnd);
    let block = ligandDictCif.slice(blockStart, blockEnd);

    block = applyAtomOpsToBlock(block, mod2.atomOps, lig);
    block = applyBondOpsToBlock(block, mod2.bondOps, lig);

    return before + block + after;
}

function escapeReForLiteral(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Apply atom ops to the chem_comp_atom loop inside a comp block.
 * Strategy:
 *   - Find the loop_ that has _chem_comp_atom.atom_id as a column.
 *   - Locate column indices.
 *   - Rewrite the row block: delete matching rows, modify changed rows,
 *     append added rows at the end of the loop.
 *
 * Preserves whitespace and column widths in the rewritten rows by joining
 * with single spaces — Coot's reader is tolerant of variable spacing.
 */
function applyAtomOpsToBlock(block: string, ops: Mod2AtomOp[], lig: string): string {
    if (ops.length === 0) return block;

    const loopInfo = findChemCompLoop(block, "_chem_comp_atom.");
    if (!loopInfo) {
        // No atom loop — caller may have passed a dict that's only bonds.
        // Skip silently rather than throwing; bond ops may still apply.
        return block;
    }

    const { columns, rowsStart, rowsEnd } = loopInfo;
    const idxAtomId = columns.indexOf("atom_id");
    const idxTypeSym = columns.indexOf("type_symbol");
    const idxTypeEnergy = columns.indexOf("type_energy");
    const idxPartialCharge = columns.indexOf("partial_charge");
    if (idxAtomId < 0) {
        throw new Error("chem_comp_atom loop has no atom_id column");
    }

    const rowsText = block.slice(rowsStart, rowsEnd);
    const rowLines = rowsText.split("\n");

    const keptRows: string[][] = [];
    const opByAtomId = new Map(ops.filter((o) => o.function !== "add").map((o) => [o.atom_id, o]));
    const addOps = ops.filter((o) => o.function === "add");

    for (const rawLine of rowLines) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const cols = tokenizeMmcifRow(line);
        if (cols.length < columns.length) continue;

        const atomId = cols[idxAtomId];
        const op = opByAtomId.get(atomId);
        if (op?.function === "delete") {
            // Skip this row.
            continue;
        }
        if (op?.function === "change") {
            if (idxTypeSym >= 0 && op.new_type_symbol && op.new_type_symbol !== ".") cols[idxTypeSym] = op.new_type_symbol;
            if (idxTypeEnergy >= 0 && op.new_type_energy && op.new_type_energy !== ".") cols[idxTypeEnergy] = op.new_type_energy;
            if (idxPartialCharge >= 0 && op.new_partial_charge && op.new_partial_charge !== ".") cols[idxPartialCharge] = op.new_partial_charge;
            if (op.new_atom_id && op.new_atom_id !== "." && op.new_atom_id !== atomId) {
                cols[idxAtomId] = op.new_atom_id;
            }
        }
        keptRows.push(cols);
    }

    // Append add ops as new rows. Pull column count from the existing loop.
    for (const op of addOps) {
        const newCols: string[] = new Array(columns.length).fill(".");
        // comp_id column (if present) gets the ligand TLC
        const idxCompId = columns.indexOf("comp_id");
        if (idxCompId >= 0) newCols[idxCompId] = lig;
        newCols[idxAtomId] = op.atom_id;
        if (idxTypeSym >= 0 && op.new_type_symbol && op.new_type_symbol !== ".") newCols[idxTypeSym] = op.new_type_symbol;
        if (idxTypeEnergy >= 0 && op.new_type_energy && op.new_type_energy !== ".") newCols[idxTypeEnergy] = op.new_type_energy;
        if (idxPartialCharge >= 0 && op.new_partial_charge && op.new_partial_charge !== ".") newCols[idxPartialCharge] = op.new_partial_charge;
        keptRows.push(newCols);
    }

    const rebuilt = keptRows.map((cols) => " " + cols.map(formatToken).join(" ")).join("\n") + "\n";
    return block.slice(0, rowsStart) + rebuilt + block.slice(rowsEnd);
}

/**
 * Apply bond ops to the chem_comp_bond loop inside a comp block.
 *
 * For "change": find the row that connects atom_id_1 and atom_id_2 (in
 * either order) and replace its value_order + value_dist columns.
 * For "delete": skip that row.
 * For "add": append a new row at the end.
 */
function applyBondOpsToBlock(block: string, ops: Mod2BondOp[], lig: string): string {
    if (ops.length === 0) return block;

    const loopInfo = findChemCompLoop(block, "_chem_comp_bond.");
    if (!loopInfo) return block; // No bond loop — nothing to do.

    const { columns, rowsStart, rowsEnd } = loopInfo;
    const idxAtom1 = columns.indexOf("atom_id_1");
    const idxAtom2 = columns.indexOf("atom_id_2");
    const idxValueOrder = columns.indexOf("type") !== -1 ? columns.indexOf("type") : columns.indexOf("value_order");
    const idxValueDist = columns.indexOf("value_dist");
    const idxValueDistEsd = columns.indexOf("value_dist_esd");
    if (idxAtom1 < 0 || idxAtom2 < 0) {
        throw new Error("chem_comp_bond loop missing atom_id columns");
    }

    const rowsText = block.slice(rowsStart, rowsEnd);
    const rowLines = rowsText.split("\n");
    const keptRows: string[][] = [];

    const matchOp = (a1: string, a2: string) =>
        ops.find(
            (o) =>
                (o.atom_id_1 === a1 && o.atom_id_2 === a2) ||
                (o.atom_id_1 === a2 && o.atom_id_2 === a1)
        );

    for (const rawLine of rowLines) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const cols = tokenizeMmcifRow(line);
        if (cols.length < columns.length) continue;

        const a1 = cols[idxAtom1];
        const a2 = cols[idxAtom2];
        const op = matchOp(a1, a2);
        if (op?.function === "delete") continue;
        if (op?.function === "change") {
            if (idxValueOrder >= 0 && op.new_type && op.new_type !== ".") cols[idxValueOrder] = op.new_type;
            if (idxValueDist >= 0 && op.new_value_dist && op.new_value_dist !== ".") cols[idxValueDist] = op.new_value_dist;
            if (idxValueDistEsd >= 0 && op.new_value_dist_esd && op.new_value_dist_esd !== ".") cols[idxValueDistEsd] = op.new_value_dist_esd;
        }
        keptRows.push(cols);
    }

    for (const op of ops.filter((o) => o.function === "add")) {
        const newCols: string[] = new Array(columns.length).fill(".");
        const idxCompId = columns.indexOf("comp_id");
        if (idxCompId >= 0) newCols[idxCompId] = lig;
        newCols[idxAtom1] = op.atom_id_1;
        newCols[idxAtom2] = op.atom_id_2;
        if (idxValueOrder >= 0 && op.new_type) newCols[idxValueOrder] = op.new_type;
        if (idxValueDist >= 0 && op.new_value_dist) newCols[idxValueDist] = op.new_value_dist;
        if (idxValueDistEsd >= 0 && op.new_value_dist_esd) newCols[idxValueDistEsd] = op.new_value_dist_esd;
        keptRows.push(newCols);
    }

    const rebuilt = keptRows.map((cols) => " " + cols.map(formatToken).join(" ")).join("\n") + "\n";
    return block.slice(0, rowsStart) + rebuilt + block.slice(rowsEnd);
}

/**
 * Quote a token if it contains whitespace; otherwise emit as-is. Coot's
 * reader accepts both unquoted single-token values and single-quoted multi-
 * word values; quoting unnecessary unquoted tokens is harmless but ugly.
 */
function formatToken(t: string): string {
    if (!t) return ".";
    if (/\s/.test(t)) return `'${t}'`;
    return t;
}

interface LoopInfo {
    /** Tag suffixes (without the "_chem_comp_*."). */
    columns: string[];
    /** Offset in the block string where the first data row starts. */
    rowsStart: number;
    /** Offset in the block string where data rows end (next tag or block end). */
    rowsEnd: number;
}

/**
 * Find a loop_ block whose first column starts with the given prefix
 * (e.g. "_chem_comp_atom." or "_chem_comp_bond."). Returns the column
 * names (after stripping the prefix) and the byte offsets of the row data.
 */
function findChemCompLoop(block: string, prefix: string): LoopInfo | null {
    // Match `loop_` followed by one or more tag lines starting with `prefix`,
    // then capture everything up to the next bare tag (`_<name>` not under prefix)
    // or block end.
    const tagOnlyRe = new RegExp(
        `loop_\\s*\\n((?:\\s*${escapeReForLiteral(prefix)}[A-Za-z0-9_]+\\s*\\n)+)`,
        "g"
    );
    let match: RegExpExecArray | null;
    while ((match = tagOnlyRe.exec(block)) !== null) {
        const tagsBlock = match[1];
        const columns = tagsBlock
            .split(/\s+/)
            .filter((t) => t.startsWith(prefix))
            .map((t) => t.slice(prefix.length));
        if (columns.length === 0) continue;

        const rowsStart = match.index + match[0].length;
        // Walk forward to find the end of the row data: stop at the next
        // line that starts with `_` (other tag) or `loop_` or `data_`.
        const remaining = block.slice(rowsStart);
        const lines = remaining.split("\n");
        let consumed = 0;
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) {
                consumed += line.length + 1; // +1 for the \n
                continue;
            }
            if (trimmed.startsWith("_") || trimmed.startsWith("loop_") || trimmed.startsWith("data_")) {
                break;
            }
            consumed += line.length + 1;
        }
        const rowsEnd = rowsStart + consumed;
        return { columns, rowsStart, rowsEnd };
    }
    return null;
}
