// PyKeko v0.3 — symmetry mates + unit cell box.
//
// Uses gemmi (already in the Moorhen WASM bundle) to read the structure's
// space group and unit cell, generate symmetry-related copies within a
// radius of the rotation centre, and render:
//   - the unit-cell box as 12 cylinder segments
//   - each sym mate as a Cα trace per chain (one cylinder per consecutive
//     CA pair) so the geometry is visible without the cost of meshing
//     full atomic detail.
//
// All output goes through Moorhen's vectorsSlice (same primitive as
// NCS ghosts / interaction overlays). Unique id prefixes:
//   pykeko-cell-*   for the unit-cell box edges
//   pykeko-sym-*    for sym mate traces

import { AtomRec, flattenMolecule } from "./MoorhenSelectionAlgebra";

const PREFIX_CELL = "pykeko-cell";
export const PREFIX_SYM = "pykeko-sym";
const PREFIX_LABEL = "pykeko-symlabel";

// ============================================================================
// Cell + symmetry helpers (gemmi)
// ============================================================================

export interface Cell { a: number; b: number; c: number; alpha: number; beta: number; gamma: number; }
interface OpMat { rot: number[][]; tran: number[]; label: string; }

export function getCell(mol: any): Cell | null {
    const gs = mol?.gemmiStructure;
    if (!gs || gs.isDeleted?.()) return null;
    const cell = gs.cell;
    if (!cell) return null;
    const c: Cell = { a: cell.a, b: cell.b, c: cell.c, alpha: cell.alpha, beta: cell.beta, gamma: cell.gamma };
    return c;
}

export function getSpacegroupName(mol: any): string | null {
    const gs = mol?.gemmiStructure;
    if (!gs || gs.isDeleted?.()) return null;
    try {
        const sg = gs.spacegroup_hm || gs.spacegroup?.short_name?.() || "";
        return sg || null;
    } catch { return null; }
}

// Read all space-group operators (excluding identity) as JS plain objects so
// downstream code doesn't have to juggle embind handles for the rest of the
// pipeline. Returns [] on failure.
export function getSymOps(mol: any): OpMat[] {
    const out: OpMat[] = [];
    const sgName = getSpacegroupName(mol);
    if (!sgName) return out;
    const mod = (window as any).CCP4Module;
    if (!mod?.get_spacegroup_by_name) return out;
    let sg: any = null;
    try { sg = mod.get_spacegroup_by_name(sgName); } catch { return out; }
    if (!sg) return out;
    try {
        const ops = sg.operations();
        const sortedOps = ops.all_ops_sorted();
        const n = sortedOps.size();
        for (let i = 0; i < n; i++) {
            const op = sortedOps.get(i);
            // gemmi stores rot as 3x3 int (denominator 24 for rotations is 24 -- but
            // actually gemmi's Op rotates by integer scale 24 too; the convention is
            // both rot and tran are over a denominator of 24. We'll convert here).
            // See https://github.com/project-gemmi/gemmi/blob/master/include/gemmi/symmetry.hpp
            const DENOM = 24;
            const rot: number[][] = [
                [op.rot[0][0] / DENOM, op.rot[0][1] / DENOM, op.rot[0][2] / DENOM],
                [op.rot[1][0] / DENOM, op.rot[1][1] / DENOM, op.rot[1][2] / DENOM],
                [op.rot[2][0] / DENOM, op.rot[2][1] / DENOM, op.rot[2][2] / DENOM],
            ];
            const tran: number[] = [op.tran[0] / DENOM, op.tran[1] / DENOM, op.tran[2] / DENOM];
            let label = "";
            try { label = String(op.triplet?.(1) || ""); } catch {
                try { label = String(op.triplet?.(0) || ""); } catch {
                    label = `op${i}`;
                }
            }
            // Skip identity op (rot = I, tran = 0).
            const isIdent = rot[0][0] === 1 && rot[1][1] === 1 && rot[2][2] === 1 &&
                            rot[0][1] === 0 && rot[0][2] === 0 && rot[1][0] === 0 &&
                            rot[1][2] === 0 && rot[2][0] === 0 && rot[2][1] === 0 &&
                            tran[0] === 0 && tran[1] === 0 && tran[2] === 0;
            if (!isIdent) out.push({ rot, tran, label });
            op.delete?.();
        }
        sortedOps.delete?.();
        ops.delete?.();
    } finally {
        sg.delete?.();
    }
    return out;
}

// ============================================================================
// Fractional / orthogonal conversion
// ============================================================================

// Build orthogonalisation matrix (cell -> Cartesian) from cell parameters.
// Reference: International Tables vol. B / gemmi cell.cpp.
function buildOrthMatrix(c: Cell): number[][] {
    const deg = Math.PI / 180;
    const ca = Math.cos(c.alpha * deg), cb = Math.cos(c.beta * deg), cg = Math.cos(c.gamma * deg);
    const sg = Math.sin(c.gamma * deg);
    const v = Math.sqrt(1 - ca*ca - cb*cb - cg*cg + 2*ca*cb*cg);
    // M[i][j] columns are the orthogonal coordinates of fractional basis vectors.
    return [
        [c.a,         c.b * cg,                     c.c * cb],
        [0,           c.b * sg,                     c.c * (ca - cb*cg) / sg],
        [0,           0,                            c.c * v / sg],
    ];
}

function buildFracMatrix(c: Cell): number[][] {
    // Frac = inverse of orth.
    const M = buildOrthMatrix(c);
    return invert3(M);
}

function invert3(m: number[][]): number[][] {
    const a = m[0][0], b = m[0][1], cv = m[0][2];
    const d = m[1][0], e = m[1][1], f = m[1][2];
    const g = m[2][0], h = m[2][1], i = m[2][2];
    const det = a*(e*i - f*h) - b*(d*i - f*g) + cv*(d*h - e*g);
    return [
        [(e*i - f*h)/det, (cv*h - b*i)/det, (b*f - cv*e)/det],
        [(f*g - d*i)/det, (a*i - cv*g)/det, (cv*d - a*f)/det],
        [(d*h - e*g)/det, (b*g - a*h)/det, (a*e - b*d)/det],
    ];
}

function mat3xVec(m: number[][], v: [number,number,number]): [number,number,number] {
    return [
        m[0][0]*v[0] + m[0][1]*v[1] + m[0][2]*v[2],
        m[1][0]*v[0] + m[1][1]*v[1] + m[1][2]*v[2],
        m[2][0]*v[0] + m[2][1]*v[1] + m[2][2]*v[2],
    ];
}

// Apply a symmetry op in fractional coords, then convert back to orthogonal.
// Includes a unit-cell translation offset to bring the result near a target.
function applySymOpToAtom(
    a: AtomRec, op: OpMat, cell: Cell, fracM: number[][], orthM: number[][], cellOffset: [number,number,number],
): AtomRec {
    // ortho -> frac
    const f = mat3xVec(fracM, [a.x, a.y, a.z]);
    // apply rot + tran (rot * f + tran)
    const fr = mat3xVec(op.rot, f as [number,number,number]);
    fr[0] += op.tran[0] + cellOffset[0];
    fr[1] += op.tran[1] + cellOffset[1];
    fr[2] += op.tran[2] + cellOffset[2];
    // frac -> ortho
    const o = mat3xVec(orthM, fr);
    return { ...a, x: o[0], y: o[1], z: o[2] };
}

// ============================================================================
// Public: generate sym mates near a centre, within a radius
// ============================================================================

export interface SymMate {
    opIdx: number;
    opLabel: string;
    cellOffset: [number, number, number];
    atoms: AtomRec[];
}

export function generateSymMatesNear(
    mol: any,
    centre: [number, number, number],
    radius: number,
): SymMate[] {
    const cell = getCell(mol);
    if (!cell) return [];
    const ops = getSymOps(mol);
    const allAtoms = flattenMolecule(mol);
    if (allAtoms.length === 0) return [];
    const orthM = buildOrthMatrix(cell);
    const fracM = buildFracMatrix(cell);
    // Pre-filter to CA only -- much cheaper to check distance + still useful
    // for "trace" rendering. (Full all-atom is left as a heavier option for
    // a future iteration.)
    const caAtoms = allAtoms.filter(a => a.atomName.trim().toUpperCase() === "CA");
    if (caAtoms.length === 0) return [];
    const out: SymMate[] = [];
    const r2 = radius * radius;
    // Search adjacent unit cells: a 3x3x3 envelope around (0,0,0).
    for (let opIdx = 0; opIdx < ops.length; opIdx++) {
        const op = ops[opIdx];
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const cellOffset: [number,number,number] = [dx, dy, dz];
                    // Transform a sample of atoms first to bail early if the whole
                    // copy is far from the centre.
                    let anyClose = false;
                    for (let k = 0; k < caAtoms.length; k += Math.max(1, Math.floor(caAtoms.length / 30))) {
                        const t = applySymOpToAtom(caAtoms[k], op, cell, fracM, orthM, cellOffset);
                        const ddx = t.x - centre[0], ddy = t.y - centre[1], ddz = t.z - centre[2];
                        if (ddx*ddx + ddy*ddy + ddz*ddz <= r2) { anyClose = true; break; }
                    }
                    if (!anyClose) continue;
                    // Full transform of the CA trace.
                    const transformed: AtomRec[] = [];
                    for (const a of caAtoms) {
                        const t = applySymOpToAtom(a, op, cell, fracM, orthM, cellOffset);
                        const ddx = t.x - centre[0], ddy = t.y - centre[1], ddz = t.z - centre[2];
                        if (ddx*ddx + ddy*ddy + ddz*ddz <= r2 * 1.5) transformed.push(t);
                    }
                    if (transformed.length > 0) {
                        out.push({
                            opIdx, opLabel: op.label,
                            cellOffset, atoms: transformed,
                        });
                    }
                }
            }
        }
    }
    return out;
}

// ============================================================================
// Rendering: cell box + sym mate traces -> MoorhenVector entries
// ============================================================================

// 8 corners of the unit cell box, in orthogonal coords.
function cellCornersOrtho(cell: Cell): [number, number, number][] {
    const M = buildOrthMatrix(cell);
    const corners: [number,number,number][] = [];
    for (const z of [0, 1]) for (const y of [0, 1]) for (const x of [0, 1]) {
        corners.push(mat3xVec(M, [x, y, z]) as [number,number,number]);
    }
    return corners;
}

const BOX_EDGES = [
    [0, 1], [2, 3], [4, 5], [6, 7],   // x edges
    [0, 2], [1, 3], [4, 6], [5, 7],   // y edges
    [0, 4], [1, 5], [2, 6], [3, 7],   // z edges
];

export function unitCellBoxVectors(mol: any): any[] {
    const cell = getCell(mol);
    if (!cell) return [];
    const corners = cellCornersOrtho(cell);
    const out: any[] = [];
    for (let i = 0; i < BOX_EDGES.length; i++) {
        const [a, b] = BOX_EDGES[i];
        out.push({
            coordsMode: "points",
            labelMode: "none", labelText: "",
            drawMode: "cylinder", arrowMode: "none",
            xFrom: corners[a][0], yFrom: corners[a][1], zFrom: corners[a][2],
            xTo:   corners[b][0], yTo:   corners[b][1], zTo:   corners[b][2],
            cidFrom: "", cidTo: "", molFromUniqueId: "", molToUniqueId: "",
            uniqueId: `${PREFIX_CELL}-edge-${i}`,
            // 0-255 -- Moorhen's vectorsDraw.ts divides by 256 internally.
            vectorColour: { r: 140, g: 220, b: 255 },
            textColour: { r: 255, g: 255, b: 255 },
            radius: 0.04,
        });
    }
    return out;
}

// Distinct colours for sym mates (cycle). 0-255 (see comment in
// unitCellBoxVectors above).
const SYM_PALETTE = [
    { r: 255, g: 100, b: 100 },
    { r: 100, g: 255, b: 130 },
    { r: 255, g: 200, b: 75  },
    { r: 180, g: 140, b: 255 },
    { r: 255, g: 140, b: 220 },
    { r: 100, g: 215, b: 255 },
    { r: 240, g: 240, b: 140 },
    { r: 140, g: 255, b: 220 },
];

export function symMateTraceVectors(mate: SymMate, idSuffix: string): any[] {
    const colour = SYM_PALETTE[mate.opIdx % SYM_PALETTE.length];
    const out: any[] = [];
    // Group atoms by chain so we draw continuous traces per chain.
    const byChain = new Map<string, AtomRec[]>();
    for (const a of mate.atoms) {
        const k = a.chain;
        let arr = byChain.get(k); if (!arr) { arr = []; byChain.set(k, arr); }
        arr.push(a);
    }
    let i = 0;
    for (const [chain, atoms] of byChain) {
        // Sort by resNo (chain may already be in order, but be safe).
        atoms.sort((a, b) => a.resNo - b.resNo);
        for (let k = 0; k + 1 < atoms.length; k++) {
            const a = atoms[k], b = atoms[k + 1];
            // Skip "long" gaps (broken chains) so we don't bridge across them.
            const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
            const d2 = dx*dx + dy*dy + dz*dz;
            if (d2 > 25) continue;  // Cα-Cα >5 A typically = chain break
            out.push({
                coordsMode: "points",
                labelMode: "none", labelText: "",
                drawMode: "cylinder", arrowMode: "none",
                xFrom: a.x, yFrom: a.y, zFrom: a.z,
                xTo:   b.x, yTo:   b.y, zTo:   b.z,
                cidFrom: "", cidTo: "", molFromUniqueId: "", molToUniqueId: "",
                uniqueId: `${PREFIX_SYM}-${idSuffix}-${i++}`,
                vectorColour: colour,
                textColour: { r: 255, g: 255, b: 255 },
                radius: 0.05,
            });
        }
    }
    return out;
}

export const PREFIX_CELL_ALL = PREFIX_CELL;
export const PREFIX_SYM_ALL = PREFIX_SYM;
