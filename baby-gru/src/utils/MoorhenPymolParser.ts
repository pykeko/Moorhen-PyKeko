/**
 * PyMOL command parser.
 *
 * Splits a PyMOL script into a sequence of Command records. Handles:
 *  - Line-based syntax (each non-empty, non-comment line is one command)
 *  - `#`-style comments (ignored, including mid-line, respecting quotes)
 *  - Backslash continuation: a line ending with `\` is joined to the next
 *  - Comma-separated arg lists; commas inside () or "" are preserved
 *
 * Does NOT validate command names or arg counts — that's the translator's job.
 */

export type PymolCommand = {
    cmd: string;
    args: string[];
    rawLine: string;
    lineNo: number;
};

/**
 * Strip a single line's trailing comment (anything from an unquoted `#`).
 * Quoted strings preserve `#`.
 */
const stripComment = (line: string): string => {
    let inDouble = false;
    let inSingle = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"' && !inSingle) inDouble = !inDouble;
        else if (c === "'" && !inDouble) inSingle = !inSingle;
        else if (c === "#" && !inDouble && !inSingle) return line.slice(0, i);
    }
    return line;
};

/**
 * Split a PyMOL arg-string on top-level commas. Respects (...) and "..." / '...' nesting.
 */
const splitArgs = (argStr: string): string[] => {
    const parts: string[] = [];
    let depth = 0;
    let inDouble = false;
    let inSingle = false;
    let buf = "";
    for (let i = 0; i < argStr.length; i++) {
        const c = argStr[i];
        if (c === '"' && !inSingle) { inDouble = !inDouble; buf += c; }
        else if (c === "'" && !inDouble) { inSingle = !inSingle; buf += c; }
        else if (c === "(" && !inDouble && !inSingle) { depth++; buf += c; }
        else if (c === ")" && !inDouble && !inSingle) { depth--; buf += c; }
        else if (c === "," && depth === 0 && !inDouble && !inSingle) {
            parts.push(buf.trim());
            buf = "";
        } else {
            buf += c;
        }
    }
    if (buf.trim().length > 0) parts.push(buf.trim());
    return parts;
};

/**
 * Parse a multi-line PyMOL script string into Commands.
 */
export const parsePymolScript = (src: string): PymolCommand[] => {
    // Strip comments + collapse `\` continuations first
    const rawLines = src.split("\n");
    const joined: { text: string; lineNo: number }[] = [];
    let pending = "";
    let pendingLineNo = 0;
    for (let i = 0; i < rawLines.length; i++) {
        let line = stripComment(rawLines[i]).replace(/\r$/, "");
        if (line.endsWith("\\")) {
            if (!pending) pendingLineNo = i + 1;
            pending += line.slice(0, -1);
            continue;
        }
        const fullText = pending + line;
        joined.push({ text: fullText, lineNo: pending ? pendingLineNo : i + 1 });
        pending = "";
    }
    if (pending) joined.push({ text: pending, lineNo: pendingLineNo });

    const cmds: PymolCommand[] = [];
    for (const { text, lineNo } of joined) {
        // PyMOL allows multiple commands on one line, separated by `;`. Split
        // each joined line on top-level semicolons (not inside quotes, not
        // inside parens) so `hide spheres; color green, elem c` parses as
        // two distinct commands. Without this, the entire remainder gets
        // glued to the first command's arg list and the second command is
        // never seen.
        for (const segment of splitTopLevel(text, ";")) {
            const trimmed = segment.trim();
            if (!trimmed) continue;
            const m = trimmed.match(/^(\S+)\s*(.*)$/);
            if (!m) continue;
            const cmd = m[1].toLowerCase();
            const argStr = m[2];
            const args = argStr.length === 0 ? [] : splitArgs(argStr);
            cmds.push({ cmd, args, rawLine: trimmed, lineNo });
        }
    }
    return cmds;
};

/**
 * Split a string on a single-char delimiter at top level — respects
 * "..." / '...' quoting and (...) nesting. Used to split PyMOL command
 * sequences on `;` without breaking selectors that contain quoted text.
 */
const splitTopLevel = (src: string, delim: string): string[] => {
    const out: string[] = [];
    let depth = 0;
    let inDouble = false;
    let inSingle = false;
    let buf = "";
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (c === '"' && !inSingle) { inDouble = !inDouble; buf += c; }
        else if (c === "'" && !inDouble) { inSingle = !inSingle; buf += c; }
        else if (c === "(" && !inDouble && !inSingle) { depth++; buf += c; }
        else if (c === ")" && !inDouble && !inSingle) { depth--; buf += c; }
        else if (c === delim && depth === 0 && !inDouble && !inSingle) {
            out.push(buf);
            buf = "";
        } else {
            buf += c;
        }
    }
    out.push(buf);
    return out;
};
