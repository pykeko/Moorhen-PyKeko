// PyKeko v0.2.44 — in-app log console (PyMOL-style).
//
// Renders a thin always-on strip at the very bottom of the viewport
// showing the most recent line from /tmp/pykeko.log (which already
// collects BOTH the renderer's console output and the main process's
// own IPC log entries — refmac/findligand/acedrg spawns, save-bundle
// paths, etc.). Click the strip (or press Cmd+`) to expand into a
// scrollable history; same again to collapse.
//
// Polls the main process via pykeko:log-tail-since on a 1 s interval
// while expanded, and on a 3 s interval while collapsed (just enough
// to keep the strip updated). Stops polling entirely when the
// __moorhenControl bridge isn't there (web build).

import { useCallback, useEffect, useRef, useState } from "react";

interface ParsedLine {
    raw: string;
    timestamp?: string;
    text: string;
    level: "error" | "warn" | "info" | "debug" | "ipc" | "repl-in" | "repl-out" | "repl-err";
}

// REPL history — persisted across sessions via localStorage. Bounded list
// (LIFO sense: newest pushed at end; up-arrow walks backward).
const HISTORY_KEY = "pykeko.logConsole.replHistory";
const HISTORY_MAX = 200;
function loadHistory(): string[] {
    try {
        const s = (typeof window !== "undefined") ? window.localStorage?.getItem(HISTORY_KEY) : null;
        return s ? JSON.parse(s) : [];
    } catch { return []; }
}
function saveHistory(h: string[]) {
    try {
        if (typeof window !== "undefined") window.localStorage?.setItem(HISTORY_KEY, JSON.stringify(h.slice(-HISTORY_MAX)));
    } catch {}
}

// Strip ISO timestamp Electron prepends, and classify the line so we
// can render errors/warnings in a different colour. Heuristic — the
// log lines are unstructured.
function parseLine(raw: string): ParsedLine {
    let level: ParsedLine["level"] = "info";
    const tsm = raw.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\s*(.*)$/);
    const timestamp = tsm?.[1];
    const rest = tsm ? tsm[2] : raw;
    const lower = rest.toLowerCase();
    if (/error|exception|fatal|failed/.test(lower) && !/\bsucceeded\b/.test(lower)) level = "error";
    else if (/warn|warning|deprecat/.test(lower)) level = "warn";
    else if (/^(renderer console: )?(In cootCommand|Calling)\b/.test(rest)) level = "debug";
    else if (/^(refmac5 |acedrg |findligand |saved |opened |save-|got |spawn|launched|invoke:|starting|running|done)/i.test(rest)) level = "ipc";
    return { raw, timestamp, text: rest, level };
}

// Default filter: show everything EXCEPT the chatty "In cootCommand X /
// Calling X" pairs that the worker emits for every single Coot call.
// Toggle off via the panel's "Show all" checkbox.
function isNoisy(line: ParsedLine): boolean {
    return line.level === "debug" || /^renderer console: Map redraw took/.test(line.text);
}

const MAX_LINES = 1000;

export const MoorhenLogConsole = () => {
    const ctrl: any = (typeof window !== "undefined") ? (window as any).__moorhenControl : null;
    const available = !!ctrl?.logTailInitial && !!ctrl?.logTailSince;

    const [lines, setLines] = useState<ParsedLine[]>([]);
    const [expanded, setExpanded] = useState<boolean>(false);
    const [showAll, setShowAll] = useState<boolean>(false);
    const [filter, setFilter] = useState<string>("");
    const positionRef = useRef<number>(0);
    const scrollRef = useRef<HTMLDivElement | null>(null);

    // REPL state. Modes: "js" / "pml" / "shell". `!` prefix overrides
    // any mode and routes to the shell channel (so you can always
    // shell-out from JS or PyMOL without flipping the dropdown).
    const [replInput, setReplInput] = useState<string>("");
    // Default mode is PyMOL — most users coming over from Coot 0.9 will
    // type `color red, chain A` long before they reach for `MoorhenControlApi.foo()`.
    const [replMode, setReplMode] = useState<"js" | "pml" | "shell">(() => {
        if (typeof window === "undefined") return "pml";
        const saved = window.localStorage?.getItem("pykeko.logConsole.replMode");
        return (saved === "js" || saved === "shell" || saved === "pml") ? saved : "pml";
    });
    useEffect(() => {
        try { window.localStorage?.setItem("pykeko.logConsole.replMode", replMode); } catch {}
    }, [replMode]);
    const [busy, setBusy] = useState<boolean>(false);
    const [cwd, setCwd] = useState<string>("");

    // Drag-resizable scroll-area height. User drags the top edge of the
    // expanded panel up/down. Persisted across launches.
    const HEIGHT_KEY = "pykeko.logConsole.panelHeight";
    const MIN_PANEL_H = 80;
    const [panelHeight, setPanelHeight] = useState<number>(() => {
        if (typeof window === "undefined") return 240;
        const v = parseInt(window.localStorage?.getItem(HEIGHT_KEY) || "", 10);
        return Number.isFinite(v) && v >= MIN_PANEL_H ? v : 240;
    });
    useEffect(() => {
        try { window.localStorage?.setItem(HEIGHT_KEY, String(panelHeight)); } catch {}
    }, [panelHeight]);
    const maxPanelH = () => (typeof window !== "undefined" ? Math.floor(window.innerHeight * 0.75) : 600);
    const startResize = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        const startY = e.clientY;
        const startH = panelHeight;
        const onMove = (ev: MouseEvent) => {
            // Anchored at the bottom -- dragging up grows the panel.
            const delta = startY - ev.clientY;
            const next = Math.max(MIN_PANEL_H, Math.min(maxPanelH(), startH + delta));
            setPanelHeight(next);
        };
        const onUp = () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
        };
        document.body.style.cursor = "ns-resize";
        document.body.style.userSelect = "none";
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
    }, [panelHeight]);
    const historyRef = useRef<string[]>(loadHistory());
    const historyIdxRef = useRef<number>(historyRef.current.length); // points past end
    const draftRef = useRef<string>("");
    const inputRef = useRef<HTMLInputElement | null>(null);

    // Initial cwd fetch — populates the panel header so the user can
    // see where files are being written. Re-queried after every `!cd`.
    useEffect(() => {
        const api: any = (typeof window !== "undefined") ? (window as any).MoorhenControlApi : null;
        if (api?.getCwd) {
            api.getCwd().then((r: any) => { if (r?.ok && r.cwd) setCwd(r.cwd); }).catch(() => {});
        }
    }, []);

    const appendLocal = useCallback((level: ParsedLine["level"], text: string) => {
        setLines(prev => [...prev, { raw: text, text, level } as ParsedLine].slice(-MAX_LINES));
    }, []);

    const runRepl = useCallback(async (src: string) => {
        if (!src.trim()) return;
        const api: any = (typeof window !== "undefined") ? (window as any).MoorhenControlApi : null;
        // `!` prefix always means shell, regardless of current mode.
        // Shell *mode* also routes to the shell channel — same code path,
        // just no leading `!` required.
        const hasShellPrefix = src.trimStart().startsWith("!");
        const isShell = hasShellPrefix || replMode === "shell";
        const usePml = !isShell && replMode === "pml";
        const prompt = isShell ? "!" : (usePml ? "p>" : ">");
        const displayCmd = hasShellPrefix ? src.trimStart().slice(1).trimStart() : src;
        appendLocal("repl-in", `${prompt} ${displayCmd}`);
        // Push to history (dedupe consecutive duplicates).
        const h = historyRef.current;
        if (h.length === 0 || h[h.length - 1] !== src) {
            h.push(src);
            if (h.length > HISTORY_MAX) h.splice(0, h.length - HISTORY_MAX);
            saveHistory(h);
        }
        historyIdxRef.current = historyRef.current.length;
        draftRef.current = "";
        if (!api) {
            appendLocal("repl-err", "REPL unavailable — MoorhenControlApi not mounted yet");
            return;
        }
        setBusy(true);
        try {
            if (isShell) {
                if (!api.runShell) { appendLocal("repl-err", "shell unavailable"); return; }
                // In Shell mode without a `!` prefix the input IS the command;
                // when prefixed, strip the marker before passing through.
                const cmd = hasShellPrefix
                    ? src.trimStart().slice(1).trimStart()
                    : src.trim();

                // Special-case shell builtins whose effect on the *running*
                // shell wouldn't survive a one-shot subshell: cd, export,
                // pushd/popd/dirs, clear. Each routes to a dedicated IPC
                // handler that mutates process-wide state (cwd / env /
                // cwdStack) so subsequent !-shell commands AND the
                // refmac5/findligand/acedrg spawn helpers all see it.

                // cd / cd <path> -> setCwd
                const cdMatch = /^cd(?:\s+(.+?))?\s*$/.exec(cmd);
                if (cdMatch && api.setCwd) {
                    const target = (cdMatch[1] || "").trim() || "~";
                    const r = await api.setCwd(target);
                    if (r?.ok) { setCwd(r.cwd); appendLocal("repl-out", `cwd → ${r.cwd}`); }
                    else appendLocal("repl-err", r?.error || "cd failed");
                    return;
                }

                // export NAME=value | export NAME -> setEnv
                const exportMatch = /^export\s+(.+)$/.exec(cmd);
                if (exportMatch && api.setEnv) {
                    const r = await api.setEnv(exportMatch[1].trim());
                    if (r?.ok) {
                        const disp = (r.value && r.value.length > 200) ? r.value.slice(0, 200) + "…" : (r.value ?? "");
                        appendLocal("repl-out", r.read ? `${r.name}=${disp}` : `export ${r.name}=${disp}`);
                    } else {
                        appendLocal("repl-err", r?.error || "export failed");
                    }
                    return;
                }

                // pushd <path> / popd / dirs -> cwdStack
                const pushdMatch = /^pushd(?:\s+(.+?))?\s*$/.exec(cmd);
                if (pushdMatch && api.cwdStack) {
                    const target = (pushdMatch[1] || "").trim();
                    if (!target) { appendLocal("repl-err", "pushd needs a path"); return; }
                    const r = await api.cwdStack("push", target);
                    if (r?.ok) {
                        setCwd(r.cwd);
                        appendLocal("repl-out", `pushd → ${r.cwd}  (stack: ${r.stack.join(" ")})`);
                    } else {
                        appendLocal("repl-err", r?.error || "pushd failed");
                    }
                    return;
                }
                if (/^popd\s*$/.test(cmd) && api.cwdStack) {
                    const r = await api.cwdStack("pop");
                    if (r?.ok) {
                        setCwd(r.cwd);
                        appendLocal("repl-out", `popd → ${r.cwd}  (stack: ${r.stack.join(" ")})`);
                    } else {
                        appendLocal("repl-err", r?.error || "popd failed");
                    }
                    return;
                }
                if (/^dirs\s*$/.test(cmd) && api.cwdStack) {
                    const r = await api.cwdStack("list");
                    if (r?.ok) appendLocal("repl-out", r.stack.join("\n"));
                    else appendLocal("repl-err", r?.error || "dirs failed");
                    return;
                }

                // clear / cls -> empty local scrollback (matches DevTools).
                if (/^(?:clear|cls)\s*$/.test(cmd)) {
                    setLines([]);
                    return;
                }

                // tty-needing commands hang silently in a no-tty subshell until
                // the 30 s timeout kills them. Warn and refuse rather than let
                // the user think PyKeko froze.
                const ttyBin = /^(?:vim?|nvim|emacs|nano|less|more|man|ssh|sftp|telnet|htop|top|tmux|screen|psql|mysql|sqlite3)\b/;
                if (ttyBin.test(cmd)) {
                    const bin = cmd.match(/^(\S+)/)?.[1] || "this command";
                    appendLocal("repl-err", `${bin} needs a tty — open Terminal for that. (Forced through anyway? Type !-${cmd})`);
                    return;
                }
                // Escape hatch for "I really do want to run it": prefix the
                // command with a dash, e.g. `!-vim --version` runs through.
                let finalCmd = cmd;
                if (cmd.startsWith("-")) finalCmd = cmd.slice(1);

                const r = await api.runShell(finalCmd);
                if (r?.ok) {
                    if (r.stdout) appendLocal("repl-out", r.stdout.replace(/\n+$/, ""));
                    if (r.stderr) appendLocal("repl-err", r.stderr.replace(/\n+$/, ""));
                    if (!r.stdout && !r.stderr) appendLocal("repl-out", `(exit ${r.code})`);
                } else {
                    if (r?.stdout) appendLocal("repl-out", r.stdout.replace(/\n+$/, ""));
                    if (r?.stderr) appendLocal("repl-err", r.stderr.replace(/\n+$/, ""));
                    appendLocal("repl-err", r?.timedOut ? "(shell command timed out)" : r?.error ? `error: ${r.error}` : `(exit ${r?.code ?? "?"})`);
                }
            } else if (usePml) {
                if (!api.runPymol) { appendLocal("repl-err", "PyMOL mode unavailable"); return; }
                try {
                    await api.runPymol(src);
                    appendLocal("repl-out", "ok");
                } catch (e: any) {
                    appendLocal("repl-err", `PyMOL: ${String(e?.message || e)}`);
                }
            } else {
                if (!api.evalJs) { appendLocal("repl-err", "JS eval unavailable"); return; }
                const r = await api.evalJs(src);
                if (r?.ok) {
                    appendLocal("repl-out", r.repr ?? "undefined");
                } else {
                    appendLocal("repl-err", r?.error || "(unknown error)");
                }
            }
        } catch (e: any) {
            appendLocal("repl-err", String(e?.message || e));
        } finally {
            setBusy(false);
        }
    }, [appendLocal, replMode]);

    const onReplKey = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.preventDefault();
            const src = replInput;
            setReplInput("");
            runRepl(src);
        } else if (e.key === "ArrowUp") {
            const h = historyRef.current;
            if (h.length === 0) return;
            if (historyIdxRef.current === h.length) draftRef.current = replInput; // save in-progress
            const next = Math.max(0, historyIdxRef.current - 1);
            historyIdxRef.current = next;
            setReplInput(h[next]);
            e.preventDefault();
        } else if (e.key === "ArrowDown") {
            const h = historyRef.current;
            if (historyIdxRef.current >= h.length) return;
            const next = historyIdxRef.current + 1;
            historyIdxRef.current = next;
            setReplInput(next >= h.length ? draftRef.current : h[next]);
            e.preventDefault();
        }
    }, [replInput, runRepl]);

    // Initial fetch + poll.
    useEffect(() => {
        if (!available) return;
        let alive = true;
        let timer: any = null;

        const tick = async () => {
            if (!alive) return;
            try {
                if (positionRef.current === 0) {
                    const r = await ctrl.logTailInitial();
                    if (r?.ok) {
                        positionRef.current = r.position || 0;
                        const newLines = r.text.split("\n").filter((l: string) => l.length > 0).map(parseLine);
                        setLines(prev => [...prev, ...newLines].slice(-MAX_LINES));
                    }
                } else {
                    const r = await ctrl.logTailSince(positionRef.current);
                    if (r?.ok && r.text) {
                        positionRef.current = r.position || positionRef.current;
                        const newLines = r.text.split("\n").filter((l: string) => l.length > 0).map(parseLine);
                        if (newLines.length > 0) {
                            setLines(prev => [...prev, ...newLines].slice(-MAX_LINES));
                        }
                    }
                }
            } catch (e) { /* ignore individual poll failures */ }
            const delay = expanded ? 1000 : 3000;
            timer = setTimeout(tick, delay);
        };
        tick();
        return () => {
            alive = false;
            if (timer) clearTimeout(timer);
        };
    }, [available, expanded]);

    // Cmd+` toggles the panel (same shortcut DevTools uses on macOS).
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "`") {
                e.preventDefault();
                setExpanded(v => !v);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    // Auto-scroll to bottom on new content (while expanded).
    useEffect(() => {
        if (expanded && scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [lines, expanded]);

    // Focus the REPL when the panel opens (so the user can start typing
    // immediately after ⌘`, matching DevTools behaviour).
    useEffect(() => {
        if (expanded && inputRef.current) {
            // setTimeout so it survives the same-tick keydown that opened us.
            const t = setTimeout(() => inputRef.current?.focus(), 0);
            return () => clearTimeout(t);
        }
    }, [expanded]);

    // Push Moorhen's bottom panel (sequence viewer + validation panel)
    // up by the console's visible height so they don't overlap. The panel
    // is `position: absolute; bottom: 0`, so a CSS-side override of its
    // `bottom` value moves it cleanly. Re-applied whenever our height changes.
    useEffect(() => {
        if (!available) return;
        const headerH = 36; // collapsed strip
        const filterH = expanded ? 38 : 0;
        const cwdH = expanded && cwd ? 24 : 0;
        const replH = expanded ? 36 : 0;
        const resizeH = expanded ? 5 : 0;
        const totalH = headerH + filterH + cwdH + replH + resizeH + (expanded ? panelHeight : 0);
        const style = document.getElementById("pykeko-log-console-bottom-offset")
            || (() => {
                const s = document.createElement("style");
                s.id = "pykeko-log-console-bottom-offset";
                document.head.appendChild(s);
                return s;
            })();
        style.textContent = `.moorhen__bottom-panel-container { bottom: ${totalH}px !important; }`;
        return () => {
            const s = document.getElementById("pykeko-log-console-bottom-offset");
            if (s) s.remove();
        };
    }, [available, expanded, cwd, panelHeight]);

    if (!available) return null;

    const visible = (showAll ? lines : lines.filter(L => !isNoisy(L)))
        .filter(L => !filter || L.text.toLowerCase().includes(filter.toLowerCase()));
    const latest = visible[visible.length - 1];

    const colorFor = (level: ParsedLine["level"]) => ({
        error: "#ff6b6b",
        warn: "#ffd43b",
        info: "#e9ecef",
        debug: "#868e96",
        ipc: "#74c0fc",
        "repl-in": "#b197fc",
        "repl-out": "#69db7c",
        "repl-err": "#ff8787",
    }[level]);

    return (
        <div style={{
            position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 1500,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: "12.5px",
            background: "rgba(20, 22, 26, 0.92)", color: "#e9ecef",
            borderTop: "1px solid #495057",
            backdropFilter: "blur(4px)",
            pointerEvents: "auto",
        }}>
            {/* Status strip — always visible, click to expand. Height is set
                generously so the strip fully covers any bottom-pinned host UI
                (e.g. Moorhen's "No sequences available" placeholder when no
                structures are loaded) instead of cutting through it mid-line. */}
            <div
                onClick={() => setExpanded(v => !v)}
                style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "6px 10px",
                    cursor: "pointer",
                    userSelect: "none",
                    minHeight: 30,
                    borderBottom: expanded ? "1px solid #495057" : "none",
                }}
                title={expanded ? "Click to collapse (⌘`)" : "Click to expand (⌘`)"}
            >
                <span style={{ color: "#868e96", fontWeight: 600 }}>›_</span>
                <span style={{
                    color: latest ? colorFor(latest.level) : "#868e96",
                    flex: 1,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                }}>
                    {latest ? latest.text : "(log empty)"}
                </span>
                <span style={{ color: "#868e96", fontSize: "11px" }}>
                    {expanded ? "▼" : "▲"}
                </span>
            </div>

            {/* Expanded body */}
            {expanded && (
                <div>
                    {/* Resize handle at the very top edge — drag to grow/shrink
                        the scroll area. Tiny grey strip with `ns-resize` cursor
                        and `≡` affordance on hover so it's discoverable. */}
                    <div
                        onMouseDown={startResize}
                        title="Drag to resize"
                        style={{
                            height: 5,
                            cursor: "ns-resize",
                            background: "linear-gradient(to bottom, transparent 0%, #495057 50%, transparent 100%)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            userSelect: "none",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "#74c0fc")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "linear-gradient(to bottom, transparent 0%, #495057 50%, transparent 100%)")}
                    />
                    <div style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "5px 10px",
                        borderBottom: "1px solid #343a40",
                        background: "rgba(0,0,0,0.2)",
                    }}>
                        <input
                            type="text"
                            placeholder="Filter (case-insensitive)…"
                            value={filter}
                            onChange={e => setFilter(e.target.value)}
                            style={{
                                flex: 1, padding: "3px 6px",
                                background: "#1a1d21", color: "#e9ecef",
                                border: "1px solid #495057", borderRadius: 3,
                                fontFamily: "inherit", fontSize: "12px",
                            }}
                        />
                        <label style={{ color: "#adb5bd", display: "flex", alignItems: "center", gap: 4, fontSize: "12px" }}>
                            <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
                            Show all
                        </label>
                        <button
                            onClick={(e) => { e.stopPropagation(); setLines([]); }}
                            style={{
                                background: "#343a40", color: "#e9ecef",
                                border: "1px solid #495057", borderRadius: 3,
                                padding: "3px 8px", cursor: "pointer", fontSize: "12px",
                            }}
                        >
                            Clear view
                        </button>
                    </div>
                    {/* Active cwd indicator — files saved by the in-app
                        handlers (covalent link, save-bundle, etc.) land here.
                        Changes when the user runs `!cd <path>`. */}
                    {cwd && (
                        <div
                            title="Active working directory — !cd <path> to change. Files saved/loaded by PyKeko default to this directory."
                            style={{
                                padding: "3px 10px",
                                background: "rgba(0,0,0,0.15)",
                                color: "#74c0fc",
                                fontSize: "12px",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                borderBottom: "1px solid #343a40",
                            }}
                        >
                            cwd: {cwd}
                        </div>
                    )}
                    <div
                        ref={scrollRef}
                        style={{
                            height: panelHeight, overflowY: "auto",
                            padding: "4px 10px",
                            lineHeight: 1.35,
                        }}
                    >
                        {visible.length === 0 ? (
                            <div style={{ color: "#868e96", padding: 6 }}>
                                {filter ? "(no matches)" : "(nothing to show — check Show all)"}
                            </div>
                        ) : visible.map((L, i) => (
                            <div key={i} style={{ color: colorFor(L.level), whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                                {L.timestamp && <span style={{ color: "#5c5f66" }}>{L.timestamp.slice(11, 19)} </span>}
                                {L.text}
                            </div>
                        ))}
                    </div>

                    {/* v0.2.45 REPL — JS eval in renderer scope. Same
                        evaluator backs the moorhen_eval MCP tool. */}
                    <div style={{
                        display: "flex", alignItems: "center", gap: 6,
                        padding: "4px 10px",
                        borderTop: "1px solid #343a40",
                        background: "rgba(0,0,0,0.25)",
                    }}>
                        <select
                            value={replMode}
                            onChange={(e) => setReplMode(e.target.value as "js" | "pml" | "shell")}
                            disabled={busy}
                            title="Input mode (! prefix always runs as shell, even from JS/PyMOL)"
                            style={{
                                background: "#1a1d21",
                                color: "#e9ecef",
                                border: "1px solid #495057",
                                borderRadius: 3,
                                padding: "2px 4px",
                                fontFamily: "inherit",
                                fontSize: "12px",
                                cursor: "pointer",
                            }}
                        >
                            <option value="pml">PyMOL</option>
                            <option value="js">JS</option>
                            <option value="shell">Shell</option>
                        </select>
                        {(() => {
                            const hasShellPrefix = replInput.trimStart().startsWith("!");
                            const effectiveShell = hasShellPrefix || replMode === "shell";
                            const promptText = busy ? "…"
                                : effectiveShell ? "!"
                                : (replMode === "pml" ? "p>" : ">");
                            const promptColor = busy ? "#ffd43b"
                                : effectiveShell ? "#ff8787"
                                : "#b197fc";
                            return (
                                <span style={{ color: promptColor, fontWeight: 700, userSelect: "none", minWidth: 12 }}>
                                    {promptText}
                                </span>
                            );
                        })()}
                        <input
                            ref={inputRef}
                            type="text"
                            value={replInput}
                            disabled={busy}
                            onChange={(e) => { setReplInput(e.target.value); historyIdxRef.current = historyRef.current.length; }}
                            onKeyDown={onReplKey}
                            spellCheck={false}
                            autoCapitalize="off"
                            autoCorrect="off"
                            placeholder={
                                replMode === "pml"
                                    ? 'PyMOL — try: color red, //A   (! prefix → shell)'
                                : replMode === "shell"
                                    ? 'Shell — try: ls *.pdb   (cd / pushd / export / clear are intercepted)'
                                    : 'JS — try: MoorhenControlApi.listMolecules?.()   (! prefix → shell)'
                            }
                            style={{
                                flex: 1,
                                padding: "3px 6px",
                                background: "#101216",
                                color: "#e9ecef",
                                border: "1px solid #495057",
                                borderRadius: 3,
                                fontFamily: "inherit",
                                fontSize: "11.5px",
                                outline: "none",
                            }}
                        />
                        <span style={{ color: "#5c5f66", fontSize: "10px", whiteSpace: "nowrap" }}>
                            ↑↓ history · Enter run
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
};
