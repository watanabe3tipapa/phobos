import { GraphicsLayer } from "./graphics-layer.js";
import { getSelectionText, offsetAtCell, textPoint, } from "./selection.js";
import { selectionRange } from "./selection-range.js";
import { rectangleSelection } from "./rectangle-selection.js";
import { TrackedSelection, MAX_TRACKED_SELECTION_ROWS, } from "./tracked-selection.js";
const DEFAULT_COLOR = 256;
const DEFAULT_FG_CSS = "var(--term-app-fg, var(--term-fg))";
const DEFAULT_BG_CSS = "var(--term-app-bg, var(--term-bg))";
const FLAG_BOLD = 0x01;
const FLAG_DIM = 0x02;
const FLAG_ITALIC = 0x04;
const FLAG_UNDERLINE = 0x08;
const FLAG_REVERSE = 0x20;
const FLAG_INVISIBLE = 0x40;
const FLAG_STRIKETHROUGH = 0x80;
const DEFAULT_SCROLLBACK_OVERSCAN_ROWS = 10;
function rgbToCSS(packed) {
    const r = (packed >> 16) & 0xff;
    const g = (packed >> 8) & 0xff;
    const b = packed & 0xff;
    return `rgb(${r},${g},${b})`;
}
function colorToCSS(index) {
    if (index === DEFAULT_COLOR)
        return null;
    if (index < 16)
        return `var(--term-color-${index})`;
    if (index < 232) {
        const n = index - 16;
        const r = Math.floor(n / 36) * 51;
        const g = (Math.floor(n / 6) % 6) * 51;
        const b = (n % 6) * 51;
        return `rgb(${r},${g},${b})`;
    }
    const level = (index - 232) * 10 + 8;
    return `rgb(${level},${level},${level})`;
}
function cellFgCSS(fg, fgRgb) {
    if (fgRgb !== undefined)
        return rgbToCSS(fgRgb);
    return colorToCSS(fg);
}
function cellBgCSS(bg, bgRgb) {
    if (bgRgb !== undefined)
        return rgbToCSS(bgRgb);
    return colorToCSS(bg);
}
function buildCellStyle({ fg, bg, flags, fgRgb, bgRgb, underlineStyle, underlineRgb, }) {
    let fgCSS = cellFgCSS(fg, fgRgb);
    let bgCSS = cellBgCSS(bg, bgRgb);
    if (flags & FLAG_REVERSE) {
        [fgCSS, bgCSS] = [bgCSS ?? DEFAULT_BG_CSS, fgCSS ?? DEFAULT_FG_CSS];
    }
    let style = "";
    if (fgCSS)
        style += `color:${fgCSS};`;
    if (bgCSS)
        style += `background:${bgCSS};`;
    if (flags & FLAG_BOLD)
        style += "font-weight:bold;";
    if (flags & FLAG_DIM)
        style += "opacity:0.5;";
    if (flags & FLAG_ITALIC)
        style += "font-style:italic;";
    const decorations = [];
    const underline = underlineStyle ?? (flags & FLAG_UNDERLINE ? "single" : "none");
    if (underline !== "none")
        decorations.push("underline");
    if (flags & FLAG_STRIKETHROUGH)
        decorations.push("line-through");
    if (decorations.length)
        style += `text-decoration:${decorations.join(" ")};`;
    if (underline !== "none") {
        const cssStyle = underline === "curly"
            ? "wavy"
            : underline === "double" ||
                underline === "dotted" ||
                underline === "dashed"
                ? underline
                : "solid";
        style += `text-decoration-style:${cssStyle};text-decoration-skip-ink:none;`;
        if (underlineRgb !== undefined)
            style += `text-decoration-color:${rgbToCSS(underlineRgb)};`;
    }
    if (flags & FLAG_INVISIBLE)
        style += "visibility:hidden;";
    return style;
}
// Cell colors are normally inline styles so each run can be painted without
// extra classes. Cursor styles need to remain overridable by the focused
// cursor rule, though, so move only those two declarations to custom
// properties when a cursor span reuses a cell style.
function cursorCellStyle(style) {
    return style
        .replace(/(^|;)color:/g, "$1--term-cell-fg:")
        .replace(/(^|;)background:/g, "$1--term-cell-bg:");
}
function columnStyle(columns) {
    return columns === 1 ? "" : `--term-span-cols:${columns};`;
}
function appendRun(parent, text, style) {
    const span = document.createElement("span");
    if (style)
        span.style.cssText = style;
    span.textContent = text;
    parent.appendChild(span);
}
function escapeHTML(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
// CSS applies one decoration style/color to every line on an element. Keep
// the strike on its own inline element so colored/curly underlines do not
// change it. The cell span still owns geometry and the text appears only once.
function cellSpanPart(className, style, text) {
    let content = escapeHTML(text);
    const flat = !style.includes("text-decoration:underline line-through;");
    if (!flat) {
        style = style.replace("text-decoration:underline line-through;", "text-decoration:underline;");
        content = `<span style="text-decoration:line-through solid currentColor;">${content}</span>`;
    }
    const classAttr = className ? ` class="${className}"` : "";
    const styleAttr = style ? ` style="${style}"` : "";
    const opening = `<span${classAttr}${styleAttr}>`;
    return {
        html: `${opening}${content}</span>`,
        opening: flat ? opening : undefined,
        text: flat ? text : undefined,
    };
}
function safeLinkHref(uri) {
    if (!uri)
        return undefined;
    try {
        const url = new URL(uri);
        return url.protocol === "http:" || url.protocol === "https:"
            ? url.href
            : undefined;
    }
    catch {
        return undefined;
    }
}
function linkIdentity(cell) {
    if (!cell.linkUri)
        return "";
    return cell.linkKey ?? `fallback\0${cell.linkId ?? ""}\0${cell.linkUri}`;
}
function resolveColors(fg, bg, flags, fgRgb, bgRgb) {
    const foreground = cellFgCSS(fg, fgRgb) || DEFAULT_FG_CSS;
    const background = cellBgCSS(bg, bgRgb) || DEFAULT_BG_CSS;
    return flags & FLAG_REVERSE
        ? { fg: background, bg: foreground }
        : { fg: foreground, bg: background };
}
// Pixel-snapped vertical gradient stops keyed off `--term-row-height` so that
// every cell paints the eighth-block boundary on the same physical pixel —
// using raw percentages (e.g. `12.5%`) at the canonical 17px row-height
// resolves to 2.125px and the browser rounds it differently across cells,
// producing the per-cell jog Claude Code's horizontal-rule (`▔▔▔▔▔`) makes
// visible against the row immediately below.
const SNAP_1_8 = "round(calc(var(--term-row-height) * 0.125), 1px)";
const SNAP_2_8 = "round(calc(var(--term-row-height) * 0.25), 1px)";
const SNAP_3_8 = "round(calc(var(--term-row-height) * 0.375), 1px)";
const SNAP_4_8 = "round(calc(var(--term-row-height) * 0.5), 1px)";
const SNAP_5_8 = "round(calc(var(--term-row-height) * 0.625), 1px)";
const SNAP_6_8 = "round(calc(var(--term-row-height) * 0.75), 1px)";
const SNAP_7_8 = "round(calc(var(--term-row-height) * 0.875), 1px)";
function getBlockBackground(cp, fg, bg) {
    switch (cp) {
        case 0x2580:
            return `linear-gradient(${fg} ${SNAP_4_8},${bg} ${SNAP_4_8})`;
        case 0x2581:
            return `linear-gradient(${bg} ${SNAP_7_8},${fg} ${SNAP_7_8})`;
        case 0x2582:
            return `linear-gradient(${bg} ${SNAP_6_8},${fg} ${SNAP_6_8})`;
        case 0x2583:
            return `linear-gradient(${bg} ${SNAP_5_8},${fg} ${SNAP_5_8})`;
        case 0x2584:
            return `linear-gradient(${bg} ${SNAP_4_8},${fg} ${SNAP_4_8})`;
        case 0x2585:
            return `linear-gradient(${bg} ${SNAP_3_8},${fg} ${SNAP_3_8})`;
        case 0x2586:
            return `linear-gradient(${bg} ${SNAP_2_8},${fg} ${SNAP_2_8})`;
        case 0x2587:
            return `linear-gradient(${bg} ${SNAP_1_8},${fg} ${SNAP_1_8})`;
        case 0x2588:
            return fg;
        case 0x2589:
            return `linear-gradient(to right,${fg} 87.5%,${bg} 87.5%)`;
        case 0x258a:
            return `linear-gradient(to right,${fg} 75%,${bg} 75%)`;
        case 0x258b:
            return `linear-gradient(to right,${fg} 62.5%,${bg} 62.5%)`;
        case 0x258c:
            return `linear-gradient(to right,${fg} 50%,${bg} 50%)`;
        case 0x258d:
            return `linear-gradient(to right,${fg} 37.5%,${bg} 37.5%)`;
        case 0x258e:
            return `linear-gradient(to right,${fg} 25%,${bg} 25%)`;
        case 0x258f:
            return `linear-gradient(to right,${fg} 12.5%,${bg} 12.5%)`;
        case 0x2590:
            return `linear-gradient(to right,${bg} 50%,${fg} 50%)`;
        case 0x2591:
            return `color-mix(in srgb,${fg} 25%,${bg})`;
        case 0x2592:
            return `color-mix(in srgb,${fg} 50%,${bg})`;
        case 0x2593:
            return `color-mix(in srgb,${fg} 75%,${bg})`;
        case 0x2594:
            return `linear-gradient(${fg} ${SNAP_1_8},${bg} ${SNAP_1_8})`;
        case 0x2595:
            return `linear-gradient(to right,${bg} 87.5%,${fg} 87.5%)`;
        default: {
            const QUADRANTS = {
                0x2596: [false, false, true, false],
                0x2597: [false, false, false, true],
                0x2598: [true, false, false, false],
                0x2599: [true, false, true, true],
                0x259a: [true, false, false, true],
                0x259b: [true, true, true, false],
                0x259c: [true, true, false, true],
                0x259d: [false, true, false, false],
                0x259e: [false, true, true, false],
                0x259f: [false, true, true, true],
            };
            const q = QUADRANTS[cp];
            if (!q)
                return fg;
            const [tl, tr, bl, br] = q;
            if (tl && tr && bl && br)
                return fg;
            const layers = [];
            const POS = ["0 0", "100% 0", "0 100%", "100% 100%"];
            q.forEach((filled, i) => {
                if (filled)
                    layers.push(`linear-gradient(${fg},${fg}) ${POS[i]}/50% 50% no-repeat`);
            });
            layers.push(bg);
            return layers.join(",");
        }
    }
}
// Keep box characters as text for selection and copy while painting their
// strokes to cell edges. Some fallback fonts leave gaps at those boundaries.
const LIGHT_BOX_ARMS = {
    0x2500: "lr", // ─
    0x2502: "ud", // │
    0x250c: "dr", // ┌
    0x2510: "dl", // ┐
    0x2514: "ur", // └
    0x2518: "ul", // ┘
    0x251c: "udr", // ├
    0x2524: "udl", // ┤
    0x252c: "dlr", // ┬
    0x2534: "ulr", // ┴
    0x253c: "udlr", // ┼
    0x2574: "l", // ╴
    0x2575: "u", // ╵
    0x2576: "r", // ╶
    0x2577: "d", // ╷
};
const HEAVY_BOX_ARMS = {
    0x2501: "lr", // ━
    0x2503: "ud", // ┃
    0x250f: "dr", // ┏
    0x2513: "dl", // ┓
    0x2517: "ur", // ┗
    0x251b: "ul", // ┛
    0x2523: "udr", // ┣
    0x252b: "udl", // ┫
    0x2533: "dlr", // ┳
    0x253b: "ulr", // ┻
    0x254b: "udlr", // ╋
    0x2578: "l", // ╸
    0x2579: "u", // ╹
    0x257a: "r", // ╺
    0x257b: "d", // ╻
};
const ROUNDED_BOX_CORNERS = {
    0x256d: "tl", // ╭
    0x256e: "tr", // ╮
    0x256f: "br", // ╯
    0x2570: "bl", // ╰
};
const BOX_STYLES = {};
function addBoxStyles(characters, className) {
    const stroke = "var(--term-box-stroke)";
    const verticalLength = `calc(50% + ${stroke})`;
    const horizontalLength = `calc(50% + ${stroke})`;
    for (const [codepoint, arms] of Object.entries(characters)) {
        const selected = [];
        if (arms.includes("u") && arms.includes("d")) {
            selected.push(["center center", `${stroke} 100%`]);
        }
        else {
            if (arms.includes("u"))
                selected.push(["center top", `${stroke} ${verticalLength}`]);
            if (arms.includes("d"))
                selected.push(["center bottom", `${stroke} ${verticalLength}`]);
        }
        if (arms.includes("l") && arms.includes("r")) {
            selected.push(["center center", `100% ${stroke}`]);
        }
        else {
            if (arms.includes("l"))
                selected.push(["left center", `${horizontalLength} ${stroke}`]);
            if (arms.includes("r"))
                selected.push(["right center", `${horizontalLength} ${stroke}`]);
        }
        BOX_STYLES[Number(codepoint)] = {
            className,
            style: `background-image:${selected.map(() => "linear-gradient(currentColor,currentColor)").join(",")};background-position:${selected.map(([position]) => position).join(",")};background-size:${selected.map(([, size]) => size).join(",")};background-repeat:no-repeat;`,
        };
    }
}
addBoxStyles(LIGHT_BOX_ARMS, "term-box");
addBoxStyles(HEAVY_BOX_ARMS, "term-box term-box-heavy");
for (const [codepoint, corner] of Object.entries(ROUNDED_BOX_CORNERS)) {
    BOX_STYLES[Number(codepoint)] = {
        className: `term-box term-box-round term-box-round-${corner}`,
        style: "",
    };
}
export class Renderer {
    get hasImageFlow() {
        return (this.container.parentElement?.classList.contains("has-image-flow") ??
            false);
    }
    constructor(container, options = {}) {
        this.rows = 0;
        this.cols = 0;
        this.rowEls = [];
        this.prevCursorRow = -1;
        this.prevCursorCol = -1;
        this.prevCursorVisible = false;
        this.prevRowBg = [];
        this._scrollbackRowEls = [];
        this._scrollbackKeys = [];
        this._scrollbackRowHeight = 0;
        this._scrollbackGapSpacers = [];
        this._renderedScrollbackCount = -1;
        this._renderedDiscardedCount = -1;
        this._scrollbackTopSpacer = null;
        this._scrollbackBottomSpacer = null;
        this.rowText = new WeakMap();
        this.rowParts = new WeakMap();
        this.rowBackground = new WeakMap();
        this.selection = null;
        this.needsSetup = false;
        this.colorsChanged = false;
        this.painted = false;
        this.container = container;
        this.colorHost = options.colorHost ?? container;
        this.graphics = new GraphicsLayer(container, options);
        this.searchLayer = document.createElement("div");
        this.searchLayer.className = "term-search-layer";
        this.searchLayer.setAttribute("aria-hidden", "true");
    }
    setup(cols, rows) {
        this.cols = cols;
        this.rows = rows;
        this.container.innerHTML = "";
        this.rowText = new WeakMap();
        this.rowParts = new WeakMap();
        this.rowBackground = new WeakMap();
        this.rowEls = [];
        this.prevRowBg = [];
        this._scrollbackRowEls = [];
        this._scrollbackKeys = [];
        this._scrollbackGapSpacers = [];
        this._renderedScrollbackCount = -1;
        this._renderedDiscardedCount = -1;
        const fragment = document.createDocumentFragment();
        this._scrollbackTopSpacer = document.createElement("div");
        this._scrollbackTopSpacer.className = "term-scrollback-spacer";
        fragment.appendChild(this._scrollbackTopSpacer);
        this._scrollbackBottomSpacer = document.createElement("div");
        this._scrollbackBottomSpacer.className = "term-scrollback-spacer";
        fragment.appendChild(this._scrollbackBottomSpacer);
        for (let r = 0; r < rows; r++) {
            const rowEl = document.createElement("div");
            rowEl.className = "term-row";
            fragment.appendChild(rowEl);
            this.rowEls.push(rowEl);
        }
        this.container.appendChild(fragment);
        this.searchLayer.replaceChildren();
        this.container.appendChild(this.searchLayer);
        this.graphics.setup();
        this.prevCursorRow = -1;
        this.prevCursorCol = -1;
    }
    _buildRowContent(rowEl, getCell, lineLen, cursorCol, rowIndex) {
        // Each part is one direct child: a cell span, text run, or complete link.
        // Keeping their boundaries lets a redraw preserve unchanged Unicode cells.
        const parts = [];
        let linkHtml = "";
        const content = {
            text: "",
            specialCells: [],
            metadata: null,
        };
        const recordText = (text, col, width = 1, omit = false) => {
            const start = content.text.length;
            content.text += text;
            if (text.length !== width || width > 1 || omit) {
                content.specialCells.push({
                    start,
                    end: content.text.length,
                    col,
                    width,
                    omit,
                });
            }
        };
        let runStyle = "";
        let runText = "";
        let runCells = [];
        let runStart = 0;
        let runLinkKey = "";
        let runLinkUri;
        let outputLinkKey = "";
        let rowBackground;
        let uniformBackground = lineLen >= this.cols;
        const appendContent = (content, linkKey, uri) => {
            const href = safeLinkHref(uri);
            const nextLinkKey = href ? linkKey : "";
            if (nextLinkKey !== outputLinkKey) {
                if (outputLinkKey)
                    parts.push({ html: linkHtml + "</a>" });
                if (nextLinkKey) {
                    linkHtml = `<a class="term-link" href="${escapeHTML(href)}" target="_blank" rel="noopener noreferrer">`;
                }
                outputLinkKey = nextLinkKey;
            }
            if (outputLinkKey)
                linkHtml += content.html;
            else
                parts.push(content);
        };
        const flushRun = (endCol) => {
            if (!runText)
                return;
            const append = (className, style, text) => appendContent(cellSpanPart(className, style, text), runLinkKey, runLinkUri);
            if (cursorCol >= runStart && cursorCol < endCol) {
                const offset = cursorCol - runStart;
                const before = runCells.slice(0, offset).join("");
                const cursorChar = runCells[offset] || " ";
                const after = runCells.slice(offset + 1).join("");
                if (before) {
                    const style = columnStyle(offset) + runStyle;
                    append("", style, before);
                }
                const cursorStyle = cursorCellStyle(runStyle);
                append("term-cursor", cursorStyle, cursorChar);
                if (after) {
                    const style = columnStyle(runCells.length - offset - 1) + runStyle;
                    append("", style, after);
                }
            }
            else {
                const style = columnStyle(runCells.length) + runStyle;
                append("", style, runText);
            }
            runText = "";
            runCells = [];
        };
        const appendStyledSpan = (className, style, text, linkKey, linkUri) => {
            appendContent(cellSpanPart(className, style, text), linkKey, linkUri);
        };
        for (let col = 0; col < this.cols; col++) {
            const cell = getCell(col);
            const inBounds = col < lineLen;
            const cp = inBounds ? cell.char : 0;
            const width = inBounds ? (cell.width ?? 1) : 1;
            const cellLinkKey = inBounds ? linkIdentity(cell) : "";
            const cellLinkUri = inBounds ? cell.linkUri : undefined;
            // Only a shared, opaque background can fill the unused row width.
            // Otherwise it would also show through default, dim, or hidden cells.
            // A wide continuation is painted by its lead, not by its own style.
            const continuesWide = inBounds &&
                width === 0 &&
                col > 0 &&
                (getCell(col - 1).width ?? 1) === 2;
            if (uniformBackground && !continuesWide) {
                const bg = resolveColors(cell.fg, cell.bg, cell.flags, cell.fgRgb, cell.bgRgb).bg;
                if (cell.flags & (FLAG_DIM | FLAG_INVISIBLE) ||
                    (rowBackground !== undefined && rowBackground !== bg)) {
                    uniformBackground = false;
                }
                else {
                    rowBackground = bg;
                }
            }
            if (inBounds && width === 0) {
                flushRun(col);
                // Skipping is only right when this continues the wide cell to the
                // left, which already covers both columns and its cursor. A width-0
                // cell with no wide cell before it owns its column, so dropping it
                // would shorten the row.
                if (!continuesWide) {
                    recordText(" ", col);
                    const style = buildCellStyle(cell);
                    const cursor = col === cursorCol;
                    appendStyledSpan(cursor ? "term-cursor" : "", cursor ? cursorCellStyle(style) : style, " ", cellLinkKey, cellLinkUri);
                }
                runStyle = "";
                runLinkKey = "";
                runLinkUri = undefined;
                runText = "";
                runCells = [];
                runStart = col + 1;
                continue;
            }
            if (inBounds && width === 2) {
                flushRun(col);
                // A scrollback row keeps the width it was stored at, so a narrower
                // grid can put the last rendered column on a wide lead whose
                // continuation is outside the row. Drawing the pair here would spill
                // a second column past the row.
                if (col + 1 >= this.cols) {
                    recordText(" ", col);
                    const style = buildCellStyle(cell);
                    const cursor = col === cursorCol;
                    appendStyledSpan(cursor ? "term-cursor" : "", cursor ? cursorCellStyle(style) : style, " ", cellLinkKey, cellLinkUri);
                    runStyle = "";
                    runLinkKey = "";
                    runLinkUri = undefined;
                    runText = "";
                    runCells = [];
                    runStart = col + 1;
                    continue;
                }
                const ch = cell.chars ?? (cp >= 32 ? String.fromCodePoint(cp) : " ");
                recordText(ch, col, 2);
                const style = buildCellStyle(cell);
                const cursor = cursorCol >= col && cursorCol < col + 2;
                const cls = cursor ? "term-wide term-cursor" : "term-wide";
                appendStyledSpan(cls, cursor ? cursorCellStyle(style) : style, ch, cellLinkKey, cellLinkUri);
                runStyle = "";
                runLinkKey = "";
                runLinkUri = undefined;
                runText = "";
                runCells = [];
                runStart = col + 2;
                continue;
            }
            if (inBounds && cp >= 0x2580 && cp <= 0x259f) {
                flushRun(col);
                const ch = cell.chars ?? String.fromCodePoint(cp);
                recordText(ch, col);
                const colors = resolveColors(cell.fg, cell.bg, cell.flags, cell.fgRgb, cell.bgRgb);
                const cls = col === cursorCol ? "term-block term-cursor" : "term-block";
                const bg = getBlockBackground(cp, colors.fg, colors.bg);
                const style = buildCellStyle(cell) + `color:${colors.fg};background:${bg};`;
                appendStyledSpan(cls, col === cursorCol ? cursorCellStyle(style) : style, ch, cellLinkKey, cellLinkUri);
                runStyle = "";
                runLinkKey = "";
                runLinkUri = undefined;
                runText = "";
                runCells = [];
                runStart = col + 1;
            }
            else {
                const ch = cell.chars ?? (inBounds && cp >= 32 ? String.fromCodePoint(cp) : " ");
                recordText(ch, col, 1, cell.spacerHead === true);
                const style = inBounds ? buildCellStyle(cell) : "";
                // Font fallback can give a narrow Unicode glyph a different advance
                // from ASCII. Bound each such cell (including complete graphemes) so
                // it cannot move later cells within a text run.
                if (ch.length !== 1 || ch.charCodeAt(0) > 0x7e) {
                    flushRun(col);
                    const cursor = col === cursorCol;
                    const box = BOX_STYLES[cp];
                    const boxStyle = box && ch === String.fromCodePoint(cp) ? box : null;
                    let className = boxStyle?.className ?? "";
                    if (boxStyle && cell.flags & FLAG_BOLD)
                        className += " term-box-bold";
                    if (cursor)
                        className += className ? " term-cursor" : "term-cursor";
                    appendStyledSpan(className, (cursor ? cursorCellStyle(style) : style) + (boxStyle?.style ?? ""), ch, cellLinkKey, cellLinkUri);
                    runStyle = "";
                    runLinkKey = "";
                    runLinkUri = undefined;
                    runStart = col + 1;
                    continue;
                }
                if (style !== runStyle || cellLinkKey !== runLinkKey) {
                    flushRun(col);
                    runStyle = style;
                    runLinkKey = cellLinkKey;
                    runLinkUri = cellLinkUri;
                    runText = ch;
                    runCells = [ch];
                    runStart = col;
                }
                else {
                    runText += ch;
                    runCells.push(ch);
                }
            }
        }
        flushRun(this.cols);
        if (outputLinkKey)
            parts.push({ html: linkHtml + "</a>" });
        this.updateRowParts(rowEl, parts);
        this.rowText.set(rowEl, content);
        const bgCss = uniformBackground && rowBackground !== DEFAULT_BG_CSS
            ? (rowBackground ?? "")
            : "";
        if (rowIndex >= 0) {
            if (bgCss !== (this.prevRowBg[rowIndex] ?? "")) {
                rowEl.style.background = bgCss;
                this.prevRowBg[rowIndex] = bgCss;
            }
        }
        else if (this.rowBackground.get(rowEl) !== bgCss) {
            rowEl.style.background = bgCss;
            this.rowBackground.set(rowEl, bgCss);
        }
    }
    updateRowParts(row, parts) {
        const previous = this.rowParts.get(row);
        let start = 0;
        let oldEnd = previous?.length ?? 0;
        let newEnd = parts.length;
        if (previous) {
            while (start < oldEnd &&
                start < newEnd &&
                previous[start].html === parts[start].html)
                start++;
            while (oldEnd > start &&
                newEnd > start &&
                previous[oldEnd - 1].html === parts[newEnd - 1].html) {
                oldEnd--;
                newEnd--;
            }
        }
        if (start === oldEnd && start === newEnd)
            return;
        // Keep spans with unchanged geometry and styling. Assigning raw text to
        // their existing text nodes avoids HTML parsing and element replacement.
        let textOnly = previous !== undefined && oldEnd === newEnd;
        for (let i = start; textOnly && i < newEnd; i++) {
            const child = row.childNodes[i];
            textOnly =
                parts[i].opening !== undefined &&
                    parts[i].opening === previous[i].opening &&
                    child?.childNodes.length === 1 &&
                    child.firstChild?.nodeType === 3;
        }
        if (textOnly) {
            for (let i = start; i < newEnd; i++) {
                if (parts[i].html !== previous[i].html)
                    row.childNodes[i].firstChild.nodeValue = parts[i].text;
            }
            this.rowParts.set(row, parts);
            return;
        }
        const retained = start + parts.length - newEnd;
        const replaced = Math.max(oldEnd - start, newEnd - start);
        // Parsing the whole row is cheaper when there is little to retain.
        if (retained < replaced) {
            row.innerHTML = parts.map((part) => part.html).join("");
        }
        else {
            // Replace only the changed middle, retaining the native text nodes and
            // layout objects of the matching prefix and suffix. Links stay atomic.
            const range = row.ownerDocument.createRange();
            range.setStart(row, start);
            range.setEnd(row, oldEnd);
            range.deleteContents();
            const html = parts
                .slice(start, newEnd)
                .map((part) => part.html)
                .join("");
            if (html)
                range.insertNode(range.createContextualFragment(html));
        }
        this.rowParts.set(row, parts);
    }
    _updateScrollbackRow(core, sbOffset, rowEl) {
        const lineLen = core.getScrollbackLineLen(sbOffset);
        this._buildRowContent(rowEl, (col) => core.getScrollbackCell(sbOffset, col), lineLen, -1, -1);
        const content = this.rowText.get(rowEl);
        const metadata = core.getScrollbackRowMetadata?.(sbOffset);
        content.metadata =
            metadata && lineLen <= this.cols ? { ...metadata } : null;
    }
    syncScrollback(core, viewport) {
        const scrollbackCount = core.getScrollbackCount();
        const rowHeight = viewport?.rowHeight ?? 0;
        const virtual = viewport !== undefined && rowHeight > 0;
        const overscan = viewport?.overscanRows ?? DEFAULT_SCROLLBACK_OVERSCAN_ROWS;
        const hasDiscardedCount = viewport?.scrollbackDiscardedCount !== undefined;
        const discardedCount = viewport?.scrollbackDiscardedCount ?? 0;
        const viewportHeight = viewport && viewport.clientHeight > 0
            ? viewport.clientHeight
            : this.rows * rowHeight;
        const firstVisible = virtual
            ? Math.floor(viewport.scrollTop / rowHeight)
            : 0;
        const visibleRows = virtual
            ? Math.ceil(viewportHeight / rowHeight)
            : scrollbackCount;
        const start = virtual
            ? Math.max(0, Math.min(scrollbackCount, firstVisible - overscan))
            : 0;
        const end = virtual
            ? Math.max(start, Math.min(scrollbackCount, firstVisible + visibleRows + overscan))
            : scrollbackCount;
        const selection = this.container.ownerDocument.getSelection();
        const selectionInContainer = selection !== null &&
            !selection.isCollapsed &&
            (this.container.contains(selection.anchorNode) ||
                this.container.contains(selection.focusNode));
        // beforeMutation invalidates content even when history counts stay the same
        // (for example OSC colors). Only scrolls through unchanged rows can reuse it.
        const contentUnchanged = this.painted &&
            !this.colorsChanged &&
            hasDiscardedCount &&
            scrollbackCount === this._renderedScrollbackCount &&
            discardedCount === this._renderedDiscardedCount;
        // Keep the existing overscan window until the viewport approaches its edge.
        const first = (this._scrollbackKeys[0] ?? Infinity) - discardedCount;
        const last = (this._scrollbackKeys[this._scrollbackKeys.length - 1] ?? -Infinity) -
            discardedCount +
            1;
        const margin = Math.ceil(overscan / 2);
        if (virtual &&
            contentUnchanged &&
            !selectionInContainer &&
            !viewport?.selectedRows &&
            rowHeight === this._scrollbackRowHeight &&
            this._scrollbackKeys.length === last - first &&
            this._scrollbackKeys.length <= visibleRows + 2 * overscan &&
            first <= Math.max(0, Math.min(scrollbackCount, firstVisible - margin)) &&
            last >= Math.min(scrollbackCount, firstVisible + visibleRows + margin))
            return;
        const indices = new Set();
        for (let index = start; index < end; index++)
            indices.add(index);
        if (!viewport?.selectedRows &&
            selectionInContainer &&
            selection.rangeCount === 1) {
            const range = selection.getRangeAt(0);
            const selected = this._scrollbackRowEls.flatMap((row, i) => range.intersectsNode(row)
                ? [this._scrollbackKeys[i] - discardedCount]
                : []);
            if (selected.length <= MAX_TRACKED_SELECTION_ROWS) {
                for (const index of selected)
                    if (index >= 0 && index < scrollbackCount)
                        indices.add(index);
            }
        }
        if (viewport?.selectedRows) {
            for (let index = Math.max(0, viewport.selectedRows.start); index <= Math.min(scrollbackCount - 1, viewport.selectedRows.end); index++)
                indices.add(index);
        }
        const ordered = Array.from(indices).sort((a, b) => a - b);
        const keys = ordered.map((index) => discardedCount + index);
        if (contentUnchanged &&
            rowHeight === this._scrollbackRowHeight &&
            keys.length === this._scrollbackKeys.length &&
            keys.every((key, index) => key === this._scrollbackKeys[index])) {
            return;
        }
        const previous = new Map();
        for (let i = 0; i < this._scrollbackRowEls.length; i++) {
            previous.set(this._scrollbackKeys[i], this._scrollbackRowEls[i]);
        }
        const retained = new Set(keys);
        for (const [key, rowEl] of previous) {
            if (!retained.has(key))
                rowEl.remove();
        }
        for (const spacer of this._scrollbackGapSpacers)
            spacer.remove();
        this._scrollbackGapSpacers = [];
        const nextRows = [];
        let nextSibling = this._scrollbackTopSpacer?.nextSibling ?? null;
        let previousIndex = (ordered[0] ?? scrollbackCount) - 1;
        for (const index of ordered) {
            if (index > previousIndex + 1) {
                const spacer = document.createElement("div");
                spacer.className = "term-scrollback-spacer";
                spacer.style.height = `${(index - previousIndex - 1) * rowHeight}px`;
                this.container.insertBefore(spacer, nextSibling ?? this._scrollbackBottomSpacer);
                this._scrollbackGapSpacers.push(spacer);
            }
            previousIndex = index;
            const key = discardedCount + index;
            const offset = scrollbackCount - 1 - index;
            let rowEl = previous.get(key);
            if (!rowEl) {
                rowEl = document.createElement("div");
                rowEl.className = "term-row term-scrollback-row";
                this._updateScrollbackRow(core, offset, rowEl);
            }
            else if (!contentUnchanged) {
                this._updateScrollbackRow(core, offset, rowEl);
            }
            if (rowEl !== nextSibling) {
                this.container.insertBefore(rowEl, nextSibling ?? this._scrollbackBottomSpacer);
            }
            nextSibling = rowEl.nextSibling;
            nextRows.push(rowEl);
        }
        this._scrollbackRowEls = nextRows;
        this._scrollbackKeys = keys;
        this._renderedScrollbackCount = scrollbackCount;
        this._renderedDiscardedCount = discardedCount;
        this._scrollbackRowHeight = rowHeight;
        if (this._scrollbackTopSpacer) {
            this._scrollbackTopSpacer.style.height = `${(ordered[0] ?? scrollbackCount) * rowHeight}px`;
        }
        if (this._scrollbackBottomSpacer) {
            this._scrollbackBottomSpacer.style.height = `${ordered.length ? (scrollbackCount - ordered[ordered.length - 1] - 1) * rowHeight : 0}px`;
        }
    }
    syncColorOverrides(colors = {}) {
        for (const [key, property] of [
            ["foreground", "--term-app-fg"],
            ["background", "--term-app-bg"],
            ["cursor", "--term-app-cursor"],
        ]) {
            const value = colors[key];
            const css = value === undefined ? "" : rgbToCSS(value);
            if (this.colorHost.style.getPropertyValue(property) === css)
                continue;
            if (css)
                this.colorHost.style.setProperty(property, css);
            else
                this.colorHost.style.removeProperty(property);
        }
    }
    render(core, viewport) {
        this.syncColorOverrides(core.getColorOverrides?.());
        this.viewport = viewport;
        this.selection ?? (this.selection = new TrackedSelection(this.container.parentElement ?? this.container));
        const positions = this.selection.beforeRender(core, this.selectionRows());
        const rows = core.getRows();
        const cols = core.getCols();
        let resized = false;
        if (this.needsSetup || rows !== this.rows || cols !== this.cols) {
            this.setup(cols, rows);
            this.needsSetup = false;
            resized = true;
        }
        this.syncScrollback(core, viewport && {
            ...viewport,
            selectedRows: positions
                ? { start: positions.start.row, end: positions.end.row }
                : undefined,
        });
        const cursor = core.getCursor();
        const cursorVisible = cursor.visible;
        const shape = cursor.shape ?? "block";
        const blink = String(cursor.blinking ?? false);
        // Shape and blink changes need no cell replacement: CSS reads the grid state.
        if (this.container.dataset.cursorShape !== shape)
            this.container.dataset.cursorShape = shape;
        if (this.container.dataset.cursorBlink !== blink)
            this.container.dataset.cursorBlink = blink;
        const needsCursorUpdate = cursor.row !== this.prevCursorRow ||
            cursor.col !== this.prevCursorCol ||
            cursorVisible !== this.prevCursorVisible;
        for (let r = 0; r < this.rows; r++) {
            const isDirty = this.colorsChanged || resized || core.isDirtyRow(r);
            const hadCursor = r === this.prevCursorRow && needsCursorUpdate;
            const hasCursor = r === cursor.row;
            if (isDirty || hadCursor || (hasCursor && needsCursorUpdate)) {
                const cCol = hasCursor && cursorVisible ? cursor.col : -1;
                this._buildRowContent(this.rowEls[r], (col) => core.getCell(r, col), this.cols, cCol, r);
            }
            const content = this.rowText.get(this.rowEls[r]);
            if (content) {
                const metadata = core.getRowMetadata?.(r);
                content.metadata = metadata ? { ...metadata } : null;
            }
        }
        this.prevCursorRow = cursor.row;
        this.prevCursorCol = cursor.col;
        this.prevCursorVisible = cursorVisible;
        core.clearDirty();
        this.colorsChanged = false;
        this.selection.afterRender(this.selectionRows(), positions);
        this.painted = true;
        this.graphics.reconcile(core, {
            scrollTop: viewport?.scrollTop ?? 0,
            clientHeight: viewport?.clientHeight ?? 0,
            rowHeight: viewport?.rowHeight ?? 0,
            charWidth: viewport?.charWidth ?? 0,
            overscanRows: viewport?.overscanRows ?? DEFAULT_SCROLLBACK_OVERSCAN_ROWS,
            scrollbackCount: core.getScrollbackCount(),
        });
    }
    /** Mounted rows in chronological, retained-buffer coordinates. */
    *searchRows() {
        for (let i = 0; i < this._scrollbackRowEls.length; i++) {
            yield {
                row: this._scrollbackKeys[i] - Math.max(0, this._renderedDiscardedCount),
                element: this._scrollbackRowEls[i],
            };
        }
        for (let i = 0; i < this.rowEls.length; i++) {
            yield {
                row: Math.max(0, this._renderedScrollbackCount) + i,
                element: this.rowEls[i],
            };
        }
    }
    /** Plain text for the native selection, or null when this terminal does not own it. */
    getSelectionText() {
        const terminal = this.container.parentElement;
        if (!terminal)
            return null;
        return getSelectionText(terminal, this.selectionRows());
    }
    *selectionRows() {
        for (const row of this.searchRows()) {
            const content = this.rowText.get(row.element);
            if (content)
                yield { ...row, content };
        }
    }
    beforeMutation(core) {
        this.selection?.beforeMutation(core, this.selectionRows());
        this.painted = false;
    }
    /** Resolve a mounted row hit using cell geometry, including wide glyphs. */
    positionAt(target, clientX, charWidth) {
        if (!this.painted || this.needsSetup || charWidth <= 0)
            return null;
        const element = target.closest(".term-row");
        const mounted = Array.from(this.searchRows()).find((row) => row.element === element);
        if (!mounted)
            return null;
        const col = Math.floor((clientX - mounted.element.getBoundingClientRect().left) / charWidth);
        return col >= 0 && col < this.cols ? { row: mounted.row, col } : null;
    }
    select(core, position, unit, beforeSelect) {
        if (!this.painted || this.needsSetup)
            return false;
        const range = selectionRange(core, position, unit);
        if (!range)
            return false;
        beforeSelect();
        // Blurring the terminal input may synchronously deliver a focus report.
        // A host can write, resize or destroy in that callback.
        if (!this.painted || this.needsSetup)
            return false;
        this.syncScrollback(core, {
            ...(this.viewport ?? { scrollTop: 0, clientHeight: 0, rowHeight: 0 }),
            selectedRows: { start: range.start.row, end: range.end.row },
        });
        const mounted = Array.from(this.selectionRows());
        const edge = (position, after) => {
            const row = mounted.find((row) => row.row === position.row);
            return (row &&
                textPoint(row.element, offsetAtCell(row.content, position.col, after)));
        };
        const start = edge(range.start, false), end = edge(range.end, true);
        const native = this.container.ownerDocument.getSelection();
        if (!start || !end || !native)
            return false;
        native.setBaseAndExtent(...start, ...end);
        this.selection?.capture(core, this.selectionRows());
        return true;
    }
    rectangle(core, start, end, beforeSelect) {
        if (!this.painted || this.needsSetup)
            return null;
        const rectangle = rectangleSelection(core, start, end);
        if (!rectangle)
            return null;
        beforeSelect();
        return this.painted && !this.needsSetup ? rectangle : null;
    }
    /** Clamp a drag to the nearest mounted row without mounting extra history. */
    dragPositionAt(clientX, clientY, charWidth) {
        if (!this.painted || this.needsSetup || charWidth <= 0)
            return null;
        let nearest = null;
        for (const { row, element } of this.searchRows()) {
            const rect = element.getBoundingClientRect();
            const distance = Math.max(rect.top - clientY, clientY - rect.bottom, 0);
            if (!nearest || distance < nearest.distance)
                nearest = {
                    row,
                    distance,
                    col: Math.max(0, Math.min(this.cols - 1, Math.floor((clientX - rect.left) / charWidth))),
                };
        }
        return nearest && { row: nearest.row, col: nearest.col };
    }
    requestSetup() {
        this.needsSetup = true;
    }
    /** Re-read indexed colors in live and retained rows without rebuilding the grid. */
    invalidateColors() {
        this.colorsChanged = true;
    }
    /** Replaces decorations only, preserving native text selection. */
    setSearchDecorations(decorations) {
        if (!decorations.firstChild && !this.searchLayer.firstChild)
            return;
        this.searchLayer.replaceChildren(decorations);
    }
    destroy() {
        this.syncColorOverrides();
        this.painted = false;
        this.selection?.dispose();
        this.graphics.destroy();
        this.container.innerHTML = "";
        this.rowEls = [];
        this._scrollbackRowEls = [];
    }
}
//# sourceMappingURL=renderer.js.map