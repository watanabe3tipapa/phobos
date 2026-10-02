/** Own only an Alt+left drag accepted by the terminal's painted-grid checks. */
export class RectangleDrag {
    constructor(element, callbacks) {
        this.element = element;
        this.callbacks = callbacks;
        this.anchor = null;
        this.suppressClick = false;
        this.owned = false;
        this.lastEvent = null;
        this.frame = null;
        this.down = (event) => {
            this.cancel();
            this.owned = false;
            this.suppressClick = false;
            if (event.defaultPrevented ||
                event.button !== 0 ||
                !event.altKey ||
                event.ctrlKey ||
                event.metaKey)
                return;
            const anchor = this.callbacks.start(event);
            if (!anchor || !this.callbacks.select(anchor, anchor))
                return;
            this.anchor = anchor;
            this.owned = true;
            event.preventDefault();
            event.stopImmediatePropagation();
        };
        this.move = (event) => {
            if (!this.owned)
                return;
            if (!(event.buttons & 1)) {
                this.blur();
                return;
            }
            event.preventDefault();
            event.stopImmediatePropagation();
            this.update(event);
            this.lastEvent = event;
            this.scheduleScroll();
        };
        this.up = (event) => {
            if (!this.owned || event.button !== 0)
                return;
            event.preventDefault();
            event.stopImmediatePropagation();
            this.update(event);
            this.cancel();
            this.owned = false;
            this.suppressClick = true;
        };
        this.click = (event) => {
            if (!this.suppressClick || event.detail === 0)
                return;
            this.suppressClick = false;
            event.preventDefault();
            event.stopImmediatePropagation();
        };
        this.key = (event) => {
            if (!this.anchor || event.key !== "Escape")
                return;
            event.preventDefault();
            event.stopImmediatePropagation();
            this.cancel();
            this.callbacks.clear();
        };
        this.cancel = () => {
            this.anchor = null;
            this.lastEvent = null;
            if (this.frame !== null)
                cancelAnimationFrame(this.frame);
            this.frame = null;
        };
        this.blur = () => {
            this.cancel();
            this.owned = false;
        };
        this.focus = (event) => {
            if (!this.element.contains(event.target))
                this.cancel();
        };
        element.addEventListener("mousedown", this.down, true);
        element.addEventListener("click", this.click, true);
        const doc = element.ownerDocument;
        doc.addEventListener("mousemove", this.move, true);
        doc.addEventListener("mouseup", this.up, true);
        doc.addEventListener("keydown", this.key, true);
        doc.addEventListener("focusin", this.focus);
        doc.defaultView?.addEventListener("blur", this.blur);
    }
    update(event) {
        const point = this.callbacks.position(event);
        if (this.anchor && (!point || !this.callbacks.select(this.anchor, point)))
            this.callbacks.clear();
    }
    scheduleScroll() {
        if (this.frame !== null || !this.anchor || !this.lastEvent)
            return;
        this.frame = requestAnimationFrame(() => {
            this.frame = null;
            if (!this.anchor || !this.lastEvent)
                return;
            const rect = this.element.getBoundingClientRect();
            const y = this.lastEvent.clientY;
            const delta = y < rect.top
                ? Math.max(-24, y - rect.top)
                : y > rect.bottom
                    ? Math.min(24, y - rect.bottom)
                    : 0;
            const before = this.element.scrollTop;
            this.element.scrollTop += delta;
            this.update(this.lastEvent);
            if (this.element.scrollTop !== before)
                this.scheduleScroll();
        });
    }
    destroy() {
        this.cancel();
        this.element.removeEventListener("mousedown", this.down, true);
        this.element.removeEventListener("click", this.click, true);
        const doc = this.element.ownerDocument;
        doc.removeEventListener("mousemove", this.move, true);
        doc.removeEventListener("mouseup", this.up, true);
        doc.removeEventListener("keydown", this.key, true);
        doc.removeEventListener("focusin", this.focus);
        doc.defaultView?.removeEventListener("blur", this.blur);
    }
}
//# sourceMappingURL=rectangle-drag.js.map