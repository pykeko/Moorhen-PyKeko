// Right-click context-menu button: declare a covalent link between the
// right-clicked atom (typically a Cys SG) and a ligand atom the user types.
//
// On submit, the panel:
//   1. Fetches the chosen link CIF template from public/MoorhenAssets/cov-links/
//   2. Loads it into the WASM via read_dictionary_string (so Refmac sees the chem_link)
//   3. Exports the current model as mmCIF
//   4. Injects a _struct_conn loop_ row pointing at both atoms with ccp4_link_id
//   5. Triggers a browser download of the augmented mmCIF
//
// Why not call make_covalent_link in the WASM: that binding is silently dropped
// at runtime — see feedback_moorhen_embind_silent_drop.md. Coot's mmCIF/PDB
// writers also strip connection metadata, so the link survives only in the
// downloaded file. The user feeds that file to refmacat externally.

import { useCallback, useEffect, useState } from "react";
import { useCommandCentre } from "../../InstanceManager";
import { moorhen } from "../../types/moorhen";
import { MoorhenContextButtonBase, ContextButtonProps } from "./MoorhenContextButtonBase";
import {
    parseCid,
    findAtomInModel,
    appendStructConnLoop,
} from "../../utils/MoorhenCovalentLinkSurgery";
import { cidToSpec } from "../../utils/utils";

interface LinkRegistryItem {
    id: string;
    name: string;
    family: string;
    link_cif: string;
}

const LinkPanel = (props: {
    molecule: moorhen.Molecule;
    sgCid: string;
    commandCentre: React.RefObject<moorhen.CommandCentre>;
    setShowOverlay: React.Dispatch<React.SetStateAction<boolean>>;
    urlPrefix: string;
}) => {
    const { molecule, sgCid, commandCentre, setShowOverlay, urlPrefix } = props;
    const [cbCid, setCbCid] = useState("");
    const [linkId, setLinkId] = useState("");
    const [registry, setRegistry] = useState<LinkRegistryItem[]>([]);
    const [picking, setPicking] = useState(false);
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState("");
    const [statusKind, setStatusKind] = useState<"info" | "error" | "success">("info");

    // Load the cov-links registry on mount.
    //
    // urlPrefix defaults to "MoorhenAssets" (see MoorhenWebComponent.tsx:76 —
    // it's the assets-dir prefix, NOT a server-root prefix). So the URL is
    // ${urlPrefix}/cov-links/index.json, NOT ${urlPrefix}/MoorhenAssets/...
    // which doubles the prefix; the static server falls back to index.html
    // for the missing path, and JSON.parse chokes on "<!doctype" (the bug
    // that bit a fresh v0.2.21 install).
    useEffect(() => {
        (async () => {
            try {
                const url = `${urlPrefix}/cov-links/index.json`;
                const resp = await fetch(url);
                if (!resp.ok) {
                    setStatus(`Could not load cov-links registry (${resp.status} from ${url})`);
                    setStatusKind("error");
                    return;
                }
                const text = await resp.text();
                if (text.trimStart().startsWith("<")) {
                    setStatus(`Registry URL ${url} returned HTML — wrong assets path`);
                    setStatusKind("error");
                    return;
                }
                const data = JSON.parse(text);
                const items: LinkRegistryItem[] = (data?.warheads || []).map((w: any) => ({
                    id: w.id, name: w.name, family: w.family, link_cif: w.link_cif,
                }));
                setRegistry(items);
                if (items.length > 0) setLinkId(items[0].id);
            } catch (e: any) {
                setStatus(`Registry load failed: ${e?.message || e}`);
                setStatusKind("error");
            }
        })();
    }, [urlPrefix]);

    // Click-to-pick: listen for one atomClicked event when the user hits the
    // "Pick ligand atom" button. Same pattern used by MoorhenCreateAcedrgLinkModal
    // and MoorhenVectorsModal — the canvas (mgWebGL) dispatches "atomClicked" on
    // document with detail.label = the atom CID.
    //
    // The label format from parseAtomInfoLabel is
    //   /<mol_name>/<chain>/<res_no>(<res_name>)/<atom>[:<altloc>]
    // (mol_name is the file name like "8FD9", NOT the integer molNo). Use the
    // existing cidToSpec helper instead of a hand-rolled regex so the format
    // can't drift — earlier I had `^\/\d+\/...` which expected an integer
    // mol_no and never matched, so the picked CID silently fell through.
    useEffect(() => {
        if (!picking) return;
        const onAtomClicked = (evt: any) => {
            const pickedCid = evt?.detail?.label as string | undefined;
            if (!pickedCid) { setPicking(false); return; }
            try {
                const spec = cidToSpec(pickedCid);
                if (!spec?.chain_id || spec.res_no === undefined || !spec.atom_name) {
                    setStatus(`Could not parse picked CID: ${pickedCid}`);
                    setStatusKind("error");
                    setPicking(false);
                    return;
                }
                const short = `//${spec.chain_id}/${spec.res_no}/${String(spec.atom_name).trim()}`;
                setCbCid(short);
                setStatus(`Picked: ${short}`);
                setStatusKind("info");
            } catch (e: any) {
                setStatus(`Pick parse error: ${e?.message || e}`);
                setStatusKind("error");
            }
            setPicking(false);
        };
        document.addEventListener("atomClicked", onAtomClicked, { once: true });
        return () => {
            document.removeEventListener("atomClicked", onAtomClicked);
        };
    }, [picking]);

    const submit = useCallback(async () => {
        if (!cbCid.trim() || !linkId) return;
        setBusy(true);
        setStatus("Working…");
        setStatusKind("info");
        try {
            const sg = parseCid(sgCid);
            const cb = parseCid(cbCid.trim());
            if (!sg || !cb) {
                setStatus(`CID parse failed (expected //CHAIN/RESNO/ATOM): sg=${sgCid} cb=${cbCid}`);
                setStatusKind("error");
                setBusy(false);
                return;
            }

            // 1. Fetch the link CIF
            const entry = registry.find((r) => r.id === linkId);
            const linkCifPath = entry?.link_cif || `${linkId}.cif`;
            const cifResp = await fetch(`${urlPrefix}/cov-links/${linkCifPath}`);
            if (!cifResp.ok) {
                setStatus(`Could not fetch link CIF ${linkCifPath} (${cifResp.status})`);
                setStatusKind("error");
                setBusy(false);
                return;
            }
            const cifText = await cifResp.text();

            // 2. Load into WASM (so Refmac's monomer library sees the chem_link)
            await commandCentre.current.cootCommand({
                returnType: "status",
                command: "read_dictionary_string",
                commandArgs: [cifText, molecule.molNo],
                changesMolecules: [molecule.molNo],
            } as any, false);

            // 3. Export current model
            const modelResp: any = await commandCentre.current.cootCommand({
                returnType: "string",
                command: "molecule_to_mmCIF_string_with_gemmi",
                commandArgs: [molecule.molNo],
            } as any, false);
            const modelMmcif: string = modelResp?.data?.result?.result || "";
            if (!modelMmcif) {
                setStatus("Model export returned empty");
                setStatusKind("error");
                setBusy(false);
                return;
            }

            // 4. Look up label_* + auth_* for both atoms
            const sgInfo = findAtomInModel(modelMmcif, sg);
            const cbInfo = findAtomInModel(modelMmcif, cb);
            if (!sgInfo) {
                setStatus(`Atom ${sgCid} not found in model atom_site loop`);
                setStatusKind("error");
                setBusy(false);
                return;
            }
            if (!cbInfo) {
                setStatus(`Atom ${cbCid} not found in model atom_site loop`);
                setStatusKind("error");
                setBusy(false);
                return;
            }

            // 5. Surgery
            const augmented = appendStructConnLoop(modelMmcif, {
                id: `pk_${linkId}_${sgInfo.auth_seq_id}_${cbInfo.auth_seq_id}`,
                conn_type_id: "covale",
                ptnr1: { ...sgInfo, atom: sg.atom },
                ptnr2: { ...cbInfo, atom: cb.atom },
                ccp4_link_id: linkId,
            });

            // 6. Trigger download
            const blob = new Blob([augmented], { type: "chemical/x-mmcif" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${(molecule.name || "model").replace(/[^A-Za-z0-9_.-]/g, "_")}_covalent_${linkId}.cif`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);

            setStatus(`Declared ${linkId}: ${sgInfo.label_comp_id} ${sgInfo.auth_seq_id} ${sg.atom} → ${cbInfo.label_comp_id} ${cbInfo.auth_seq_id} ${cb.atom}. Downloaded augmented mmCIF — pass it to refmac externally.`);
            setStatusKind("success");
            setBusy(false);
            setTimeout(() => setShowOverlay(false), 3500);
        } catch (e: any) {
            setStatus(`Failed: ${e?.message || String(e)}`);
            setStatusKind("error");
            setBusy(false);
        }
    }, [cbCid, linkId, sgCid, registry, urlPrefix, commandCentre, molecule.molNo, molecule.name, setShowOverlay]);

    const statusColor = statusKind === "error" ? "#e03131" : statusKind === "success" ? "#2f9e44" : "#495057";

    return (
        <div style={{
            padding: 16, background: "white", border: "1px solid #ccc",
            borderRadius: 8, minWidth: 420, maxWidth: 520, boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        }}>
            <h6 style={{ marginTop: 0, marginBottom: 12 }}>Declare covalent link</h6>
            <div style={{ marginBottom: 10 }}>
                <label style={{ display: "block", fontSize: "0.85rem", color: "#495057" }}>Cys SG (from right-click)</label>
                <code style={{ fontSize: "0.95rem", color: "#212529" }}>{sgCid}</code>
            </div>
            <div style={{ marginBottom: 10 }}>
                <label style={{ display: "block", fontSize: "0.85rem", color: "#495057" }}>Ligand atom</label>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <button
                        onClick={() => { setPicking(true); setStatus("Click any atom in the 3D viewer…"); setStatusKind("info"); }}
                        disabled={busy || picking}
                        style={{
                            padding: "6px 12px", fontSize: "0.9rem",
                            background: picking ? "#fff3bf" : "#e7f5ff",
                            color: "#1971c2", border: "1px solid #4dabf7", borderRadius: 6,
                            cursor: busy ? "not-allowed" : "pointer", whiteSpace: "nowrap",
                        }}
                    >
                        {picking ? "Click an atom…" : "Pick in viewer"}
                    </button>
                    <input
                        style={{ flex: 1, padding: "6px 8px", fontSize: "0.95rem", fontFamily: "monospace" }}
                        value={cbCid}
                        onChange={(e) => setCbCid(e.target.value)}
                        placeholder="//A/801/C19  (or type)"
                        disabled={busy || picking}
                    />
                </div>
            </div>
            <div style={{ marginBottom: 12 }}>
                <label style={{ display: "block", fontSize: "0.85rem", color: "#495057" }}>Link template</label>
                <select
                    style={{ width: "100%", padding: "6px 8px", fontSize: "0.95rem" }}
                    value={linkId}
                    onChange={(e) => setLinkId(e.target.value)}
                    disabled={busy || registry.length === 0}
                >
                    {registry.length === 0 && <option value="">(loading registry…)</option>}
                    {registry.map((r) => (
                        <option key={r.id} value={r.id}>{r.id} — {r.family} — {r.name}</option>
                    ))}
                </select>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                    style={{
                        padding: "8px 14px", fontSize: "0.95rem",
                        background: busy || !cbCid.trim() || !linkId ? "#adb5bd" : "#4dabf7",
                        color: "white", border: "none", borderRadius: 6,
                        cursor: busy || !cbCid.trim() || !linkId ? "not-allowed" : "pointer",
                    }}
                    onClick={submit}
                    disabled={busy || !cbCid.trim() || !linkId}
                >
                    {busy ? "Working…" : "Declare + download"}
                </button>
                <button
                    style={{
                        padding: "8px 14px", fontSize: "0.95rem",
                        background: "#e9ecef", color: "#495057", border: "none", borderRadius: 6, cursor: "pointer",
                    }}
                    onClick={() => setShowOverlay(false)}
                    disabled={busy}
                >Cancel</button>
            </div>
            {status && (
                <div style={{ marginTop: 10, fontSize: "0.85rem", color: statusColor }}>{status}</div>
            )}
        </div>
    );
};

export const MoorhenCovalentLinkButton = (props: ContextButtonProps) => {
    const commandCentre = useCommandCentre();

    const open = useCallback(async (mol: moorhen.Molecule, atom: moorhen.ResidueSpec) => {
        const atomName = (atom as any).atom_name || "SG";
        const sgCid = `//${atom.chain_id}/${atom.res_no}/${atomName.trim()}`;
        props.setOverlayContents(
            <LinkPanel
                molecule={mol}
                sgCid={sgCid}
                commandCentre={commandCentre}
                setShowOverlay={props.setShowOverlay}
                urlPrefix={props.urlPrefix}
            />
        );
        setTimeout(() => props.setShowOverlay(true), 50);
    }, [props, commandCentre]);

    return (
        <MoorhenContextButtonBase
            icon={<span style={{ fontSize: "1.3rem", color: "#fa5252", lineHeight: 1, fontWeight: 700 }}>⛓</span>}
            toolTipLabel="Declare covalent link to ligand"
            needsAtomData={true}
            nonCootCommand={open}
            {...props}
        />
    );
};
