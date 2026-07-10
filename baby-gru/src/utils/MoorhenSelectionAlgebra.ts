// PyKeko v0.3 — selection algebra.
//
// PyMOL-style selection language over the atoms in loaded molecules.
// Operators (high to low precedence):
//   ()                    -- grouping
//   not, byres, byobj     -- unary
//   within R [A] of EXPR  -- distance predicate (binds tighter than and/or)
//   and                   -- intersection
//   or                    -- union
//
// Primitives:
//   all, none
//   chain A | chain A+B+C
//   resi 100 | resi 100-200 | resi 100+105+200-210
//   resn ALA | resn ALA+GLY+SER
//   name CA | name CA+CB+CG
//   b > 30 | b < 50 | b >= 30 | b <= 50 | b = 25
//   q > 0.5                     (occupancy, same operators as b)
//   mol 0 | mol 0+1             (molNo)
//   polymer | organic | solvent | water | metals | hydro | protein | nucleic
//   <saved_name>                (looked up in savedSelections map)
//
// Grammar:
//   expr      := or_expr
//   or_expr   := and_expr ('or' and_expr)*
//   and_expr  := within_expr ('and' within_expr)*
//   within_expr := unary_expr ('within' NUM ['A'|'Å'] 'of' unary_expr)?
//   unary_expr := ('not' | 'byres' | 'byobj') unary_expr | primary
//   primary   := '(' expr ')' | atom_pred | class | ident
//
// Examples:
//   "byres polymer within 5 of organic"
//   "chain A and resi 100-200 and not name H+H1+H2"
//   "(b > 50 or q < 0.5) and polymer"
//
// The parser produces an AST that's evaluated against a flat list of atom
// records walked out of gemmi (see resolveSelection at the bottom). The
// pure-AST functions are usable from unit tests without needing a live
// gemmi structure.

// ============================================================================
// AST
// ============================================================================

type CmpOp = ">" | "<" | ">=" | "<=" | "=";

export type SelExpr =
    | { kind: "all" }
    | { kind: "none" }
    | { kind: "chain"; values: string[] }
    | { kind: "resi"; ranges: { from: number; to: number }[] }
    | { kind: "resn"; values: string[] }
    | { kind: "name"; values: string[] }
    | { kind: "bfactor"; op: CmpOp; value: number }
    | { kind: "occupancy"; op: CmpOp; value: number }
    | { kind: "mol"; molNos: number[] }
    | { kind: "class"; className: ChemClass }
    | { kind: "saved"; name: string }
    | { kind: "not"; expr: SelExpr }
    | { kind: "and"; left: SelExpr; right: SelExpr }
    | { kind: "or"; left: SelExpr; right: SelExpr }
    | { kind: "byres"; expr: SelExpr }
    | { kind: "byobj"; expr: SelExpr }
    | { kind: "within"; radius: number; outer: SelExpr; inner: SelExpr };

export type ChemClass =
    | "polymer" | "organic" | "solvent" | "water"
    | "metals" | "hydro" | "protein" | "nucleic";

// Flat atom record the evaluator works against. Decoupled from gemmi so the
// parser+evaluator stay unit-testable in isolation.
export interface AtomRec {
    molNo: number;
    molName: string;
    chain: string;
    resNo: number;
    insCode: string;
    resName: string;
    atomName: string;
    element: string;
    altConf: string;
    occ: number;
    b: number;
    x: number; y: number; z: number;
    // Pre-computed handles for byres/byobj expansion.
    residueKey: string;  // molNo:chain:resNo:insCode
    moleculeKey: number; // = molNo
}

// ============================================================================
// Tokeniser
// ============================================================================

type Token =
    | { t: "lparen" } | { t: "rparen" }
    | { t: "kw"; v: string }       // reserved keyword (and, or, not, byres, byobj, within, of, all, none, chain, resi, resn, name, b, q, mol, plus class names)
    | { t: "id"; v: string }       // identifier (saved selection name)
    | { t: "num"; v: number }
    | { t: "list"; v: string[] }   // a+b+c list following a primitive
    | { t: "range"; from: number; to: number }
    | { t: "op"; v: CmpOp };

const KEYWORDS = new Set([
    "all", "none", "and", "or", "not", "byres", "byobj", "within", "of",
    "chain", "resi", "resn", "name", "b", "q", "mol",
    "polymer", "organic", "solvent", "water", "metals", "hydro",
    "protein", "nucleic",
    "a", "å", // optional "within R A of" / "within R Å of" units
]);

function tokenize(src: string): Token[] {
    const out: Token[] = [];
    let i = 0;
    const s = src.trim();
    while (i < s.length) {
        const c = s[i];
        if (/\s/.test(c)) { i++; continue; }
        if (c === "(") { out.push({ t: "lparen" }); i++; continue; }
        if (c === ")") { out.push({ t: "rparen" }); i++; continue; }
        // Comparison operators (try 2-char first)
        if (c === ">" && s[i + 1] === "=") { out.push({ t: "op", v: ">=" }); i += 2; continue; }
        if (c === "<" && s[i + 1] === "=") { out.push({ t: "op", v: "<=" }); i += 2; continue; }
        if (c === ">") { out.push({ t: "op", v: ">" }); i++; continue; }
        if (c === "<") { out.push({ t: "op", v: "<" }); i++; continue; }
        if (c === "=") { out.push({ t: "op", v: "=" }); i++; continue; }
        // Wildcard `*`, optionally as part of a `+`-list (e.g. `CA+*`, `*+CB`).
        // A bare `*` means "match all", handled at parseStringList/parseResi.
        // `*` inside a list dominates: any list containing `*` is equivalent to
        // no filter at all, since a wildcard subsumes the other list entries.
        if (c === "*") {
            let rest = "*";
            i++;
            while (s[i] === "+") {
                rest += s[i]; i++;
                const next = s.slice(i).match(/^[A-Za-z0-9_*]+/);
                if (!next) break;
                rest += next[0]; i += next[0].length;
            }
            // Emit as list — the parser handles a single-item list containing "*"
            // the same as any other list; parseStringList/parseResi collapse "*"
            // to an empty match set (= match everything).
            out.push({ t: "list", v: rest.split("+") });
            continue;
        }
        // Number / number-list / range / digit-leading identifier
        // Handle leading digit specially: if it's a `digit (- or +) digit`
        // pattern we want a list/range token, not a "num followed by negative num".
        // If a digit sequence is followed by alpha characters (e.g. `6ZV`,
        // `2HOH`), treat the whole thing as a string identifier -- PDB
        // ligand codes can start with a digit, and `resn 6ZV` should not
        // lex as `num(6) id(ZV)`.
        if (/[\d.]/.test(c)) {
            const numMatch = s.slice(i).match(/^\d+(?:\.\d+)?/);
            if (numMatch) {
                const after = s[i + numMatch[0].length];
                // Digit-leading identifier: `\d+[A-Za-z][A-Za-z0-9_]*`
                if (after && /[A-Za-z_]/.test(after)) {
                    const idMatch = s.slice(i).match(/^\d+[A-Za-z_][A-Za-z0-9_]*/);
                    if (idMatch) {
                        let rest = idMatch[0];
                        i += idMatch[0].length;
                        // If followed by + (list separator), collect more parts.
                        while (s[i] === "+") {
                            rest += s[i]; i++;
                            const next = s.slice(i).match(/^[A-Za-z0-9_*]+/);
                            if (!next) break;
                            rest += next[0]; i += next[0].length;
                        }
                        out.push({ t: "list", v: rest.split("+") });
                        continue;
                    }
                }
                if (after === "+" || (after === "-" && /\d/.test(s[i + numMatch[0].length + 1] || ""))) {
                    // Range or list -- lex the whole thing as composite list token
                    let rest = numMatch[0];
                    i += numMatch[0].length;
                    while (s[i] === "+" || (s[i] === "-" && /\d/.test(s[i + 1] || ""))) {
                        rest += s[i];
                        i++;
                        const next = s.slice(i).match(/^\d+(?:\.\d+)?/);
                        if (!next) break;
                        rest += next[0];
                        i += next[0].length;
                    }
                    // Split on `+` then each chunk is `N` or `N-M`.
                    out.push({ t: "list", v: rest.split("+") });
                    continue;
                }
                out.push({ t: "num", v: parseFloat(numMatch[0]) });
                i += numMatch[0].length;
                continue;
            }
        }
        // Leading minus (could be a negative number for b/q comparisons)
        if (c === "-" && /\d/.test(s[i + 1] || "")) {
            const m = s.slice(i).match(/^-\d+(?:\.\d+)?/);
            if (m) {
                out.push({ t: "num", v: parseFloat(m[0]) });
                i += m[0].length;
                continue;
            }
        }
        // Identifier or keyword (alphanumeric + underscore, may include + for
        // lists like "A+B+C" or "100-200+205").
        const m = s.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
        if (m) {
            const word = m[0];
            const lower = word.toLowerCase();
            i += word.length;
            // Following + or - introduces a list/range — but only if NOT
            // a comparison op context. Lex the whole list as one composite
            // token when we see an alphanum followed by + (commonly used for
            // "ALA+GLY+SER" or "100-200+205").
            if (s[i] === "+" || (s[i] === "-" && /[A-Za-z0-9]/.test(s[i + 1] || ""))) {
                // Continue lexing the list / range chunks.
                let rest = word;
                while (s[i] === "+" || (s[i] === "-" && /[A-Za-z0-9]/.test(s[i + 1] || ""))) {
                    rest += s[i];
                    i++;
                    const next = s.slice(i).match(/^[A-Za-z0-9*]+/);
                    if (!next) break;
                    rest += next[0];
                    i += next[0].length;
                }
                // Heuristic: if every chunk parses as a number or range,
                // emit a list of numeric ranges. Otherwise emit a list of strings.
                const parts = rest.split("+");
                const ranges = parts.map(p => parseRangePart(p)).filter(Boolean) as { from: number; to: number }[];
                if (ranges.length === parts.length) {
                    // Emit as a sequence of range tokens via a list. Caller
                    // will need to know this is a number/range list — encode
                    // via the "list" token with stringified values; callers
                    // decide based on what follows.
                    out.push({ t: "list", v: parts });
                } else {
                    out.push({ t: "list", v: parts });
                }
                continue;
            }
            if (KEYWORDS.has(lower)) {
                out.push({ t: "kw", v: lower });
            } else {
                out.push({ t: "id", v: word });
            }
            continue;
        }
        throw new Error(`Selection: unexpected character "${c}" at position ${i}`);
    }
    return out;
}

function parseRangePart(s: string): { from: number; to: number } | null {
    const m = s.match(/^(-?\d+)(?:-(-?\d+))?$/);
    if (!m) return null;
    const from = parseInt(m[1], 10);
    const to = m[2] !== undefined ? parseInt(m[2], 10) : from;
    return { from: Math.min(from, to), to: Math.max(from, to) };
}

// ============================================================================
// Parser
// ============================================================================

class Parser {
    private i = 0;
    constructor(private toks: Token[]) {}

    private peek(): Token | undefined { return this.toks[this.i]; }
    private eat(): Token { return this.toks[this.i++]; }
    private peekKw(v: string): boolean { const t = this.peek(); return !!t && t.t === "kw" && t.v === v; }
    private eatKw(v: string): boolean { if (this.peekKw(v)) { this.i++; return true; } return false; }

    parse(): SelExpr {
        const e = this.parseOr();
        if (this.peek()) throw new Error("Selection: trailing tokens after expression");
        return e;
    }

    private parseOr(): SelExpr {
        let left = this.parseAnd();
        while (this.eatKw("or")) {
            const right = this.parseAnd();
            left = { kind: "or", left, right };
        }
        return left;
    }

    private parseAnd(): SelExpr {
        let left = this.parseWithin();
        while (this.eatKw("and")) {
            const right = this.parseWithin();
            left = { kind: "and", left, right };
        }
        return left;
    }

    private parseWithin(): SelExpr {
        // Bare `within R of Y` (no outer given) means `all within R of Y`.
        // Match PyMOL's convention: distance predicates with no left-hand
        // selection default to the universe.
        let outer: SelExpr;
        if (this.peekKw("within")) {
            outer = { kind: "all" };
        } else {
            outer = this.parseUnary();
        }
        if (this.eatKw("within")) {
            const numTok = this.eat();
            if (!numTok || numTok.t !== "num") throw new Error("Selection: 'within' needs a numeric radius");
            // Optional unit (A / Å)
            this.eatKw("a"); this.eatKw("å");
            if (!this.eatKw("of")) throw new Error("Selection: expected 'of' after 'within R'");
            const inner = this.parseUnary();
            return { kind: "within", radius: numTok.v, outer, inner };
        }
        return outer;
    }

    private parseUnary(): SelExpr {
        if (this.eatKw("not"))   return { kind: "not",   expr: this.parseUnary() };
        if (this.eatKw("byres")) return { kind: "byres", expr: this.parseUnary() };
        if (this.eatKw("byobj")) return { kind: "byobj", expr: this.parseUnary() };
        return this.parsePrimary();
    }

    private parsePrimary(): SelExpr {
        const t = this.peek();
        if (!t) throw new Error("Selection: unexpected end of expression");
        if (t.t === "lparen") {
            this.eat();
            const e = this.parseOr();
            const close = this.eat();
            if (!close || close.t !== "rparen") throw new Error("Selection: missing closing paren");
            return e;
        }
        if (t.t === "kw") {
            switch (t.v) {
                case "all":    this.eat(); return { kind: "all" };
                case "none":   this.eat(); return { kind: "none" };
                case "polymer": case "organic": case "solvent": case "water":
                case "metals": case "hydro": case "protein": case "nucleic":
                    this.eat(); return { kind: "class", className: t.v as ChemClass };
                case "chain": return this.parseStringList("chain");
                case "resn":  return this.parseStringList("resn");
                case "name":  return this.parseStringList("name");
                case "resi":  return this.parseResi();
                case "mol":   return this.parseMol();
                case "b":     return this.parseCmp("bfactor");
                case "q":     return this.parseCmp("occupancy");
            }
        }
        if (t.t === "id") {
            this.eat();
            // bare identifier = saved selection lookup
            return { kind: "saved", name: t.v };
        }
        throw new Error("Selection: unexpected token " + JSON.stringify(t));
    }

    private parseStringList(kind: "chain" | "resn" | "name"): SelExpr {
        this.eat(); // consume the keyword
        const t = this.eat();
        if (!t) throw new Error(`Selection: '${kind}' needs a value`);
        let values: string[];
        if (t.t === "list") values = t.v.map(s => s.toUpperCase());
        else if (t.t === "id" || t.t === "kw") values = [(t.v as string).toUpperCase()];
        else if (t.t === "num") values = [String(t.v)];
        else throw new Error(`Selection: '${kind}' got unexpected token ${JSON.stringify(t)}`);
        // Wildcard collapse: if any value is `*`, the whole list matches
        // everything. Return `all` so downstream matching is trivial.
        // (Empty-values would be interpreted as "no match", not "match all",
        // so we don't just filter `*` out.)
        if (values.some(v => v === "*")) return { kind: "all" };
        return { kind, values } as any;
    }

    private parseResi(): SelExpr {
        this.eat();
        const t = this.eat();
        if (!t) throw new Error("Selection: 'resi' needs a value");
        let ranges: { from: number; to: number }[];
        if (t.t === "num") {
            ranges = [{ from: t.v, to: t.v }];
        } else if (t.t === "list") {
            // `resi *` (or `resi 100+*`) collapses to match-all.
            if (t.v.some(v => v === "*")) return { kind: "all" };
            ranges = t.v.map(s => parseRangePart(s)).filter(Boolean) as any;
            if (ranges.length === 0) throw new Error("Selection: 'resi' got non-numeric values");
        } else throw new Error("Selection: 'resi' got " + JSON.stringify(t));
        return { kind: "resi", ranges };
    }

    private parseMol(): SelExpr {
        this.eat();
        const t = this.eat();
        if (!t) throw new Error("Selection: 'mol' needs a value");
        let molNos: number[];
        if (t.t === "num") molNos = [t.v];
        else if (t.t === "list") molNos = t.v.map(s => parseFloat(s)).filter(x => Number.isFinite(x));
        else throw new Error("Selection: 'mol' got " + JSON.stringify(t));
        return { kind: "mol", molNos };
    }

    private parseCmp(kind: "bfactor" | "occupancy"): SelExpr {
        this.eat(); // b or q
        const op = this.eat();
        if (!op || op.t !== "op") throw new Error(`Selection: '${kind === "bfactor" ? "b" : "q"}' needs a comparison op (>, <, >=, <=, =)`);
        const n = this.eat();
        if (!n || n.t !== "num") throw new Error(`Selection: '${kind === "bfactor" ? "b" : "q"}' op needs a number`);
        return { kind, op: op.v, value: n.v };
    }
}

export function parseSelection(src: string): SelExpr {
    const toks = tokenize(src);
    if (toks.length === 0) return { kind: "none" };
    return new Parser(toks).parse();
}

// ============================================================================
// Chemical-class predicates
// ============================================================================

const STANDARD_AA = new Set([
    "ALA", "ARG", "ASN", "ASP", "CYS", "GLN", "GLU", "GLY", "HIS", "ILE",
    "LEU", "LYS", "MET", "PHE", "PRO", "SER", "THR", "TRP", "TYR", "VAL",
    "MSE", "SEC", "PYL", "HYP",
]);
const STANDARD_NA = new Set(["A", "C", "G", "U", "T", "DA", "DC", "DG", "DT", "I", "DI"]);
const WATER = new Set(["HOH", "WAT", "H2O", "DOD", "TIP", "TIP3", "TIP4", "SPC"]);
const SOLVENT_EXTRA = new Set([
    "SO4", "PO4", "GOL", "EDO", "PEG", "MPD", "DMS", "ACT", "FMT", "CIT",
    "TRS", "BME", "EPE", "MES", "BTB", "HEP", "DMSO", "CL", "NA", "K", "BR", "I",
]); // common cryo / buffer extras
const COMMON_METALS = new Set([
    "MG", "CA", "ZN", "FE", "FE2", "FE3", "MN", "MN2", "MN3", "NI", "CU",
    "CO", "CD", "HG", "PT", "AU", "AG", "PB", "BA", "SR", "RB", "CS", "LI",
    "AL", "GA", "CR", "MO", "W", "U", "V",
]);

function atomIsHydrogen(a: AtomRec): boolean {
    const el = (a.element || "").toUpperCase();
    if (el === "H" || el === "D") return true;
    // Fall back to name heuristic if element missing
    const n = a.atomName.trim();
    return n.length > 0 && (n[0] === "H" || n[0] === "D");
}

function isChemClass(a: AtomRec, c: ChemClass): boolean {
    const r = a.resName.toUpperCase();
    switch (c) {
        case "water":   return WATER.has(r);
        case "solvent": return WATER.has(r) || SOLVENT_EXTRA.has(r);
        case "metals":  return COMMON_METALS.has(r);
        case "hydro":   return atomIsHydrogen(a);
        case "protein": return STANDARD_AA.has(r);
        case "nucleic": return STANDARD_NA.has(r);
        case "polymer": return STANDARD_AA.has(r) || STANDARD_NA.has(r);
        case "organic":
            // Non-polymer, non-water, non-solvent, non-metal, not a standalone ion
            return !STANDARD_AA.has(r) && !STANDARD_NA.has(r)
                && !WATER.has(r) && !SOLVENT_EXTRA.has(r)
                && !COMMON_METALS.has(r);
    }
}

// ============================================================================
// Evaluator
// ============================================================================

export interface EvalCtx {
    atoms: AtomRec[];
    saved?: Map<string, SelExpr>;
}

function cmp(op: CmpOp, lhs: number, rhs: number): boolean {
    switch (op) {
        case ">":  return lhs >  rhs;
        case "<":  return lhs <  rhs;
        case ">=": return lhs >= rhs;
        case "<=": return lhs <= rhs;
        case "=":  return Math.abs(lhs - rhs) < 1e-6;
    }
}

function matches(e: SelExpr, a: AtomRec, ctx: EvalCtx): boolean {
    switch (e.kind) {
        case "all":  return true;
        case "none": return false;
        case "chain": return e.values.includes(a.chain.toUpperCase());
        case "resi":  return e.ranges.some(r => a.resNo >= r.from && a.resNo <= r.to);
        case "resn":  return e.values.includes(a.resName.toUpperCase());
        case "name":  return e.values.includes(a.atomName.trim().toUpperCase());
        case "bfactor":    return cmp(e.op, a.b, e.value);
        case "occupancy":  return cmp(e.op, a.occ, e.value);
        case "mol":   return e.molNos.includes(a.molNo);
        case "class": return isChemClass(a, e.className);
        case "saved": {
            const sub = ctx.saved?.get(e.name);
            if (!sub) throw new Error(`Selection: unknown name '${e.name}'`);
            return matches(sub, a, ctx);
        }
        case "not": return !matches(e.expr, a, ctx);
        case "and": return matches(e.left, a, ctx) && matches(e.right, a, ctx);
        case "or":  return matches(e.left, a, ctx) || matches(e.right, a, ctx);
        // byres / byobj / within are expand-then-filter — handled at the set level
        case "byres": case "byobj": case "within":
            throw new Error("matches() shouldn't see byres/byobj/within — use evaluate()");
    }
}

export function evaluate(e: SelExpr, ctx: EvalCtx): Set<number> {
    // For byres/byobj/within we need set-level operations; everything else is
    // per-atom and can be lifted from matches().
    if (e.kind === "byres") {
        const inner = evaluate(e.expr, ctx);
        const residueKeys = new Set<string>();
        for (const i of inner) residueKeys.add(ctx.atoms[i].residueKey);
        const out = new Set<number>();
        for (let i = 0; i < ctx.atoms.length; i++) {
            if (residueKeys.has(ctx.atoms[i].residueKey)) out.add(i);
        }
        return out;
    }
    if (e.kind === "byobj") {
        const inner = evaluate(e.expr, ctx);
        const molNos = new Set<number>();
        for (const i of inner) molNos.add(ctx.atoms[i].molNo);
        const out = new Set<number>();
        for (let i = 0; i < ctx.atoms.length; i++) {
            if (molNos.has(ctx.atoms[i].molNo)) out.add(i);
        }
        return out;
    }
    if (e.kind === "within") {
        const inner = evaluate(e.inner, ctx);
        if (inner.size === 0) return new Set();
        // Build a quick coord array for inner atoms; O(N*M) sweep is fine
        // for typical pocket queries (M = inner = O(10-100) atoms).
        const innerCoords: { x: number; y: number; z: number }[] = [];
        for (const i of inner) {
            const a = ctx.atoms[i];
            innerCoords.push({ x: a.x, y: a.y, z: a.z });
        }
        const r2 = e.radius * e.radius;
        const outerCandidates = evaluate(e.outer, ctx);
        const out = new Set<number>();
        for (const i of outerCandidates) {
            const a = ctx.atoms[i];
            for (const ic of innerCoords) {
                const dx = a.x - ic.x, dy = a.y - ic.y, dz = a.z - ic.z;
                if (dx * dx + dy * dy + dz * dz <= r2) { out.add(i); break; }
            }
        }
        return out;
    }
    if (e.kind === "and") {
        // If the right side is a set-level expression (byres/byobj/within), or
        // resolves through a `saved` name to one, matches() would throw.
        // Evaluate it fully and intersect.
        const isSetLevel = (n: SelExpr): boolean => {
            if (n.kind === "byres" || n.kind === "byobj" || n.kind === "within") return true;
            if (n.kind === "saved") {
                const sub = ctx.saved?.get(n.name);
                return sub ? isSetLevel(sub) : false;
            }
            return false;
        };
        if (isSetLevel(e.right)) {
            const a = evaluate(e.left, ctx);
            const b = evaluate(e.right, ctx);
            const out = new Set<number>();
            for (const i of a) if (b.has(i)) out.add(i);
            return out;
        }
        const a = evaluate(e.left, ctx);
        const out = new Set<number>();
        for (const i of a) if (matches(e.right, ctx.atoms[i], ctx)) out.add(i);
        return out;
    }
    if (e.kind === "or") {
        const a = evaluate(e.left, ctx);
        const b = evaluate(e.right, ctx);
        const out = new Set<number>(a);
        for (const i of b) out.add(i);
        return out;
    }
    if (e.kind === "not") {
        const inner = evaluate(e.expr, ctx);
        const out = new Set<number>();
        for (let i = 0; i < ctx.atoms.length; i++) if (!inner.has(i)) out.add(i);
        return out;
    }
    if (e.kind === "saved") {
        // Saved-name resolution at the set level — the referenced expression
        // may contain byres/byobj/within, in which case matches() would throw.
        // Recurse through evaluate() with the substituted sub.
        const sub = ctx.saved?.get(e.name);
        if (!sub) throw new Error(`Selection: unknown name '${e.name}'`);
        return evaluate(sub, ctx);
    }
    // Simple per-atom predicate.
    const out = new Set<number>();
    for (let i = 0; i < ctx.atoms.length; i++) {
        if (matches(e, ctx.atoms[i], ctx)) out.add(i);
    }
    return out;
}

// ============================================================================
// Gemmi adapter — walk loaded molecules into AtomRec[]
// ============================================================================

// Walk a MoorhenMolecule's gemmi structure and return flat atom records.
// Bumps every embind handle's refcount; the caller doesn't need to clean up.
export function flattenMolecule(mol: any): AtomRec[] {
    const out: AtomRec[] = [];
    const gs = mol?.gemmiStructure;
    if (!gs || gs.isDeleted?.()) return out;
    const models = gs.models;
    const modelsSize = models.size();
    for (let mi = 0; mi < modelsSize; mi++) {
        const model = models.get(mi);
        const chains = model.chains;
        const chainsSize = chains.size();
        for (let ci = 0; ci < chainsSize; ci++) {
            const chain = chains.get(ci);
            const chainName = chain.name;
            const residues = chain.residues;
            const residuesSize = residues.size();
            for (let ri = 0; ri < residuesSize; ri++) {
                const residue = residues.get(ri);
                const resName = residue.name;
                const resNo = residue.seqid.num.value;
                const insCode = residue.seqid.icode || "";
                const residueKey = `${mol.molNo}:${chainName}:${resNo}:${insCode}`;
                const atoms = residue.atoms;
                const atomsSize = atoms.size();
                for (let ai = 0; ai < atomsSize; ai++) {
                    const atom = atoms.get(ai);
                    const pos = atom.pos;
                    const elemHandle = atom.element;
                    // Moorhen exposes Element via a helper that converts to a string.
                    // `atom.element` itself is an embind handle; reading `.name` on it
                    // doesn't give the symbol the way you'd expect.
                    const elementStr: string = (() => {
                        try {
                            const mod = (window as any).CCP4Module;
                            if (mod?.getElementNameAsString) return String(mod.getElementNameAsString(elemHandle) || "");
                        } catch (e) { /* fall through */ }
                        return "";
                    })();
                    out.push({
                        molNo: mol.molNo,
                        molName: mol.name,
                        chain: chainName,
                        resNo,
                        insCode,
                        resName,
                        atomName: atom.name,
                        element: elementStr,
                        altConf: atom.altloc || "",
                        occ: atom.occ,
                        b: atom.b_iso,
                        x: pos.x, y: pos.y, z: pos.z,
                        residueKey,
                        moleculeKey: mol.molNo,
                    });
                    pos.delete?.();
                    elemHandle?.delete?.();
                    atom.delete?.();
                }
                atoms.delete?.();
                residue.delete?.();
            }
            residues.delete?.();
            chain.delete?.();
        }
        chains.delete?.();
        model.delete?.();
    }
    models.delete?.();
    return out;
}

// Convert a Set<atom-index> back to a list of short-form CIDs grouped by
// molecule. Coalesces adjacent residues within the same chain into ranges.
// Returns one CID per chain per molecule per atom-name group — the cheapest
// shape that's still useful for downstream commands. For atom-level
// downstream (e.g. measurement picking) use atomIdsToFlatCids instead.
export function atomIdsToShortCids(ids: Set<number>, atoms: AtomRec[]): string[] {
    if (ids.size === 0) return [];
    // Group by mol -> chain -> resNo (set) -> atomName (set)
    type ResEntry = { atomNames: Set<string> };
    type ChainEntry = Map<number, ResEntry>;
    type MolEntry = Map<string, ChainEntry>;
    const tree = new Map<number, MolEntry>();
    for (const i of ids) {
        const a = atoms[i];
        let mol = tree.get(a.molNo); if (!mol) { mol = new Map(); tree.set(a.molNo, mol); }
        let chain = mol.get(a.chain); if (!chain) { chain = new Map(); mol.set(a.chain, chain); }
        let res = chain.get(a.resNo); if (!res) { res = { atomNames: new Set() }; chain.set(a.resNo, res); }
        res.atomNames.add(a.atomName.trim());
    }
    const out: string[] = [];
    for (const [molNo, mol] of tree) {
        for (const [chain, residues] of mol) {
            // Build sorted res list, coalesce into ranges.
            const sortedRes = [...residues.keys()].sort((a, b) => a - b);
            const ranges: string[] = [];
            let runStart = sortedRes[0], runEnd = sortedRes[0];
            for (let k = 1; k < sortedRes.length; k++) {
                if (sortedRes[k] === runEnd + 1) { runEnd = sortedRes[k]; continue; }
                ranges.push(runStart === runEnd ? String(runStart) : `${runStart}-${runEnd}`);
                runStart = runEnd = sortedRes[k];
            }
            ranges.push(runStart === runEnd ? String(runStart) : `${runStart}-${runEnd}`);
            // Atom-name suffix: if all residues in this chain share the same
            // single atom name, append it; otherwise emit one CID per
            // (range, atom-name) combo to stay accurate.
            const allAtomNames = new Set<string>();
            for (const r of residues.values()) for (const n of r.atomNames) allAtomNames.add(n);
            if (allAtomNames.size === 1) {
                const an = [...allAtomNames][0];
                out.push(`/${molNo}/${chain}/${ranges.join("+")}/${an}`);
            } else {
                // Use wildcard atom suffix — selection covers the residues whole
                // (callers needing finer granularity should request flat CIDs).
                out.push(`/${molNo}/${chain}/${ranges.join("+")}/*`);
            }
        }
    }
    return out;
}

// One CID per atom — for callers that need exact granularity (measurements,
// distance picking). The result list is typically huge for large selections;
// prefer atomIdsToShortCids for display / colour-rule purposes.
export function atomIdsToFlatCids(ids: Set<number>, atoms: AtomRec[]): string[] {
    const out: string[] = [];
    for (const i of ids) {
        const a = atoms[i];
        out.push(`/${a.molNo}/${a.chain}/${a.resNo}${a.insCode}/${a.atomName.trim()}`);
    }
    return out;
}

// ============================================================================
// Top-level helper for ControlApi consumers
// ============================================================================

export function evaluateSelectionOnMolecules(
    expr: string,
    molecules: any[],
    savedSelectionExpressions?: Record<string, string>,
): { atoms: AtomRec[]; ids: Set<number>; cids: string[]; count: number } {
    const ast = parseSelection(expr);
    const atoms: AtomRec[] = [];
    for (const m of molecules) atoms.push(...flattenMolecule(m));
    const savedAst = new Map<string, SelExpr>();
    if (savedSelectionExpressions) {
        for (const [n, e] of Object.entries(savedSelectionExpressions)) {
            try { savedAst.set(n, parseSelection(e)); } catch { /* skip bad saved entries */ }
        }
    }
    const ids = evaluate(ast, { atoms, saved: savedAst });
    const cids = atomIdsToShortCids(ids, atoms);
    return { atoms, ids, cids, count: ids.size };
}
