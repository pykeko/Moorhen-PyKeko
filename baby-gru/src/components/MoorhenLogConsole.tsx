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
    level: "error" | "warn" | "info" | "debug" | "ipc";
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
    }[level]);

    return (
        <div style={{
            position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 1500,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: "11.5px",
            background: "rgba(20, 22, 26, 0.92)", color: "#e9ecef",
            borderTop: "1px solid #495057",
            backdropFilter: "blur(4px)",
            pointerEvents: "auto",
        }}>
            {/* Status strip — always visible, click to expand. */}
            <div
                onClick={() => setExpanded(v => !v)}
                style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "3px 10px",
                    cursor: "pointer",
                    userSelect: "none",
                    minHeight: 22,
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
                <span style={{ color: "#868e96", fontSize: "10px" }}>
                    {expanded ? "▼" : "▲"}
                </span>
            </div>

            {/* Expanded body */}
            {expanded && (
                <div>
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
                                flex: 1, padding: "2px 6px",
                                background: "#1a1d21", color: "#e9ecef",
                                border: "1px solid #495057", borderRadius: 3,
                                fontFamily: "inherit", fontSize: "11px",
                            }}
                        />
                        <label style={{ color: "#adb5bd", display: "flex", alignItems: "center", gap: 4 }}>
                            <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
                            Show all
                        </label>
                        <button
                            onClick={(e) => { e.stopPropagation(); setLines([]); }}
                            style={{
                                background: "#343a40", color: "#e9ecef",
                                border: "1px solid #495057", borderRadius: 3,
                                padding: "2px 8px", cursor: "pointer", fontSize: "11px",
                            }}
                        >
                            Clear view
                        </button>
                    </div>
                    <div
                        ref={scrollRef}
                        style={{
                            maxHeight: 240, overflowY: "auto",
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
                </div>
            )}
        </div>
    );
};
