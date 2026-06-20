// v0.3: Edit → Undo / Edit → Redo menu items. Resolves the active molecule
// the same way the keyboard-shortcut path does (commandCentre.history.
// lastModifiedMolNo), calls molecule.undo()/redo(), triggers a redraw.
//
// Why: Moorhen has undo/redo (bound to Ctrl+Z / Ctrl+Shift+Z, plus a buttons
// pair tucked into each per-molecule sidebar card) but no top-level Edit-menu
// entry. macOS users in particular expect Edit → Undo to exist next to its
// shortcut. With the v0.3 macOS Cmd+Z fix, those shortcuts also fire on
// ⌘Z / ⌘⇧Z, so the menu hint reads correctly.

import { useDispatch, useSelector } from "react-redux";
import { useCommandCentre } from "../../InstanceManager";
import { triggerUpdate } from "../../store/moleculeMapUpdateSlice";
import { moorhen } from "../../types/moorhen";
import { MoorhenMenuItem } from "../interface-base";
import { enqueueSnackbar } from "@/store/";

const isMac = typeof navigator !== "undefined" && /Mac|iP(hone|od|ad)/.test(navigator.platform || navigator.userAgent || "");
const cmdGlyph = isMac ? "⌘" : "Ctrl+";

const runUndoRedo = async (
    direction: "undo" | "redo",
    commandCentre: React.MutableRefObject<any>,
    molecules: moorhen.Molecule[],
    dispatch: any,
) => {
    const selectedMolNo = commandCentre.current?.history?.lastModifiedMolNo?.();
    const selectedMolecule = molecules.find(m => m.molNo === selectedMolNo);
    if (!selectedMolecule) {
        dispatch(enqueueSnackbar({
            message: `Nothing to ${direction} (no recently-modified molecule).`,
            variant: "info",
        }));
        return;
    }
    try {
        await (direction === "undo" ? selectedMolecule.undo() : selectedMolecule.redo());
        dispatch(triggerUpdate(selectedMolecule.molNo));
    } catch (e: any) {
        dispatch(enqueueSnackbar({
            message: `${direction[0].toUpperCase() + direction.slice(1)} failed: ${e?.message || e}`,
            variant: "error",
        }));
    }
};

export const UndoMenuItem = () => {
    const dispatch = useDispatch();
    const commandCentre = useCommandCentre();
    const molecules = useSelector((state: moorhen.State) => state.molecules.moleculeList);
    return (
        <MoorhenMenuItem onClick={() => runUndoRedo("undo", commandCentre, molecules, dispatch)}>
            Undo{`    ${cmdGlyph}Z`}
        </MoorhenMenuItem>
    );
};

export const RedoMenuItem = () => {
    const dispatch = useDispatch();
    const commandCentre = useCommandCentre();
    const molecules = useSelector((state: moorhen.State) => state.molecules.moleculeList);
    return (
        <MoorhenMenuItem onClick={() => runUndoRedo("redo", commandCentre, molecules, dispatch)}>
            Redo{`    ${cmdGlyph}⇧Z`}
        </MoorhenMenuItem>
    );
};
