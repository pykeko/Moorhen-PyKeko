// PyKeko v0.3 — View → Symmetry...
//
// Toggle the unit cell box and symmetry mate Cα traces. Mates are shown
// for spacegroup operators (within a 3x3x3 neighbouring-cell envelope)
// that bring any Cα within `radius` Å of the current rotation centre.
// Each operator is drawn in its own colour from a small palette.
//
// All rendering goes through Moorhen's vectorsSlice (same primitive as
// NCS ghosts + interaction overlays); the cell + sym overlays each use a
// distinct id-prefix so they toggle independently.

import { useCallback, useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import { MoorhenButton, MoorhenSlider } from "../inputs";
import { MoorhenStack } from "../interface-base";
import { enqueueSnackbar } from "@/store/";

export const SymmetryMenuItem = () => {
    const dispatch = useDispatch();
    const [showCell, setShowCell] = useState<boolean>(false);
    const [showMates, setShowMates] = useState<boolean>(false);
    const [radius, setRadius] = useState<number>(20);
    const [cellInfo, setCellInfo] = useState<{ spacegroup?: string; cell?: any } | null>(null);
    const [matesCount, setMatesCount] = useState<number>(0);
    const [busy, setBusy] = useState<boolean>(false);

    // Fetch cell info on mount so the user can see what they're dealing with.
    useEffect(() => {
        const api: any = (typeof window !== "undefined") ? (window as any).MoorhenControlApi : null;
        if (api?.getCellInfo) {
            api.getCellInfo().then((r: any) => { if (r?.ok) setCellInfo(r); }).catch(() => {});
        }
    }, []);

    const apply = useCallback(async () => {
        const api: any = (typeof window !== "undefined") ? (window as any).MoorhenControlApi : null;
        if (!api?.showCell || !api?.showSymmetry) {
            dispatch(enqueueSnackbar({ message: "Symmetry API not ready.", variant: "error" }));
            return;
        }
        setBusy(true);
        try {
            if (showCell) {
                const r = await api.showCell();
                if (!r?.ok) dispatch(enqueueSnackbar({ message: `Cell box: ${r?.error || "failed"}`, variant: "warning" }));
            } else {
                await api.hideCell();
            }
            if (showMates) {
                const r = await api.showSymmetry({ radius });
                if (r?.ok) {
                    setMatesCount(r.matesShown ?? 0);
                    dispatch(enqueueSnackbar({
                        message: `${r.matesShown} sym mate${r.matesShown === 1 ? "" : "s"} within ${radius} Å · spacegroup ${r.spacegroup}`,
                        variant: "info", autoHideDuration: 5000,
                    }));
                } else {
                    dispatch(enqueueSnackbar({ message: `Sym mates: ${r?.error || "failed"}`, variant: "warning" }));
                }
            } else {
                await api.hideSymmetry();
                setMatesCount(0);
            }
        } finally { setBusy(false); }
    }, [showCell, showMates, radius, dispatch]);

    const clearAll = useCallback(async () => {
        const api: any = (typeof window !== "undefined") ? (window as any).MoorhenControlApi : null;
        if (api?.hideCell) await api.hideCell();
        if (api?.hideSymmetry) await api.hideSymmetry();
        setShowCell(false); setShowMates(false); setMatesCount(0);
    }, []);

    return (
        <MoorhenStack gap="0.6rem" style={{ minWidth: 360 }}>
            {cellInfo?.cell ? (
                <div style={{ fontSize: "11.5px", color: "#495057", lineHeight: 1.4 }}>
                    <b>{cellInfo.spacegroup || "(no spacegroup)"}</b>
                    <span style={{ marginLeft: 8, fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>
                        a={cellInfo.cell.a.toFixed(2)} b={cellInfo.cell.b.toFixed(2)} c={cellInfo.cell.c.toFixed(2)} ·
                        α={cellInfo.cell.alpha} β={cellInfo.cell.beta} γ={cellInfo.cell.gamma}
                    </span>
                </div>
            ) : (
                <div style={{ fontSize: "11.5px", color: "#868e96" }}>
                    No active molecule with crystallographic info.
                </div>
            )}

            <MoorhenStack gap="0.2rem">
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "13px", cursor: "pointer" }}>
                    <input type="checkbox" checked={showCell} onChange={(e) => setShowCell(e.target.checked)} />
                    <span style={{
                        display: "inline-block", width: 14, height: 14,
                        background: "#8cd9ff", border: "1px solid #495057", borderRadius: 2,
                    }} />
                    <span>Unit cell box</span>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "13px", cursor: "pointer" }}>
                    <input type="checkbox" checked={showMates} onChange={(e) => setShowMates(e.target.checked)} />
                    <span style={{
                        display: "inline-block", width: 14, height: 14,
                        background: "linear-gradient(45deg, #ff6666, #66ff80)",
                        border: "1px solid #495057", borderRadius: 2,
                    }} />
                    <span>Symmetry mates (Cα trace)</span>
                    {matesCount > 0 && (
                        <span style={{ color: "#868e96", marginLeft: "auto", fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>
                            {matesCount} shown
                        </span>
                    )}
                </label>
            </MoorhenStack>

            <MoorhenSlider
                sliderTitle="Radius around rotation centre (Å) for sym-mate search"
                minVal={5}
                maxVal={60}
                logScale={false}
                stepButtons={2.5}
                externalValue={radius}
                setExternalValue={setRadius}
                decimalPlaces={1}
                showMinMaxVal={false}
            />

            <div style={{ display: "flex", gap: 8 }}>
                <MoorhenButton onClick={apply} disabled={busy}>
                    {busy ? "Applying…" : "Apply"}
                </MoorhenButton>
                <MoorhenButton onClick={clearAll} disabled={busy}>
                    Clear all
                </MoorhenButton>
            </div>

            <div style={{ fontSize: "11px", color: "#868e96", lineHeight: 1.4 }}>
                Tip: zoom out (mouse wheel) before showing the cell box; the cell is often much
                larger than a typical close-up view. Sym mate detection searches a 3×3×3 envelope
                of neighbouring unit cells, so mates can appear several cells away from the ASU.
            </div>
        </MoorhenStack>
    );
};
