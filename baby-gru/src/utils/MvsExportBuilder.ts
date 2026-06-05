// Build a MolViewSpec (MVS) JSON document describing the current PyKeko scene
// for the self-contained Mol* viewer template (wrapper writes it into the HTML
// at export time).
//
// Scope:
//   - One or more molecules, embedded as base64-PDB data URLs. Each molecule
//     can carry the actual visible Moorhen representations (CBs/CRs/Surface
//     etc.) along with their per-rep colour rules. When no reps are supplied
//     we fall back to a polymer→cartoon default.
//   - One or more maps, embedded as base64-CCP4 data URLs (already cropped
//     to model+padding by MvsCcp4Crop). 2Fo-Fc → single isosurface in the
//     map's colour; difference maps → two isosurfaces (+green, -red) at
//     ±contour.
//   - Camera (root-level) if supplied by MvsCameraCapture.
//
// The schema (kind/params/children) mirrors molstar/lib/extensions/mvs/tree
// and is what `MVSData.fromMVSJ(...)` + `loadMVS(...)` consume.

export interface MvsColourRule {
    cid: string;
    color: string;
    /** When false (Moorhen's default), the rule's colour applies ONLY to
     *  carbon atoms; non-carbon atoms (N/O/S/P/...) keep CPK element
     *  defaults. When true, every atom in the cid gets the colour.
     *  Optional — defaults to true so callers that don't know about this
     *  flag get the simple "colour everything" behaviour. */
    applyColourToNonCarbonAtoms?: boolean;
}

export interface MvsRepInput {
    /** Moorhen RepresentationStyles value (CBs, CRs, MolecularSurface, ...). */
    style: string;
    /** Coot CID selecting the atoms this rep applies to (e.g. "/&#42;/&#42;/&#42;/&#42;" = all atoms). */
    cid: string;
    /** Colour rules attached to THIS rep (may be empty — fall back to the
     *  molecule's defaultColourRules). */
    colourRules?: MvsColourRule[];
}

export interface MvsMoleculeInput {
    name: string;
    /** Coordinate text (PDB format) to embed as a data URL. */
    coords: string;
    /** Chain ids (auth_asym_id). Used as a last-resort fallback when no
     *  representations + no colourRules were supplied. */
    chains: string[];
    /** Molecule-level defaultColourRules (from Coot's `get_colour_rules`).
     *  Used as the colour source for any representation that has no rules
     *  of its own. */
    colourRules?: MvsColourRule[];
    /** Visible Moorhen representations. Each emits one (or more) MVS
     *  components according to its style. When empty/missing we emit a
     *  single polymer→cartoon as the catch-all so something draws. */
    representations?: MvsRepInput[];
}

export interface MvsMapInput {
    name: string;
    /** Raw CCP4 bytes (post-crop). */
    bytes: Uint8Array;
    /** True for Fo-Fc style maps — emits a second negative-isovalue surface. */
    isDifference: boolean;
    /** Contour level in ABSOLUTE density units (what Moorhen stores). Passed
     *  to MVS as `absolute_isovalue` so the displayed isosurface exactly
     *  matches what the user was looking at in PyKeko. The Mol* UI exposes
     *  a Relative/Absolute toggle on the slider so users can switch to σ. */
    contourAbsolute: number | null;
    /** Hex colour for 2Fo-Fc style maps. Ignored for diff maps (which use
     *  fixed green/red, matching Coot/Moorhen defaults). */
    color: string;
    /** Diff-map colours; used only when isDifference=true. */
    positiveColor?: string;
    negativeColor?: string;
}

export interface MvsCameraInput {
    target: [number, number, number];
    position: [number, number, number];
    up?: [number, number, number];
}

export interface MvsExportOptions {
    molecules: MvsMoleculeInput[];
    maps?: MvsMapInput[];
    camera?: MvsCameraInput | null;
    title?: string;
    backgroundColor?: string;
}

// Distinct hexes for chain colouring. MVS's `color` node is uniform-only
// (no built-in "chain-id rainbow" theme), so we emit one `color` node per
// chain with an `auth_asym_id` selector. Cycled for >10 chains. Used only
// in the last-resort fallback path (no reps, no rules).
const CHAIN_PALETTE = [
    "#9067cf", "#f08e3c", "#5ab4ac", "#d6604d", "#67a9cf",
    "#fee08b", "#bf812d", "#80cdc1", "#c994c7", "#a6dba0",
];

// UTF-8-safe base64 for text. (PDB is ASCII but stay robust.)
const textToBase64 = (text: string): string => {
    const bytes = new TextEncoder().encode(text);
    return bytesToBase64(bytes);
};

// Chunked base64 for binary; native btoa explodes on long single strings.
const bytesToBase64 = (bytes: Uint8Array): string => {
    let bin = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
    }
    return btoa(bin);
};

const node = (kind: string, params: any = {}, children: any[] = []) => ({ kind, params, children });

// Parse a Moorhen CID into an MVS selector object. Format is
// `/mdl/chain/resno(ins)/atom:alt`; we handle the cases that matter for
// colour rules + rep selectors. Wildcards `*` mean "any" and translate to
// "no restriction on this field". Residue-name selectors `(RESN)` or
// `(RESN,RESN,...)` translate to auth_comp_id. Returns null for CIDs we
// don't know how to map. The constant `WHOLE` signals "no selector
// restriction" (caller emits no `selector` field).
const WHOLE_STRUCTURE: Record<string, any> = {};
const cidToMvsSelector = (cid: string): Record<string, any> | null => {
    if (!cid) return null;
    // Whole-structure forms used by Moorhen: //, /*/*/*/*, /*/*/*/*:*, etc.
    if (cid === "//" || cid.match(/^\/\*+\/\*+(\/\*+)?(\/\*+)?(:\*+)?$/)) return WHOLE_STRUCTURE;
    // Strip optional `:altloc` suffix; MVS has no alt-loc selector so we
    // can't honor it anyway.
    const noAlt = cid.split(":")[0];
    // /mdl/chain — most common chain-level rule
    let m = noAlt.match(/^\/[\d*]*\/([A-Za-z0-9]+)\/?$/);
    if (m) return { auth_asym_id: m[1] };
    // /mdl/chain/resno
    m = noAlt.match(/^\/[\d*]*\/([A-Za-z0-9]+)\/(-?\d+)\/?$/);
    if (m) return { auth_asym_id: m[1], auth_seq_id: parseInt(m[2], 10) };
    // /mdl/chain/r1-r2
    m = noAlt.match(/^\/[\d*]*\/([A-Za-z0-9]+)\/(-?\d+)-(-?\d+)\/?$/);
    if (m) return { auth_asym_id: m[1], beg_auth_seq_id: parseInt(m[2], 10), end_auth_seq_id: parseInt(m[3], 10) };
    // Specialized: /mdl/chain/(RESN)/atom forms — fall through to general parser below
    // (the early-return above only matched chain-only / residue-only / range cases).
    // Now the wildcard-friendly forms. Moorhen often emits things like
    // `/*/*/(ABM)/*` for a ligand selection, where any `*` field means
    // "don't restrict this dimension". We parse the 4-segment shape
    // (mdl/chain/res/atom) and translate each non-wildcard segment to
    // its MVS counterpart.
    //   chain segment:  '*' → skip; 'A' / 'AA' → auth_asym_id
    //   res segment:    '*' → skip; '(RESN)' or '(RESN,RESN)' → auth_comp_id;
    //                   integer → auth_seq_id; r1-r2 → beg/end_auth_seq_id
    //   atom segment:   '*' → skip; 'CA' → auth_atom_id
    const segs = noAlt.split("/");
    // /mdl/chain/res/atom = 5 pieces ("", mdl, chain, res, atom)
    if (segs.length === 5 && segs[0] === "") {
        const [_, _mdl, chainS, resS, atomS] = segs;
        const sel: Record<string, any> = {};
        // Chain
        if (chainS && chainS !== "*" && /^[A-Za-z0-9]+$/.test(chainS)) sel.auth_asym_id = chainS;
        else if (chainS && chainS !== "*") return null;   // can't represent chain set ('A,B')
        // Residue
        if (resS && resS !== "*") {
            // (RESN) or (RESN,RESN,...) — auth_comp_id selector. MVS takes
            // a single string here, so for a single name we set it directly;
            // for a comma list we'd need a union expression which MVS doesn't
            // straightforwardly support — fall back to first one and warn
            // (covers the typical single-ligand case).
            const nameMatch = resS.match(/^\(([^)]+)\)$/);
            if (nameMatch) {
                const names = nameMatch[1].split(",").map(s => s.trim()).filter(Boolean);
                if (names.length === 1) sel.auth_comp_id = names[0];
                else if (names.length > 1) {
                    // Only one name expressible per MVS component selector.
                    // Pick the first; the rest are silently dropped (rare path).
                    sel.auth_comp_id = names[0];
                }
            } else if (/^-?\d+$/.test(resS)) {
                sel.auth_seq_id = parseInt(resS, 10);
            } else if (/^-?\d+--?\d+$/.test(resS)) {
                const [a, b] = resS.split("-").map(s => parseInt(s, 10));
                sel.beg_auth_seq_id = a; sel.end_auth_seq_id = b;
            } else {
                return null;
            }
        }
        // Atom
        if (atomS && atomS !== "*") {
            // Atom names may have spaces ("CA  ") in PDB; strip.
            const atomName = atomS.trim();
            if (atomName) sel.auth_atom_id = atomName;
        }
        // All-wildcard segments → empty sel → treat as whole-structure.
        return Object.keys(sel).length === 0 ? WHOLE_STRUCTURE : sel;
    }
    return null;
};

// Jmol/RasMol/Mol* default CPK element colours. Used to preserve the
// heteroatom palette when a Moorhen rule has applyColourToNonCarbonAtoms=
// false (the default for chain colour rules). MVS's default colour theme
// applies its own element colours, but when we attach an explicit colour
// node it OVERRIDES theme colours — so we have to put them back explicitly.
const CPK_HETEROATOMS: { [elem: string]: string } = {
    N: "#3050f8",   H: "#ffffff",   O: "#ff0d0d",   S: "#ffff30",
    P: "#ff8000",   F: "#90e050",  CL: "#1ff01f",  BR: "#a62929",
    I: "#940094",  SE: "#ffa100",  FE: "#e06633",  ZN: "#7d80b0",
    CA: "#3dff00",  K: "#8f40d4",  NA: "#ab5cf2",  MG: "#8aff00",
    MN: "#9c7ac7", CU: "#c88033",
};

// Reps where per-element CPK colouring is meaningful (atoms render as
// distinct visual elements: spheres, sticks, surface dots). Cartoon /
// carbohydrate are continuous-geometry where only the dominant residue
// colour matters; per-element expansion there just bloats the JSON.
const CPK_RELEVANT_REPS = new Set(["ball_and_stick", "spacefill", "surface"]);

// Build colour child nodes from Moorhen rules. Returns an empty array if
// rules is empty/missing — caller decides on the fallback.
// Each rule may also carry applyColourToNonCarbonAtoms=false (Moorhen's
// default for chain rules) — in that case the rule's colour applies to
// carbon atoms ONLY, and we additionally emit CPK colours for heteroatoms
// in the same selector so the export visually matches Moorhen's display.
// CPK expansion is skipped for reps where it'd be meaningless (cartoon).
const colorNodesFromRules = (
    rules: MvsColourRule[] | undefined,
    mvsRepType?: string,
): any[] => {
    if (!rules || rules.length === 0) return [];
    const expandCpk = mvsRepType ? CPK_RELEVANT_REPS.has(mvsRepType) : true;
    const children: any[] = [];
    for (const r of rules) {
        const selector = cidToMvsSelector(r.cid);
        if (selector === null) continue;   // unparseable CID — skip
        const applyToHet = r.applyColourToNonCarbonAtoms !== false;
        if (applyToHet || !expandCpk) {
            // Simple case: paint everything in the selector with this colour.
            const params: any = { color: r.color };
            if (Object.keys(selector).length > 0) params.selector = selector;
            children.push(node("color", params));
        } else {
            // Carbons-only path: restrict the rule's colour to C atoms,
            // then add CPK overrides for heteroatoms in the same selector.
            const cSel = { ...selector, type_symbol: "C" };
            children.push(node("color", { selector: cSel, color: r.color }));
            for (const [elem, hex] of Object.entries(CPK_HETEROATOMS)) {
                const eSel = { ...selector, type_symbol: elem };
                children.push(node("color", { selector: eSel, color: hex }));
            }
        }
    }
    return children;
};

// Fallback chain-colour nodes when no rules are available at all.
const chainPaletteColorNodes = (chains: string[]) =>
    chains.map((c, i) => node("color", {
        selector: { auth_asym_id: c },
        color: CHAIN_PALETTE[i % CHAIN_PALETTE.length],
    }));

// Map a Moorhen rep style to {mvsType, selector}. selector="all"|"polymer"|
// "ligand"|"ion"|"water" → use MVS named selector; null → use the rep's own
// cid via cidToMvsSelector (or whole-structure if it's the catch-all).
// Returns null for styles that have no meaningful MVS equivalent (rama,
// rotamer, hover, environment, etc.) — those are skipped silently.
type RepMapping = { mvsType: string; selector: string | null };
const moorhenRepToMvs = (style: string): RepMapping | null => {
    switch (style) {
        case "CBs":              // carbon bonds (default sticks + bond lines)
        case "CAs":              // Cα trace (we render as ball_and_stick on backbone)
        case "CDs":              // contact dots-style bonds
        case "StickBases":       // nucleic acid bases as sticks
        case "ligands":          // ligand-only ball-and-stick
        case "adaptativeBonds":  // adaptive bonds
            return { mvsType: "ball_and_stick", selector: null };
        case "CRs":              // cartoon ribbons
            return { mvsType: "cartoon", selector: null };
        case "Calpha":           // Cα trace (cartoon-style spline)
            return { mvsType: "cartoon", selector: null };
        case "VdwSpheres":       // VdW spheres
            return { mvsType: "spacefill", selector: null };
        case "MolecularSurface": // Connolly surface
        case "VdWSurface":       // VdW surface
        case "gaussian":         // gaussian surface
        case "MetaBalls":        // metaball-style surface
            return { mvsType: "surface", selector: null };
        case "glycoBlocks":      // SNFG carbohydrate notation
            return { mvsType: "carbohydrate", selector: null };
        case "DishyBases":       // disc-shaped nucleic acid bases (no MVS equivalent → sticks fallback)
            return { mvsType: "ball_and_stick", selector: null };
        // UI helpers / validation overlays / non-exportable
        case "hover":
        case "environment":
        case "residue_environment":
        case "ligand_environment":
        case "residueSelection":
        case "rama":             // colour-by-Ramachandran (a colour theme, not a rep)
        case "rotamer":          // colour-by-rotamer
        case "allHBonds":
        case "contact_dots":
        case "chemical_features":
        case "ligand_validation":
        case "restraints":
        case "unitCell":
        case "transformation":
            return null;
        default:
            // Unknown style → fall back to ball_and_stick (least surprising
            // for an unrecognised structure rep).
            return { mvsType: "ball_and_stick", selector: null };
    }
};

// Emit a single MVS component+representation for one Moorhen rep. Returns
// null when the rep doesn't translate (UI helper, validation overlay).
// Colours: rep's own rules first, then molecule defaults, then a uniform
// fallback grey if neither are available.
const repToComponent = (
    rep: MvsRepInput,
    moleculeDefaultRules: { cid: string; color: string }[] | undefined,
    chains: string[],
): any | null => {
    const mapping = moorhenRepToMvs(rep.style);
    if (!mapping) return null;

    // Component selector. Three cases:
    //   - WHOLE_STRUCTURE (the catch-all "/*/*/*/*"): use MVS's "all" keyword.
    //   - null (unparseable CID — e.g. complex set algebra we don't handle):
    //     SKIP this rep with a warning. Falling back to "all" was a footgun:
    //     a spheres rep meant for a single ligand silently expanded to every
    //     atom in the scene (pk-v0.2.5 bug).
    //   - parsed object: use it.
    const cidSel = cidToMvsSelector(rep.cid);
    if (cidSel === null) {
        // eslint-disable-next-line no-console
        console.warn(`[MvsExportBuilder] dropping rep '${rep.style}' — CID '${rep.cid}' didn't parse to an MVS selector. Coverage in the export is reduced; the corresponding rep won't render.`);
        return null;
    }
    const componentSelector = cidSel === WHOLE_STRUCTURE ? "all" : cidSel;

    // Build colour children. Priority: rep's own rules > molecule defaults
    // > chain palette fallback > uniform grey. The mvsType is threaded
    // through so CPK heteroatom expansion only fires for reps where
    // per-element colouring is visible (sticks, spheres, surface).
    let colorChildren = colorNodesFromRules(rep.colourRules, mapping.mvsType);
    if (colorChildren.length === 0) colorChildren = colorNodesFromRules(moleculeDefaultRules, mapping.mvsType);
    if (colorChildren.length === 0 && chains.length > 0) colorChildren = chainPaletteColorNodes(chains);
    if (colorChildren.length === 0) colorChildren = [node("color", { color: "#888888" })];

    return node("component", { selector: componentSelector }, [
        node("representation", { type: mapping.mvsType }, colorChildren),
    ]);
};

const structureBranch = (m: MvsMoleculeInput) => {
    const dataUrl = "data:text/plain;base64," + textToBase64(m.coords);

    // Build one MVS component per visible Moorhen representation. Skip ones
    // that don't map. If after filtering we have nothing, emit a default
    // polymer-cartoon so the user sees something (matches the prior
    // hard-coded behavior for callers that don't pass representations).
    let structureChildren: any[] = [];
    if (m.representations && m.representations.length > 0) {
        for (const rep of m.representations) {
            const comp = repToComponent(rep, m.colourRules, m.chains);
            if (comp) structureChildren.push(comp);
        }
    }
    if (structureChildren.length === 0) {
        // Fallback: polymer→cartoon (+ligand/ion ball_and_stick) using whatever
        // colours we have. This is the original behavior, preserved for
        // callers that haven't been updated to pass representations yet.
        let polyColors = colorNodesFromRules(m.colourRules, "cartoon");
        if (polyColors.length === 0) polyColors = chainPaletteColorNodes(m.chains);
        structureChildren = [
            node("component", { selector: "polymer" }, [
                node("representation", { type: "cartoon" }, polyColors),
            ]),
            node("component", { selector: "ligand" }, [
                node("representation", { type: "ball_and_stick" }, [
                    node("color", { color: "#88dd88" }),
                ]),
            ]),
            node("component", { selector: "ion" }, [
                node("representation", { type: "ball_and_stick" }, [
                    node("color", { color: "#ffaa44" }),
                ]),
            ]),
        ];
    }

    return node("download", { url: dataUrl }, [
        // PDB rather than mmCIF: PyKeko/Coot's mmCIF writer doesn't emit
        // _entity_poly records and tags every atom as HETATM, so Mol*'s
        // `polymer` selector matches nothing (no cartoon). PDB's ATOM/HETATM
        // distinction is honoured correctly by Coot's writer.
        node("parse", { format: "pdb" }, [
            node("structure", { type: "model" }, structureChildren),
        ]),
    ]);
};

// One isosurface child node for a volume.
//   If `absoluteLevel` is given, we emit `absolute_isovalue` so the displayed
//   surface matches exactly what the user was looking at, independent of the
//   cropped map's recomputed stddev.
//   Otherwise we emit `relative_isovalue` (σ-multiples), which Mol* multiplies
//   by the map's RMSD at load time — sensible defaults for maps that came in
//   without a UI-set contour.
// Either way the Mol* slider exposes a Relative/Absolute toggle so users can
// switch interactively.
const isoSurface = (
    contour: { absolute: number } | { sigma: number },
    color: string,
    clipCenter?: [number, number, number] | null,
) => {
    const params: any = {
        type: "isosurface",
        show_wireframe: true,
        show_faces: false,
    };
    if ("absolute" in contour) params.absolute_isovalue = contour.absolute;
    else params.relative_isovalue = contour.sigma;
    // MVS distinguishes structure `representation` from `volume_representation`
    // — they take different param schemas. Use the volume one here.
    //
    // PyKeko 0.2.16: when we know the export-time camera target, emit a
    // declarative `clip` child node so the recipient viewer (whether ours or
    // any other MVS-aware tool) sees a sensibly-cropped sphere of density
    // BEFORE any post-load JS runs. wireCameraFollowDensity in our
    // viewer-template then takes over and re-anchors on every camera move.
    // Per molstar/molstar#1844 (dsehnal), MVS-layer clip uses radius
    // directly — no *2 half-scale gotcha that the raw transformer's
    // clip.objects[].scale slot has. radius=20 matches the camera-follow
    // radius in App.tsx, leaving the 40Å embedded cube as a comfortable
    // wander region.
    const reps: any[] = [ node("color", { color }) ];
    if (clipCenter) {
        reps.push(node("clip", {
            type: "sphere",
            center: clipCenter,
            radius: CLIP_RADIUS_ANGSTROMS,
            invert: true,        // keep INSIDE the sphere, discard outside
            variant: "pixel",    // per-fragment clipping; smoother than "object"
        }));
    }
    return node("volume_representation", params, reps);
};

// Radius of the sphere clip baked into each volume_representation at export
// time. wireCameraFollowDensity uses the SAME number on the recipient side so
// the static initial clip and the camera-follow update agree.
const CLIP_RADIUS_ANGSTROMS = 20;

const volumeBranch = (m: MvsMapInput, clipCenter?: [number, number, number] | null) => {
    const dataUrl = "data:application/octet-stream;base64," + bytesToBase64(m.bytes);
    const haveAbs = m.contourAbsolute !== null && m.contourAbsolute !== undefined;
    // For diff maps without an explicit contour, default to 3σ; for 2Fo-Fc, 1.5σ.
    const fallbackSigma = m.isDifference ? 3.0 : 1.5;
    const contourPos = haveAbs
        ? { absolute: m.contourAbsolute as number }
        : { sigma: fallbackSigma };
    const contourNeg = haveAbs
        ? { absolute: -(m.contourAbsolute as number) }
        : { sigma: -fallbackSigma };

    const reps = m.isDifference
        ? [
              isoSurface(contourPos, m.positiveColor ?? "#00cc44", clipCenter),  // +Fo-Fc — green
              isoSurface(contourNeg, m.negativeColor ?? "#cc0033", clipCenter),  // -Fo-Fc — red
          ]
        : [
              isoSurface(contourPos, m.color ?? "#3a86ff", clipCenter),           // 2mFo-DFc — blue
          ];

    return node("download", { url: dataUrl }, [
        node("parse", { format: "map" }, [
            node("volume", {}, reps),
        ]),
    ]);
};

export function buildMvsJson(opts: MvsExportOptions): string {
    const bg = opts.backgroundColor || "#000000";
    // PyKeko 0.2.16: when a camera is captured, feed its target into the
    // volume branches so they emit a declarative sphere clip centered there
    // (see isoSurface). Falls back to no-clip when no camera (the volume
    // shows uncropped — that's the previous behaviour).
    const clipCenter: [number, number, number] | null = opts.camera?.target ?? null;
    const children: any[] = [
        node("canvas", { background_color: bg }),
        ...opts.molecules.map(m => structureBranch(m)),
        ...(opts.maps || []).map(m => volumeBranch(m, clipCenter)),
    ];
    if (opts.camera) {
        // Camera is a root-level node, not nested inside the data branches.
        // Placed last so the doc's structure-first/maps-second/camera-last
        // reading order matches how Mol* sets things up.
        children.push(node("camera", {
            target: opts.camera.target,
            position: opts.camera.position,
            ...(opts.camera.up ? { up: opts.camera.up } : {}),
        }));
    }
    const doc = {
        metadata: {
            title: opts.title || "PyKeko export",
            version: "1",
            timestamp: new Date().toISOString(),
        },
        root: { kind: "root", params: {}, children },
    };
    return JSON.stringify(doc);
}
