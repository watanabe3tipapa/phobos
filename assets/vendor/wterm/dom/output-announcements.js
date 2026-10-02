const INTERVAL_MS = 500;
const MAX_CELLS = 32768;
const MAX_TEXT = 65536;
const MAX_LINES = 20;
const MAX_CHARACTERS = 4000;
const LIMIT_MESSAGE = "Output announcements paused because there is too much output. Type in the terminal or turn announcements off and on to resume.";
/** Bounded, opt-in summaries of changes to painted terminal text. */
export class OutputAnnouncements {
    constructor(host, getCore, ready) {
        this.host = host;
        this.getCore = getCore;
        this.ready = ready;
        this.live = null;
        this.timer = null;
        this.previous = null;
        this.lines = 0;
        this.characters = 0;
        this.paused = false;
        /** Discard pending speech and baseline existing text after a user action. */
        this.reset = () => {
            this.invalidate();
            this.lines = 0;
            this.characters = 0;
            this.paused = false;
            const core = this.getCore();
            // Suppress everything received before focus/enable, even when its paint
            // is pending. Publishing still waits for the next completed paint.
            if (core && this.active()) {
                this.previous = this.snapshot(core);
                if (!this.previous)
                    this.limit();
            }
        };
        host.addEventListener("focusin", this.reset);
        host.addEventListener("focusout", this.reset);
        host.ownerDocument.addEventListener("visibilitychange", this.reset);
        host.ownerDocument.defaultView?.addEventListener("blur", this.reset);
        host.ownerDocument.defaultView?.addEventListener("focus", this.reset);
    }
    setEnabled(enabled) {
        if (enabled === !!this.live)
            return;
        if (enabled) {
            this.live = this.host.ownerDocument.createElement("div");
            this.live.className = "term-announcements";
            this.live.setAttribute("role", "log");
            this.live.setAttribute("aria-label", "Terminal output");
            this.live.setAttribute("aria-live", "polite");
            this.live.setAttribute("aria-relevant", "additions");
            this.live.setAttribute("aria-atomic", "false");
            this.host.append(this.live);
        }
        else {
            this.live?.remove();
            this.live = null;
        }
        this.reset();
    }
    active() {
        return (!!this.live &&
            this.host.classList.contains("focused") &&
            this.host.isConnected &&
            this.host.ownerDocument.visibilityState !== "hidden" &&
            this.host.ownerDocument.hasFocus());
    }
    input() {
        if (this.paused)
            this.reset();
        else {
            this.lines = 0;
            this.characters = 0;
        }
    }
    /** A resize changes coordinates, not terminal output. */
    invalidate() {
        if (this.timer !== null)
            clearTimeout(this.timer);
        this.timer = null;
        this.previous = null;
        this.live?.replaceChildren();
    }
    /** Called after painting. No cell reads or timers while disabled/unfocused. */
    rendered() {
        if (!this.active()) {
            this.invalidate();
            return;
        }
        if (this.paused || this.timer !== null)
            return;
        const core = this.getCore();
        if (!core)
            return;
        if (!this.previous) {
            this.previous = this.snapshot(core);
            if (!this.previous)
                this.limit();
            return;
        }
        this.timer = setTimeout(() => {
            this.timer = null;
            if (!this.active()) {
                this.invalidate();
                return;
            }
            // A new write may be awaiting paint, including synchronized output.
            // The next completed render schedules another attempt.
            if (!this.ready())
                return;
            const current = this.getCore();
            if (current)
                this.announce(current);
        }, INTERVAL_MS);
    }
    snapshot(core, start) {
        const cols = core.getCols();
        const rows = core.getRows();
        const history = core.getScrollbackCount();
        const discarded = core.getScrollbackDiscardedCount?.() ?? 0;
        const base = history + discarded;
        const first = start ?? base;
        if (first < discarded || (base + rows - first) * cols > MAX_CELLS)
            return null;
        const lines = [];
        let length = 0;
        for (let row = first; row < base + rows; row++) {
            const offset = base - row - 1;
            const width = row < base ? core.getScrollbackLineLen(offset) : cols;
            // Old history rows can have a different width after resizing.
            if (width > cols)
                return null;
            let text = "";
            for (let col = 0; col < width; col++) {
                const cell = row < base
                    ? core.getScrollbackCell(offset, col)
                    : core.getCell(row - base, col);
                if (cell.width === 0 || cell.spacerHead)
                    continue;
                const chars = cell.chars ?? String.fromCodePoint(cell.char || 32);
                length += chars.length;
                if (length > MAX_TEXT)
                    return null;
                text += chars;
            }
            lines.push(text.replace(/ +$/, ""));
        }
        return { base: first, cols, rows, alternate: core.usingAltScreen(), lines };
    }
    announce(core) {
        const previous = this.previous;
        if (!previous)
            return;
        const base = core.getScrollbackCount() + (core.getScrollbackDiscardedCount?.() ?? 0);
        if (previous.cols !== core.getCols() ||
            previous.rows !== core.getRows() ||
            previous.alternate !== core.usingAltScreen() ||
            base < previous.base) {
            this.previous = this.snapshot(core);
            return;
        }
        const current = this.snapshot(core, previous.base);
        if (!current) {
            this.limit();
            return;
        }
        const changed = current.lines.filter((line, index) => line.trim() && line !== previous.lines[index]);
        this.previous = {
            ...current,
            base,
            lines: current.lines.slice(base - current.base),
        };
        if (!changed.length)
            return;
        const text = changed.join("\n");
        if (this.lines + changed.length > MAX_LINES ||
            this.characters + text.length > MAX_CHARACTERS) {
            this.limit();
            return;
        }
        this.lines += changed.length;
        this.characters += text.length;
        this.publish(text);
    }
    publish(text) {
        if (!this.live)
            return;
        const entry = this.host.ownerDocument.createElement("div");
        entry.textContent = text;
        // New nodes let identical output from successive commands be announced.
        // Removals are excluded from aria-relevant and retained DOM stays bounded.
        this.live.replaceChildren(entry);
    }
    limit() {
        this.paused = true;
        this.previous = null;
        this.publish(LIMIT_MESSAGE);
    }
    destroy() {
        this.setEnabled(false);
        this.host.removeEventListener("focusin", this.reset);
        this.host.removeEventListener("focusout", this.reset);
        this.host.ownerDocument.removeEventListener("visibilitychange", this.reset);
        this.host.ownerDocument.defaultView?.removeEventListener("blur", this.reset);
        this.host.ownerDocument.defaultView?.removeEventListener("focus", this.reset);
    }
}
//# sourceMappingURL=output-announcements.js.map