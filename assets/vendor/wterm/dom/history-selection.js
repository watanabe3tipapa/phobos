import { scanText } from "./text-capture.js";
const owners = new WeakMap();
/** A complete, immutable selection; no partial text is exposed while scanning. */
export class HistorySelection {
    constructor(element) {
        this.element = element;
        this.text = null;
        this.scan = null;
        this.timer = null;
        this.resolve = null;
        this.rectangle = null;
        this.decorated = new Set();
        this.onPointerDown = (event) => {
            // A secondary click should not discard a pending keyboard Copy.
            if (event.button === 2 && this.element.contains(event.target))
                return;
            this.clear();
        };
        this.onFocus = (event) => {
            if (!this.element.contains(event.target))
                this.clear();
        };
        this.onSelectionChange = () => {
            if (!this.active)
                return;
            const doc = this.element.ownerDocument;
            const active = doc.activeElement;
            if (active &&
                (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) {
                const input = active;
                if (input.selectionStart !== input.selectionEnd) {
                    this.clear();
                    return;
                }
            }
            const selection = doc.getSelection();
            if (selection && !selection.isCollapsed)
                this.clear();
        };
        this.status = element.ownerDocument.createElement("div");
        this.status.className = "term-selection-status";
        this.status.setAttribute("role", "status");
        element.appendChild(this.status);
        const doc = element.ownerDocument;
        doc.addEventListener("pointerdown", this.onPointerDown, true);
        doc.addEventListener("focusin", this.onFocus);
        doc.addEventListener("selectionchange", this.onSelectionChange);
    }
    get pending() {
        return this.resolve !== null;
    }
    get active() {
        return this.pending || this.text !== null;
    }
    getText() {
        this.onSelectionChange();
        return this.text;
    }
    select() {
        this.claim();
        this.status.textContent = "Selecting terminal text…";
        return new Promise((resolve) => {
            this.resolve = resolve;
        });
    }
    selectRectangle(rectangle) {
        this.claim();
        this.rectangle = rectangle;
        this.text = rectangle.text;
    }
    paintRectangle(rows, charWidth) {
        this.clearDecorations();
        if (!this.rectangle || charWidth <= 0)
            return;
        const first = this.rectangle.rows[0].row;
        for (const { row, element } of rows) {
            const range = this.rectangle.rows[row - first];
            if (!range)
                continue;
            element.classList.add("term-rectangle-row");
            element.style.setProperty("--term-selection-left", `${range.left * charWidth}px`);
            element.style.setProperty("--term-selection-width", `${(range.right - range.left) * charWidth}px`);
            this.decorated.add(element);
        }
    }
    clearDecorations() {
        for (const element of this.decorated) {
            element.classList.remove("term-rectangle-row");
            element.style.removeProperty("--term-selection-left");
            element.style.removeProperty("--term-selection-width");
        }
        this.decorated.clear();
    }
    claim() {
        const doc = this.element.ownerDocument;
        owners.get(doc)?.clear();
        this.clear();
        owners.set(doc, this);
        // Removing a collapsed textarea caret makes Chromium scroll it back into
        // view on the next key event, overriding the terminal's scroll position.
        const native = doc.getSelection();
        if (native && !native.isCollapsed)
            native.removeAllRanges();
    }
    /** WTerm calls this only once its current frame has painted. */
    resume(core) {
        if (!this.pending || this.scan)
            return;
        const scan = (this.scan = scanText(core));
        const tick = () => {
            this.timer = null;
            const deadline = performance.now() + 4;
            try {
                for (let batch = 0; batch < 32; batch++) {
                    const next = scan.next();
                    if (next.done) {
                        this.scan = null;
                        this.text = next.value;
                        this.element.classList.add("term-select-all");
                        this.status.textContent = "";
                        const resolve = this.resolve;
                        this.resolve = null;
                        resolve?.(true);
                        return;
                    }
                    if (performance.now() >= deadline)
                        break;
                }
                this.timer = setTimeout(tick, 0);
            }
            catch {
                this.clear();
                this.status.textContent =
                    "Unable to select all text. Select a smaller range to copy.";
            }
        };
        this.timer = setTimeout(tick, 0);
    }
    clear(message = "") {
        if (!this.active && !this.status.textContent && !message)
            return;
        if (this.timer !== null)
            clearTimeout(this.timer);
        this.timer = null;
        this.scan?.return("");
        this.scan = null;
        this.text = null;
        this.rectangle = null;
        this.clearDecorations();
        this.element.classList.remove("term-select-all");
        this.status.textContent = message;
        if (owners.get(this.element.ownerDocument) === this)
            owners.delete(this.element.ownerDocument);
        const resolve = this.resolve;
        this.resolve = null;
        resolve?.(false);
    }
    invalidate() {
        if (!this.active)
            return;
        this.clear(this.pending ? "Terminal changed. Select all again to copy." : "");
    }
    destroy() {
        this.clear();
        const doc = this.element.ownerDocument;
        doc.removeEventListener("pointerdown", this.onPointerDown, true);
        doc.removeEventListener("focusin", this.onFocus);
        doc.removeEventListener("selectionchange", this.onSelectionChange);
        this.status.remove();
    }
}
//# sourceMappingURL=history-selection.js.map