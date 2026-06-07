// PyKeko covalent-ligand workflow — unit tests for the link-CIF substitution
// and atom-map helpers. Validates end-to-end on hardcoded XQQ (acalabrutinib)
// chemistry without requiring RDKit or the WASM build.

import { jest } from "@jest/globals";
import {
    applyAtomMap,
    buildAtomMap,
} from "../../src/utils/MoorhenCovalentLinkLibrary";

/**
 * XQQ (acalabrutinib) atoms + bonds derived from the deposited chem_comp.
 * We only model the warhead end of the molecule (everything past the
 * carbonyl-C is irrelevant to the F2 link CIF).
 *
 *   C21(methyl) — C19(Cβ) = C13(Cα) — C7(carbonyl) (=O1)(–N1)
 *   (H18 on C19; H13 on C13 in post-product form)
 */
const xqqAtoms = [
    { name: "C19", element: "C" }, // 0  Cβ
    { name: "C13", element: "C" }, // 1  Cα
    { name: "C7",  element: "C" }, // 2  carbonyl C
    { name: "C21", element: "C" }, // 3  methyl (Cγ)
    { name: "N1",  element: "N" }, // 4  amide N
    { name: "O1",  element: "O" }, // 5  carbonyl O
    { name: "H18", element: "H" }, // 6  H on C19 (deleted in post-product mod2)
    { name: "H13", element: "H" }, // 7  H on C13
];

const xqqBonds = [
    { a: 0, b: 1, order: 2 }, // C19 = C13
    { a: 1, b: 2, order: 1 }, // C13 - C7
    { a: 0, b: 3, order: 1 }, // C19 - C21 methyl
    { a: 2, b: 4, order: 1 }, // C7 - N1
    { a: 2, b: 5, order: 2 }, // C7 = O1
    { a: 0, b: 6, order: 1 }, // C19 - H18
    { a: 1, b: 7, order: 1 }, // C13 - H13
];

describe("buildAtomMap", () => {
    test("XQQ (acalabrutinib): walks Cβ → Cα → carbonyl-C → N + =O", () => {
        const cbIdx = 0; // C19
        const caIdx = 1; // C13
        const map = buildAtomMap("XQQ", xqqAtoms, xqqBonds, cbIdx, caIdx);
        expect(map.lig).toBe("XQQ");
        expect(map.cb).toBe("C19");
        expect(map.ca).toBe("C13");
        expect(map.co).toBe("C7");
        expect(map.n).toBe("N1");
        expect(map.o).toBe("O1");
        expect(map.hcb).toBe("H18"); // post-product input
    });

    test("optional amidePlane is passed through unchanged", () => {
        const map = buildAtomMap(
            "XQQ",
            xqqAtoms,
            xqqBonds,
            0,
            1,
            "plane-amide"
        );
        expect(map.amidePlane).toBe("plane-amide");
    });

    test("alkyne pre-Michael input: no H on Cβ", () => {
        // Same XQQ skeleton but without H18 (Cβ has only methyl + C13)
        const atomsNoHcb = xqqAtoms.filter((a) => a.name !== "H18");
        // After removal, indexes shift; rebuild bond list mapping
        const oldToNew = new Map(
            xqqAtoms
                .filter((a) => a.name !== "H18")
                .map((a, i) => [xqqAtoms.indexOf(a), i])
        );
        const bondsNoHcb = xqqBonds
            .filter((b) => !(b.a === 6 || b.b === 6))
            .map((b) => ({
                a: oldToNew.get(b.a),
                b: oldToNew.get(b.b),
                order: b.order,
            }));
        const cbIdx = oldToNew.get(0);
        const caIdx = oldToNew.get(1);
        const map = buildAtomMap("XQQ", atomsNoHcb, bondsNoHcb, cbIdx, caIdx);
        expect(map.cb).toBe("C19");
        expect(map.hcb).toBeUndefined();
    });

    test("missing carbonyl: throws with clear error", () => {
        const truncated = xqqAtoms.slice(0, 2); // just C19, C13
        const truncatedBonds = [{ a: 0, b: 1, order: 2 }];
        expect(() =>
            buildAtomMap("XQQ", truncated, truncatedBonds, 0, 1)
        ).toThrow(/could not find carbonyl-C/);
    });
});

describe("applyAtomMap", () => {
    test("substitutes all required tokens in a minimal CIF", () => {
        const template = `data_link_CYS-YNA
_chem_link.comp_id_2 <LIG>
loop_
_chem_link_bond.atom_1_comp_id
_chem_link_bond.atom_id_1
_chem_link_bond.atom_2_comp_id
_chem_link_bond.atom_id_2
_chem_link_bond.type
 1 SG    2 <CB>   single
 2 <CB>  2 <CA>   double
loop_
_chem_link_plane.atom_id
 <SG>
 <CB>
 <CA>
 <CO>
 <N>
 <O>`;
        const map = {
            lig: "XQQ",
            cb: "C19",
            ca: "C13",
            co: "C7",
            n: "N1",
            o: "O1",
        };
        const out = applyAtomMap(template, map);
        expect(out).not.toMatch(/<LIG>/);
        expect(out).not.toMatch(/<CB>/);
        expect(out).not.toMatch(/<CA>/);
        expect(out).not.toMatch(/<CO>/);
        expect(out).toContain("comp_id_2 XQQ");
        expect(out).toContain("1 SG    2 C19   single");
        expect(out).toContain("2 C19  2 C13   double");
    });

    test("optional tokens kept when undefined: no spurious substitution", () => {
        const template = `<AMIDE_PLANE>: still here\n<CB>: substituted`;
        const map = { lig: "X", cb: "C19", ca: "C13", co: "C7", n: "N", o: "O" };
        const out = applyAtomMap(template, map);
        expect(out).toContain("<AMIDE_PLANE>:");
        expect(out).toContain("C19: substituted");
    });

    test("idempotent: running twice yields the same result as once", () => {
        const template = `<LIG>/<CB>=<CA>`;
        const map = { lig: "XQQ", cb: "C19", ca: "C13", co: "C7", n: "N", o: "O" };
        const once = applyAtomMap(template, map);
        const twice = applyAtomMap(once, map);
        expect(twice).toBe(once);
        expect(once).toBe("XQQ/C19=C13");
    });
});
