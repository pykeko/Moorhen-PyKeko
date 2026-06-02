import { PlayArrowOutlined } from "@mui/icons-material";
import Prism from "prismjs";
import "prismjs/components/prism-clike";
import "prismjs/components/prism-javascript";
import "prismjs/themes/prism-okaidia.css";
import { useSelector, useStore } from "react-redux";
import Editor from "react-simple-code-editor";
import { useCallback, useEffect, useRef, useState } from "react";  // useEffect for draft-snap-out
import { useCommandCentre } from "../../InstanceManager";
import { moorhen } from "../../types/moorhen";
import { MoorhenScriptApi } from "../../utils/MoorhenScriptAPI";
import { modalKeys } from "../../utils/enums";
import { convertRemToPx, convertViewtoPx } from "../../utils/utils";
import { MoorhenButton, MoorhenSelect } from "../inputs";
import { MoorhenDraggableModalBase } from "../interface-base/ModalBase/DraggableModalBase";

type ScriptMode = "javascript" | "pymol";

const MODE_STORAGE_KEY = "moorhen.scripting.mode";
const HISTORY_STORAGE_PREFIX = "moorhen.scripting.history.";
const HISTORY_MAX = 200;

const loadInitialMode = (): ScriptMode => {
    // PyKeko default: PyMOL (crystallographers' lingua franca; the JS mode is opt-in).
    try {
        const v = localStorage.getItem(MODE_STORAGE_KEY);
        return v === "javascript" ? "javascript" : "pymol";
    } catch {
        return "pymol";
    }
};

const loadHistory = (mode: ScriptMode): string[] => {
    try {
        const raw = localStorage.getItem(HISTORY_STORAGE_PREFIX + mode);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter(s => typeof s === "string") : [];
    } catch {
        return [];
    }
};

const saveHistory = (mode: ScriptMode, hist: string[]) => {
    try { localStorage.setItem(HISTORY_STORAGE_PREFIX + mode, JSON.stringify(hist)); } catch {}
};

/** Cursor is "at top" of the textarea — anywhere on the first line. */
const cursorAtTop = (ta: HTMLTextAreaElement): boolean => {
    const before = ta.value.slice(0, ta.selectionStart);
    return !before.includes("\n");
};
/** Cursor is "at bottom" — anywhere on the last line. */
const cursorAtBottom = (ta: HTMLTextAreaElement): boolean => {
    const after = ta.value.slice(ta.selectionEnd);
    return !after.includes("\n");
};

export const MoorhenScriptModal = () => {
    const [code, setCode] = useState<string>("");
    const [mode, setMode] = useState<ScriptMode>(loadInitialMode);
    // Per-mode shell-style history. historyIdx: -1 means "live draft, not
    // browsing history"; 0 = most recent submitted command, 1 = one before…
    // draft stashes whatever the user was typing before they first hit ↑,
    // so ↓ back to -1 restores it.
    const [history, setHistory] = useState<string[]>(() => loadHistory(loadInitialMode()));
    const historyIdxRef = useRef<number>(-1);
    const draftRef = useRef<string>("");

    const width = useSelector((state: moorhen.State) => state.sceneSettings.width);
    const height = useSelector((state: moorhen.State) => state.sceneSettings.height);
    const molecules = useSelector((state: moorhen.State) => state.molecules.moleculeList);
    const maps = useSelector((state: moorhen.State) => state.maps);
    const store = useStore();
    const commandCentre = useCommandCentre();

    const handleModeChange = (evt: React.ChangeEvent<HTMLSelectElement>) => {
        const newMode = evt.target.value as ScriptMode;
        setMode(newMode);
        try { localStorage.setItem(MODE_STORAGE_KEY, newMode); } catch {}
        // Switch history pool to match the new mode; reset browse position.
        setHistory(loadHistory(newMode));
        historyIdxRef.current = -1;
        draftRef.current = "";
    };

    // Run + record. De-duplicates against the immediate previous entry
    // (zsh HIST_IGNORE_DUPS) so a re-run doesn't bloat history with the
    // same command back-to-back. Skips empty submissions.
    const handleScriptExe = useCallback(async () => {
        const trimmed = code.trim();
        if (trimmed) {
            setHistory(prev => {
                const last = prev[prev.length - 1];
                const next = last === trimmed ? prev : [...prev, trimmed];
                const capped = next.length > HISTORY_MAX ? next.slice(-HISTORY_MAX) : next;
                if (capped !== prev) saveHistory(mode, capped);
                return capped;
            });
            historyIdxRef.current = -1;
            draftRef.current = "";
        }
        try {
            const scriptApi = new MoorhenScriptApi(commandCentre, store as any, molecules, maps);
            if (mode === "pymol") {
                await scriptApi.exePymol(code);
            } else {
                await scriptApi.exe(code);
            }
        } catch (err) {
            console.error(err);
        }
    }, [code, mode, maps, molecules, store, commandCentre]);

    // Keydown handler — passed to react-simple-code-editor's `onKeyDown` prop
    // (more reliable than a ref + bubbling, which broke when the modal's
    // two-phase mount re-rendered the wrapping div). Implements:
    //   - Cmd/Ctrl+Enter: submit (matches REPL convention; was previously
    //     mouse-only via the Play button).
    //   - ↑ at top of textarea: history previous (stashes draft on first dive).
    //   - ↓ at bottom of textarea: history next (restores draft at idx === -1).
    // Boundary-only navigation preserves normal caret movement inside
    // multi-line scripts.
    // Note: typed loosely (Element instead of HTMLTextAreaElement) because
    // react-simple-code-editor's onKeyDown union-types HTMLDivElement |
    // HTMLTextAreaElement and TS rejects the narrower-handler assignment.
    // The event always comes from the inner <textarea> at runtime; we cast.
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        const ta = e.currentTarget as HTMLTextAreaElement;
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void handleScriptExe();
            return;
        }
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        if (e.key === "ArrowUp") {
            if (!cursorAtTop(ta)) return;
            if (history.length === 0) return;
            const idx = historyIdxRef.current;
            if (idx === -1) draftRef.current = code;
            const newIdx = Math.min(idx + 1, history.length - 1);
            if (newIdx === idx) return;
            e.preventDefault();
            historyIdxRef.current = newIdx;
            setCode(history[history.length - 1 - newIdx]);
            requestAnimationFrame(() => {
                ta.selectionStart = ta.selectionEnd = ta.value.length;
            });
        } else {
            if (!cursorAtBottom(ta)) return;
            const idx = historyIdxRef.current;
            if (idx === -1) return;
            e.preventDefault();
            const newIdx = idx - 1;
            historyIdxRef.current = newIdx;
            setCode(newIdx === -1 ? draftRef.current : history[history.length - 1 - newIdx]);
            requestAnimationFrame(() => {
                ta.selectionStart = ta.selectionEnd = ta.value.length;
            });
        }
    }, [history, code, handleScriptExe]);

    // If the user starts typing while replaying a history entry, snap out of
    // history mode so the next ↑ stashes the freshly-edited line instead of
    // overwriting it. The Editor only changes `code` via onValueChange, so
    // we detect via the value going off-script.
    useEffect(() => {
        const idx = historyIdxRef.current;
        if (idx === -1) return;
        const expected = history[history.length - 1 - idx];
        if (code !== expected) {
            historyIdxRef.current = -1;
            draftRef.current = "";
        }
    }, [code, history]);

    const highlight = useCallback((src: string) => {
        // Use Prism's JS highlighter for both modes. A PyMOL-specific tokenizer
        // is planned for a later phase; for now the editor stays readable.
        return Prism.highlight(src, Prism.languages.javascript, "javascript");
    }, []);

    return (
        <MoorhenDraggableModalBase
            modalId={modalKeys.SCRIPTING}
            left={width / 5}
            top={height / 6}
            headerTitle={`Interactive scripting (${mode === "pymol" ? "PyMOL" : "JavaScript"})`}
            minHeight={convertViewtoPx(10, height)}
            minWidth={convertRemToPx(37)}
            maxHeight={convertViewtoPx(60, height)}
            maxWidth={convertRemToPx(55)}
            body={
                <div style={{ width: "100%" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.25rem 0.5rem" }}>
                        <span style={{ fontSize: "0.9rem" }}>Language</span>
                        <MoorhenSelect value={mode} onChange={handleModeChange} style={{ minWidth: "10rem" }}>
                            <option value="javascript">JavaScript</option>
                            <option value="pymol">PyMOL</option>
                        </MoorhenSelect>
                    </div>
                    <div
                        style={{
                            display: "flex",
                            maxHeight: convertViewtoPx(60, height),
                            minHeight: convertViewtoPx(10, height),
                            overflowY: "auto",
                            backgroundColor: "#272822",
                            border: "1px solid #444",
                        }}
                    >
                        <div style={{ height: "100%", width: "100%" }}>
                            <Editor
                                value={code}
                                onValueChange={setCode}
                                onKeyDown={handleKeyDown}
                                highlight={highlight}
                                padding={10}
                                textareaClassName="moorhen-script-editor"
                                style={{
                                    fontFamily: '"Fira code", "Fira Mono", monospace',
                                    fontSize: 16,
                                    color: "#f8f8f2",
                                    caretColor: "#f8f8f2",
                                }}
                            />
                        </div>
                    </div>
                </div>
            }
            footer={
                <MoorhenButton variant="primary" onClick={handleScriptExe}>
                    <PlayArrowOutlined />
                </MoorhenButton>
            }
        />
    );
};
