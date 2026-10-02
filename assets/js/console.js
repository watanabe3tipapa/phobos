/**
 * Console panel backed by wterm (vercel-labs/wterm), vendored under
 * assets/vendor/wterm so the site works offline and on GitHub Pages.
 *
 * The terminal is not decoration: it is a working console for the current
 * sandbox state. Run `help` to list the commands.
 */

import { WTerm } from "../vendor/wterm/dom/index.js";

const ESC = "\x1b[";
const RESET = `${ESC}0m`;
const BOLD = `${ESC}1m`;
const DIM = `${ESC}2m`;
const GREEN = `${ESC}32m`;
const CYAN = `${ESC}36m`;
const YELLOW = `${ESC}33m`;
const RED = `${ESC}31m`;

const PROMPT_LABEL = `${GREEN}phobos${RESET}${DIM}:${RESET}${CYAN}~${RESET}`;
const PROMPT_TEXT = `\x1b[0m$ `;

const SEQUENCES = [
  ["\x1b[A", "up"],
  ["\x1b[B", "down"],
  ["\x1bOA", "up"],
  ["\x1bOB", "down"],
  ["\x1b[D", "left"],
  ["\x1b[C", "right"],
  ["\x1bOD", "left"],
  ["\x1bOC", "right"],
  ["\x1b[H", "home"],
  ["\x1b[F", "end"],
];

export class ConsolePanel {
  constructor(root, hooks = {}) {
    this.root = root;
    this.hooks = hooks;
    this.term = null;
    this.buffer = "";
    this.cursor = 0;
    this.history = [];
    this.historyIndex = 0;
    this.running = false;
    this.started = false;
  }

  async start() {
    if (this.started) return;
    this.started = true;

    this.term = new WTerm(this.root, {
      cols: 92,
      rows: 16,
      autoResize: true,
      cursorBlink: false,
      onData: (d) => this.handleInput(d),
    });
    await this.term.init();

    this.banner();
    this.prompt();
  }

  destroy() {
    this.term?.destroy();
    this.term = null;
    this.started = false;
  }

  /* ------------------------------------------------------------ rendering */

  write(s) {
    this.term?.write(s.replace(/\n/g, "\r\n"));
  }

  line(s = "") {
    this.write(s + "\n");
  }

  print(s) {
    this.write(s.endsWith("\n") ? s : s + "\n");
  }

  banner() {
    this.line(`${BOLD}${GREEN}laya console${RESET} ${DIM}· wterm${RESET}`);
    this.line(`${DIM}commands: help, run, curl, templates, template <id>, state, questions, tokens, engine, json, clear${RESET}`);
    this.line();
  }

  prompt() {
    this.write(`${PROMPT_LABEL}${PROMPT_TEXT}`);
    this.buffer = "";
    this.cursor = 0;
  }

  redraw() {
    this.write("\r\x1b[K");
    this.write(`${PROMPT_LABEL}${PROMPT_TEXT}`);
    this.write(this.buffer);
    this.write("\r\x1b[K");
    const back = this.buffer.length - this.cursor;
    if (back > 0) this.write(`\x1b[${back}C`);
  }

  /* --------------------------------------------------------------- input */

  handleInput(data) {
    this.skipLf = false;
    let i = 0;
    while (i < data.length) {
      const rest = data.slice(i);
      const seq = SEQUENCES.find(([s]) => rest.startsWith(s));
      if (seq) {
        this.move(seq[1]);
        i += seq[0].length;
        continue;
      }
      const ch = data[i];
      switch (ch) {
        case "\r":
          this.submit();
          this.skipLf = true;
          break;
        case "\n":
          if (this.skipLf) this.skipLf = false;
          else this.submit();
          break;
        case "":
        case "\b": // backspace: DEL and BS forms
          if (this.cursor > 0) {
            this.buffer = this.buffer.slice(0, this.cursor - 1) + this.buffer.slice(this.cursor);
            this.cursor -= 1;
            this.redraw();
          }
          break;
        case "\x01": // Ctrl+A
          this.move("home");
          break;
        case "\x05": // Ctrl+E
          this.move("end");
          break;
        case "\x0b": // Ctrl+K — kill to end of line
          this.buffer = this.buffer.slice(0, this.cursor);
          this.redraw();
          break;
        case "\x15": // Ctrl+U
          this.buffer = this.buffer.slice(this.cursor);
          this.cursor = 0;
          this.redraw();
          break;
        case "\x17": // Ctrl+W
          this.buffer = this.buffer.slice(0, this.cursor).replace(/\s*\S+$/, "") + this.buffer.slice(this.cursor);
          this.redraw();
          break;
        case "\x03": // Ctrl+C
          this.line(`${DIM}^C${RESET}`);
          this.prompt();
          break;
        case "\x0c": // Ctrl+L
          this.term.write("\x1b[2J\x1b[H");
          this.banner();
          this.prompt();
          break;
        default:
          if (ch >= " ") {
            this.buffer = this.buffer.slice(0, this.cursor) + ch + this.buffer.slice(this.cursor);
            this.cursor += 1;
            this.write(ch);
          }
      }
      i += 1;
    }
  }

  move(action) {
    switch (action) {
      case "left":
        if (this.cursor > 0) {
          this.cursor -= 1;
          this.write("\x1b[D");
        }
        break;
      case "right":
        if (this.cursor < this.buffer.length) {
          this.cursor += 1;
          this.write("\x1b[C");
        }
        break;
      case "home": {
        const back = this.cursor;
        this.cursor = 0;
        if (back) this.write(`\x1b[${back}D`);
        break;
      }
      case "end": {
        const fwd = this.buffer.length - this.cursor;
        this.cursor = this.buffer.length;
        if (fwd) this.write(`\x1b[${fwd}C`);
        break;
      }
      case "up":
        this.recall(-1);
        break;
      case "down":
        this.recall(1);
        break;
    }
  }

  recall(dir) {
    if (!this.history.length) return;
    this.historyIndex = Math.max(0, Math.min(this.history.length, this.historyIndex + dir));
    this.buffer = this.history[this.historyIndex] || "";
    this.cursor = this.buffer.length;
    this.redraw();
  }

  submit() {
    const cmd = this.buffer.trim();
    this.line();
    this.historyIndex = this.history.length;
    if (cmd) {
      this.history.push(cmd);
      this.execute(cmd);
    } else {
      this.prompt();
    }
  }

  async execute(input) {
    if (this.running) {
      this.log("warn", "前のコマンドを実行中です");
      this.prompt();
      return;
    }
    this.running = true;
    const cmd = input.split(/\s+/)[0];
    const argStr = input.slice(cmd.length).trim();
    const say = (s) => this.print(s);
    const dim = (s) => `${DIM}${s}${RESET}`;

    try {
      switch (cmd) {
        case "help":
        case "?": {
          say(`${BOLD}commands${RESET}`);
          const rows = [
            ["run", "run the current state through the active engine"],
            ["curl", "print the curl command for the real API"],
            ["templates", "list templates"],
            ["template <id>", "load a template into the editor"],
            ["state", "show the state input"],
            ["state <text>", "replace the state input"],
            ["questions", "dump the current question set"],
            ["tokens", "token estimate vs the 512 budget"],
            ["engine", "show the active engine and endpoint"],
            ["engine mock|laya|magnitude", "switch engine"],
            ["endpoint [url|reset]", "show, set, or reset the active engine URL"],
            ["models", "list models from Magnitude"],
            ["model <id>", "select the Magnitude model"],
            ["json", "print the last result as JSON"],
            ["clear", "clear the screen"],
          ];
          for (const [c, d] of rows) say(`  ${BOLD}${c.padEnd(20)}${RESET}${dim(d)}`);
          break;
        }
        case "templates":
          say(`${BOLD}templates${RESET}`);
          for (const t of this.hooks.templates?.() || []) {
            say(`  ${CYAN}${t.id.padEnd(16)}${RESET}${t.name}`);
          }
          break;
        case "template":
          if (!argStr) say(dim("usage: template <id>   (list with: templates)"));
          else await this.hooks.onTemplate?.(argStr);
          break;
        case "state":
          if (argStr) await this.hooks.onStateInput?.(argStr);
          else say(await this.hooks.onStateShow?.());
          break;
        case "questions":
          say(await this.hooks.onQuestionsShow?.());
          break;
        case "tokens":
          say(await this.hooks.onTokens?.());
          break;
        case "engine":
          if (argStr) await this.hooks.onEngineSet?.(argStr);
          else say(await this.hooks.onEngineShow?.());
          break;
        case "endpoint":
          say(await this.hooks.onEndpoint?.(argStr));
          break;
        case "models": {
          const out = await this.hooks.onModels?.();
          if (out) say(out);
          break;
        }
        case "model":
          if (!argStr) say(dim("usage: model <id>   (list with: models)"));
          else await this.hooks.onModelSet?.(argStr);
          break;
        case "curl":
          say(await this.hooks.onCurl?.());
          break;
        case "run":
        case "predict":
          await this.hooks.onPredict?.();
          break;
        case "json":
          say(await this.hooks.onJson?.());
          break;
        case "clear":
          this.term.write("\x1b[2J\x1b[H");
          this.banner();
          break;
        default:
          say(`${RED}unknown command: ${cmd}${RESET} ${dim("(try: help)")}`);
      }
    } catch (err) {
      this.log("err", err.message);
    } finally {
      this.running = false;
      this.prompt();
    }
  }

  log(kind, message) {
    const marks = {
      info: `${DIM}·${RESET}`,
      ok: `${GREEN}✓${RESET}`,
      warn: `${YELLOW}!${RESET}`,
      err: `${RED}×${RESET}`,
      req: `${CYAN}→${RESET}`,
    };
    this.line(`${marks[kind] || marks.info} ${message}`);
  }
}