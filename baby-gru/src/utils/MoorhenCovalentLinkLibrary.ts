// PyKeko covalent-ligand workflow — link-CIF substitution + warhead detector
//
// The hand-authored link CIFs in baby-gru/public/MoorhenAssets/cov-links/
// carry placeholder tokens (<LIG>, <CB>, <CA>, <CO>, <N>, <O>, <HCB>, <HCA>,
// <AMIDE_PLANE>) that this module substitutes at runtime with the user's
// actual atom names. Once substituted, the CIF is shipped to the WASM via
// `read_dictionary_string` and the link is declared via `make_covalent_link_using_cids`.
//
// Architecture is documented in:
//   ~/Moorhen/docs/covalent-ligand-plan.md §2.1–§2.5 (architecture)
//   ~/Moorhen/baby-gru/public/MoorhenAssets/cov-links/README.md (token semantics)
//   ~/Moorhen/baby-gru/public/MoorhenAssets/cov-links/index.json (SMARTS registry)
//
// This module is family-agnostic infrastructure. It runs the registry of
// SMARTS patterns against a ligand's chem_comp + 3D residue, picks the
// first match, extracts the atom-name map, substitutes the CIF, and emits
// the ready-to-load dictionary. The F2 ynamide family is the first user;
// F1/F4/F6 will follow once F2 is end-to-end validated.

/** Atom-name map populated by the SMARTS detector. */
export interface CovLinkAtomMap {
    /** Ligand 3- or 5-char CCD code (e.g. "XQQ", "A1IMT"). */
    lig: string;
    /** Cβ atom-id (the carbon that bonds to Cys SG). */
    cb: string;
    /** Cα atom-id (the carbon adjacent to Cβ on the carbonyl side). */
    ca: string;
    /** Carbonyl-C atom-id (the C of the amide group). */
    co: string;
    /**
     * Cγ atom-id (the substituent past Cβ on the side opposite to Cα).
     * For methyl butynamides (XQQ acalabrutinib) this is C21 — the methyl C.
     * For extended-methyl variants this is the CH₂- linker. For terminal
     * propiolamides (Spebrutinib-class) this is the H atom that takes the
     * place where the methyl would be — the detector resolves it as the
     * H name in that case.
     * Used in v2 plane + dihedral restraints (per AceDRG convention).
     */
    cg: string;
    /** Amide-N atom-id. */
    n: string;
    /** Carbonyl-O atom-id. */
    o: string;
    /**
     * H atom-id to delete on Cβ in the post-product input case.
     * Empty string when the input is the alkyne pre-Michael form.
     */
    hcb?: string;
    /**
     * H atom-id to ADD on Cα in the alkyne pre-Michael case.
     * Naming convention: follow the ligand's existing H-numbering
     * (typically H<n> where n is the Cα's number, e.g. H13 for C13).
     * Empty string when the input is the post-product form.
     */
    hca?: string;
}

/** A registry entry from cov-links/index.json. */
export interface CovLinkRegistryEntry {
    id: string;
    family: "F1" | "F2" | "F3" | "F4" | "F5" | "F6";
    name: string;
    drugs: string[];
    /** SMARTS pattern with atom-mapping numbers (e.g. [#16][C:1]=[C:2]C(=O)N). */
    smarts: string;
    /** Maps mapping-number → semantic role. */
    mapping: { cb: number; ca: number };
    /** Filename of the main link CIF (in the cov-links/ public assets dir). */
    link_cif: string;
    /** Picks which mod2 block applies. "post" uses the CIF's default inline
     * mod2 (already-bound form); the *_pre/*_terminal variants swap in a
     * separate mod2_cif that encodes the bond-order change.
     *   F2 ynamide: post (vinyl-thioether) | alkyne | alkyne_terminal
     *   F1 acrylamide: post (saturated thioether) | alkene | alkene_terminal */
    mod2_variant: "post" | "alkyne" | "alkyne_terminal" | "alkene" | "alkene_terminal";
    /** Filename of the alternative mod2 block, if mod2_variant !== "post". */
    mod2_cif?: string;
}

/** Loaded registry (deferred — fetched lazily on first detector call). */
export interface CovLinkRegistry {
    version: number;
    warheads: CovLinkRegistryEntry[];
}

/** Singleton-style registry cache. Populated by ensureRegistryLoaded(). */
let _registry: CovLinkRegistry | null = null;

/**
 * Load the cov-links registry from the public assets dir.
 * URL convention matches the rest of MoorhenAssets/ (served from web root).
 */
export async function ensureRegistryLoaded(
    baseUrl: string = "MoorhenAssets/cov-links"
): Promise<CovLinkRegistry> {
    if (_registry) return _registry;
    const response = await fetch(`${baseUrl}/index.json`);
    if (!response.ok) {
        throw new Error(
            `cov-links registry not found at ${baseUrl}/index.json (HTTP ${response.status})`
        );
    }
    _registry = (await response.json()) as CovLinkRegistry;
    return _registry;
}

/**
 * Load a link-CIF template by filename, returning the raw text with
 * placeholders still in place. Caller substitutes via applyAtomMap.
 */
export async function loadLinkCifTemplate(
    filename: string,
    baseUrl: string = "MoorhenAssets/cov-links"
): Promise<string> {
    const response = await fetch(`${baseUrl}/${filename}`);
    if (!response.ok) {
        throw new Error(
            `cov-link template ${filename} not found (HTTP ${response.status})`
        );
    }
    return response.text();
}

/**
 * Replace placeholder tokens in a link-CIF template with the user's actual
 * atom-name map. Idempotent — running this on already-substituted CIF text
 * is a no-op for replacements that don't match.
 *
 * Token semantics (all wrapped in <…>):
 *   <LIG>          → atomMap.lig
 *   <CB>           → atomMap.cb
 *   <CA>           → atomMap.ca
 *   <CG>           → atomMap.cg
 *   <CO>           → atomMap.co
 *   <N>            → atomMap.n
 *   <O>            → atomMap.o
 *   <HCB>          → atomMap.hcb   (post-product input only)
 *   <HCA>          → atomMap.hca   (alkyne input only)
 */
export function applyAtomMap(cifText: string, atomMap: CovLinkAtomMap): string {
    const replacements: [RegExp, string][] = [
        [/<LIG>/g, atomMap.lig],
        [/<CB>/g, atomMap.cb],
        [/<CA>/g, atomMap.ca],
        [/<CG>/g, atomMap.cg],
        [/<CO>/g, atomMap.co],
        [/<N>/g, atomMap.n],
        [/<O>/g, atomMap.o],
    ];
    if (atomMap.hcb) replacements.push([/<HCB>/g, atomMap.hcb]);
    if (atomMap.hca) replacements.push([/<HCA>/g, atomMap.hca]);

    let result = cifText;
    for (const [pattern, value] of replacements) {
        result = result.replace(pattern, value);
    }
    return result;
}

/**
 * Build the final substituted CIF for a given registry entry + atom map.
 * Handles the post-product vs alkyne mod2 swap: the main CYS-YNA.cif has
 * the post-product mod2 inline; the alkyne variant has its mod2 in a
 * separate file that we APPEND-with-swap (the runtime detector picked
 * which variant fired, we just have to deliver the right CIF text).
 *
 * For the post-product case: substitute and return CYS-YNA.cif as-is.
 * For the alkyne case: take CYS-YNA.cif, strip its inline `data_mod_CYS-YNA-mod2`
 * block (everything from that `data_mod_*` header to the end), append the
 * alkyne variant's `data_mod_*` block, then substitute placeholders on the
 * concatenated text.
 */
export async function buildSubstitutedLinkCif(
    entry: CovLinkRegistryEntry,
    atomMap: CovLinkAtomMap,
    baseUrl: string = "MoorhenAssets/cov-links"
): Promise<string> {
    const mainTemplate = await loadLinkCifTemplate(entry.link_cif, baseUrl);

    let combined: string;
    if (entry.mod2_variant === "post") {
        // Main template's inline mod2 is already correct.
        combined = mainTemplate;
    } else if (entry.mod2_cif) {
        // Strip the inline data_mod_*-mod2 block from main, replace with
        // the alternative one from mod2_cif.
        const altMod2Text = await loadLinkCifTemplate(entry.mod2_cif, baseUrl);
        const inlineMod2Start = mainTemplate.search(/^data_mod_[A-Z0-9-]+-mod2\b/m);
        if (inlineMod2Start < 0) {
            throw new Error(
                `link CIF ${entry.link_cif} is missing inline data_mod_*-mod2 block; cannot swap`
            );
        }
        combined =
            mainTemplate.slice(0, inlineMod2Start).trimEnd() +
            "\n\n" +
            altMod2Text.trimStart();
    } else {
        throw new Error(
            `registry entry ${entry.id} has mod2_variant="${entry.mod2_variant}" but no mod2_cif`
        );
    }

    return applyAtomMap(combined, atomMap);
}

/**
 * Build the atom map for a given ligand by introspecting its 3D residue.
 *
 * Strategy:
 *   - The detector's RDKit SMARTS match gives us Cβ and Cα indices.
 *   - Cα is bonded to the carbonyl-C; the carbonyl-C is in turn bonded to
 *     an =O and a -N(amide).
 *   - The H to delete on Cβ (post-product) is the H bonded to Cβ besides
 *     any heavier substituent.
 *
 * This function operates on a pre-built ligand graph (atoms[] + bonds[][]).
 * The caller is responsible for constructing that from RDKit or from
 * gemmi's chem_comp parser; we keep the interface minimal so the same
 * code path works for both inputs.
 *
 * Returns the atom map populated with whatever fields could be determined.
 * Fields left undefined where the graph didn't yield an answer (e.g. no H
 * on Cβ ⇒ post-product input is impossible).
 */
export interface LigandAtom {
    /** Atom-id in the ligand chem_comp (e.g. "C19"). */
    name: string;
    /** Element symbol ("C", "H", "N", "O", "S", …). */
    element: string;
}

export interface LigandBond {
    /** Index into the atoms array. */
    a: number;
    /** Index into the atoms array. */
    b: number;
    /** Bond order: 1 single, 2 double, 3 triple, 4 aromatic. */
    order: 1 | 2 | 3 | 4;
}

export function buildAtomMap(
    lig: string,
    atoms: LigandAtom[],
    bonds: LigandBond[],
    cbIdx: number,
    caIdx: number
): CovLinkAtomMap {
    const neighborsOf = (i: number): number[] =>
        bonds
            .filter((b) => b.a === i || b.b === i)
            .map((b) => (b.a === i ? b.b : b.a));

    // Walk from Cα to find carbonyl-C: the neighbor of Cα that is NOT Cβ,
    // is a carbon, and is bonded to both =O and -N.
    const caNeighbors = neighborsOf(caIdx);
    let coIdx = -1;
    for (const n of caNeighbors) {
        if (n === cbIdx) continue;
        if (atoms[n].element !== "C") continue;
        const neighborsOfN = neighborsOf(n);
        const hasDoubleO = bonds.some(
            (b) =>
                ((b.a === n && atoms[b.b].element === "O") ||
                    (b.b === n && atoms[b.a].element === "O")) &&
                b.order === 2
        );
        const hasN = neighborsOfN.some((m) => atoms[m].element === "N");
        if (hasDoubleO && hasN) {
            coIdx = n;
            break;
        }
    }
    if (coIdx < 0) {
        throw new Error(
            `buildAtomMap: could not find carbonyl-C neighbor of Cα (${atoms[caIdx].name})`
        );
    }

    // Find =O and amide-N attached to the carbonyl-C.
    let oIdx = -1;
    let nIdx = -1;
    for (const m of neighborsOf(coIdx)) {
        if (atoms[m].element === "O") {
            const isDouble = bonds.some(
                (b) =>
                    ((b.a === coIdx && b.b === m) ||
                        (b.b === coIdx && b.a === m)) &&
                    b.order === 2
            );
            if (isDouble) oIdx = m;
        } else if (atoms[m].element === "N") {
            nIdx = m;
        }
    }
    if (oIdx < 0 || nIdx < 0) {
        throw new Error(
            `buildAtomMap: could not find amide O= or N for carbonyl-C ${atoms[coIdx].name}`
        );
    }

    // Find Cγ: the substituent on Cβ that is NOT Cα and NOT an H. For most
    // F2 ligands this is a carbon (methyl, CH₂-R, aryl). For terminal
    // propiolamide it'll be the H — Spebrutinib-style, see Plan-doc §A.3.
    const cbNeighbors = neighborsOf(cbIdx);
    let cgIdx = cbNeighbors.find(
        (i) => i !== caIdx && atoms[i].element === "C"
    );
    if (cgIdx === undefined) {
        // Terminal propiolamide case: use the H bonded to Cβ as Cγ
        cgIdx = cbNeighbors.find(
            (i) => i !== caIdx && atoms[i].element === "H"
        );
    }
    if (cgIdx === undefined) {
        throw new Error(
            `buildAtomMap: could not find Cγ neighbor of Cβ (${atoms[cbIdx].name})`
        );
    }

    // Find an H bonded to Cβ (for post-product input — may not exist for
    // alkyne input where Cβ has no H). Note: in the terminal propiolamide
    // case Cγ IS the H, so hcb stays undefined (no other H to delete).
    const hcbIdx = cbNeighbors.find(
        (i) => i !== cgIdx && atoms[i].element === "H"
    );

    return {
        lig,
        cb: atoms[cbIdx].name,
        ca: atoms[caIdx].name,
        cg: atoms[cgIdx].name,
        co: atoms[coIdx].name,
        n: atoms[nIdx].name,
        o: atoms[oIdx].name,
        hcb: hcbIdx !== undefined ? atoms[hcbIdx].name : undefined,
    };
}
