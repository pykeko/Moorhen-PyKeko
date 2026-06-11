// PyKeko covalent-ligand workflow — warhead-family detector
//
// Given a ligand's bond graph + the atom the Cys SG would attack (Cβ
// candidate, typically known from the user's right-click), this module
// classifies the warhead chemistry against the F-series family registry
// and returns the registry entry + atom-name map ready for
// MoorhenCovalentLinkLibrary.buildSubstitutedLinkCif().
//
// For Phase 1 we hand-match against the F2 ynamide patterns without a
// full SMARTS engine — the patterns reduce to "Cβ → Cα → carbonyl-C(=O)N
// with specified bond orders + H presence checks," which a small graph
// walker handles. When F1/F4/F6 ship the same matcher will cover them
// (chloroacetamide is "Cβ → Cα(=O) → N with Cl on Cβ", epoxide is "Cβ in
// a 3-ring with O", etc.). Sites that need full SMARTS can later swap in
// the RDKit-WASM expose path (smilestopdb.cc already imports
// Substruct/SubstructMatch.h — adding a 30-line export is a future
// WASM-patch).
//
// References:
//   ~/Moorhen/docs/covalent-ligand-plan.md §2.1–§2.5
//   ~/Moorhen/baby-gru/public/MoorhenAssets/cov-links/index.json
//   ./MoorhenCovalentLinkLibrary.ts

import {
    ensureRegistryLoaded,
    buildAtomMap,
    LigandAtom,
    LigandBond,
    CovLinkAtomMap,
    CovLinkRegistryEntry,
} from "./MoorhenCovalentLinkLibrary";

export interface DetectionResult {
    /** The matching registry entry. */
    entry: CovLinkRegistryEntry;
    /** Atom map ready to substitute into the link CIF. */
    atomMap: CovLinkAtomMap;
    /** Index of Cβ in the input atoms array (echo of the caller's hint). */
    cbIdx: number;
    /** Index of Cα discovered by walking from Cβ. */
    caIdx: number;
}

const neighborsOf = (
    i: number,
    bonds: LigandBond[]
): { idx: number; order: 1 | 2 | 3 | 4 }[] =>
    bonds
        .filter((b) => b.a === i || b.b === i)
        .map((b) => ({ idx: b.a === i ? b.b : b.a, order: b.order }));

/**
 * Detect the warhead family by graph-walking from a known Cβ candidate.
 *
 * @param lig 3- or 5-char CCD code for the ligand
 * @param atoms ligand atom list (name + element)
 * @param bonds ligand bond list (a/b indices + order)
 * @param cbIdx Cβ candidate (the carbon that would bond to Cys SG)
 * @returns null if no family matches; the result with entry + atom map
 *          on success
 *
 * Note: pre-v2 had an `amidePlane` parameter that fed a now-deleted
 * <AMIDE_PLANE> placeholder substitution. The v2 link CIF scopes its plane
 * narrowly to {SG, Cβ, Cα, Cγ} so it no longer overlaps the ligand's amide
 * plane — the parameter is no longer needed (see AceDRG cross-validation
 * comparison at docs/.../acedrg-cys-xqq/COMPARISON.md).
 */
export async function detectWarheadFamily(
    lig: string,
    atoms: LigandAtom[],
    bonds: LigandBond[],
    cbIdx: number,
    preferFamily?: "F1" | "F2"
): Promise<DetectionResult | null> {
    const registry = await ensureRegistryLoaded();

    // Cβ must be a carbon. (We accept whatever the caller hinted; the
    // SMARTS [#16][C:1]=[C:2]C(=O)N or [C:1]#[C:2]C(=O)N both require it.)
    if (atoms[cbIdx]?.element !== "C") return null;

    const cbNeighbors = neighborsOf(cbIdx, bonds);

    // Look for a carbon neighbor that's our Cα candidate. Bond order
    // distinguishes families and variants:
    //   order 3 → F2 ynamide pre-Michael (alkyne / alkyne_terminal)
    //   order 2 → F2 post-product vinyl thioether (already drawn-bonded)
    //             OR F1 acrylamide pre-Michael (alkene / alkene_terminal)
    //   order 1 → F1 post-product saturated β-thioether (drawn-bonded)
    // For order-2 ambiguity (F2-post vs F1-pre), we honour `preferFamily` if
    // provided by the caller; otherwise we use the historical F2-first
    // heuristic (vinyl-thioether is the more common drawn form when the user
    // loaded the post-bound ligand).
    for (const cbN of cbNeighbors) {
        if (atoms[cbN.idx].element !== "C") continue;
        if (cbN.order < 1 || cbN.order > 3) continue;
        const caIdx = cbN.idx;
        const caBondOrder = cbN.order;

        // Confirm Cα is bonded to a carbonyl-C (a C that has =O and -N).
        const caCarbonyl = findCarbonylNeighbor(caIdx, cbIdx, atoms, bonds);
        if (caCarbonyl < 0) continue;

        // Distinguish terminal vs internal by whether Cβ has any C neighbour
        // besides Cα. Terminal warheads (Spebrutinib alkyne, simple
        // acrylamide ethylene) have only Cα + H's on Cβ.
        const cbCarbonNeighbors = cbNeighbors
            .filter(
                (n) => atoms[n.idx].element === "C" && n.idx !== caIdx
            ).length;
        const cbHasH = cbNeighbors.some(
            (n) => atoms[n.idx].element === "H"
        );

        // Pick the family + variant.
        let family: "F1" | "F2";
        let wantedVariant: CovLinkRegistryEntry["mod2_variant"];
        if (caBondOrder === 3) {
            family = "F2";
            wantedVariant = cbCarbonNeighbors === 0 && cbHasH
                ? "alkyne_terminal"
                : "alkyne";
        } else if (caBondOrder === 1) {
            family = "F1";
            wantedVariant = "post";
        } else {
            // caBondOrder === 2: F2-post vs F1-pre. preferFamily wins; default F2-post.
            family = preferFamily === "F1" ? "F1" : "F2";
            if (family === "F1") {
                wantedVariant = cbCarbonNeighbors === 0 && cbHasH
                    ? "alkene_terminal"
                    : "alkene";
            } else {
                wantedVariant = "post";
            }
        }

        // Find the matching registry entry.
        const entry = registry.warheads.find(
            (w) => w.family === family && w.mod2_variant === wantedVariant
        );
        if (!entry) {
            continue;
        }

        // Build the atom-name map.
        const atomMap = buildAtomMap(
            lig,
            atoms,
            bonds,
            cbIdx,
            caIdx
        );

        return { entry, atomMap, cbIdx, caIdx };
    }

    return null;
}

/**
 * Find a carbon neighbor of `caIdx` (other than `cbIdx`) that is bonded to
 * BOTH a =O and a -N (i.e. is a carbonyl-C of an amide). Returns the index
 * or -1 if no such neighbor exists.
 */
function findCarbonylNeighbor(
    caIdx: number,
    cbIdx: number,
    atoms: LigandAtom[],
    bonds: LigandBond[]
): number {
    for (const caN of neighborsOf(caIdx, bonds)) {
        if (caN.idx === cbIdx) continue;
        if (atoms[caN.idx].element !== "C") continue;
        const carbonylNeighbors = neighborsOf(caN.idx, bonds);
        const hasDoubleO = carbonylNeighbors.some(
            (m) => atoms[m.idx].element === "O" && m.order === 2
        );
        const hasN = carbonylNeighbors.some(
            (m) => atoms[m.idx].element === "N"
        );
        if (hasDoubleO && hasN) {
            return caN.idx;
        }
    }
    return -1;
}
