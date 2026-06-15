// PyKeko covalent-ligand workflow — unit tests for the refmac handoff helpers.
//
// `buildLinkRecord` emits the PDB LINK record + LINKR link_id suffix. Off-by-
// one in column placement silently breaks refmac matching (the bond restraint
// is dropped, no error). See feedback_pdb_link_columns memory.
//
// `toRefmacReadyLinkCif` transforms our hand-authored link CIFs (which use
// Coot's lenient format) to refmac-loadable form: data_link_list catalog
// block + data_mod_list catalog block + link_id column on every
// _chem_link_<X> loop_. See feedback_refmac_cif_catalog_blocks memory.

import { buildLinkRecord, toRefmacReadyLinkCif } from "../../src/utils/MoorhenCovalentLinkExecutor";

// -----------------------------------------------------------------------------
// buildLinkRecord — PDB v3.3 LINK column layout
// -----------------------------------------------------------------------------

describe("buildLinkRecord — PDB v3.3 column placement", () => {
    // Reference: 8FD9.pdb (deposited covalent ibrutinib bound to BTK)
    //   "LINK         SG  CYS A 481                 C19 XQQ A 801     1555   1555  1.68  "
    // Same shape we should emit.

    const line = buildLinkRecord(
        "A", "481", "CYS", "SG",
        "A", "701", "1E8", "CAA",
        1.81, "CYS-ACR"
    );

    test("record name occupies cols 1-6", () => {
        // Note: substring uses 0-indexed JS positions; PDB spec uses 1-indexed.
        // col 1-6 = JS [0..5]
        expect(line.substring(0, 6)).toBe("LINK  ");
    });

    test("first atom name occupies cols 13-16 (PDB column-aligned)", () => {
        // 2-letter element-symbol atom names like SG are 1-char-left-padded
        // to put the element symbol at col 14: " SG "
        expect(line.substring(12, 16)).toBe(" SG ");
    });

    test("first residue name occupies cols 18-20", () => {
        expect(line.substring(17, 20)).toBe("CYS");
    });

    test("first chain ID at col 22, seq at 23-26", () => {
        expect(line.substring(21, 22)).toBe("A");
        expect(line.substring(22, 26)).toBe(" 481");
    });

    test("second atom name occupies cols 43-46 — the v0.2.36 off-by-one", () => {
        // This is the bug v0.2.37 fixed: previously emitted at col 42-45
        // because inter-field padding was 15 instead of 16. refmac silently
        // failed to match such records.
        expect(line.substring(42, 46)).toBe(" CAA");
    });

    test("second residue name at cols 48-50, chain at 52, seq at 53-56", () => {
        expect(line.substring(47, 50)).toBe("1E8");
        expect(line.substring(51, 52)).toBe("A");
        expect(line.substring(52, 56)).toBe(" 701");
    });

    test("symop1 at cols 60-65, symop2 at cols 67-72", () => {
        expect(line.substring(59, 65)).toBe("1555  ");
        expect(line.substring(66, 72)).toBe("1555  ");
    });

    test("length at cols 74-78 (Real 5.2 format)", () => {
        expect(line.substring(73, 78)).toBe(" 1.81");
    });

    test("link_id (LINKR extension) appended whitespace-delimited after col 80", () => {
        // refmac requires this for explicit-link matching against chem_link
        // templates. Without it, refmac falls back to proximity-only
        // auto-detection.
        const tail = line.substring(80);
        expect(tail.trim()).toBe("CYS-ACR");
    });

    test("link_id omitted when not provided (plain LINK record)", () => {
        const plain = buildLinkRecord(
            "A", "481", "CYS", "SG",
            "A", "701", "1E8", "CAA",
            1.81
        );
        // No trailing link_id past col 80; line may end at col 78 or have
        // a trailing space at 79-80 but nothing alphanumeric after.
        expect(plain.substring(80).trim()).toBe("");
    });

    test("handles short residue numbers (right-padded)", () => {
        const short = buildLinkRecord(
            "A", "5", "CYS", "SG",
            "A", "12", "1E8", "CAA",
            1.81, "CYS-ACR"
        );
        // seq fields right-padded in 4-col field
        expect(short.substring(22, 26)).toBe("   5");
        expect(short.substring(52, 56)).toBe("  12");
    });

    test("handles 4-char atom names (no left-pad)", () => {
        const fourChar = buildLinkRecord(
            "A", "481", "CYS", "SG",
            "A", "701", "1E8", "HCAA",
            1.81, "CYS-ACR"
        );
        // 4-char atom names occupy cols 13-16 / 43-46 fully
        expect(fourChar.substring(42, 46)).toBe("HCAA");
    });
});

// -----------------------------------------------------------------------------
// toRefmacReadyLinkCif — catalog blocks + link_id column injection
// -----------------------------------------------------------------------------

describe("toRefmacReadyLinkCif — refmac CIF format transform", () => {
    // Minimal substituted link CIF mimicking our F1 acrylamide template
    // after the runtime <LIG>/<CB>/<CA>/<HCB> substitution.
    const SUBSTITUTED = `data_link_CYS-ACR
_chem_link.id                CYS-ACR
_chem_link.name              "Cys-S to acrylamide post-Michael adduct (sat. beta-thioether)"
_chem_link.comp_id_1         CYS
_chem_link.mod_id_1          CYS-ACR-mod1
_chem_link.group_comp_1      L-peptide
_chem_link.comp_id_2         1E8
_chem_link.mod_id_2          CYS-ACR-mod2
_chem_link.group_comp_2      non-polymer

loop_
_chem_link_bond.atom_1_comp_id
_chem_link_bond.atom_id_1
_chem_link_bond.atom_2_comp_id
_chem_link_bond.atom_id_2
_chem_link_bond.type
_chem_link_bond.value_dist
_chem_link_bond.value_dist_esd
 1 SG    2 CAA   single 1.81 0.02

data_mod_CYS-ACR-mod1
loop_
_chem_mod_atom.mod_id
_chem_mod_atom.function
_chem_mod_atom.atom_id
 CYS-ACR-mod1 delete HG .
`;

    test("prepends data_link_list catalog block", () => {
        const out = toRefmacReadyLinkCif(SUBSTITUTED);
        expect(out).toMatch(/^data_link_list/);
        // The catalog row carries all 8 _chem_link.* fields in a loop_
        expect(out).toMatch(/loop_\s*\n_chem_link\.id\s*\n_chem_link\.comp_id_1\s*\n_chem_link\.mod_id_1\s*\n_chem_link\.group_comp_1\s*\n_chem_link\.comp_id_2\s*\n_chem_link\.mod_id_2\s*\n_chem_link\.group_comp_2\s*\n_chem_link\.name/);
        // Catalog row contains the extracted metadata
        expect(out).toMatch(/CYS-ACR CYS CYS-ACR-mod1 L-peptide 1E8 CYS-ACR-mod2 non-polymer/);
    });

    test("prepends data_mod_list catalog block", () => {
        const out = toRefmacReadyLinkCif(SUBSTITUTED);
        expect(out).toMatch(/data_mod_list\s*\nloop_\s*\n_chem_mod\.id/);
        expect(out).toMatch(/CYS-ACR-mod1\s+\S+\s+CYS\s+L-peptide/);
        expect(out).toMatch(/CYS-ACR-mod2\s+\S+\s+1E8\s+non-polymer/);
    });

    test("injects link_id column into _chem_link_bond loop", () => {
        const out = toRefmacReadyLinkCif(SUBSTITUTED);
        // Header should now start with link_id
        const bondLoop = out.match(/loop_\s*\n_chem_link_bond\.link_id\s*\n_chem_link_bond\.atom_1_comp_id/);
        expect(bondLoop).not.toBeNull();
        // Data row should be prefixed with the link id
        expect(out).toMatch(/CYS-ACR 1 SG\s+2 CAA\s+single 1\.81 0\.02/);
    });

    test("preserves the per-mod data_mod_<id> blocks unchanged", () => {
        const out = toRefmacReadyLinkCif(SUBSTITUTED);
        // The data_mod_CYS-ACR-mod1 block must still be present below the
        // catalog blocks (refmac reads both — the catalog declares the
        // mod exists, the per-mod block defines what it does).
        expect(out).toContain("data_mod_CYS-ACR-mod1");
    });

    test("preserves _chem_mod_atom loops without modification", () => {
        const out = toRefmacReadyLinkCif(SUBSTITUTED);
        // mod_id is already the first column of _chem_mod_atom in our source,
        // so the transform shouldn't double-inject it.
        const modAtomRow = out.match(/^\s*CYS-ACR-mod1\s+delete\s+HG\s+\./m);
        expect(modAtomRow).not.toBeNull();
    });

    test("handles a CIF missing _chem_link.id gracefully", () => {
        // Returns the input unchanged with a console warning.
        const broken = "data_unknown\n_some.other_field foo\n";
        const out = toRefmacReadyLinkCif(broken);
        expect(out).toBe(broken);
    });

    test("extracts quoted link name", () => {
        const out = toRefmacReadyLinkCif(SUBSTITUTED);
        // The link name (quoted in the source) should appear in the catalog row
        expect(out).toMatch(/"Cys-S to acrylamide post-Michael adduct \(sat\. beta-thioether\)"/);
    });
});
