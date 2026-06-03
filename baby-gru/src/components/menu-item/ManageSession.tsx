import { useDispatch, useSelector, useStore } from "react-redux";
import { enqueueSnackbar } from "@/store";
import { useCommandCentre, useMoorhenInstance, useTimeCapsule } from "../../InstanceManager";
import { moorhensession } from "../../protobuf/MoorhenSession";
import { RootState } from "../../store/MoorhenReduxStore";
import { usePersistentState } from "../../store/menusSlice";
import { MoorhenTimeCapsule, type backupKey } from "../../utils/MoorhenTimeCapsule";
import { doDownload, guid } from "../../utils/utils";
import { MoorhenButton, MoorhenTextInput } from "../inputs";
import { MoorhenMenuItem, MoorhenMenuItemPopover, MoorhenStack } from "../interface-base";
import { Backups } from "./Backups";

// Detect the PyKeko desktop wrapper via its preload-injected IPC. When
// present, save/open go through native panels and write a single
// `.pykeko` file the user can email/move/back up like any other doc.
// When absent (plain browser build), fall back to the legacy
// browser-download for save and the existing `.pb` upload picker for load.
const isDesktopWithSessionIpc = (): boolean => {
    try { return !!(window as any)?.__moorhenControl?.saveSession; } catch { return false; }
};

export const ManageSession = () => {
    const commandCentre = useCommandCentre();
    const store = useStore<RootState>();
    const [sessionName, setSessionName] = usePersistentState("manageSession", "uploadName", "moorhen_session", true);
    const defaultBondSmoothness = useSelector((state: RootState) => state.sceneSettings.defaultBondSmoothness);
    const maps = useSelector((state: RootState) => state.maps);
    const molecules = useSelector((state: RootState) => state.molecules.moleculeList);
    const monomerLibraryPath = useMoorhenInstance().paths.monomerLibraryPath;
    const dispatch = useDispatch();
    const timeCapsule = useTimeCapsule();

    const enableTimeCapsule = useSelector((state: RootState) => state.backupSettings.enableTimeCapsule);

    const handleSessionUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files)
            try {
                const arrayBuffer = await e.target.files[0].arrayBuffer();
                const bytes = new Uint8Array(arrayBuffer);
                const sessionMessage = moorhensession.Session.decode(bytes, undefined, undefined);
                //console.log(JSON.stringify(sessionMessage, null, 4))
                await loadSession(sessionMessage);
            } catch (err) {
                console.log(err);
                dispatch(enqueueSnackbar({ message: "Error loading the session", variant: "error" }));
            }
    };

    const buildSessionBytes = async (): Promise<Uint8Array> => {
        const sessionData = await timeCapsule.current.fetchSession(true);
        const sessionMessage = moorhensession.Session.fromObject(sessionData);
        return moorhensession.Session.encode(sessionMessage).finish();
    };

    // Legacy: browser download (used when PyKeko desktop IPC isn't available).
    const getSession = async () => {
        const bytes = await buildSessionBytes();
        const _sessionName = sessionName !== "" ? sessionName : "moorhen_session";
        doDownload([bytes] as BlobPart[], `${_sessionName}.pb`);
    };

    // Desktop: native Save panel writes a single `.pykeko` file the user can
    // share, back up, or open later. Default name = first molecule's name
    // (matching the MVS-export convention), with the .pykeko extension making
    // it obvious to the user what the file represents.
    const saveSessionDesktop = async () => {
        try {
            const bytes = await buildSessionBytes();
            const first = molecules?.[0]?.name || sessionName || "pykeko_session";
            const suggested = `${first}.pykeko`;
            const ctrl = (window as any).__moorhenControl;
            const r = await ctrl.saveSession(bytes, suggested);
            if (r?.ok) {
                dispatch(enqueueSnackbar({ message: `Session saved → ${r.path}`, variant: "success" }));
            } else if (r?.canceled) {
                dispatch(enqueueSnackbar({ message: "Save canceled", variant: "info" }));
            } else {
                dispatch(enqueueSnackbar({ message: `Save failed: ${r?.error || "unknown error"}`, variant: "error" }));
            }
        } catch (e: any) {
            console.error(e);
            dispatch(enqueueSnackbar({ message: `Save failed: ${e?.message || e}`, variant: "error" }));
        }
    };

    // Desktop: native Open panel returns bytes, we decode + apply via the
    // same path the legacy "Backups" workflow uses.
    const openSessionDesktop = async () => {
        try {
            const ctrl = (window as any).__moorhenControl;
            const r = await ctrl.openSession();
            if (!r?.ok) {
                if (!r?.canceled) dispatch(enqueueSnackbar({ message: `Open failed: ${r?.error || "unknown error"}`, variant: "error" }));
                return;
            }
            // Bytes come back as a Buffer-shaped object across IPC; wrap as
            // Uint8Array for protobuf's decoder.
            const bytes = r.bytes instanceof Uint8Array ? r.bytes : new Uint8Array(r.bytes);
            const sessionMessage = moorhensession.Session.decode(bytes, undefined, undefined);
            await loadSession(sessionMessage);
            dispatch(enqueueSnackbar({ message: `Session loaded from ${r.path}`, variant: "success" }));
        } catch (e: any) {
            console.error(e);
            dispatch(enqueueSnackbar({ message: `Open failed: ${e?.message || e}`, variant: "error" }));
        }
    };

    const createBackup = async () => {
        await timeCapsule.current.updateDataFiles();
        const session = await timeCapsule.current.fetchSession(false);
        const sessionString = JSON.stringify(session);
        const key: backupKey = {
            dateTime: `${Date.now()}`,
            type: "manual",
            serNo: guid(),
            molNames: session.moleculeData.map(mol => mol.name),
            mapNames: session.mapData.map(map => map.uniqueId),
            mtzNames: session.mapData.filter(map => map.hasReflectionData).map(map => map.associatedReflectionFileName),
        };
        const keyString = JSON.stringify({
            ...key,
            label: MoorhenTimeCapsule.getBackupLabel(key),
        });
        return timeCapsule.current.createBackup(keyString, sessionString);
    };

    const loadSession = async (session: string | object) => {
        try {
            commandCentre.current.history.reset();
            let status = -1;
            if (typeof session === "string") {
                status = await MoorhenTimeCapsule.loadSessionFromJsonString(
                    session as string,
                    monomerLibraryPath,
                    molecules,
                    maps,
                    commandCentre,
                    timeCapsule,
                    store,
                    dispatch
                );
            } else {
                status = await MoorhenTimeCapsule.loadSessionFromProtoMessage(
                    session,
                    monomerLibraryPath,
                    molecules,
                    maps,
                    commandCentre,
                    timeCapsule,
                    store,
                    dispatch
                );
            }
            if (status === -1) {
                dispatch(enqueueSnackbar({ message: "Failed to read backup (deprecated format)", variant: "warning" }));
            }
        } catch (err) {
            console.log(err);
            dispatch(enqueueSnackbar({ message: "Error loading session", variant: "warning" }));
        }
    };
    const desktop = isDesktopWithSessionIpc();
    return (
        <>
            {desktop ? (
                // Desktop: clean one-click Save/Open via native panels.
                // The legacy "Save Session File:" textbox-row and the
                // in-browser-backup items are hidden — they made sense in
                // the browser build (no filesystem access, IndexedDB as a
                // workaround), but are confusing when you have real files.
                <>
                    <MoorhenMenuItem id="pykeko-save-session" onClick={saveSessionDesktop}>
                        Save session…
                    </MoorhenMenuItem>
                    <MoorhenMenuItem id="pykeko-open-session" onClick={openSessionDesktop}>
                        Open session…
                    </MoorhenMenuItem>
                </>
            ) : (
                <>
                    <label htmlFor="session-file-input" className="moorhen__input__label-menu">
                        Save Session File:
                    </label>
                    <label htmlFor="text-input-session" className="moorhen_menu-custom-left-margin">
                        <MoorhenTextInput
                            text={sessionName}
                            setText={setSessionName}
                            button={true}
                            onClick={getSession}
                            icon="MatSymFileDownload"
                            style={{ width: "85%", marginLeft: "0", paddingLeft: "0" }}
                            id="text-input-session"
                        />
                    </label>
                    <hr className="moorhen_menu-hr"></hr>
                    <MoorhenMenuItem id="save-session-menu-item" onClick={createBackup} disabled={!enableTimeCapsule}>
                        Save in-browser backup
                    </MoorhenMenuItem>
                    <MoorhenMenuItemPopover menuItemText="Load in-browser Backup">
                        <Backups disabled={!enableTimeCapsule} loadSession={loadSession} />
                    </MoorhenMenuItemPopover>
                </>
            )}
        </>
    );
};
