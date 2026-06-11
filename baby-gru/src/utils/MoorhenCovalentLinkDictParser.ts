// Parses a ligand chem_comp dictionary CIF into the LigandAtom[]/LigandBond[]
// shape the warhead detector expects. Used by both:
//   - the right-click "Declare covalent link" button, which needs to run the
//     detector against the user's existing ligand to know the Cα/Cβ atom names
//     (so the link CIF placeholders can be substituted correctly), and
//   - the new SMILES-time covalent attachment flow, which gets a fresh dict
//     back from smiles_to_pdb and needs to detect the warhead family before
//     placing the ligand.
//
// The dict is the standard CCP4 monomer-library format used by RDKit's
// smiles_to_pdb / AceDRG / the cached Coot per-molecule chem_comp.
//
// We only need atom name + element (for atoms) and atom1/atom2 + bond order
// (for bonds). Coordinates are ignored — the detector works on the bond graph,
// not on 3D geometry. Hydrogens are kept (the detector looks at them for
// terminal-warhead detection).

import { tokenizeMmcifRow } from "./MoorhenCovalentLinkSurgery";
import { LigandAtom, LigandBond } from "./MoorhenCovalentLinkLibrary";

/**
 * Parse a chem_comp dictionary CIF and extract the atom + bond list for a
 * given ligand TLC. Returns null if no `data_comp_<lig>` block is found or
 * the block has no `_chem_comp_atom` loop.
 */
export function parseChemCompFromDict(
    cifText: string,
    lig: string
): { atoms: LigandAtom[]; bonds: LigandBond[] } | null {
    // Locate the data_comp_<lig> block (case-sensitive — Coot writes TLCs
    // in their canonical case).
    const blockRe = new RegExp(`(^|\\n)data_comp_${escapeRe(lig)}\\b`);
    const m = cifText.match(blockRe);
    if (!m) return null;
    const blockStart = (m.index ?? 0) + (m[1] ? 1 : 0);
    // Block ends at next data_ header or end-of-file.
    const nextDataRe = /(^|\n)data_/g;
    nextDataRe.lastIndex = blockStart + 1;
    const next = nextDataRe.exec(cifText);
    const blockEnd = next ? next.index + (next[1] ? 1 : 0) : cifText.length;
    const block = cifText.slice(blockStart, blockEnd);

    const atoms = parseAtomLoop(block);
    if (!atoms || atoms.length === 0) return null;

    const nameToIdx = new Map<string, number>();
    for (let i = 0; i < atoms.length; i++) nameToIdx.set(atoms[i].name, i);

    const bonds = parseBondLoop(block, nameToIdx);
    return { atoms, bonds };
}

function parseAtomLoop(block: string): LigandAtom[] | null {
    const loopRe = /loop_\s*\n((?:\s*_chem_comp_atom\.[A-Za-z0-9_]+\s*\n)+)/g;
    const m = loopRe.exec(block);
    if (!m) return null;
    const tags = m[1]
        .split(/\s+/)
        .filter((t) => t.startsWith("_chem_comp_atom."))
        .map((t) => t.slice("_chem_comp_atom.".length));
    const idxAtomId = tags.indexOf("atom_id");
    const idxTypeSym = tags.indexOf("type_symbol");
    if (idxAtomId < 0 || idxTypeSym < 0) return null;

    const out: LigandAtom[] = [];
    const rest = block.slice(m.index + m[0].length);
    for (const rawLine of rest.split("\n")) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        // End of loop: another tag, loop_, or data_ header.
        if (line.startsWith("_") || line.startsWith("loop_") || line.startsWith("data_")) break;
        const cols = tokenizeMmcifRow(line);
        if (cols.length < tags.length) continue;
        out.push({ name: cols[idxAtomId], element: cols[idxTypeSym] });
    }
    return out;
}

function parseBondLoop(
    block: string,
    nameToIdx: Map<string, number>
): LigandBond[] {
    const loopRe = /loop_\s*\n((?:\s*_chem_comp_bond\.[A-Za-z0-9_]+\s*\n)+)/g;
    const m = loopRe.exec(block);
    if (!m) return [];
    const tags = m[1]
        .split(/\s+/)
        .filter((t) => t.startsWith("_chem_comp_bond."))
        .map((t) => t.slice("_chem_comp_bond.".length));
    const idxA1 = tags.indexOf("atom_id_1");
    const idxA2 = tags.indexOf("atom_id_2");
    // Different writers use "type" (Coot/RDKit) or "value_order" (CCP4-ML).
    const idxOrder = tags.indexOf("type") >= 0 ? tags.indexOf("type") : tags.indexOf("value_order");
    if (idxA1 < 0 || idxA2 < 0 || idxOrder < 0) return [];

    const out: LigandBond[] = [];
    const rest = block.slice(m.index + m[0].length);
    for (const rawLine of rest.split("\n")) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        if (line.startsWith("_") || line.startsWith("loop_") || line.startsWith("data_")) break;
        const cols = tokenizeMmcifRow(line);
        if (cols.length < tags.length) continue;

        const a = nameToIdx.get(cols[idxA1]);
        const b = nameToIdx.get(cols[idxA2]);
        if (a === undefined || b === undefined) continue;

        const order = normalizeBondOrder(cols[idxOrder]);
        if (order === null) continue;
        out.push({ a, b, order });
    }
    return out;
}

/**
 * Normalise a CCP4-ML bond-order token to the LigandBond.order numeric union.
 * Accepts "single"/"SING"/"1", "double"/"DOUB"/"2", "triple"/"TRIP"/"3",
 * "aromatic"/"AROM"/"4", and a few "deloc" variants (treated as aromatic).
 */
function normalizeBondOrder(token: string): 1 | 2 | 3 | 4 | null {
    const t = token.trim().toUpperCase();
    if (t === "1" || t === "SING" || t === "SINGLE") return 1;
    if (t === "2" || t === "DOUB" || t === "DOUBLE") return 2;
    if (t === "3" || t === "TRIP" || t === "TRIPLE") return 3;
    if (t === "4" || t === "AROM" || t === "AROMATIC" || t === "DELOC") return 4;
    return null;
}

function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
