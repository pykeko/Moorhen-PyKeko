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
    buildAtomMapF3,
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
 * <AMIDE_PLANE> placeholder substitution. Confirmed via grep on
 * 2026-06-14 that both F2 (CYS-YNA.cif) and F1 (CYS-ACR.cif) link CIFs
 * scope their plane / restraint sets narrowly enough that they no
 * longer overlap the ligand's amide plane — no in-template references
 * to <AMIDE_PLANE> remain. The parameter is gone for good (see AceDRG
 * cross-validation comparison at docs/.../acedrg-cys-xqq/COMPARISON.md).
 */
export async function detectWarheadFamily(
    lig: string,
    atoms: LigandAtom[],
    bonds: LigandBond[],
    cbIdx: number,
    preferFamily?: "F1" | "F2" | "F3" | "F5"
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

        // F5 maleimide ring check: distinguishes F5 from F1/F2 when caBondOrder
        // is 2 (the C=C). The maleimide signature: Cβ has a SEPARATE carbon
        // neighbour (not Cα) that is itself a carbonyl-C, AND that carbonyl
        // is bonded to the same amide-N as the Cα-side carbonyl (closes the
        // 5-ring). If yes → F5 maleimide pre-Michael (alkene_ring variant).
        let isMaleimideRing = false;
        if (caBondOrder === 2) {
            const cbRingCarbonyl = cbNeighbors.find(
                (n) =>
                    n.order === 1 &&
                    n.idx !== caIdx &&
                    isAmideCarbonyl(n.idx, atoms, bonds)
            );
            if (cbRingCarbonyl) {
                // Check that the Cα-side carbonyl's amide-N is the same atom
                // as the Cβ-side carbonyl's amide-N (the ring closure).
                const caN_amide = amideNitrogenOf(caCarbonyl, atoms, bonds);
                const cbN_amide = amideNitrogenOf(cbRingCarbonyl.idx, atoms, bonds);
                if (caN_amide >= 0 && cbN_amide >= 0 && caN_amide === cbN_amide) {
                    isMaleimideRing = true;
                }
            }
        }

        // Pick the family + variant.
        let family: "F1" | "F2" | "F5";
        let wantedVariant: CovLinkRegistryEntry["mod2_variant"];
        if (caBondOrder === 3) {
            family = "F2";
            wantedVariant = cbCarbonNeighbors === 0 && cbHasH
                ? "alkyne_terminal"
                : "alkyne";
        } else if (caBondOrder === 1) {
            family = "F1";
            wantedVariant = "post";
        } else if (isMaleimideRing) {
            // caBondOrder === 2 AND the maleimide ring signature holds: F5.
            // preferFamily can still override (user picked F1/F2 from the
            // dropdown explicitly), but auto-detection picks F5 here.
            // F3 isn't reachable from this branch (order=2 not order=1).
            if (preferFamily === "F1") {
                family = "F1";
                wantedVariant = "alkene";
            } else if (preferFamily === "F2") {
                family = "F2";
                wantedVariant = "post";
            } else {
                family = "F5";
                wantedVariant = "alkene_ring";
            }
        } else {
            // caBondOrder === 2 and no ring: F2-post vs F1-pre.
            // preferFamily wins; default F2-post (legacy heuristic).
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

    // F3 chloroacetamide branch: Cβ is bonded DIRECTLY to the carbonyl-C
    // (no intervening Cα). The signature is "Cβ has a carbon neighbour
    // that is itself a carbonyl (=O and -N)". For pre-reaction input we
    // also expect a Cl neighbour on Cβ; for post-product we just expect
    // a spare H to delete on the sp3 Cβ.
    for (const cbN of cbNeighbors) {
        if (atoms[cbN.idx].element !== "C") continue;
        if (cbN.order !== 1) continue;
        const coCandidate = cbN.idx;
        if (!isAmideCarbonyl(coCandidate, atoms, bonds)) continue;

        // Pre vs post: presence of Cl on Cβ is the distinguishing factor.
        const cbHasCl = cbNeighbors.some(
            (n) => atoms[n.idx].element === "Cl"
        );
        const wantedVariant: CovLinkRegistryEntry["mod2_variant"] = cbHasCl
            ? "chloride"
            : "post";

        const entry = registry.warheads.find(
            (w) => w.family === "F3" && w.mod2_variant === wantedVariant
        );
        if (!entry) continue;

        const atomMap = buildAtomMapF3(lig, atoms, bonds, cbIdx, coCandidate);

        // For the DetectionResult API we still need a caIdx — F3 has no
        // proper Cα. Return coCandidate's index in its place (the closest
        // semantic match — it's the carbon "α" to the carbonyl as far as
        // the warhead's bond graph is concerned). Callers that look at
        // caIdx for F3-specific logic should use atomMap fields instead.
        return { entry, atomMap, cbIdx, caIdx: coCandidate };
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
        if (isAmideCarbonyl(caN.idx, atoms, bonds)) {
            return caN.idx;
        }
    }
    return -1;
}

/**
 * Check whether a carbon atom is an amide carbonyl-C — bonded to BOTH a
 * =O (double-bonded oxygen) and an -N (any nitrogen neighbour). Used by
 * findCarbonylNeighbor for the F1/F2 walk and by the F3 chloroacetamide
 * branch where Cβ's carbon neighbour IS the carbonyl (no intermediate Cα).
 */
function isAmideCarbonyl(
    cIdx: number,
    atoms: LigandAtom[],
    bonds: LigandBond[]
): boolean {
    if (atoms[cIdx]?.element !== "C") return false;
    const nb = neighborsOf(cIdx, bonds);
    const hasDoubleO = nb.some((m) => atoms[m.idx].element === "O" && m.order === 2);
    const hasN = nb.some((m) => atoms[m.idx].element === "N");
    return hasDoubleO && hasN;
}

/**
 * Return the index of the amide-N neighbour of a carbonyl-C, or -1 if
 * none. Used for F5 maleimide ring-closure detection: the two ring
 * carbonyls share an amide-N (the ring's central nitrogen).
 */
function amideNitrogenOf(
    cIdx: number,
    atoms: LigandAtom[],
    bonds: LigandBond[]
): number {
    for (const m of neighborsOf(cIdx, bonds)) {
        if (atoms[m.idx].element === "N") return m.idx;
    }
    return -1;
}
