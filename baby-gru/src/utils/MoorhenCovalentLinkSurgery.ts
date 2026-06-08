// PyKeko covalent-ligand workflow — mmCIF surgery helpers
//
// Lives separately from the orchestrator so the UI button can import the
// surgery functions without pulling in the detector + library machinery.
// See feedback_moorhen_embind_silent_drop.md for why we can't use the
// make_covalent_link WASM binding.

export interface CidParts {
    chain: string;
    resNo: number;
    atom: string;
}

/** Short-form Moorhen CID: //CHAIN/RESNO/ATOM, e.g. //A/145/SG */
export function parseCid(cid: string): CidParts | null {
    const m = /^\/\/([^/]+)\/(-?\d+)\/(.+)$/.exec(cid.trim());
    if (!m) return null;
    return { chain: m[1], resNo: parseInt(m[2], 10), atom: m[3].trim() };
}

export interface AtomSiteInfo {
    label_asym_id: string;
    label_seq_id: string;
    label_comp_id: string;
    auth_asym_id: string;
    auth_seq_id: string;
}

/**
 * Find a specific atom in the mmCIF atom_site loop. Naive whitespace tokenizer —
 * handles unquoted/quoted atoms but not multi-line semicolon-delimited values
 * (which atom_site never uses).
 */
export function findAtomInModel(mmcif: string, target: CidParts): AtomSiteInfo | null {
    const re = /loop_\s*\n((?:\s*_atom_site\.[A-Za-z0-9_]+\s*\n)+)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(mmcif)) !== null) {
        const tagsBlock = match[1];
        const tags = tagsBlock.split(/\s+/).filter(t => t.startsWith("_atom_site."));
        const colIdx = (col: string) => tags.indexOf(`_atom_site.${col}`);
        const idxChain = colIdx("auth_asym_id");
        const idxSeq = colIdx("auth_seq_id");
        const idxAtom = colIdx("label_atom_id");
        const idxLabelAsym = colIdx("label_asym_id");
        const idxLabelSeq = colIdx("label_seq_id");
        const idxLabelComp = colIdx("label_comp_id");
        if (idxChain < 0 || idxSeq < 0 || idxAtom < 0 || idxLabelAsym < 0 ||
            idxLabelSeq < 0 || idxLabelComp < 0) continue;

        const rest = mmcif.substring(match.index + match[0].length);
        const lines = rest.split("\n");
        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line || line.startsWith("#")) continue;
            if (line.startsWith("_") || line.startsWith("loop_") || line.startsWith("data_")) break;
            const cols = tokenizeMmcifRow(line);
            if (cols.length < tags.length) continue;
            const chain = cols[idxChain];
            const seq = parseInt(cols[idxSeq], 10);
            const atom = cols[idxAtom];
            if (chain === target.chain && seq === target.resNo && atom === target.atom) {
                return {
                    label_asym_id: cols[idxLabelAsym],
                    label_seq_id: cols[idxLabelSeq],
                    label_comp_id: cols[idxLabelComp],
                    auth_asym_id: chain,
                    auth_seq_id: String(seq),
                };
            }
        }
    }
    return null;
}

/** mmCIF whitespace tokenizer that respects single/double quotes.
 *
 * Quoted values are stripped of their delimiters AND trimmed: gemmi (and
 * Coot, which uses gemmi internally) writes atom names with PDB-style
 * column padding inside quotes, so `label_atom_id` for a Cys SG comes out
 * as `' SG '` not `SG`. Callers compare against the canonical short form
 * `SG`, so the tokenizer trims here once rather than every consumer
 * having to remember to. Unquoted tokens can't contain whitespace by
 * mmCIF rules, so trim is a no-op for them. */
export function tokenizeMmcifRow(line: string): string[] {
    const out: string[] = [];
    let i = 0;
    while (i < line.length) {
        while (i < line.length && /\s/.test(line[i])) i++;
        if (i >= line.length) break;
        const c = line[i];
        if (c === '"' || c === "'") {
            i++;
            const start = i;
            while (i < line.length && line[i] !== c) i++;
            out.push(line.substring(start, i).trim());
            i++;
        } else {
            const start = i;
            while (i < line.length && !/\s/.test(line[i])) i++;
            out.push(line.substring(start, i));
        }
    }
    return out;
}

export interface StructConnRow {
    id: string;
    conn_type_id: string;
    ptnr1: AtomSiteInfo & { atom: string };
    ptnr2: AtomSiteInfo & { atom: string };
    ccp4_link_id: string;
}

/**
 * Append a new loop_ _struct_conn block at the end of the mmCIF.
 * Gemmi+Refmac concatenate multiple struct_conn loops semantically, so we
 * don't need to merge with any existing block.
 */
export function appendStructConnLoop(mmcif: string, row: StructConnRow): string {
    const block = [
        "loop_",
        "_struct_conn.id",
        "_struct_conn.conn_type_id",
        "_struct_conn.ptnr1_label_asym_id",
        "_struct_conn.ptnr1_label_seq_id",
        "_struct_conn.ptnr1_label_comp_id",
        "_struct_conn.ptnr1_label_atom_id",
        "_struct_conn.ptnr1_auth_asym_id",
        "_struct_conn.ptnr1_auth_seq_id",
        "_struct_conn.ptnr2_label_asym_id",
        "_struct_conn.ptnr2_label_seq_id",
        "_struct_conn.ptnr2_label_comp_id",
        "_struct_conn.ptnr2_label_atom_id",
        "_struct_conn.ptnr2_auth_asym_id",
        "_struct_conn.ptnr2_auth_seq_id",
        "_struct_conn.ccp4_link_id",
        [
            row.id,
            row.conn_type_id,
            row.ptnr1.label_asym_id,
            row.ptnr1.label_seq_id || ".",
            row.ptnr1.label_comp_id,
            row.ptnr1.atom,
            row.ptnr1.auth_asym_id,
            row.ptnr1.auth_seq_id,
            row.ptnr2.label_asym_id,
            row.ptnr2.label_seq_id || ".",
            row.ptnr2.label_comp_id,
            row.ptnr2.atom,
            row.ptnr2.auth_asym_id,
            row.ptnr2.auth_seq_id,
            row.ccp4_link_id,
        ].map(quoteIfNeeded).join(" "),
    ].join("\n");
    const trimmed = mmcif.replace(/\s+$/, "");
    return trimmed + "\n\n" + block + "\n";
}

function quoteIfNeeded(v: string): string {
    if (v === "" || v == null) return ".";
    if (/[\s'"]/.test(v)) return `'${v.replace(/'/g, "''")}'`;
    return v;
}

const STANDARD_AA = new Set([
    "ALA", "ARG", "ASN", "ASP", "CYS", "GLN", "GLU", "GLY", "HIS",
    "ILE", "LEU", "LYS", "MET", "PHE", "PRO", "SER", "THR", "TRP",
    "TYR", "VAL", "MSE", "SEC", "PYL",
]);
const NON_LIGAND = new Set(["HOH", "WAT", "DOD", "H2O"]);

export interface NearbyAtom {
    cid: string;       // //CHAIN/RESNO/ATOM
    compId: string;    // residue 3-letter code
    atom: string;      // atom name
    distance: number;  // Å
}

/**
 * Return all non-protein, non-water atoms within maxDist Å of the given anchor
 * atom (typically a Cys SG), sorted by distance ascending. The UI lets the user
 * pick from this list — auto-picking can be wrong when several ligand atoms
 * are near the Cys.
 */
export function findNearbyLigandAtoms(
    mmcif: string,
    anchor: CidParts,
    maxDist: number = 5.0,
): NearbyAtom[] {
    const nearest = findNearestLigandAtomsImpl(mmcif, anchor, maxDist);
    return nearest;
}

/**
 * Convenience for callers that just want the single closest candidate.
 * Used by the auto-detect quick-pick path. Returns null if nothing within
 * maxDist Å.
 */
export function findNearestLigandAtom(
    mmcif: string,
    sgCid: CidParts,
    maxDist: number = 2.5,
): NearbyAtom | null {
    const all = findNearestLigandAtomsImpl(mmcif, sgCid, maxDist);
    return all.length > 0 ? all[0] : null;
}

function findNearestLigandAtomsImpl(
    mmcif: string,
    sgCid: CidParts,
    maxDist: number,
): NearbyAtom[] {
    const re = /loop_\s*\n((?:\s*_atom_site\.[A-Za-z0-9_]+\s*\n)+)/g;
    let match: RegExpExecArray | null;
    let bestSg: { x: number; y: number; z: number } | null = null;
    const candidates: NearbyAtom[] = [];

    while ((match = re.exec(mmcif)) !== null) {
        const tagsBlock = match[1];
        const tags = tagsBlock.split(/\s+/).filter(t => t.startsWith("_atom_site."));
        const idx = (col: string) => tags.indexOf(`_atom_site.${col}`);
        const idxChain = idx("auth_asym_id"), idxSeq = idx("auth_seq_id"),
              idxAtom = idx("label_atom_id"), idxComp = idx("label_comp_id"),
              idxX = idx("Cartn_x"), idxY = idx("Cartn_y"), idxZ = idx("Cartn_z"),
              idxGroup = idx("group_PDB");
        if (idxChain < 0 || idxSeq < 0 || idxAtom < 0 || idxComp < 0 ||
            idxX < 0 || idxY < 0 || idxZ < 0) continue;

        const rest = mmcif.substring(match.index + match[0].length);
        const lines = rest.split("\n");
        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line || line.startsWith("#")) continue;
            if (line.startsWith("_") || line.startsWith("loop_") || line.startsWith("data_")) break;
            const cols = tokenizeMmcifRow(line);
            if (cols.length < tags.length) continue;
            const chain = cols[idxChain];
            const seq = parseInt(cols[idxSeq], 10);
            const atom = cols[idxAtom];
            const comp = cols[idxComp];
            const x = parseFloat(cols[idxX]);
            const y = parseFloat(cols[idxY]);
            const z = parseFloat(cols[idxZ]);
            if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) continue;

            if (chain === sgCid.chain && seq === sgCid.resNo && atom === sgCid.atom) {
                bestSg = { x, y, z };
                continue;
            }
            // Only consider non-protein, non-water HETATM or unusual residues
            if (STANDARD_AA.has(comp)) continue;
            if (NON_LIGAND.has(comp)) continue;
            candidates.push({
                cid: `//${chain}/${seq}/${atom}`,
                compId: comp,
                atom,
                distance: -1, // fill in after we know bestSg
            });
            // Store coords in the candidate (re-using cid field is bad — use a side slot)
            (candidates[candidates.length - 1] as any)._coord = { x, y, z };
        }
    }

    if (!bestSg) return [];

    const within: NearbyAtom[] = [];
    for (const c of candidates) {
        // Skip hydrogen atoms — never the covalent partner, just visual noise.
        // Standard atom-name conventions: starts with H or single-digit-H.
        const n = c.atom;
        if (n.startsWith("H") || /^\d*H/.test(n)) continue;
        const co = (c as any)._coord as { x: number; y: number; z: number };
        const dx = co.x - bestSg.x, dy = co.y - bestSg.y, dz = co.z - bestSg.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d <= maxDist) {
            within.push({ cid: c.cid, compId: c.compId, atom: c.atom, distance: d });
        }
    }
    within.sort((a, b) => a.distance - b.distance);
    return within;
}
