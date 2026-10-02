# phobos

**No text generation. Only probabilities and confidence, on a single screen.**

[laya](https://github.com/NandhaKishorM/laya) is a decision model that returns probabilities. Unlike generative AI, it does not write an answer as prose — it returns typed answers and probability distributions for the questions you ask. phobos explains that property across three pages: an introduction, a hands-on Sandbox, and a design guide.

[![License](https://img.shields.io/badge/License-Apache%202.0-yellow.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-v0.1.0-blue.svg)](https://github.com/watanabe3tipapa/phobos/releases)
[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-live-blue.svg)](https://watanabe3tipapa.github.io/phobos/)
[![GitHub](https://img.shields.io/github/issues/watanabe3tipapa/phobos.svg)](https://github.com/watanabe3tipapa/phobos/issues)

[日本語](README.md) | [English](README_en.md)

**Quick links:** [Live site](https://watanabe3tipapa.github.io/phobos/) · [Sandbox](https://watanabe3tipapa.github.io/phobos/demo.html) · [UI/UX design guide](https://watanabe3tipapa.github.io/phobos/laya_uiux_guide.html) · [Console reference](#console-reference) · [Honest limits](#honest-limits)

## Concept

### Why probabilities instead of prose

Generative AI returns readable sentences. But how far that text should be trusted cannot be read off the text itself. What is usable as grounds for a decision is a number: a probability.

laya closes that gap by design.

- The answer space is defined per request. Adding options later requires no retraining
- Each option's `[MASK]` marker position is scored individually, and softmax is applied over those positions alone
- Nothing is generated, so there is no text parsing and no hallucination

Training uses **RLCD** (Reinforcement Learning for Calibrated Decisions). Because the reward is a strictly well-formed scoring rule, the behaviour that maximises expected reward *is* honest probability reporting. There is structurally no incentive to hide a guess, in the model or in the consuming UI.

So the UI phobos draws is not there to hide the answer. It is there **to stop hiding the probability and the confidence**.

### The three primitives

The answer space is decided at request time, so users never have to learn a type. Both the implementation and the consumer side collapse into three primitives.

| Type | Returns | Typical use |
|---|---|---|
| `choice` | A distribution over all options | Routing, classification, guardrails |
| `score` | A probability per scale label | Urgency, severity, complexity |
| `noul` | P(true) | Churn intent, intent detection |

Of the three, `score` is the weakest primitive (0.372 on SST-5). `noul` is expressed with the fixed labels `false:` / `true:`, so on the English checkpoint it tends to follow the label rather than the state; returning a confident "no" to clearly affirmative input has been reported ([issue #156](https://github.com/NandhaKishorM/laya/issues/156)). If `noul` answers look constant, replace it with a two-option `choice` that uses a neutral key and check again.

### Confidence gating

Answers whose confidence falls below the threshold are pulled out of automatic decisions and routed to human review. The default threshold is 0.85.

laya's own confidence is defined by entropy normalisation:

```
confidence = 1 - H(p) / log(k)
```

`H(p)` is the entropy of the distribution `p`, and `k` is the number of options. The sharper the distribution, the higher the confidence. Per the model card, **the raw model leans overconfident**. Temperature scaling brings mean ECE from 0.466 down to 0.081, so if you intend to use the probabilities in practice, recalibrate on your own data first.

Note that `action.act_probability` currently returns almost exactly 1.0 and has almost no discriminative power (AUROC 0.30). Only `confidence` is a usable basis for the gate (AUROC 0.77).

## Main features

### The three pages

| Task | What phobos provides |
|---|---|
| Score something | Ask "how urgent?" with `score` and get a probability per level |
| Route | Lay out candidates with `choice` and get the distribution and the leader |
| Decide | Get a single number with `noul` as P(true) |
| Stop an untrustworthy answer | Confidence gating (default 0.85) routes it to human review |
| Verify it yourself | Three switchable engines and a console in the Sandbox |
| Put it in a UI | A 7-chapter UI/UX design guide |

File layout:

| File | Contents |
|---|---|
| `index.html` | Intro LP. Three primitives, calibration, speed, multilingual support, limits, setup |
| `demo.html` | Sandbox. Three columns for state, question design, and results, plus a wterm console |
| `laya_uiux_guide.html` | Design guide for surfacing probabilities and confidence in a UI (7 chapters) |

### Three inference engines

The Sandbox lets you switch engines. All three run on the same screen with the same interactions.

| Engine | Connects to | Default | Output | Calibrated |
|---|---|---|---|---|
| `mock` (default) | Nothing. Runs entirely in the browser | None | Deterministic heuristic | No |
| `laya` | `POST /v1/systemone` | `http://localhost:8000/v1/systemone` | Typed probabilities | Yes (temperature calibration is the consumer's job) |
| `magnitude` | `POST /inference/v1/chat/completions` | `http://127.0.0.1:10100/inference/v1` | Self-reported values from a text generator | No |

The defaults are the constants in `assets/js/engine.js`; the `endpoint` command changes them at any time.

**`mock` cannot be used as an experimental result.** It makes no network calls and returns the same value for the same input every time, so the latency readout is not a measurement either. Run validation and benchmarks on the `laya` engine. The UI and the console say so at all times.

**`magnitude` is for comparison only.** The same questions are sent to a text generation engine, which self-reports `confidence` and `distribution`. The numbers that come back are uncalibrated, so they cannot be compared with laya's probabilities. Only when you select it does the UI show a warning at the top of the result, an `uncalibrated` tag, and a note that the 0.85 gate does not apply.

### Other features

- 8 question templates, with invalid question sets detected and rejected before sending
- State can be supplied as text, by file drop, or as JSON
- A token meter that compares the estimated token count of the state against the 512-token-per-question limit for the English checkpoint, and warns in advance that the tail will be cut when you exceed it
- JSON and CSV export, plus copy to clipboard
- Raw response display

### Console

The terminal in `demo.html` is not decoration. It is a working console that drives the current state: editing the input field, swapping templates, running inference, and switching engines are all available as commands. wterm 0.5.4 is vendored, so there is no CDN dependency.

## Try it in a browser

No need to clone the repository. The [Sandbox on the live site](https://watanabe3tipapa.github.io/phobos/demo.html) is ready to use. With the default `mock` engine you need neither a backend nor an API key.

1. Paste a state text (or drop a file)
2. Pick a template
3. Run `Analyze`
4. Read the probabilities and confidence, then export

Connecting a real model uses the same screen. See "Connect a real model" below.

## Install and build

### Requirements

| Tool | Version | Check |
|---|---:|---|
| Node.js | 22 (verified in development and CI) | `node --version` |
| npm | The bundled npm is fine | `npm --version` |
| Python | >= 3.10 (only for `laya`) | `python3 --version` |
| Git | Optional (deploy, contributing) | `git --version` |

The only dependency is used to vendor wterm. There is no CDN dependency at runtime.

### Basic steps

1. Get the repository

```bash
git clone https://github.com/watanabe3tipapa/phobos.git
cd phobos
```

2. Install dependencies and build

```bash
npm ci
npm run build
npm run serve      # http://localhost:4173/
```

No bundler is involved. `npm run build` only extracts the publishable files into `dist/`.

```
index.html / demo.html / laya_uiux_guide.html   ┐
assets/css/ (base / lp / play / doc)            ├→ build.mjs → dist/ → GitHub Pages
assets/js/ (engine / templates / play / console)┘
assets/vendor/wterm/  … vendored from npm (Apache-2.0)
```

### Main commands

| Command | Purpose |
|---|---|
| `npm run build` | Generate `dist/` |
| `npm run serve` | Preview the built `dist/` on `:4173` |
| `npm run vendor` | Re-vendor `@wterm/{core,dom}` into `assets/vendor/wterm/` |
| `npm run vendor:check` | Check that the vendored copy matches the pin and SHA in `package.json` (also runs in CI) |

### Deploying

A push to `main` deploys automatically. The workflow runs `npm ci` → `npm run vendor:check` → `npm run build` → Pages upload. The site is served from the domain root, so no base path rewriting is needed.

On first run only, set **Settings → Pages → Build and deployment → Source** to **GitHub Actions** in the repository settings.

## Connect a real model

### laya

[laya-serve](https://pypi.org/project/laya/) exposes the Router as a Jev-compatible HTTP server. The shape of `POST /v1/systemone` is the same as TypeSafe Jev, so existing clients work by changing the base URL alone. Jev is a third-party product name (see [About Jev](#about-jev)).

```bash
pip install "laya[serve]"
LAYA_DEVICE=cuda LAYA_PRELOAD=1 laya-serve    # 0.0.0.0:8000
```

```bash
curl -s localhost:8000/v1/systemone -H 'Content-Type: application/json' -d '{
  "state": {"document": "I was charged twice. Please fix this ASAP."},
  "questions": {"billing": {"type": "noul", "instructions": "Is this ticket about billing?"}}
}'
```

| Environment variable | Default | Meaning |
|---|---|---|
| `LAYA_DEVICE` | Automatic | Execution device (`cuda` / `cpu` / `mps`) |
| `LAYA_PRELOAD` | Enabled | Load all checkpoints at startup |
| `LAYA_MODELS` | Empty | Which models to use. Can be pinned individually with `english` / `multilingual` / `typed-decisions` |
| `LAYA_API_KEY` | Unset | When set, `Authorization: Bearer <key>` becomes required |
| `LAYA_THREADS` | Automatic | Number of inference threads |
| `LAYA_MAX_CONCURRENT` | Automatic | Concurrency cap. Requests beyond it get `503` |

If you do not set `model`, the Router detects the script and language and picks one. Use `GET /health` to check the connection (it returns `loaded` / `revisions` / `device`). It binds `0.0.0.0` by default and has no authentication unless `LAYA_API_KEY` is set. If you expose it beyond your own machine, always set authentication.

The input budget is 512 tokens per question on the English checkpoint (192 for options, roughly 320 for the state) and 1024 tokens on the multilingual checkpoint (256 for options, roughly 768 for the state). The options head is a fixed slot, so a 77-option question leaves only 3–4 tokens per label and accuracy collapses (0.425 on Banking77). If you want 50 or more options in one question, raise `head_max_len` or split it into staged two-step `choice` questions.

> A separate package named `laya-serve` is deprecated and read-only on PyPI, and its maintenance has ended. Install from `laya[serve]` as shown above. The old package used the `LAYA_SERVE_` prefix; the unified one uses `LAYA_`.

### Magnitude

[Magnitude](https://github.com/magnitudedev/magnitude) is an inference engine that runs open-weight models on your own device. You compile the kernels for your own hardware and fine-tune them. It is Apache-2.0.

The Sandbox connects directly to its public **OpenAI-compatible API**.

```bash
# Models are obtained in the desktop app.
# Start the server from the desktop app, or with:
magnitude serve
```

| Item | Value |
|---|---|
| Base URL | `http://127.0.0.1:10100/inference/v1` |
| Model list | `GET /inference/v1/models` |
| Inference | `POST /inference/v1/chat/completions` (`stream: false`) |
| Response body | `choices[0].message.content` |
| API key | Not required for clients on the same machine |

```bash
curl http://127.0.0.1:10100/inference/v1/models
```

There are three steps:

1. Select `Magnitude` in the engine switcher
2. Press refresh, or run `models` in the console
3. Set the model with `model <id>`, then run `run`

**This output cannot be used as an experimental result.** It is self-reported by a text generation engine and is uncalibrated. The implementation shows a warning at the top of the result, an `uncalibrated` tag instead of `live`, and a note that the 0.85 gate does not apply, but only when you select magnitude. Use it to see the difference between "generation" and "calibrated decision" for the same question.

### CORS

`laya-serve` has no environment variable for allowing origins. `demo.html` calls the server directly from the browser, so the request is always cross-origin.

1. **Local verification only**: run it in a browser with CORS checks disabled (`google-chrome --disable-web-security`). Disabling it removes every same-origin restriction, which also means other services' credentials become readable. Use a dedicated profile and always close it afterwards
2. **For regular use**: put a reverse proxy that allows CORS in front of `laya-serve`
3. **Proper fix**: serve the static site and the inference from the same origin

The live page URL is HTTPS, but requests to `http://localhost` are allowed. `localhost` counts as a trusted origin, so it is not blocked as mixed content. Note that `localhost` is only reachable from your own machine. If you open the live site from another device, real inference will not connect (`mock` still works). Also, a plaintext remote host such as `http://192.168.0.10:8000` cannot be loaded from an HTTPS page.

## Running it on your own device

### Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `demo.html` is blank | Opened directly over `file://` | Open it over HTTP |
| `Failed to resolve module specifier` | Same, `file://` | Same |
| `terminal failed to start` | wterm's WASM failed to initialise | Check the browser console. There is no GPU dependency |
| `npm run vendor:check` stops at `not installed` | `node_modules` is missing, or it does not match the pin | `npm ci` |
| `Failed to fetch` on `laya` | The server is not running | Check `curl localhost:8000/health` |
| CORS error on `laya` | Origin mismatch | See "CORS" above |
| "Connection failed" on `magnitude` | Magnitude is not running, or the model was not fetched | Open the desktop app or run `magnitude serve`, then refresh the list |
| "No model selected" on `magnitude` | Model ID not set | Fetch with `models`, set with `model <id>` |
| Copy does nothing | Clipboard permission, or a non-secure context | Open it over `http://localhost` |
| Fonts look different | Google Fonts is unreachable | By design. Falls back to local fonts |
| The engine selection disappears | The origin changed, or stored data was cleared | Origins are independent per port |

### Always open it over HTTP

`demo.html` uses ES Modules and an import map, so it cannot run from `file://`. Double-clicking in Finder or running `open index.html` causes module loading to be rejected and the page goes blank.

```bash
npm run build && npm run serve    # http://localhost:4173/
```

`python3 -m http.server 4173` or the VS Code Live Server extension work just as well.

### Settings stored in the browser

The selected engine, the endpoints, and the Magnitude model ID are saved in `localStorage`.

| Key | Contents |
|---|---|
| `phobos.laya.engine` | The selected engine |
| `phobos.laya.endpoint` | The laya-serve URL |
| `phobos.magnitude.endpoint` | The Magnitude base URL |
| `phobos.magnitude.model` | The Magnitude model ID used for runs |

- They are independent per origin, so `localhost:4173`, `localhost:4174`, and the live site URL each keep separate values
- Private browsing may block `localStorage`; in that case the app runs with session-only settings
- To reset, clear the browser's stored data or run `endpoint reset` in the console

### Using it offline

- The `mock` engine is complete without network access. wterm's WASM is loaded from the vendored files, so there are no extra downloads
- Real inference needs a server on your own machine, but it makes no outbound connections
- The exception is fonts. All three pages load Google Fonts via `<link>`. When unreachable, they fall back to `Hiragino Kaku Gothic ProN` and similar

### Do not edit these

| Path | Why | Correct procedure |
|---|---|---|
| `assets/vendor/wterm/` | Generated. `npm run vendor` recreates it | Change the pin in `package.json`, then `npm run vendor` |
| `dist/` | Build output. Not committed | `npm run build` |
| `manifest.json` inside vendor | The ledger for the sync check | `npm run vendor` overwrites it |

## Console reference

| Command | Description |
|---|---|
| `help` / `?` | List commands |
| `run` / `predict` | Run inference on the current state |
| `curl` | Print the command that calls the real API |
| `templates` | List templates |
| `template <id>` | Load a template into the editor |
| `state` / `state <text>` | Show / replace the state text |
| `questions` | Dump the current question set |
| `tokens` | Estimate against the 512-token budget |
| `engine` | Show the current engine and endpoint |
| `engine mock\|laya\|magnitude` | Switch the engine |
| `endpoint` / `endpoint <url>` / `endpoint reset` | Show / set / reset the real API URL |
| `models` | Fetch the Magnitude model list |
| `model <id>` | Set the Magnitude model to run |
| `json` | Print the last run as JSON |
| `clear` | Clear the screen |

Key bindings: `↑` / `↓` for history, `Ctrl+U` / `Ctrl+K` to delete, `Ctrl+L` to clear, and `Ctrl/⌘+Enter` to run inference when the input field has focus.

## Honest limits

A summary of the "Honest Limits" section of the [Laya model card](https://huggingface.co/convaiinnovations/laya). Do not confuse these with what the Sandbox returns.

- **Weak zero-shot. It is meant to be specialised first.** The bundled checkpoint scores 0.362 on the typed-decisions benchmark, which is below both 0.318 for random answering and 0.461 for majority voting. The 0.766 figure comes from `laya-typed-decisions`, which was fine-tuned on the training split of the same benchmark. laya is not a zero-shot decision engine; it is a base for specialisation
- **It breaks down with many options.** The head is a fixed token slot, so do not put 50 or more options in one question
- **`score` is the weakest.** 0.372 on SST-5
- **`noul` follows the label.** It is strongly influenced by the `false:` / `true:` phrasing
- **It is overconfident out of the box.** Temperature calibration improves ECE from 0.466 to 0.081
- **`action.act_probability` is unusable.** It returns almost exactly 1.0, AUROC 0.30
- **The English checkpoint is English only.** Use `laya-multilingual` for anything else

## Documentation

Read in this order to get the whole picture.

1. [Intro LP](https://watanabe3tipapa.github.io/phobos/) — three primitives, calibration, multilingual support, performance, limits
2. [Sandbox](https://watanabe3tipapa.github.io/phobos/demo.html) — touch the probabilistic output yourself, with three engines and a console
3. [UI/UX design guide](https://watanabe3tipapa.github.io/phobos/laya_uiux_guide.html) — design guidance for surfacing probabilities and confidence (7 chapters)

Every figure quoted in this repository and in the three pages comes from the [Laya model card](https://huggingface.co/convaiinnovations/laya) and [BENCHMARKS.md](https://github.com/NandhaKishorM/laya/blob/main/BENCHMARKS.md).

The record of implementation background, design decisions, and verification results lives in [DEV-MEMO.md](DEV-MEMO.md) (Japanese).

### About Jev

> Jev is a third-party product name, not a typo. The upstream benchmark records it as `Jev 1.13.0 (published)`. Every Jev figure quoted here (ECE 0.246, typed-decisions 0.727, banking77 0.870, option-order robustness 0.13) is a **published third-party value**. We did not measure them: with no TypeSafe API access, the sample sizes, prompts, and temperature-calibration conditions differ from the laya side. Do not read them as a like-for-like comparison.

## Contributing

Contributions are welcome. Please open an [Issue](https://github.com/watanabe3tipapa/phobos/issues) before making a large change. The general steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Commit your change (`git commit -m 'Add your feature'`)
4. Push the branch and open a Pull Request

Do not hand-edit `assets/vendor/wterm/`. Change the pin in `package.json` and run `npm run vendor`. CI checks the sync with `npm run vendor:check`.

## Contact

- GitHub: https://github.com/watanabe3tipapa/phobos
- Live site: https://watanabe3tipapa.github.io/phobos/

## License

Apache-2.0 — see the [LICENSE](LICENSE) file in this repository. The bundled wterm 0.5.4 and laya are Apache-2.0 as well.
