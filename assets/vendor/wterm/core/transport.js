// Count before encoding so rejected pastes do not allocate another huge buffer.
function utf8Length(text, limit) {
    let bytes = 0;
    for (let i = 0; i < text.length && bytes <= limit; i++) {
        const code = text.charCodeAt(i);
        if (code < 0x80)
            bytes++;
        else if (code < 0x800)
            bytes += 2;
        else if (code >= 0xd800 &&
            code <= 0xdbff &&
            i + 1 < text.length &&
            text.charCodeAt(i + 1) >= 0xdc00 &&
            text.charCodeAt(i + 1) <= 0xdfff) {
            bytes += 4;
            i++;
        }
        else
            bytes += 3; // Includes TextEncoder's replacement for lone surrogates.
    }
    return bytes;
}
export class WebSocketTransport {
    constructor(options = {}) {
        this._ws = null;
        this._connectionUrl = null;
        this._reconnectTimer = null;
        this._drainTimer = null;
        this._reconnectDelay = 1000;
        this._closed = false;
        this._buffer = [];
        this._queuedBytes = 0;
        this._backpressured = false;
        this._socketPaused = false;
        this.url = options.url ?? null;
        this._connectionUrl = this.url;
        this.reconnect = options.reconnect !== false;
        this.maxReconnectDelay = options.maxReconnectDelay ?? 30000;
        this.maxBufferedBytes = options.maxBufferedBytes ?? 1024 * 1024;
        this.maxBufferedMessages = options.maxBufferedMessages ?? 1024;
        this.highWaterMark =
            options.highWaterMark ?? Math.min(64 * 1024, this.maxBufferedBytes);
        this.lowWaterMark =
            options.lowWaterMark ?? Math.floor(this.highWaterMark / 4);
        if (!Number.isSafeInteger(this.maxBufferedBytes) ||
            this.maxBufferedBytes <= 0 ||
            !Number.isSafeInteger(this.maxBufferedMessages) ||
            this.maxBufferedMessages <= 0 ||
            !Number.isSafeInteger(this.highWaterMark) ||
            this.highWaterMark <= 0 ||
            this.highWaterMark > this.maxBufferedBytes ||
            !Number.isSafeInteger(this.lowWaterMark) ||
            this.lowWaterMark < 0 ||
            this.lowWaterMark >= this.highWaterMark) {
            throw new RangeError("Invalid WebSocket buffer limits");
        }
        this.onData = options.onData ?? null;
        this.onOpen = options.onOpen ?? null;
        this.onClose = options.onClose ?? null;
        this.onError = options.onError ?? null;
        this.onBackpressure = options.onBackpressure ?? null;
    }
    connect(url) {
        const target = url ?? this.url;
        if (!target)
            throw new Error("No WebSocket URL provided");
        const previous = this._ws;
        if (!this._closed &&
            target === this._connectionUrl &&
            previous &&
            (previous.readyState === WebSocket.CONNECTING ||
                previous.readyState === WebSocket.OPEN))
            return;
        // Construct first: a malformed URL must not dispose a working connection.
        const ws = new WebSocket(target);
        const oldTarget = this._connectionUrl ?? this.url;
        const changedUrl = oldTarget !== null && target !== oldTarget;
        this._cancelTimers();
        this._ws = ws;
        this._closed = false;
        this._socketPaused = false;
        this.url = target;
        this._connectionUrl = target;
        if (changedUrl)
            this._clearBuffer();
        if (previous) {
            this._detach(previous);
            previous.close();
        }
        ws.binaryType = "arraybuffer";
        ws.onopen = () => {
            if (this._ws !== ws || this._closed)
                return;
            this._reconnectDelay = 1000;
            this._flushBuffer();
            if (this._ws === ws && !this._closed)
                this.onOpen?.();
        };
        ws.onmessage = (event) => {
            if (this._ws !== ws || this._closed)
                return;
            this.onData?.(event.data instanceof ArrayBuffer
                ? new Uint8Array(event.data)
                : event.data);
        };
        ws.onclose = () => {
            if (this._ws !== ws)
                return;
            this._ws = null;
            this._detach(ws);
            this._cancelTimers();
            this._socketPaused = false;
            // Only bytes still owned by the transport survive a lost connection.
            // Bytes handed to WebSocket.send have uncertain delivery and are never replayed.
            if (this.reconnect && !this._closed)
                this._scheduleReconnect();
            try {
                this._updatePressure();
            }
            finally {
                this.onClose?.();
            }
        };
        ws.onerror = (event) => {
            if (this._ws !== ws || this._closed)
                return;
            try {
                this.onError?.(event);
            }
            finally {
                if (this._ws === ws)
                    ws.close();
            }
        };
        this._updatePressure();
    }
    /** Accept the complete message or throw; never enqueue a partial paste. */
    send(data) {
        if (this._closed)
            throw new Error("WebSocket transport is closed");
        const available = this.maxBufferedBytes - this.bufferedAmount;
        const bytes = typeof data === "string" ? utf8Length(data, available) : data.byteLength;
        if (bytes > available || this._buffer.length >= this.maxBufferedMessages) {
            throw new RangeError("WebSocket send buffer limit exceeded");
        }
        // Copy views, including Buffer/subarray inputs, so caller mutations cannot
        // change a pending command or keep an oversized backing buffer alive.
        const item = typeof data === "string"
            ? new TextEncoder().encode(data)
            : new Uint8Array(data);
        this._buffer.push(item);
        this._queuedBytes += item.byteLength;
        this._flushBuffer();
    }
    close() {
        this._closed = true;
        this._cancelTimers();
        this._clearBuffer();
        this._socketPaused = false;
        try {
            this._ws?.close();
        }
        finally {
            this._updatePressure();
        }
    }
    get connected() {
        return !this._closed && this._ws?.readyState === WebSocket.OPEN;
    }
    /** Bytes still queued here plus bytes buffered by the current open socket. */
    get bufferedAmount() {
        return this._queuedBytes + (this.connected ? this._ws.bufferedAmount : 0);
    }
    get queuedBytes() {
        return this._queuedBytes;
    }
    get queuedMessages() {
        return this._buffer.length;
    }
    get backpressured() {
        return this._backpressured;
    }
    _flushBuffer() {
        const ws = this._ws;
        if (ws && this.connected) {
            if (this._socketPaused && ws.bufferedAmount <= this.lowWaterMark)
                this._socketPaused = false;
            // Bound per-turn message work as well as bytes. Preserve message boundaries.
            for (let sent = 0; !this._socketPaused && this._buffer.length && sent < 64; sent++) {
                const item = this._buffer[0];
                if (ws.bufferedAmount > 0 &&
                    ws.bufferedAmount + item.byteLength > this.highWaterMark) {
                    this._socketPaused = true;
                    break;
                }
                ws.send(item);
                this._buffer.shift();
                this._queuedBytes -= item.byteLength;
                if (ws.bufferedAmount >= this.highWaterMark)
                    this._socketPaused = true;
            }
            if ((this._buffer.length || ws.bufferedAmount) &&
                this._drainTimer === null) {
                this._drainTimer = setTimeout(() => {
                    this._drainTimer = null;
                    this._flushBuffer();
                }, 16);
            }
        }
        this._updatePressure();
    }
    _updatePressure() {
        const bytes = this.bufferedAmount;
        const full = this._buffer.length >= this.maxBufferedMessages;
        const next = this._backpressured
            ? bytes > this.lowWaterMark || full
            : bytes >= this.highWaterMark || full;
        if (next === this._backpressured)
            return;
        this._backpressured = next;
        this.onBackpressure?.(next);
    }
    _clearBuffer() {
        this._buffer = [];
        this._queuedBytes = 0;
    }
    _cancelTimers() {
        if (this._reconnectTimer !== null)
            clearTimeout(this._reconnectTimer);
        if (this._drainTimer !== null)
            clearTimeout(this._drainTimer);
        this._reconnectTimer = this._drainTimer = null;
    }
    _detach(ws) {
        ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    }
    _scheduleReconnect() {
        this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = null;
            if (!this._closed && this.reconnect)
                this.connect();
        }, this._reconnectDelay);
        this._reconnectDelay = Math.min(this._reconnectDelay * 2, this.maxReconnectDelay);
    }
}
//# sourceMappingURL=transport.js.map