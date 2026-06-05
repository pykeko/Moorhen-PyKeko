// "Export portable viewer (HTML)" menu item — PyKeko desktop app only.
// Collects coordinates + maps for the loaded scene, builds an MVS JSON
// document, and hands it to the wrapper IPC which injects it into the
// pre-built Mol* viewer template and writes a single self-contained .html
// via the native Save panel. Renders nothing in the browser build.
//
// When the scene has visible density maps, we pop a confirm dialog first:
// embedded maps balloon the HTML size, and not every export needs them
// (e.g. sharing a figure for a slide). Default keeps maps in; the user
// can uncheck to ship a structures-only file.
import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Dialog, DialogTitle, DialogContent, DialogActions, Typography, Box, FormControlLabel, Checkbox } from "@mui/material";
import { RootState, enqueueSnackbar } from "@/store";
import { moorhen } from "../../types/moorhen";
import { buildMvsJson, MvsMapInput } from "../../utils/MvsExportBuilder";
import { cropCcp4 } from "../../utils/MvsCcp4Crop";
import { captureCamera } from "../../utils/MvsCameraCapture";
import { MoorhenMenuItem } from "../interface-base/MenuItems/MenuItem";
import { MoorhenButton } from "../inputs";

// Half-side (Å) of the density cube embedded in the portable viewer. We
// embed a region wider than the on-screen "rolling sphere" so the viewer's
// camera-follow clip (default 20 Å sphere — see App.tsx DENSITY_CLIP_RADIUS)
// has room to wander before the user pans past the embedded data. ~2× the
// clip radius is a reasonable balance: file grows ~8× vs the old 20 Å cube
// (~250 KB → ~2 MB per map at typical 0.5 Å spacing) for ~2× wander room
// in each direction.
const DENSITY_CUBE_HALF_SIDE_ANGSTROMS = 40;

const rgbToHex = (rgb: { r: number; g: number; b: number } | null | undefined): string | undefined => {
    if (!rgb) return undefined;
    const to255 = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
    return "#" + [rgb.r, rgb.g, rgb.b].map(v => to255(v).toString(16).padStart(2, "0")).join("");
};

// Union XYZ centroid across all molecules — used as a fallback crop centre
// when no camera state is available (rare; only on the very first frame
// before the user has moved the view).
async function computeUnionCentroid(mols: moorhen.Molecule[]): Promise<[number, number, number] | null> {
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const m of mols) {
        const atoms = await m.gemmiAtomsForCid("/*/*/*/*");
        for (const a of atoms) { sx += a.x; sy += a.y; sz += a.z; n++; }
    }
    return n > 0 ? [sx / n, sy / n, sz / n] : null;
}

// Cheap "what would this map cost in the HTML?" estimate. The cropped CCP4
// is 4 bytes/voxel × (2 · halfSide / spacing)³, plus ~33% base64 overhead.
// We use a typical 0.5 Å spacing as a stand-in (Moorhen-loaded maps don't
// expose their grid spacing on the JS side without a round-trip).
const estimateMapBytes = (halfSideAng: number, spacing = 0.5): number => {
    const n = Math.max(1, Math.ceil((2 * halfSideAng) / spacing));
    return Math.ceil(n * n * n * 4 * 1.34);  // 4 bytes float × 4/3 base64
};
const formatBytes = (b: number): string => {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
};

export const ExportMvsViewer = () => {
    const dispatch = useDispatch();
    const molecules = useSelector((state: RootState) => state.molecules.moleculeList) as moorhen.Molecule[];
    const maps = useSelector((state: RootState) => state.maps) as any as moorhen.Map[];
    const visibleMaps = useSelector((state: RootState) => state.mapContourSettings.visibleMaps);

    // Confirm-dialog state. Opens when the menu item fires AND the scene has
    // visible maps; bypassed entirely for structure-only scenes (the dialog
    // would add a click for no information gain).
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [includeMaps, setIncludeMaps] = useState(true);

    const visibleMapSet = new Set(visibleMaps || []);
    const candidateMaps = (maps || []).filter(m => visibleMapSet.has(m.molNo));
    const estimatedMapBytes = candidateMaps.length * estimateMapBytes(DENSITY_CUBE_HALF_SIDE_ANGSTROMS);

    const handleClick = () => {
        const ctrl = (window as any).__moorhenControl;
        if (!ctrl?.exportMvsViewer) {
            dispatch(enqueueSnackbar({ message: "Portable viewer export is only available in the PyKeko desktop app", variant: "warning" }));
            return;
        }
        if (!molecules || molecules.length === 0) {
            dispatch(enqueueSnackbar({ message: "Load a structure first", variant: "warning" }));
            return;
        }
        if (candidateMaps.length === 0) {
            // No maps to ask about — go straight to save dialog.
            void doExport(false);
            return;
        }
        setIncludeMaps(true);  // re-arm default each time
        setConfirmOpen(true);
    };

    const doExport = async (withMaps: boolean) => {
        const ctrl = (window as any).__moorhenControl;
        // ctrl + molecules already validated by handleClick; this method is
        // also called directly from the dialog Save button after the same
        // checks. Defensive re-check is cheap.
        if (!ctrl?.exportMvsViewer || !molecules || molecules.length === 0) return;
        try {
            // --- Structures ---
            const mols = await Promise.all(molecules.map(async m => {
                // Ensure Moorhen has fetched the real Coot colour rules; without
                // this the export falls back to a fixed palette that doesn't
                // match what was on screen.
                if (!m.defaultColourRules) {
                    try { await m.fetchDefaultColourRules(); } catch { /* fall back to palette */ }
                }
                const rulesPair = (rules: any[] | undefined) => (rules || [])
                    .map((r: any) => ({
                        cid: r.cid as string,
                        color: r.color as string,
                        applyColourToNonCarbonAtoms: r.applyColourToNonCarbonAtoms === true,
                    }))
                    .filter((r: any) => typeof r.cid === "string" && typeof r.color === "string");
                const colourRules = rulesPair(m.defaultColourRules);
                // Collect the molecule's currently-visible representations.
                // Each rep carries its style + cid + per-rep colourRules; the
                // builder maps Moorhen styles → MVS rep types and applies the
                // rep-level rules first, falling back to molecule defaults.
                const representations = ((m.representations || []) as any[])
                    .filter((r: any) => r.visible !== false)
                    .map((r: any) => ({
                        style: r.style,
                        cid: r.cid,
                        colourRules: rulesPair(r.colourRules),
                        // Pass through bondOptions.width so the builder can derive an MVS
                        // ball_and_stick `size_factor` for thin-bond ("lines") reps. v0.2.17:
                        // before this, PyMOL "lines" and "sticks" both exported as default-
                        // thickness sticks because CBs → ball_and_stick collapsed the
                        // distinction (the in-app translator distinguishes them via
                        // bondOptions.width = 0.03 vs the default 0.10).
                        bondWidth: typeof r?.bondOptions?.width === "number" ? r.bondOptions.width : undefined,
                    }));
                return {
                    name: m.name,
                    // PDB rather than mmCIF: Coot's mmCIF writer doesn't tag polymer
                    // residues as polymer, so Mol*'s cartoon path can't fire (see builder).
                    coords: await m.getAtoms("pdb"),
                    // Per-chain colouring needs the actual chain letters (auth_asym_id).
                    chains: (m.sequences || []).map((s: any) => s.chain).filter(Boolean),
                    colourRules,
                    representations,
                };
            }));

            // --- Maps (visible only, opt-in) ---
            // Each map gets cropped to a cube around the camera target (matches
            // Moorhen's on-screen "sphere of density around the cursor"
            // behaviour). Falls back to molecule centroid if no camera state is
            // available. Cropping to a small cube (~20 Å half-side) keeps the
            // embedded file small AND the standalone viewer responsive —
            // meshing a whole-ASU isosurface costs the viewer dearly.
            const cam = captureCamera();
            const mapInputs: MvsMapInput[] = [];
            const skipped: string[] = [];
            if (withMaps && candidateMaps.length > 0) {
                const cropCenter: [number, number, number] | null = cam?.target
                    ?? (await computeUnionCentroid(molecules));
                if (!cropCenter) {
                    // Shouldn't happen given the molecule-loaded check; defensive.
                    throw new Error("Cannot determine crop center (no camera + no molecules)");
                }
                for (const m of candidateMaps) {
                    try {
                        const mapReply: any = await m.getMap();
                        const mapBuf: ArrayBuffer = mapReply?.data?.result?.mapData;
                        if (!mapBuf) { skipped.push(`${m.name} (no data)`); continue; }

                        const cropped = cropCcp4(mapBuf, {
                            centerXYZ: cropCenter,
                            radiusAngstroms: DENSITY_CUBE_HALF_SIDE_ANGSTROMS,
                        });

                        const params = m.getMapContourParams();
                        // contourLevel is in ABSOLUTE density units (Moorhen's
                        // slider exposes σ but stores absolute, multiplying by
                        // the map's RMSD under the hood). Pass straight through
                        // as absolute_isovalue. For a map that was just loaded
                        // and never UI-adjusted, the Redux entry is missing —
                        // fall back to the map's own suggestedContourLevel (set
                        // by Coot's auto-fit at load time) so the export still
                        // matches what's on screen.
                        const contourAbsolute: number | null = typeof params?.contourLevel === "number"
                            ? params.contourLevel
                            : (typeof m.suggestedContourLevel === "number" ? m.suggestedContourLevel : null);

                        mapInputs.push({
                            name: m.name,
                            bytes: cropped.bytes,
                            isDifference: !!m.isDifference,
                            contourAbsolute,
                            color: rgbToHex(params?.mapColour as any) ?? "#3a86ff",
                            positiveColor: rgbToHex(params?.positiveMapColour as any),
                            negativeColor: rgbToHex(params?.negativeMapColour as any),
                        });
                    } catch (e: any) {
                        skipped.push(`${m.name} (${e?.message || e})`);
                    }
                }
            }

            const mvsJson = buildMvsJson({
                molecules: mols,
                maps: mapInputs,
                camera: cam,
                title: `PyKeko — ${mols.map(m => m.name).join(", ")}`,
            });
            const suggestedName = (mols[0]?.name || "pykeko") + "_viewer.html";
            const r = await ctrl.exportMvsViewer(mvsJson, suggestedName);
            if (r?.ok) {
                const mapInfo = mapInputs.length > 0 ? ` (${mapInputs.length} map${mapInputs.length > 1 ? "s" : ""})` : "";
                dispatch(enqueueSnackbar({ message: `Saved portable viewer${mapInfo} to ${r.path}`, variant: "success" }));
                if (skipped.length > 0) {
                    dispatch(enqueueSnackbar({ message: `Skipped maps: ${skipped.join(", ")}`, variant: "warning" }));
                }
            } else if (r?.canceled) {
                dispatch(enqueueSnackbar({ message: "Export canceled", variant: "info" }));
            } else {
                dispatch(enqueueSnackbar({ message: `Export failed: ${r?.error || "unknown error"}`, variant: "error" }));
            }
        } catch (e: any) {
            dispatch(enqueueSnackbar({ message: `Export failed: ${e?.message || e}`, variant: "error" }));
        }
        document.body.click();
    };

    // Only meaningful inside the Electron wrapper (the browser build can't write to disk
    // and lacks the bundled viewer template).
    if (typeof window === "undefined" || !(window as any).__moorhenControl?.exportMvsViewer) return null;

    const confirmAndExport = (withMaps: boolean) => {
        setConfirmOpen(false);
        void doExport(withMaps);
    };

    return (
        <>
            <MoorhenMenuItem onClick={handleClick}>
                Export portable viewer (.html)…
            </MoorhenMenuItem>
            <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Export portable viewer</DialogTitle>
                <DialogContent>
                    <Typography variant="body2" gutterBottom>
                        {molecules.length} molecule{molecules.length === 1 ? "" : "s"}:
                        {" "}{molecules.map(m => m.name).join(", ")}
                    </Typography>
                    <Typography variant="body2" gutterBottom>
                        {candidateMaps.length} visible map{candidateMaps.length === 1 ? "" : "s"}:
                        {" "}{candidateMaps.map(m => m.name).join(", ")}
                    </Typography>
                    <Box sx={{ mt: 2, p: 1.5, backgroundColor: "rgba(77,171,247,0.10)", borderRadius: 1 }}>
                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={includeMaps}
                                    onChange={e => setIncludeMaps(e.target.checked)}
                                />
                            }
                            label={
                                <Typography variant="body2">
                                    Include density map{candidateMaps.length === 1 ? "" : "s"}
                                    {" "}<Typography component="span" variant="caption" color="text.secondary">
                                        (≈ {formatBytes(estimatedMapBytes)} added to the HTML; cropped to a
                                        {" "}{DENSITY_CUBE_HALF_SIDE_ANGSTROMS} Å cube around the current view)
                                    </Typography>
                                </Typography>
                            }
                        />
                        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5, ml: 4 }}>
                            Unchecking ships structures only (much smaller file, no density).
                        </Typography>
                    </Box>
                </DialogContent>
                <DialogActions>
                    <MoorhenButton variant="secondary" onClick={() => setConfirmOpen(false)}>
                        Cancel
                    </MoorhenButton>
                    <MoorhenButton variant="primary" onClick={() => confirmAndExport(includeMaps)}>
                        Save…
                    </MoorhenButton>
                </DialogActions>
            </Dialog>
        </>
    );
};
