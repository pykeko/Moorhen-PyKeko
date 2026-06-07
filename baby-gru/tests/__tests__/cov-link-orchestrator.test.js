// PyKeko covalent-ligand workflow — unit tests for the orchestrator.
// Covers happy path (XQQ post-product → declare), dry-run, no-match,
// dictionary load failure, and link-apply failure.

import { jest } from "@jest/globals";
import { declareCovalentLink } from "../../src/utils/MoorhenCovalentLinkOrchestrator";

const XQQ_REGISTRY = {
    version: 1,
    warheads: [
        {
            id: "CYS-YNA-post",
            family: "F2",
            name: "Cys-S to alpha,beta-ynamide post-product",
            drugs: ["acalabrutinib"],
            smarts: "[#16][C:1]=[C:2]C(=O)N",
            mapping: { cb: 1, ca: 2 },
            link_cif: "CYS-YNA.cif",
            mod2_variant: "post",
        },
    ],
};

const XQQ_CIF = `data_link_CYS-YNA
_chem_link.id CYS-YNA
_chem_link.comp_id_2 <LIG>
loop_
_chem_link_bond.atom_1_comp_id
_chem_link_bond.atom_id_1
_chem_link_bond.atom_2_comp_id
_chem_link_bond.atom_id_2
_chem_link_bond.type
 1 SG    2 <CB>   single
 2 <CB>  2 <CA>   double
`;

function mockFetch(routes) {
    return jest.fn(async (url) => {
        for (const [pattern, response] of Object.entries(routes)) {
            if (url.endsWith(pattern)) {
                return response;
            }
        }
        throw new Error(`unexpected fetch: ${url}`);
    });
}

const XQQ_ATOMS = [
    { name: "C19", element: "C" }, // 0 Cβ
    { name: "C13", element: "C" }, // 1 Cα
    { name: "C7",  element: "C" }, // 2 carbonyl
    { name: "C21", element: "C" }, // 3 methyl
    { name: "N1",  element: "N" },
    { name: "O1",  element: "O" },
    { name: "H18", element: "H" },
];
const XQQ_BONDS = [
    { a: 0, b: 1, order: 2 },
    { a: 1, b: 2, order: 1 },
    { a: 0, b: 3, order: 1 },
    { a: 2, b: 4, order: 1 },
    { a: 2, b: 5, order: 2 },
    { a: 0, b: 6, order: 1 },
];

beforeEach(() => {
    jest.resetModules();
});

describe("declareCovalentLink — happy path", () => {
    test("XQQ + Cys → declares CYS-YNA-post link", async () => {
        global.fetch = mockFetch({
            "/index.json": { ok: true, json: async () => XQQ_REGISTRY },
            "/CYS-YNA.cif": { ok: true, text: async () => XQQ_CIF },
        });
        const commandCalls = [];
        const commandCentre = {
            cootCommand: jest.fn(async (request) => {
                commandCalls.push(request);
                // both reads return status=0 (dict) / status=1 (link declare success)
                const status = request.command === "read_dictionary_string" ? 0 : 1;
                return { data: { result: { result: status } } };
            }),
        };
        const result = await declareCovalentLink(
            {
                lig: "XQQ",
                molNo: 7,
                sgCid: "//A/481/SG",
                cbCid: "//A/801/C19",
                atoms: XQQ_ATOMS,
                bonds: XQQ_BONDS,
                cbIdx: 0,
            },
            commandCentre
        );
        expect(result.success).toBe(true);
        expect(result.entry.id).toBe("CYS-YNA-post");
        expect(result.linkDeclared).toBe(true);
        expect(result.cifText).toContain("comp_id_2 XQQ");
        expect(result.cifText).toContain("1 SG    2 C19");
        expect(result.cifText).toContain("2 C19  2 C13");
        expect(commandCalls).toHaveLength(2);
        expect(commandCalls[0].command).toBe("read_dictionary_string");
        expect(commandCalls[1].command).toBe("make_covalent_link_using_cids");
        expect(commandCalls[1].commandArgs).toEqual([
            7,
            "//A/481/SG",
            "//A/801/C19",
            "CYS-YNA-post",
        ]);
    });
});

describe("declareCovalentLink — dry-run", () => {
    test("with dryRun=true: substitutes CIF but skips WASM calls", async () => {
        global.fetch = mockFetch({
            "/index.json": { ok: true, json: async () => XQQ_REGISTRY },
            "/CYS-YNA.cif": { ok: true, text: async () => XQQ_CIF },
        });
        const commandCentre = { cootCommand: jest.fn() };
        const result = await declareCovalentLink(
            {
                lig: "XQQ",
                molNo: 7,
                sgCid: "//A/481/SG",
                cbCid: "//A/801/C19",
                atoms: XQQ_ATOMS,
                bonds: XQQ_BONDS,
                cbIdx: 0,
                dryRun: true,
            },
            commandCentre
        );
        expect(result.success).toBe(true);
        expect(result.linkDeclared).toBe(false);
        expect(result.cifText).toContain("comp_id_2 XQQ");
        expect(commandCentre.cootCommand).not.toHaveBeenCalled();
        expect(result.message).toMatch(/Dry-run/);
    });
});

describe("declareCovalentLink — non-matching ligand", () => {
    test("returns no_warhead_match without invoking WASM", async () => {
        global.fetch = mockFetch({
            "/index.json": { ok: true, json: async () => XQQ_REGISTRY },
        });
        const commandCentre = { cootCommand: jest.fn() };
        // Saturated chain — no C=C / C≡C between cb and ca
        const atoms = [
            { name: "C1", element: "C" },
            { name: "C2", element: "C" },
            { name: "C3", element: "C" },
            { name: "N",  element: "N" },
            { name: "O",  element: "O" },
        ];
        const bonds = [
            { a: 0, b: 1, order: 1 },
            { a: 1, b: 2, order: 1 },
            { a: 2, b: 3, order: 1 },
            { a: 2, b: 4, order: 2 },
        ];
        const result = await declareCovalentLink(
            {
                lig: "SAT",
                molNo: 7,
                sgCid: "//A/481/SG",
                cbCid: "//A/801/C1",
                atoms,
                bonds,
                cbIdx: 0,
            },
            commandCentre
        );
        expect(result.success).toBe(false);
        expect(result.error).toBe("no_warhead_match");
        expect(commandCentre.cootCommand).not.toHaveBeenCalled();
    });
});

describe("declareCovalentLink — read_dictionary_string failure", () => {
    test("returns dictionary_load_failed and skips link declaration", async () => {
        global.fetch = mockFetch({
            "/index.json": { ok: true, json: async () => XQQ_REGISTRY },
            "/CYS-YNA.cif": { ok: true, text: async () => XQQ_CIF },
        });
        const commandCentre = {
            cootCommand: jest.fn(async () => ({
                data: { result: { result: -1 } }, // status -1 = parse error
            })),
        };
        const result = await declareCovalentLink(
            {
                lig: "XQQ",
                molNo: 7,
                sgCid: "//A/481/SG",
                cbCid: "//A/801/C19",
                atoms: XQQ_ATOMS,
                bonds: XQQ_BONDS,
                cbIdx: 0,
            },
            commandCentre
        );
        expect(result.success).toBe(false);
        expect(result.error).toBe("dictionary_load_failed");
        expect(commandCentre.cootCommand).toHaveBeenCalledTimes(1);
    });
});

describe("declareCovalentLink — make_covalent_link failure", () => {
    test("returns link_apply_failed when binding returns 0", async () => {
        global.fetch = mockFetch({
            "/index.json": { ok: true, json: async () => XQQ_REGISTRY },
            "/CYS-YNA.cif": { ok: true, text: async () => XQQ_CIF },
        });
        let callIdx = 0;
        const commandCentre = {
            cootCommand: jest.fn(async () => {
                callIdx += 1;
                // dict succeeds (0), link declare fails (0)
                return { data: { result: { result: callIdx === 1 ? 0 : 0 } } };
            }),
        };
        const result = await declareCovalentLink(
            {
                lig: "XQQ",
                molNo: 7,
                sgCid: "//A/481/SG",
                cbCid: "//A/801/C19",
                atoms: XQQ_ATOMS,
                bonds: XQQ_BONDS,
                cbIdx: 0,
            },
            commandCentre
        );
        expect(result.success).toBe(false);
        expect(result.error).toBe("link_apply_failed");
        expect(result.linkDeclared).toBe(false);
        expect(commandCentre.cootCommand).toHaveBeenCalledTimes(2);
    });
});
