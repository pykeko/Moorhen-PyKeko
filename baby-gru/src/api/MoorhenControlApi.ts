// @ts-nocheck
// MoorhenControlApi — a small, typed control surface over the live Moorhen app.
// Built by MoorhenControlBridge (which supplies the live commandCentre/store/dispatch),
// exposed as window.MoorhenControlApi and driven by the wrapper's control bridge.
// v1 (Phase 1): load/navigate/core-edits/state. Screenshots are handled by the
// Electron wrapper (webContents.capturePage), not here.
//
// NB headless control has no mouse events, so after anything that changes the scene we
// dispatch setRequestDrawScene to force MoorhenWebMG to repaint the WebGL canvas.
import { MoorhenMolecule } from "../utils/MoorhenMolecule";
import { MoorhenMap } from "../utils/MoorhenMap";
import { MoorhenScriptApi } from "../utils/MoorhenScriptAPI";
import { MoorhenTimeCapsule } from "../utils/MoorhenTimeCapsule";
import { moorhensession } from "../protobuf/MoorhenSession";
import { executeCovalentLink } from "../utils/MoorhenCovalentLinkExecutor";
import { evaluateSelectionOnMolecules, flattenMolecule } from "../utils/MoorhenSelectionAlgebra";
import { setSavedSelection, removeSavedSelection } from "../store/savedSelectionsSlice";
import { bondsToVectors, detectAll, InteractionType, OVERLAY_ID_PREFIX } from "../utils/MoorhenInteractions";
import { addVectors, removeVectorsMatchingIDString } from "../store/vectorsSlice";
import { generateSymMatesNear, getCell, getSpacegroupName, PREFIX_CELL_ALL, PREFIX_SYM_ALL, symMateTraceVectors, unitCellBoxVectors } from "../utils/MoorhenSymmetry";
import { addMolecule, showMolecule } from "../store/moleculesSlice";
import { addMap } from "../store/mapsSlice";
import { setActiveMap } from "../store/generalStatesSlice";
import { triggerUpdate } from "../store/moleculeMapUpdateSlice";
import { setRequestDrawScene } from "../store/glRefSlice";

type Ctx = { commandCentre: any; store: any; dispatch: any; monomerLibraryPath: string; videoRecorderRef?: any; timeCapsule?: any };

const DEFAULT_MTZ_COLUMNS = {
  F: "FWT", PHI: "PHWT", Fobs: "FP", SigFobs: "SIGFP", FreeR: "FREE",
  isDifference: false, useWeight: false, calcStructFact: true,
};

function b64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

export function createControlApi(ctx: Ctx) {
  const { commandCentre, store, dispatch, monomerLibraryPath } = ctx;

  const getMolecules = () => store.getState().molecules.moleculeList || [];
  const getMaps = () => store.getState().maps || [];
  const getActiveMap = () => store.getState().generalStates.activeMap;
  const repaint = () => dispatch(setRequestDrawScene(true));

  const molByNo = (molNo?: number) => {
    const mols = getMolecules();
    if (molNo === undefined || molNo === null) {
      // Don't trust a stale active-molecule ref: only honour it if the
      // referenced molNo is still in the live list. Otherwise fall back to
      // the most recently loaded molecule. Returning a dangling MoorhenMolecule
      // here previously caused "Cannot pass deleted object" when downstream
      // code called gemmiStructure methods on it.
      const active = store.getState().glRef?.activeMolecule;
      if (active && active.molNo !== undefined) {
        const live = mols.find((m) => m.molNo === active.molNo);
        if (live) return live;
      }
      return mols[mols.length - 1];
    }
    return mols.find((m) => m.molNo === molNo);
  };
  const requireMol = (molNo?: number) => { const m = molByNo(molNo); if (!m) throw new Error("no molecule loaded"); return m; };
  const requireActiveMap = () => { const m = getActiveMap(); if (!m) throw new Error("no active map — load a map first"); return m; };

  // Re-fetch atoms, redraw representations, repaint the scene (post raw-cootCommand edit).
  const refresh = async (mol: any) => {
    mol.setAtomsDirty(true);
    await mol.redraw();
    dispatch(triggerUpdate(mol.molNo));
    repaint();
  };

  // Authoritative atom count straight from coot (mol.atomCount caches stale after edits).
  const liveAtomCount = async (mol: any) => {
    try {
      const r = await commandCentre.current.cootCommand({ returnType: "status", command: "get_number_of_atoms", commandArgs: [mol.molNo] }, false);
      const n = r?.data?.result?.result;
      return typeof n === "number" ? n : mol.atomCount;
    } catch (e) { return mol.atomCount; }
  };

  // Tolerant CID parse "/mdl/chain/resno(ins)/atom:alt" -> fields (for auto_fit_rotamer)
  const parseCid = (cid: string) => {
    const m = cid.match(/\/(?:\d*)\/([A-Za-z0-9]*)\/(-?\d+)([A-Za-z]?)(?:\/([^:]*))?(?::(.*))?/);
    return { chain: m ? m[1] : "", resNo: m ? parseInt(m[2], 10) : NaN, insCode: (m && m[3]) || "", altConf: (m && m[5]) || "" };
  };

  const coot = (command: string, commandArgs: any[], molNo: number, returnType = "status") =>
    commandCentre.current.cootCommand({ returnType, command, commandArgs, changesMolecules: [molNo] }, true);

  const api = {
    async getState() {
      const molecules = [];
      for (const m of getMolecules()) molecules.push({ molNo: m.molNo, name: m.name, atomCount: await liveAtomCount(m) });
      return {
        molecules,
        maps: getMaps().map((m) => ({ molNo: m.molNo, name: m.name, isDifference: m.isDifference })),
        activeMapMolNo: getActiveMap()?.molNo ?? null,
      };
    },

    async loadCoordsFromString(pdbString: string, name = "molecule") {
      const mol = new MoorhenMolecule(commandCentre, store, monomerLibraryPath);
      await mol.loadToCootFromString(pdbString, name);
      await mol.fetchIfDirtyAndDraw("CBs");
      dispatch(addMolecule(mol));
      // Keyboard shortcuts (space-jump, drag-atoms) and the eye-icon read
      // state.molecules.visibleMolecules; addMolecule alone doesn't flip it.
      dispatch(showMolecule(mol));
      await mol.centreOn("/*/*/*/*", false, true);
      repaint();
      return { molNo: mol.molNo, name: mol.name, atomCount: await liveAtomCount(mol) };
    },

    async loadCoordsFromURL(url: string, name = "molecule") {
      const mol = new MoorhenMolecule(commandCentre, store, monomerLibraryPath);
      await mol.loadToCootFromURL(url, name);
      await mol.fetchIfDirtyAndDraw("CBs");
      dispatch(addMolecule(mol));
      // Keyboard shortcuts (space-jump, drag-atoms) and the eye-icon read
      // state.molecules.visibleMolecules; addMolecule alone doesn't flip it.
      dispatch(showMolecule(mol));
      await mol.centreOn("/*/*/*/*", false, true);
      repaint();
      return { molNo: mol.molNo, name: mol.name, atomCount: await liveAtomCount(mol) };
    },

    async loadMapFromMtz(mtzBase64: string, name = "map", columns?: any) {
      const map = new MoorhenMap(commandCentre, store);
      await map.loadToCootFromMtzData(b64ToUint8(mtzBase64), name, { ...DEFAULT_MTZ_COLUMNS, ...(columns || {}) });
      dispatch(addMap(map));
      dispatch(setActiveMap(map));
      await map.setActive();
      await map.drawMapContour();
      repaint();
      return { molNo: map.molNo, name: map.name, isDifference: map.isDifference };
    },

    async loadMapFromCcp4(mapBase64: string, name = "map", isDifference = false) {
      const map = new MoorhenMap(commandCentre, store);
      await map.loadToCootFromMapData(b64ToUint8(mapBase64), name, isDifference);
      dispatch(addMap(map));
      dispatch(setActiveMap(map));
      await map.setActive();
      await map.drawMapContour();
      repaint();
      return { molNo: map.molNo, name: map.name, isDifference: map.isDifference };
    },

    // Batch-load a set of files (the CLI-launch path: `pykeko a.pdb b.mtz c.cif`).
    // fileSpecs: [{ name, dataBase64 }]. Loads in type order regardless of input order —
    // coordinates first, then restraints/dictionary CIFs (attached to the molecules just
    // loaded, NOT spawned as monomers), then maps. A .cif is classified by content
    // (data_comp_* without _atom_site) exactly as autoOpenFiles does.
    async loadFiles(fileSpecs: { name: string; dataBase64: string }[]) {
      const decoder = new TextDecoder();
      const isCoordExt = (n: string) => /\.(pdb|ent|cif|mmcif)$/i.test(n);
      const isMtz = (n: string) => /\.mtz$/i.test(n);
      const isMapExt = (n: string) => /\.(mrc|map|ccp4)(\.gz)?$/i.test(n);
      const isSession = (n: string) => /\.(pykeko|pb)$/i.test(n);

      const coordFiles: { name: string; text: string }[] = [];
      const dictFiles: { name: string; text: string }[] = [];
      const mtzFiles: { name: string; bytes: Uint8Array }[] = [];
      const mapFiles: { name: string; base64: string }[] = [];
      const sessionFiles: { name: string; bytes: Uint8Array }[] = [];

      for (const spec of fileSpecs) {
        if (isSession(spec.name)) {
          // Session files have highest precedence — they restore the whole scene.
          // If a user does `pykeko session.pykeko other.pdb` we still load the
          // session, then the other.pdb on top of the restored state.
          sessionFiles.push({ name: spec.name, bytes: b64ToUint8(spec.dataBase64) });
        } else if (isCoordExt(spec.name)) {
          const text = decoder.decode(b64ToUint8(spec.dataBase64));
          const isDict = /data_comp_\S/i.test(text) && !/_atom_site\.\s/.test(text);
          (isDict ? dictFiles : coordFiles).push({ name: spec.name, text });
        } else if (isMtz(spec.name)) {
          mtzFiles.push({ name: spec.name, bytes: b64ToUint8(spec.dataBase64) });
        } else if (isMapExt(spec.name)) {
          mapFiles.push({ name: spec.name, base64: spec.dataBase64 });
        }
      }

      const results: any[] = [];

      // 0. Sessions — restore the whole scene first, then load other files on top.
      // The Electron wrapper passes .pykeko/.pb session files here on CLI launch
      // (`pykeko session.pykeko`); previously these silently fell through to
      // "unknown extension" and nothing appeared in the viewer.
      for (const f of sessionFiles) {
        if (!ctx.timeCapsule) {
          results.push({ file: f.name, type: "error", error: "session load needs the TimeCapsule context (not wired)" });
          continue;
        }
        try {
          // Match the native handleSessionUpload path (MoorhenFileLoading.ts loadSession):
          // reset the cootCommand history BEFORE the restore. Without this, in-flight
          // command IDs from the new molecule's drawing pipeline can race against the
          // teardown of the prior scene and surface as ".map of undefined" inside
          // loadSessionData. Drag-drop got this for free; the CLI path needs it explicit.
          try { commandCentre.current.history.reset(); } catch (e) {}
          const msg = moorhensession.Session.decode(f.bytes as any, undefined, undefined);
          const status = await MoorhenTimeCapsule.loadSessionFromProtoMessage(
            msg,
            monomerLibraryPath,
            getMolecules(),
            getMaps(),
            commandCentre,
            ctx.timeCapsule,
            store,
            dispatch,
          );
          results.push({ file: f.name, type: "session", status });
        } catch (e: any) {
          results.push({ file: f.name, type: "error", error: `session restore failed: ${e?.message || e}`, stack: String(e?.stack || "") });
        }
      }

      const preExisting = getMolecules();
      const loadedMols: any[] = [];

      // 1. Coordinates — each becomes a molecule
      for (const f of coordFiles) {
        const mol = new MoorhenMolecule(commandCentre, store, monomerLibraryPath);
        await mol.loadToCootFromString(f.text, f.name);
        if (mol.molNo === -1) { results.push({ file: f.name, type: "error", error: "could not read as coordinates" }); continue; }
        await mol.fetchIfDirtyAndDraw("CBs");
        dispatch(addMolecule(mol));
        dispatch(showMolecule(mol));
        loadedMols.push(mol);
        results.push({ file: f.name, type: "molecule", molNo: mol.molNo, atomCount: await liveAtomCount(mol) });
      }

      // 2. Restraints dictionaries — attach to molecules (existing + just-loaded), never a new molecule
      const targetMols = [...preExisting, ...loadedMols];
      for (const f of dictFiles) {
        if (targetMols.length === 0) {
          // Nothing to attach to — register globally so any later load can use it
          await commandCentre.current.cootCommand({ returnType: "status", command: "read_dictionary_string", commandArgs: [f.text, -999999], changesMolecules: [] }, false);
          results.push({ file: f.name, type: "dictionary", attachedTo: "global" });
        } else {
          for (const mol of targetMols) { await mol.addDict(f.text); await mol.redraw(); dispatch(triggerUpdate(mol.molNo)); }
          results.push({ file: f.name, type: "dictionary", attachedTo: targetMols.map((m) => m.molNo) });
        }
      }

      // 3. Maps — MTZ via auto-read (detects F/PHI + difference columns), CCP4/MRC direct
      for (const f of mtzFiles) {
        const file = new File([f.bytes], f.name);
        const newMaps = await MoorhenMap.autoReadMtz(file, commandCentre, store);
        for (let i = 0; i < newMaps.length; i++) {
          const m = newMaps[i];
          dispatch(addMap(m));
          await m.drawMapContour();
          if (i === 0) { dispatch(setActiveMap(m)); await m.setActive(); }
          results.push({ file: f.name, type: "map", molNo: m.molNo, isDifference: m.isDifference });
        }
        if (newMaps.length === 0) results.push({ file: f.name, type: "error", error: "no maps read from MTZ" });
      }
      for (const f of mapFiles) {
        const isDiff = /_fofc\.|_diff\./i.test(f.name);
        const r = await this.loadMapFromCcp4(f.base64, f.name, isDiff);
        results.push({ file: f.name, type: "map", molNo: r.molNo, isDifference: r.isDifference });
      }

      // Centre on the last coordinates loaded (maps centre themselves only when no molecule present)
      if (loadedMols.length > 0) await loadedMols[loadedMols.length - 1].centreOn("/*/*/*/*", false, true);
      repaint();
      return { loaded: results };
    },

    async setActiveMap(mapMolNo: number) {
      const map = getMaps().find((m) => m.molNo === mapMolNo);
      if (!map) throw new Error("map not found: " + mapMolNo);
      dispatch(setActiveMap(map));
      await map.setActive();
      return { activeMapMolNo: map.molNo };
    },

    async goToResidue(cid: string, molNo?: number) {
      const mol = requireMol(molNo);
      await mol.centreOn(cid, false, true);
      repaint();
      return { centeredOn: cid, molNo: mol.molNo };
    },

    async refine(cid: string, mode = "TRIPLE", molNo?: number) {
      const mol = requireMol(molNo);
      const map = requireActiveMap();
      await map.setActive();
      await mol.refineResiduesUsingAtomCid(cid, mode, 4000, true);
      dispatch(triggerUpdate(mol.molNo));
      repaint();
      return { refined: cid, mode, molNo: mol.molNo };
    },

    async autoFitRotamer(cid: string, molNo?: number) {
      const mol = requireMol(molNo);
      const map = requireActiveMap();
      const { chain, resNo, insCode, altConf } = parseCid(cid);
      await coot("auto_fit_rotamer", [mol.molNo, chain, resNo, insCode, altConf, map.molNo], mol.molNo);
      await refresh(mol);
      return { autoFitRotamer: cid, molNo: mol.molNo };
    },

    async flipPeptide(cid: string, molNo?: number) {
      const mol = requireMol(molNo);
      await coot("flipPeptide_cid", [mol.molNo, cid, ""], mol.molNo);
      await refresh(mol);
      return { flipped: cid, molNo: mol.molNo };
    },

    async addTerminalResidue(cid: string, molNo?: number) {
      const mol = requireMol(molNo);
      await coot("add_terminal_residue_directly_using_cid", [mol.molNo, cid], mol.molNo);
      await refresh(mol);
      return { addedTerminal: cid, molNo: mol.molNo };
    },

    async addWaters(molNo?: number) {
      const mol = requireMol(molNo);
      const map = requireActiveMap();
      await coot("add_waters", [mol.molNo, map.molNo, 2.6, 4.0], mol.molNo);
      await refresh(mol);
      return { addedWaters: true, molNo: mol.molNo };
    },

    async deleteCid(cid: string, molNo?: number) {
      const mol = requireMol(molNo);
      await coot("delete_using_cid", [mol.molNo, cid, "LITERAL"], mol.molNo);
      await refresh(mol);
      return { deleted: cid, molNo: mol.molNo };
    },

    async undo(molNo?: number) {
      const mol = requireMol(molNo);
      await mol.undo();
      dispatch(triggerUpdate(mol.molNo));
      repaint();
      return { undo: true, molNo: mol.molNo };
    },

    async redo(molNo?: number) {
      const mol = requireMol(molNo);
      await mol.redo();
      dispatch(triggerUpdate(mol.molNo));
      repaint();
      return { redo: true, molNo: mol.molNo };
    },

    async coot(command: string, commandArgs: any[] = [], molNo?: number, returnType = "status") {
      const mol = molByNo(molNo);
      const res = await commandCentre.current.cootCommand(
        { returnType, command, commandArgs, changesMolecules: mol ? [mol.molNo] : [] }, true);
      return { command, result: res?.data?.result?.result ?? null };
    },

    // Run a PyMOL or JS script through MoorhenScriptApi. Exposed primarily so
    // an autonomous CDP-based test loop can iterate on the translator without
    // poking the modal.
    async runPymol(script: string) {
      const api = new MoorhenScriptApi(commandCentre, store);
      // The translator reads videoRecorderRef off env when png/ray are invoked.
      (api as any).videoRecorderRef = ctx.videoRecorderRef;
      await api.exePymol(script);
      repaint();
      return { ok: true };
    },
    async runJs(script: string) {
      // Preserve + summarise the script's return value in the same shape
      // evalJs uses ({ok, kind, repr}) so the MCP wrapper's declared contract
      // ("returns the same summary shape as moorhen_eval") is honoured.
      // Previously discarded the value and returned {ok:true} — every result
      // JSON-stringified to `{}` at the MCP layer.
      const api = new MoorhenScriptApi(commandCentre, store);
      try {
        const result = await api.exe(script);
        repaint();
        return { ok: true, ...summarizeForRepl(result) };
      } catch (e: any) {
        return { ok: false, error: String(e?.stack || e?.message || e) };
      }
    },
    /** Declare a covalent link between a Cys SG atom and a ligand carbon
     * (Cβ) via the v0.2.29+ executor pipeline. Loads the link CIF into
     * Coot's dictionary, exports the model as augmented mmCIF with a new
     * `_struct_conn` row, optionally triggers a browser download of that
     * augmented mmCIF, and applies the mod2 to the in-viewer ligand chem_comp
     * for live bond-order update.
     *
     * @param sgCid Short-form CID of the Cys SG (e.g. "//A/481/SG")
     * @param cbCid Short-form CID of the ligand Cβ (e.g. "//A/801/C19")
     * @param linkId Registry entry id from cov-links/index.json
     *               (e.g. "CYS-ACR-pre-terminal")
     * @param molNo Optional; defaults to the active/first molecule
     * @param download Whether to trigger the browser download (default true)
     */
    async declareCovalentLink(sgCid: string, cbCid: string, linkId: string, molNo?: number, download = true) {
      const mols = getMolecules();
      const molecule = molNo !== undefined
        ? mols.find((m: any) => m.molNo === molNo)
        : mols[0];
      if (!molecule) {
        return { ok: false, message: `No molecule found (molNo=${molNo ?? "default"})` };
      }
      // Family hint mirrors the SMILES dialog and the right-click button.
      const preferFamily =
        linkId.startsWith("CYS-YNA") ? "F2" :
        linkId.startsWith("CYS-ACR") ? "F1" :
        linkId.startsWith("CYS-CAA") ? "F3" :
        linkId.startsWith("CYS-EPX") ? "F4" :
        linkId.startsWith("CYS-MAL") ? "F5" :
        linkId.startsWith("CYS-RVC") ? "F6" :
        undefined;
      const result = await executeCovalentLink({
        molecule,
        sgCid,
        cbCid,
        linkId,
        preferFamily,
        urlPrefix: "MoorhenAssets",
        commandCentre,
        download,
      });
      repaint();
      return {
        ok: result.ok,
        message: result.message,
        liveDisplayUpdated: result.liveDisplayUpdated ?? false,
        rsrAwareUpdated: result.rsrAwareUpdated ?? false,
        mmdbLinkInjected: result.mmdbLinkInjected ?? false,
        savedCifPath: result.savedCifPath ?? null,
        savedLinkCifPath: result.savedLinkCifPath ?? null,
        savedModelPdbPath: result.savedModelPdbPath ?? null,
        sgInfo: result.sgInfo ?? null,
        cbInfo: result.cbInfo ?? null,
      };
    },

    /**
     * Spawn refmac5 to refine a covalent-linked model against the user's
     * MTZ. Desktop-only (uses the __moorhenControl IPC bridge). Returns
     * the refined model paths plus the (tail of) refmac log.
     *
     * Typical use: after declareCovalentLink, take savedCifPath +
     * savedLinkCifPath, ask the user for their MTZ, call this. The
     * refined PDB lands in the same directory; load it back into Moorhen
     * via loadCoordsFromBytes (or just open the PDB) if the user wants
     * to inspect.
     *
     * If refmac5 is not installed, returns { ok: false, notInstalled: true }.
     */
    async runRefmacat(modelCifPath: string, mtzPath: string,
                      linkCifPath?: string | null, nCycles?: number, outDir?: string) {
      const ctrl: any = (typeof window !== "undefined") ? (window as any).__moorhenControl : null;
      if (!ctrl?.runRefmacat) {
        return { ok: false, error: "refmacat IPC bridge unavailable (not running in PyKeko desktop?)" };
      }
      return await ctrl.runRefmacat(modelCifPath, mtzPath, linkCifPath ?? null, nCycles ?? 5, outDir ?? null);
    },

    /**
     * Native MTZ file picker (desktop only). Convenience wrapper for the
     * refmacat flow — pairs with runRefmacat above. Returns
     * { ok, path } | { canceled } | { ok: false, error }.
     */
    async pickMtzFile() {
      const ctrl: any = (typeof window !== "undefined") ? (window as any).__moorhenControl : null;
      if (!ctrl?.pickMtzFile) {
        return { ok: false, error: "pickMtzFile IPC bridge unavailable" };
      }
      return await ctrl.pickMtzFile();
    },

    /**
     * Spawn CCP4's `findligand` (Coot 0.9 desktop's ligand-fit) to search
     * a map for ligand-shaped density blobs. Replacement for the broken
     * WASM fit_ligand_right_here / fit_ligand bindings in v0.2.41.
     *
     * Caller responsibilities: serialize the protein + ligand to PDB
     * text (via molecule_to_PDB_string) and the ligand's chem_comp dict
     * to CIF text. The MTZ comes in as a disk path (via pickMtzFile()).
     *
     * Returns { ok, fittedLigands, workDir, logPath, log } where
     * fittedLigands is an array of { pdbText, path, clusterIdx,
     * sampleIdx }. Use loadCoordsFromString to display each.
     */
    async runFindLigand(opts: {
      proteinPdbText: string;
      mtzPath: string;
      fCol?: string;
      phiCol?: string;
      ligandPdbText: string;
      ligandCifText: string;
      sigma?: number;
      clusters?: number;
      samples?: number;
      flexible?: boolean;
      absoluteLevel?: number;
    }) {
      const ctrl: any = (typeof window !== "undefined") ? (window as any).__moorhenControl : null;
      if (!ctrl?.runFindLigand) {
        return { ok: false, error: "runFindLigand IPC bridge unavailable (PyKeko desktop only)" };
      }
      return await ctrl.runFindLigand(opts);
    },

    /**
     * PyKeko v0.2.47 — Spawn CCP4's `dimple` auto-pipeline:
     * molecular-replacement-or-rigid-body + restrained refinement +
     * optional ligand fitting end-to-end. Saves the model to disk first
     * via the saveAugmentedCif IPC handler if `modelPath` isn't given.
     *
     * Returns { ok, finalPdb, finalPdbText, finalMtz, outDir, logPath, log }
     * | { ok: false, notInstalled?, error }.
     *
     * Typical use: ask the user for an MTZ (via pickMtzFile()), optionally
     * for a ligand CIF, optionally for a SMILES; serialize the active
     * molecule to PDB via molecule_to_PDB_string + saveTextFile to disk;
     * call this. Refined PDB lands in outDir/final.pdb; load it back via
     * loadCoordsFromString.
     */
    async runDimple(opts: {
      modelPath: string;
      mtzPath: string;
      ligandCifPath?: string | null;
      smiles?: string | null;
      outDir?: string | null;
      restrCycles?: number;
      mrThreshold?: number;
      freeRFlagsMtz?: string | null;
    }) {
      const ctrl: any = (typeof window !== "undefined") ? (window as any).__moorhenControl : null;
      if (!ctrl?.runDimple) {
        return { ok: false, error: "runDimple IPC bridge unavailable (PyKeko desktop only)" };
      }
      return await ctrl.runDimple(opts);
    },

    // PyKeko v0.2.45 — shell escape, mirrors the in-app console's `!`
    // prefix. Runs the command via the user's login shell in the active
    // effective cwd (see setCwd). Desktop-only. Returns
    // { ok, code, signal, stdout, stderr, cmd, cwd, killed, timedOut }.
    async runShell(cmd: string, opts?: { cwd?: string; timeoutMs?: number }) {
      const ctrl: any = (typeof window !== "undefined") ? (window as any).__moorhenControl : null;
      if (!ctrl?.runShell) {
        return { ok: false, error: "runShell IPC bridge unavailable (PyKeko desktop only)" };
      }
      return await ctrl.runShell(cmd, opts || {});
    },

    // PyKeko v0.2.45 — change/read the active working directory. After
    // setCwd, all relative save targets go to the new dir.
    async setCwd(p: string) {
      const ctrl: any = (typeof window !== "undefined") ? (window as any).__moorhenControl : null;
      if (!ctrl?.setCwd) return { ok: false, error: "setCwd IPC bridge unavailable (PyKeko desktop only)" };
      return await ctrl.setCwd(p);
    },
    async getCwd() {
      const ctrl: any = (typeof window !== "undefined") ? (window as any).__moorhenControl : null;
      if (!ctrl?.getCwd) return { ok: false, error: "getCwd IPC bridge unavailable (PyKeko desktop only)" };
      return await ctrl.getCwd();
    },
    // PyKeko v0.2.45 — `!export NAME=value` capture. Persists into
    // process.env so subsequent shell + spawn-helper invocations see it.
    async setEnv(arg: string) {
      const ctrl: any = (typeof window !== "undefined") ? (window as any).__moorhenControl : null;
      if (!ctrl?.setEnv) return { ok: false, error: "setEnv IPC bridge unavailable (PyKeko desktop only)" };
      return await ctrl.setEnv(arg);
    },
    // PyKeko v0.2.45 — directory stack for !pushd/!popd/!dirs.
    async cwdStack(action: "push" | "pop" | "list", p?: string) {
      const ctrl: any = (typeof window !== "undefined") ? (window as any).__moorhenControl : null;
      if (!ctrl?.cwdStack) return { ok: false, error: "cwdStack IPC bridge unavailable (PyKeko desktop only)" };
      return await ctrl.cwdStack(action, p);
    },

    // PyKeko v0.3 — evaluate a selection-algebra expression.
    //
    // Returns { count, cids } where cids is a short-form CID list grouped
    // by chain/residue-range. See MoorhenSelectionAlgebra.ts for the
    // grammar. Examples:
    //   "byres polymer within 5 of organic"  -> pocket residues around ligand
    //   "chain A and resi 100-200"           -> CIDs for that range
    //   "(b > 50) and polymer"               -> high-B protein atoms
    //   "not water"                          -> everything except water
    //
    // Saved-selection names (bare identifiers in the expression) are
    // auto-resolved against the store's savedSelections map. Pass an
    // explicit `savedSelections` arg to override, or to evaluate against
    // a hypothetical map for previewing.
    async evaluateSelection(expr: string, savedSelections?: Record<string, string>) {
      // Empty / whitespace-only expression: reject clearly instead of silently
      // returning count=0. An empty selection is almost never intentional —
      // it usually means a template variable didn't get filled in.
      if (typeof expr !== "string" || expr.trim() === "") {
        return { ok: false, error: "Selection: expression is empty. Pass a non-empty selection (e.g. 'chain A', 'resn 6ZN', or a saved-selection name)." };
      }
      try {
        const mols = getMolecules();
        const saved = savedSelections ?? Object.fromEntries(
          Object.entries(store.getState().savedSelections?.byName || {}).map(([n, s]: [string, any]) => [n, s.expression])
        );
        const r = evaluateSelectionOnMolecules(expr, mols, saved);
        return { ok: true, count: r.count, cids: r.cids };
      } catch (e: any) {
        return { ok: false, error: String(e?.message || e) };
      }
    },

    // PyKeko v0.3 — interaction overlays (H-bonds / salt bridges / disulfides /
    // clashes). Detects per-type and renders as pseudobonds via the existing
    // vectorsSlice; each type uses a unique id-prefix so the four overlays can
    // be toggled independently. Defaults to all four types if none specified.
    // selection (optional) is a selection-algebra expression restricting which
    // atoms participate in detection (e.g. "byres polymer within 6 of organic"
    // to scope to the binding pocket).
    async showInteractions(opts?: {
      types?: InteractionType[];
      selection?: string;
    }) {
      try {
        const mols = getMolecules();
        const types = opts?.types ?? ["hbond", "salt", "disulfide", "clash"];
        // Collect atoms -- filter by selection if requested.
        let atoms: any[] = [];
        for (const m of mols) atoms.push(...flattenMolecule(m));
        if (opts?.selection) {
          const savedMap = Object.fromEntries(
            Object.entries(store.getState().savedSelections?.byName || {}).map(([n, s]: [string, any]) => [n, s.expression])
          );
          const evald = evaluateSelectionOnMolecules(opts.selection, mols, savedMap);
          const keep = evald.ids;
          atoms = atoms.filter((_, i) => keep.has(i));
        }
        const detected = detectAll(atoms, types);
        const counts: Record<string, number> = {};
        for (const t of types) {
          const bonds = detected[t];
          counts[t] = bonds.length;
          dispatch(removeVectorsMatchingIDString(OVERLAY_ID_PREFIX[t]));
          if (bonds.length > 0) {
            dispatch(addVectors(bondsToVectors(bonds, OVERLAY_ID_PREFIX[t])));
          }
        }
        repaint();
        return { ok: true, counts };
      } catch (e: any) {
        return { ok: false, error: String(e?.message || e) };
      }
    },
    async hideInteractions(types?: InteractionType[]) {
      const list = types ?? ["hbond", "salt", "disulfide", "clash"];
      for (const t of list) dispatch(removeVectorsMatchingIDString(OVERLAY_ID_PREFIX[t]));
      repaint();
      return { ok: true };
    },

    // PyKeko v0.3 — symmetry overlays: unit cell box + sym mate CA traces.
    //
    // showCell()        -> draw the unit-cell box for the active molecule
    // hideCell()        -> remove it
    // showSymmetry({radius=15, molNo?}) -> draw sym mate CA traces of every
    //                       spacegroup operator (within an envelope of
    //                       neighbouring unit cells) that brings any CA within
    //                       `radius` A of the current rotation centre. Cycles
    //                       through a colour palette per operator.
    // hideSymmetry()    -> remove all sym mate traces
    // getCellInfo()     -> { spacegroup, cell: {a,b,c,alpha,beta,gamma} }
    async showCell(molNo?: number) {
      const mol = molByNo(molNo);
      if (!mol) return { ok: false, error: "No molecule loaded." };
      const vectors = unitCellBoxVectors(mol);
      if (vectors.length === 0) return { ok: false, error: "Molecule has no unit cell." };
      dispatch(removeVectorsMatchingIDString(PREFIX_CELL_ALL));
      dispatch(addVectors(vectors));
      repaint();
      return { ok: true, edges: vectors.length };
    },
    async hideCell() {
      dispatch(removeVectorsMatchingIDString(PREFIX_CELL_ALL));
      repaint();
      return { ok: true };
    },
    async showSymmetry(opts?: { radius?: number; molNo?: number }) {
      const radius = opts?.radius ?? 15;
      const mol = molByNo(opts?.molNo);
      if (!mol) return { ok: false, error: "No molecule loaded." };
      const sg = getSpacegroupName(mol);
      const cell = getCell(mol);
      if (!sg || !cell) {
        return { ok: false, error: "Molecule has no spacegroup or unit cell." };
      }
      const origin = store.getState().glRef.origin;
      const centre: [number, number, number] = [-origin[0], -origin[1], -origin[2]];
      const mates = generateSymMatesNear(mol, centre, radius);
      dispatch(removeVectorsMatchingIDString(PREFIX_SYM_ALL));
      let totalEdges = 0;
      for (let i = 0; i < mates.length; i++) {
        const traceVectors = symMateTraceVectors(mates[i], `m${i}`);
        if (traceVectors.length > 0) {
          dispatch(addVectors(traceVectors));
          totalEdges += traceVectors.length;
        }
      }
      repaint();
      return {
        ok: true,
        spacegroup: sg,
        matesShown: mates.length,
        traceSegments: totalEdges,
        mates: mates.map(m => ({ opIdx: m.opIdx, opLabel: m.opLabel, cellOffset: m.cellOffset, atomCount: m.atoms.length })),
      };
    },
    async hideSymmetry() {
      dispatch(removeVectorsMatchingIDString(PREFIX_SYM_ALL));
      repaint();
      return { ok: true };
    },
    async getCellInfo(molNo?: number) {
      const mol = molByNo(molNo);
      if (!mol) return { ok: false, error: "No molecule loaded." };
      return { ok: true, spacegroup: getSpacegroupName(mol), cell: getCell(mol) };
    },

    // PyKeko v0.3 — saved-selection management.
    // setSelection persists by name (overwriting any existing entry).
    // deleteSelection removes by name. listSelections returns the current map.
    async setSelection(name: string, expression: string, note?: string) {
      if (!name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        return { ok: false, error: "Name must be a bare identifier (letters/digits/underscore, starting with a letter or _)." };
      }
      // Validate the expression by parsing it before persisting. Include the
      // current saved-selections map so `byres near_lig` and other
      // saved-name-referencing expressions validate against known names.
      // Don't include the name we're about to write — that lets an incorrect
      // self-reference through until first use (matches the create-then-fix
      // ergonomics of PyMOL's `select` command).
      try {
        const mols = getMolecules();
        const currentSaved = Object.fromEntries(
          Object.entries(store.getState().savedSelections?.byName || {})
            .map(([n, s]: [string, any]) => [n, s.expression])
        );
        evaluateSelectionOnMolecules(expression, mols, currentSaved); // throws if grammar is wrong
      } catch (e: any) {
        return { ok: false, error: "Expression failed to parse: " + String(e?.message || e) };
      }
      dispatch(setSavedSelection({ name, expression, note }));
      return { ok: true, name, expression };
    },
    async deleteSelection(name: string) {
      dispatch(removeSavedSelection(name));
      return { ok: true, name };
    },
    async listSelections() {
      return { ok: true, selections: store.getState().savedSelections?.byName || {} };
    },

    // PyKeko v0.2.45 — JS REPL evaluator.
    //
    // Evaluates a JS source string in the renderer's global scope and returns
    // a JSON-safe summary of the result. Used by both the in-app console's
    // command line and the moorhen_eval MCP tool.
    //
    // - Tries expression form first ("return (src);") so single expressions
    //   like `1+1` or `MoorhenControlApi` produce a value the way DevTools
    //   would. Falls back to statement form ("src;") for multi-statement
    //   scripts.
    // - Wrapped in an async function so `await` works.
    // - The scope is the renderer, NOT the main process — same as DevTools,
    //   no fs/child_process/etc. The eval can reach window.MoorhenControlApi
    //   and any other globals; it cannot touch the Electron main side.
    // - The serializer caps depth/length so huge objects don't shovel
    //   megabytes through IPC. The local REPL receives the same JSON-safe
    //   summary (intentionally — keeps the surface uniform between local
    //   and MCP callers).
    // PyKeko v0.3.2 — return the current session (serialised to
    // protobuf bytes, then encoded as a JSON-safe object) so scripted
    // tests and MCP callers can inspect what would land in a `.pykeko`
    // file without triggering a native save dialog.
    //
    // Returns { ok, session: {molecules, maps, viewData, pykekoSavedSelections,
    // pykekoUiState, vectorData, overlay2dData, ...}, sizeBytes } or
    // { ok:false, error }. The session object is the raw JS structure from
    // MoorhenTimeCapsule.fetchSession(); pass includeAdditionalMapData=false
    // for a lean read (leaves out the raw MTZ payloads).
    async getSessionBlob(includeAdditionalMapData = false) {
      if (!ctx.timeCapsule) {
        return { ok: false, error: "TimeCapsule not wired into ControlApi ctx" };
      }
      try {
        const session = await ctx.timeCapsule.current.fetchSession(!!includeAdditionalMapData);
        // Rough size estimate via JSON.stringify — actual protobuf bytes will
        // be smaller but this is a useful ballpark for the caller.
        let sizeBytes = 0;
        try { sizeBytes = JSON.stringify(session).length; } catch (e) {}
        return { ok: true, session, sizeBytes };
      } catch (e: any) {
        return { ok: false, error: String(e?.message || e), stack: String(e?.stack || "") };
      }
    },

    // Session round-trip verification verb — encodes the current session to
    // protobuf bytes (the same bytes a `.pykeko` file would contain), decodes
    // them back into a Session message, and applies via loadSessionFromProtoMessage
    // (the same code path File → Open session runs). Returns the pre/post
    // JSON summaries so a scripted test can diff them without touching disk
    // or a native dialog.
    async roundTripSession() {
      if (!ctx.timeCapsule) return { ok: false, error: "no timeCapsule in ctx" };
      try {
        const pre = await ctx.timeCapsule.current.fetchSession(false);
        const message = moorhensession.Session.create(pre);
        const bytes = moorhensession.Session.encode(message).finish();
        const decoded = moorhensession.Session.decode(bytes);
        const decodedObj = moorhensession.Session.toObject(decoded, {
          defaults: true, arrays: true, objects: true, longs: String, enums: String, bytes: String,
        });
        // Extract summary (parts we care about for the round-trip test)
        const summary = (s: any) => ({
          molNames: (s.moleculeData || []).map((m: any) => m.name),
          reps: (s.moleculeData || []).flatMap((m: any) =>
            (m.representations || []).map((r: any) => ({ style: r.style, cid: r.cid }))),
          colourRuleCids: (s.moleculeData || []).flatMap((m: any) =>
            (m.colourRules || []).map((c: any) => c.cid)),
          savedSelections: (s.pykekoSavedSelections || []).map((sel: any) => ({
            name: sel.name, expression: sel.expression, note: sel.note || "",
          })),
        });
        return {
          ok: true,
          byteLen: bytes.length,
          pre: summary(pre),
          post: summary(decodedObj),
        };
      } catch (e: any) {
        return { ok: false, error: String(e?.message || e), stack: String(e?.stack || "") };
      }
    },

    async evalJs(src: string) {
      if (typeof src !== "string" || !src.trim()) {
        return { ok: false, error: "empty input" };
      }
      const AsyncFn: any = Object.getPrototypeOf(async function () {}).constructor;
      let fn: any;
      // Expression form first (so `1+1` / `foo` produce a return value).
      try {
        fn = new AsyncFn(`"use strict"; return (${src}\n);`);
      } catch (e) {
        // Fall back to statement form (handles `var x = ...; x + 1` style).
        try {
          fn = new AsyncFn(`"use strict"; ${src}`);
        } catch (e2: any) {
          return { ok: false, error: "SyntaxError: " + String(e2?.message || e2) };
        }
      }
      try {
        const result = await fn();
        return { ok: true, ...summarizeForRepl(result) };
      } catch (e: any) {
        return { ok: false, error: String(e?.stack || e?.message || e) };
      }
    },
  };

  return api;
}

// JSON-safe summary of a REPL value, capped so a returned huge object
// can't shovel megabytes through IPC. Mirrors the shape DevTools prints:
// "kind" = type name, "repr" = printable string, "json" = the cleaned
// value when round-trip-safe (so the local REPL can render objects with
// some structure; MCP callers can ignore json and use repr).
function summarizeForRepl(v: any) {
  if (v === undefined) return { kind: "undefined", repr: "undefined", json: null };
  if (v === null) return { kind: "null", repr: "null", json: null };
  const t = typeof v;
  if (t === "string") return { kind: "string", repr: JSON.stringify(v), json: v };
  if (t === "number" || t === "boolean" || t === "bigint")
    return { kind: t, repr: String(v), json: t === "bigint" ? String(v) : v };
  if (t === "function") {
    const name = v.name || "<anonymous>";
    return { kind: "function", repr: `[Function: ${name}]`, json: null };
  }
  if (t === "symbol") return { kind: "symbol", repr: String(v), json: null };
  // Object/array — try JSON.stringify with depth+length cap.
  const MAX_LEN = 64 * 1024;
  try {
    const seen = new WeakSet();
    const trim = (val: any, depth: number): any => {
      if (depth > 6) return "[…]";
      if (val === null || typeof val !== "object") {
        if (typeof val === "function") return `[Function: ${val.name || "<anonymous>"}]`;
        if (typeof val === "bigint") return String(val);
        if (typeof val === "symbol") return String(val);
        return val;
      }
      if (seen.has(val)) return "[Circular]";
      seen.add(val);
      if (Array.isArray(val)) {
        return val.slice(0, 64).map((x) => trim(x, depth + 1));
      }
      // DOM nodes / WebAssembly / etc. — just describe.
      if (val.nodeType && typeof val.nodeName === "string") {
        return `[${val.nodeName} ${val.id ? "#" + val.id : ""}]`;
      }
      if (val.constructor && val.constructor.name && val.constructor.name !== "Object") {
        // Embind C++ objects, MoorhenMolecule, etc. — keep the type name +
        // a few enumerable own props so the REPL is informative.
        const obj: any = { __type: val.constructor.name };
        for (const k of Object.keys(val).slice(0, 32)) {
          try { obj[k] = trim(val[k], depth + 1); } catch (e) { obj[k] = "[unreadable]"; }
        }
        return obj;
      }
      const out: any = {};
      for (const k of Object.keys(val).slice(0, 64)) {
        try { out[k] = trim(val[k], depth + 1); } catch (e) { out[k] = "[unreadable]"; }
      }
      return out;
    };
    const trimmed = trim(v, 0);
    let repr = JSON.stringify(trimmed, null, 2);
    if (repr && repr.length > MAX_LEN) repr = repr.slice(0, MAX_LEN) + "\n… (truncated)";
    return { kind: Array.isArray(v) ? "array" : (v.constructor?.name || "object"), repr, json: trimmed };
  } catch (e: any) {
    return { kind: "object", repr: "[unserialisable: " + String(e?.message || e) + "]", json: null };
  }
}

export type MoorhenControlApi = ReturnType<typeof createControlApi>;
