// PyKeko v0.3 — interaction detection + overlay rendering.
//
// Four overlays sharing one pseudobond primitive (Moorhen's vectorsSlice):
//   - Hydrogen bonds  (donor-acceptor distance, dashed yellow)
//   - Salt bridges    (charged N <-> charged O within 4 A, solid blue)
//   - Disulfides      (Cys SG-SG within 2.3 A, solid gold)
//   - Clashes         (overlap > 0.4 A vs sum-of-vdW, solid hot-pink)
//
// All four reuse the AtomRec[] flat-atom representation from the selection
// algebra module, so this file has no gemmi-handling code of its own --
// callers pass the flattened atoms in.
//
// Donor/acceptor table is a curated subset of the ChimeraX / PyMOL canonical
// list, narrowed for the standard 20 AAs + nucleotides + common ligand atom
// types (handled by element fallback for non-standard residues).

import { AtomRec } from "./MoorhenSelectionAlgebra";

export type InteractionType = "hbond" | "salt" | "disulfide" | "clash";

export interface InteractionBond {
    a: AtomRec;
    b: AtomRec;
    distance: number;
    type: InteractionType;
}

// ============================================================================
// Donor / acceptor tables
// ============================================================================

// Side-chain donors per residue: atoms that can donate an H-bond (have N-H
// or O-H in the canonical protonation state). Backbone N is donor for every
// residue except PRO and is handled separately.
const SIDECHAIN_DONORS: Record<string, string[]> = {
    ARG: ["NE", "NH1", "NH2"],
    LYS: ["NZ"],
    HIS: ["ND1", "NE2"],   // both protonatable; treat as both donor + acceptor
    ASN: ["ND2"],
    GLN: ["NE2"],
    TRP: ["NE1"],
    SER: ["OG"],
    THR: ["OG1"],
    TYR: ["OH"],
    CYS: ["SG"],           // weak donor
};
// Side-chain acceptors per residue. Backbone O is acceptor for every residue.
const SIDECHAIN_ACCEPTORS: Record<string, string[]> = {
    ASP: ["OD1", "OD2"],
    GLU: ["OE1", "OE2"],
    ASN: ["OD1"],
    GLN: ["OE1"],
    HIS: ["ND1", "NE2"],
    SER: ["OG"],
    THR: ["OG1"],
    TYR: ["OH"],
    MET: ["SD"],           // weak acceptor
    CYS: ["SG"],
};
const POSITIVE: Record<string, string[]> = {
    ARG: ["NE", "NH1", "NH2"],
    LYS: ["NZ"],
    HIS: ["ND1", "NE2"],   // includes when protonated
};
const NEGATIVE: Record<string, string[]> = {
    ASP: ["OD1", "OD2"],
    GLU: ["OE1", "OE2"],
};

// van der Waals radii (Å). Bondi 1964 + extensions for crystallographic
// ions, halogens, metals. Default 1.7 for unknowns.
const VDW: Record<string, number> = {
    H: 1.20, D: 1.20,
    C: 1.70, N: 1.55, O: 1.52, S: 1.80, P: 1.80,
    F: 1.47, CL: 1.75, BR: 1.85, I: 1.98,
    SE: 1.90,
    MG: 1.73, CA: 2.31, ZN: 1.39, FE: 1.94, MN: 2.05, CU: 1.40, NI: 1.63,
    NA: 2.27, K: 2.75,
};

function vdw(el: string): number {
    return VDW[(el || "").toUpperCase()] ?? 1.7;
}

function isHydrogen(a: AtomRec): boolean {
    const el = (a.element || "").toUpperCase();
    if (el === "H" || el === "D") return true;
    const n = a.atomName.trim();
    return n.length > 0 && (n[0] === "H" || n[0] === "D");
}

function isBackboneN(a: AtomRec): boolean { return a.atomName.trim() === "N"; }
function isBackboneO(a: AtomRec): boolean { return a.atomName.trim() === "O"; }

function isDonor(a: AtomRec): boolean {
    const name = a.atomName.trim().toUpperCase();
    const resn = a.resName.toUpperCase();
    // Backbone N (except proline)
    if (name === "N" && resn !== "PRO") return true;
    const sc = SIDECHAIN_DONORS[resn];
    if (sc && sc.includes(name)) return true;
    // Non-standard residues / ligands: N/O/S as element heuristic
    const el = (a.element || "").toUpperCase();
    if ((el === "N" || el === "O" || el === "S") && !SIDECHAIN_ACCEPTORS[resn]) return true;
    return false;
}

function isAcceptor(a: AtomRec): boolean {
    const name = a.atomName.trim().toUpperCase();
    const resn = a.resName.toUpperCase();
    if (name === "O") return true;  // backbone O
    const sc = SIDECHAIN_ACCEPTORS[resn];
    if (sc && sc.includes(name)) return true;
    const el = (a.element || "").toUpperCase();
    if ((el === "N" || el === "O" || el === "S") && !SIDECHAIN_DONORS[resn]) return true;
    return false;
}

function isPositive(a: AtomRec): boolean {
    const name = a.atomName.trim().toUpperCase();
    const sc = POSITIVE[a.resName.toUpperCase()];
    return !!sc && sc.includes(name);
}

function isNegative(a: AtomRec): boolean {
    const name = a.atomName.trim().toUpperCase();
    const sc = NEGATIVE[a.resName.toUpperCase()];
    return !!sc && sc.includes(name);
}

function isCysSG(a: AtomRec): boolean {
    return a.resName.toUpperCase() === "CYS" && a.atomName.trim().toUpperCase() === "SG";
}

// Same residue OR adjacent in the same chain (skip bonded backbone N/C pairs
// for clash filtering).
function sameResOrAdjacent(a: AtomRec, b: AtomRec): boolean {
    if (a.molNo !== b.molNo) return false;
    if (a.chain !== b.chain) return false;
    if (a.resNo === b.resNo && a.insCode === b.insCode) return true;
    if (Math.abs(a.resNo - b.resNo) === 1) return true;
    return false;
}

// ============================================================================
// Spatial index (uniform-grid bucketing for O(N) pair finding)
// ============================================================================

class Grid {
    private cells = new Map<string, number[]>();
    constructor(private atoms: AtomRec[], private cellSize: number) {
        for (let i = 0; i < atoms.length; i++) {
            const a = atoms[i];
            const k = this.key(a.x, a.y, a.z);
            let bucket = this.cells.get(k);
            if (!bucket) { bucket = []; this.cells.set(k, bucket); }
            bucket.push(i);
        }
    }
    private key(x: number, y: number, z: number): string {
        const cs = this.cellSize;
        return `${Math.floor(x / cs)}:${Math.floor(y / cs)}:${Math.floor(z / cs)}`;
    }
    // Iterate over atom indices within `radius` of (x,y,z). May yield duplicates
    // if radius > cellSize -- caller should de-dup.
    neighbours(x: number, y: number, z: number, radius: number): number[] {
        const cs = this.cellSize;
        const r = Math.max(1, Math.ceil(radius / cs));
        const cx = Math.floor(x / cs), cy = Math.floor(y / cs), cz = Math.floor(z / cs);
        const out: number[] = [];
        for (let dx = -r; dx <= r; dx++) {
            for (let dy = -r; dy <= r; dy++) {
                for (let dz = -r; dz <= r; dz++) {
                    const k = `${cx + dx}:${cy + dy}:${cz + dz}`;
                    const bucket = this.cells.get(k);
                    if (bucket) for (const i of bucket) out.push(i);
                }
            }
        }
        return out;
    }
}

// ============================================================================
// Detection
// ============================================================================

const HBOND_MIN = 2.5;
const HBOND_MAX = 3.5;
const SALT_MAX = 4.0;
const DISULFIDE_MAX = 2.3;
const CLASH_OVERLAP = 0.4;

function distance2(a: AtomRec, b: AtomRec): number {
    const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    return dx * dx + dy * dy + dz * dz;
}

export function detectHBonds(atoms: AtomRec[]): InteractionBond[] {
    if (atoms.length === 0) return [];
    const grid = new Grid(atoms, HBOND_MAX);
    const max2 = HBOND_MAX * HBOND_MAX;
    const min2 = HBOND_MIN * HBOND_MIN;
    const out: InteractionBond[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < atoms.length; i++) {
        const a = atoms[i];
        if (isHydrogen(a)) continue;
        if (!isDonor(a)) continue;
        const cand = grid.neighbours(a.x, a.y, a.z, HBOND_MAX);
        for (const j of cand) {
            if (j <= i) continue;
            const b = atoms[j];
            if (isHydrogen(b)) continue;
            if (!isAcceptor(b)) continue;
            if (sameResOrAdjacent(a, b)) continue;
            const d2 = distance2(a, b);
            if (d2 < min2 || d2 > max2) continue;
            const key = `${i}:${j}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ a, b, distance: Math.sqrt(d2), type: "hbond" });
        }
    }
    return out;
}

export function detectSaltBridges(atoms: AtomRec[]): InteractionBond[] {
    if (atoms.length === 0) return [];
    const grid = new Grid(atoms, SALT_MAX);
    const max2 = SALT_MAX * SALT_MAX;
    const out: InteractionBond[] = [];
    for (let i = 0; i < atoms.length; i++) {
        const a = atoms[i];
        if (!isPositive(a)) continue;
        const cand = grid.neighbours(a.x, a.y, a.z, SALT_MAX);
        for (const j of cand) {
            if (j === i) continue;
            const b = atoms[j];
            if (!isNegative(b)) continue;
            if (sameResOrAdjacent(a, b)) continue;
            const d2 = distance2(a, b);
            if (d2 > max2) continue;
            out.push({ a, b, distance: Math.sqrt(d2), type: "salt" });
        }
    }
    return out;
}

export function detectDisulfides(atoms: AtomRec[]): InteractionBond[] {
    if (atoms.length === 0) return [];
    const sgIndices: number[] = [];
    for (let i = 0; i < atoms.length; i++) if (isCysSG(atoms[i])) sgIndices.push(i);
    const out: InteractionBond[] = [];
    const max2 = DISULFIDE_MAX * DISULFIDE_MAX;
    for (let i = 0; i < sgIndices.length; i++) {
        for (let j = i + 1; j < sgIndices.length; j++) {
            const a = atoms[sgIndices[i]], b = atoms[sgIndices[j]];
            if (a.resNo === b.resNo && a.chain === b.chain && a.molNo === b.molNo) continue;
            const d2 = distance2(a, b);
            if (d2 > max2) continue;
            out.push({ a, b, distance: Math.sqrt(d2), type: "disulfide" });
        }
    }
    return out;
}

export function detectClashes(atoms: AtomRec[]): InteractionBond[] {
    if (atoms.length === 0) return [];
    // Maximum vdW sum we'll ever check: 2 * max(vdw) ~= 4.6 A. Cap at 5 A.
    const grid = new Grid(atoms, 5);
    const out: InteractionBond[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < atoms.length; i++) {
        const a = atoms[i];
        if (isHydrogen(a)) continue;
        const ra = vdw(a.element);
        const cand = grid.neighbours(a.x, a.y, a.z, 5);
        for (const j of cand) {
            if (j <= i) continue;
            const b = atoms[j];
            if (isHydrogen(b)) continue;
            if (sameResOrAdjacent(a, b)) continue;
            const rb = vdw(b.element);
            const threshold = (ra + rb) - CLASH_OVERLAP;
            const t2 = threshold * threshold;
            const d2 = distance2(a, b);
            if (d2 >= t2) continue;
            const key = `${i}:${j}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ a, b, distance: Math.sqrt(d2), type: "clash" });
        }
    }
    return out;
}

// ============================================================================
// Overlay-rendering helpers (build MoorhenVector[] for vectorsSlice)
// ============================================================================

export interface OverlayStyle {
    drawMode: "cylinder" | "dashedcylinder";
    color: { r: number; g: number; b: number };
    radius: number;
    label: boolean;
}

const STYLES: Record<InteractionType, OverlayStyle> = {
    hbond:     { drawMode: "dashedcylinder", color: { r: 1.0, g: 0.85, b: 0.20 }, radius: 0.04, label: false },
    salt:      { drawMode: "cylinder",        color: { r: 0.40, g: 0.55, b: 1.0 },  radius: 0.06, label: false },
    disulfide: { drawMode: "cylinder",        color: { r: 1.0, g: 0.85, b: 0.10 }, radius: 0.08, label: false },
    clash:     { drawMode: "cylinder",        color: { r: 1.0, g: 0.20, b: 0.40 }, radius: 0.06, label: true  },
};

// Build MoorhenVector entries for a batch of bonds. uniqueId prefix lets
// the caller remove this batch alone via removeVectorsMatchingIDString.
export function bondsToVectors(bonds: InteractionBond[], idPrefix: string): any[] {
    const out: any[] = [];
    for (let i = 0; i < bonds.length; i++) {
        const b = bonds[i];
        const style = STYLES[b.type];
        out.push({
            coordsMode: "points",
            labelMode: style.label ? "middle" : "none",
            labelText: style.label ? b.distance.toFixed(2) : "",
            drawMode: style.drawMode,
            arrowMode: "none",
            xFrom: b.a.x, yFrom: b.a.y, zFrom: b.a.z,
            xTo:   b.b.x, yTo:   b.b.y, zTo:   b.b.z,
            cidFrom: "",
            cidTo: "",
            molFromUniqueId: "",
            molToUniqueId: "",
            uniqueId: `${idPrefix}-${i}`,
            vectorColour: style.color,
            textColour: { r: 1, g: 1, b: 1 },
            radius: style.radius,
        });
    }
    return out;
}

// ============================================================================
// Top-level orchestrator for the ControlApi
// ============================================================================

export function detectAll(
    atoms: AtomRec[],
    types: InteractionType[],
): Record<InteractionType, InteractionBond[]> {
    const r: Record<InteractionType, InteractionBond[]> = {
        hbond: [], salt: [], disulfide: [], clash: [],
    };
    for (const t of types) {
        switch (t) {
            case "hbond":     r.hbond     = detectHBonds(atoms); break;
            case "salt":      r.salt      = detectSaltBridges(atoms); break;
            case "disulfide": r.disulfide = detectDisulfides(atoms); break;
            case "clash":     r.clash     = detectClashes(atoms); break;
        }
    }
    return r;
}

export const OVERLAY_ID_PREFIX: Record<InteractionType, string> = {
    hbond: "pykeko-hbond",
    salt: "pykeko-salt",
    disulfide: "pykeko-disulfide",
    clash: "pykeko-clash",
};
