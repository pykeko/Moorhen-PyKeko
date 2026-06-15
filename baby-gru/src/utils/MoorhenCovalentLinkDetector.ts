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
    buildAtomMapF4,
    buildAtomMapF6,
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
    preferFamily?: "F1" | "F2" | "F3" | "F4" | "F5" | "F6"
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

    // F4 epoxide branch: Cβ is bonded to an O that is itself bonded to
    // another C — the 3-ring O-Cα-Cβ closure. Same O appears on both Cβ
    // and Cα with single bonds. This signature is unique to epoxides
    // (and oxiranes more broadly) because no other functional group
    // makes a 3-ring containing exactly one O and two C's bonded to
    // each other.
    for (const cbN of cbNeighbors) {
        if (atoms[cbN.idx].element !== "O") continue;
        if (cbN.order !== 1) continue;
        const oeCandidate = cbN.idx;
        // Walk from O to find a C neighbour that is ALSO bonded directly
        // to Cβ (closing the 3-ring).
        const oNeighbors = neighborsOf(oeCandidate, bonds);
        let caCandidate = -1;
        for (const oN of oNeighbors) {
            if (oN.idx === cbIdx) continue;
            if (atoms[oN.idx].element !== "C") continue;
            // Is this C bonded directly to Cβ?
            const directlyToCb = bonds.some(
                (b) =>
                    (b.a === oN.idx && b.b === cbIdx) ||
                    (b.b === oN.idx && b.a === cbIdx)
            );
            if (directlyToCb) {
                caCandidate = oN.idx;
                break;
            }
        }
        if (caCandidate < 0) continue;

        // Pre vs post: in pre-reaction (closed ring) input, the O has
        // EXACTLY 2 heavy neighbours (Cα and Cβ — closing the ring).
        // In post-product (opened) input, Cβ would NOT have an O
        // neighbour any more (the ring already opened) — so reaching this
        // branch implicitly means pre-reaction. The post-product case is
        // detected separately below if Cβ has H neighbours but no O.
        const wantedVariant: CovLinkRegistryEntry["mod2_variant"] = "epoxide";

        const entry = registry.warheads.find(
            (w) => w.family === "F4" && w.mod2_variant === wantedVariant
        );
        if (!entry) continue;

        const atomMap = buildAtomMapF4(lig, atoms, bonds, cbIdx, caCandidate, oeCandidate);
        return { entry, atomMap, cbIdx, caIdx: caCandidate };
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

    // F6 reversible carbonyl branch: Cβ has =O (carbonyl oxygen)
    // and NO N within 1 bond of the carbonyl-C (distinguishes from
    // amide carbonyls in F1/F2/F3/F5). The classic warheads are
    // simple ketones / aldehydes that form hemithioketals with Cys-S.
    for (const cbN of cbNeighbors) {
        if (atoms[cbN.idx].element !== "O") continue;
        if (cbN.order !== 2) continue;
        // Cβ has a =O — but is it an amide carbonyl? Check Cβ's other
        // neighbours for N. If found, this is amide chemistry already
        // covered by F1/F2/F3/F5 and we skip.
        const hasNAmide = cbNeighbors.some(
            (n) => atoms[n.idx].element === "N"
        );
        if (hasNAmide) continue;
        // Found a non-amide carbonyl: F6 candidate. The mod2 variant is
        // "carbonyl" (pre-reaction free C=O). The post-product (hemi-
        // thioketal) signature would have Cβ with -OH + -S + R + R',
        // detected separately if needed.
        const wantedVariant: CovLinkRegistryEntry["mod2_variant"] = "carbonyl";
        const entry = registry.warheads.find(
            (w) => w.family === "F6" && w.mod2_variant === wantedVariant
        );
        if (!entry) continue;
        const atomMap = buildAtomMapF6(lig, atoms, bonds, cbIdx, cbN.idx);
        // No proper caIdx for F6 — Cβ is the only carbon in scope. Return
        // -1 as a sentinel; downstream code that needs caIdx for F6
        // should fall back to atomMap fields.
        return { entry, atomMap, cbIdx, caIdx: -1 };
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

/**
 * v0.2.39: scan every carbon in the ligand and return the first one for
 * which `detectWarheadFamily` succeeds. Used by the menu-driven covalent
 * declaration flow ("Ligand → Make covalent…") to pre-fill the Cβ atom
 * BEFORE the user clicks — they only need to confirm or override.
 *
 * Family priority follows v0.2.32 plan-doc order: F1 (acrylamide) and F2
 * (ynamide) are the most common Cys warhead chemistries; F3-F6 are
 * tried as fallback. The first match wins.
 *
 * Returns null if no carbon survives any family's detector.
 */
export async function suggestCbAtom(
    lig: string,
    atoms: LigandAtom[],
    bonds: LigandBond[],
): Promise<DetectionResult | null> {
    const families: Array<"F1" | "F2" | "F3" | "F4" | "F5" | "F6"> =
        ["F2", "F1", "F3", "F4", "F5", "F6"];
    for (const fam of families) {
        for (let i = 0; i < atoms.length; i++) {
            if (atoms[i].element !== "C") continue;
            const det = await detectWarheadFamily(lig, atoms, bonds, i, fam);
            if (det) return det;
        }
    }
    return null;
}
