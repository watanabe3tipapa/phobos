/**
 * Sandbox wiring: state input, question editor, inference, result rendering,
 * export, and the wterm console bridge.
 */

import { TEMPLATES, getTemplate, validateQuestions } from "./templates.js";
import {
  estimateTokens,
  tokenBudget,
  stateToText,
  detectScript,
  normalizeResult,
  predict,
  getEndpoint,
  setEndpoint,
  getEngine,
  setEngine,
  getMagnitudeEndpoint,
  setMagnitudeEndpoint,
  getMagnitudeModel,
  setMagnitudeModel,
  listMagnitudeModels,
} from "./engine.js";
import { ConsolePanel } from "./console.js";

const $ = (sel) => document.querySelector(sel);
const CONFIDENCE_GATE = 0.85;

const state = {
  kind: "raw",
  templateId: "email-triage",
  questions: {},
  engine: getEngine(),
  model: getMagnitudeModel(),
  busy: false,
  lastResult: null,
};

const el = {
  stateInput: $("#state-input"),
  tokenFill: $("#token-fill"),
  tokenLabel: $("#token-label"),
  stateHint: $("#state-hint"),
  inputKind: $("#input-kind"),
  templateList: $("#template-list"),
  questionList: $("#question-list"),
  qCount: $("#q-count"),
  formError: $("#form-error"),
  resultList: $("#result-list"),
  resultMeta: $("#result-meta"),
  routeTag: $("#route-tag"),
  rawOutput: $("#raw-output"),
  dropzone: $("#dropzone"),
  fileInput: $("#file-input"),
  consoleState: $("#console-state"),
  engineMagnitude: $("#engine-magnitude"),
  modelSelect: $("#model-select"),
  btnModels: $("#btn-models"),
};

/* ------------------------------------------------------------------ icons */

const ICONS = {
  mail: '<path d="M4 5h16v14H4z"/><path d="m4 6 8 7 8-7"/>',
  shield: '<path d="M12 3l7 3v6c0 4-3 7-7 8-4-1-7-4-7-8V6z"/>',
  ticket: '<path d="M4 8h16v8H4z"/><path d="M9 8v8M15 8v8"/>',
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
  invoice: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  chart: '<path d="M5 20V10M12 20V4M19 20v-6"/>',
  globe: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c3 3 3 13 0 16M12 4c-3 3-3 13 0 16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
};

function icon(name, cls = "") {
  const paths = ICONS[name] || ICONS.plus;
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

/* ------------------------------------------------------------------ utils */

function toast(message) {
  let node = document.querySelector(".toast");
  if (!node) {
    node = document.createElement("div");
    node.className = "toast";
    node.setAttribute("role", "status");
    document.body.appendChild(node);
  }
  node.textContent = message;
  node.classList.add("is-visible");
  clearTimeout(node._t);
  node._t = setTimeout(() => node.classList.remove("is-visible"), 1800);
}

function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The one export shape used by both the JSON button and the `json` console
 * command: the request (state + questions) plus the result, so a run can be
 * reproduced from the file alone.
 */
function exportJson() {
  const run = { state: currentStateObject(), questions: activeQuestions() };
  if (state.lastResult) run.result = state.lastResult;
  return JSON.stringify(run, null, 2);
}

function currentStateObject() {
  const raw = el.stateInput.value;
  if (state.kind === "email") {
    return splitEmail(raw);
  }
  if (state.kind === "json") {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  if (state.kind === "ticket") {
    return splitTicket(raw);
  }
  return raw;
}

function splitEmail(raw) {
  const headers = {};
  const headerRe = /^([A-Za-z-]+):\s*(.*)$/;
  const lines = raw.split(/\r?\n/);
  let i = 0;
  for (; i < lines.length; i++) {
    if (lines[i].trim() === "") {
      i++;
      break;
    }
    const m = lines[i].match(headerRe);
    if (m) headers[m[1].toLowerCase()] = m[2].trim();
    else break;
  }
  return { ...headers, body: lines.slice(i).join("\n").trim() };
}

function splitTicket(raw) {
  const out = {};
  const id = raw.match(/(?:ticket|case|#)\s*(#?\d+)/i);
  if (id) out.id = id[1];
  const pri = raw.match(/priority[:\s]+(p[0-4])/i);
  if (pri) out.priority = pri[1].toUpperCase();
  out.subject = raw.split(/\r?\n/)[0].slice(0, 120);
  out.body = raw.trim();
  return out;
}

function activeQuestions() {
  return state.questions;
}

/* --------------------------------------------------------- token metering */

function renderTokens() {
  const text = el.stateInput.value;
  const n = estimateTokens(text);
  const budget = tokenBudget();
  const ratio = Math.min(1, n / budget);
  el.tokenFill.style.width = `${ratio * 100}%`;
  el.tokenFill.className = `tmeter__fill${n > budget ? " is-over" : n > budget * 0.8 ? " is-warn" : ""}`;
  el.tokenLabel.textContent = `${n} / ${budget} tokens`;

  if (n > budget) {
    el.stateHint.textContent = `上限を超過しています。状態の末尾が切れます（超過 ${n - budget} tokens）。`;
    el.stateHint.style.color = "var(--danger)";
  } else if (n > budget * 0.8) {
    el.stateHint.textContent = `上限に接近しています（残り ${budget - n} tokens）。`;
    el.stateHint.style.color = "var(--warn)";
  } else {
    el.stateHint.textContent = "1 質問あたり 512 トークン（質問＋選択肢＋状態）が上限です。";
    el.stateHint.style.color = "";
  }
  return n;
}

/* ------------------------------------------------------------- templates */

function renderTemplates() {
  el.templateList.innerHTML = TEMPLATES.map(
    (t) => `
    <button type="button" class="template" data-template="${t.id}" aria-pressed="${
      t.id === state.templateId
    }">
      ${icon(t.icon, "template__icon")}
      <span>
        <span class="template__name">${t.name}<span class="tag">${Object.keys(
      t.questions
    ).length}</span></span>
        <span class="template__desc">${t.description}</span>
      </span>
    </button>`
  ).join("");

  el.templateList.querySelectorAll("[data-template]").forEach((btn) => {
    btn.addEventListener("click", () => loadTemplate(btn.dataset.template));
  });
}

function loadTemplate(id) {
  const tpl = getTemplate(id);
  state.templateId = tpl.id;
  state.questions = structuredClone(tpl.questions || {});
  el.stateInput.value = tpl.stateSample;
  state.kind = tpl.kind || "raw";
  syncKindTabs();
  renderTemplates();
  renderQuestions();
  renderTokens();
  el.console?.log("info", `template loaded: ${tpl.id} (${Object.keys(state.questions).length} questions)`);
  toast(`テンプレート: ${tpl.name}`);
}

/* ------------------------------------------------------- question editor */

function setFormSummary(errors) {
  const bad = Object.keys(errors).filter((k) => k !== "__form");
  if (errors.__form) {
    el.formError.textContent = errors.__form;
  } else if (bad.length) {
    const label = bad.length === 1 ? "質問" : "質問";
    el.formError.textContent = `${bad.length} 件の${label}を修正してください: ${bad.join(", ")}`;
  } else {
    el.formError.textContent = "";
  }
  el.formError.hidden = !(errors.__form || bad.length);
}

/**
 * Re-validate and repaint only the validity flags, so it can run on every
 * keystroke without destroying the input the user is typing in.
 */
function refreshValidity() {
  const errors = validateQuestions(state.questions);
  for (const card of el.questionList.querySelectorAll(".qcard")) {
    const msg = errors[card.dataset.q];
    card.dataset.invalid = msg ? "true" : "false";
    let slot = card.querySelector(".qcard__err");
    if (msg) {
      if (!slot) {
        slot = document.createElement("p");
        slot.className = "err qcard__err";
        card.querySelector(".qcard__body")?.appendChild(slot);
      }
      slot.textContent = msg;
    } else if (slot) {
      slot.remove();
    }
  }
  setFormSummary(errors);
}

function renderQuestions() {
  const errors = validateQuestions(state.questions);
  const keys = Object.keys(state.questions);

  el.qCount.textContent = String(keys.length);
  setFormSummary(errors);

  if (!keys.length) {
    el.questionList.innerHTML = `<div class="empty">質問がありません。テンプレートを選ぶか「+ 質問を追加」を押してください。</div>`;
    return;
  }

  el.questionList.innerHTML = keys
    .map((key) => {
      const q = state.questions[key];
      const invalid = errors[key] ? "true" : "false";
      const errText = errors[key] ? `<p class="err qcard__err">${errors[key]}</p>` : "";
      let criteriaHtml = "";

      if (q.type === "choice") {
        const entries = Object.entries(q.criteria || {});
        criteriaHtml = entries
          .map(
            ([k, v], i) => `
            <div class="crit">
              <input type="text" value="${escapeAttr(k)}" data-crit-key="${escapeAttr(
              key
            )}:${i}:k" aria-label="選択肢キー" />
              <input type="text" value="${escapeAttr(v)}" data-crit-key="${escapeAttr(
              key
            )}:${i}:v" aria-label="選択肢の説明" />
              <button type="button" class="icon-btn" data-del-crit="${escapeAttr(
              key
            )}:${i}" aria-label="選択肢を削除">${icon("trash")}</button>
            </div>`
          )
          .join("");
        criteriaHtml += `<button type="button" class="btn btn--sm btn--ghost" data-add-crit="${escapeAttr(
          key
        )}">+ 選択肢</button>`;
      } else if (q.type === "score") {
        criteriaHtml = q.criteria
          .map(
            (v, i) => `
            <div class="crit crit--score">
              <input type="text" value="${escapeAttr(v)}" data-crit-key="${escapeAttr(
              key
            )}:${i}:v" aria-label="段階" />
              <button type="button" class="icon-btn" data-del-crit="${escapeAttr(
              key
            )}:${i}" aria-label="段階を削除">${icon("trash")}</button>
            </div>`
          )
          .join("");
        criteriaHtml += `<button type="button" class="btn btn--sm btn--ghost" data-add-crit="${escapeAttr(
          key
        )}">+ 段階</button>`;
      } else {
        criteriaHtml = `<p class="hint">noul は yes / no の二値判定です。基準は不要です。</p>`;
      }

      return `
      <div class="qcard" data-invalid="${invalid}" data-q="${escapeAttr(key)}">
        <div class="qcard__head">
          <span class="qcard__key"><input type="text" value="${escapeAttr(key)}" data-qkey="${escapeAttr(
        key
      )}" aria-label="質問キー" /></span>
          <span class="qcard__type">
            <select data-qtype="${escapeAttr(key)}" aria-label="質問型">
              ${["choice", "score", "noul"]
                .map(
                  (t) =>
                    `<option value="${t}"${q.type === t ? " selected" : ""}>${t}</option>`
                )
                .join("")}
            </select>
          </span>
          <button type="button" class="icon-btn" data-del-q="${escapeAttr(
        key
      )}" aria-label="質問を削除">${icon("trash")}</button>
        </div>
        <div class="qcard__body">
          <input class="input" type="text" value="${escapeAttr(
            q.instructions || ""
          )}" data-qinstr="${escapeAttr(key)}" placeholder="質問文 (instructions)" aria-label="質問文" />
          <span class="label" style="margin: 0">criteria</span>
          ${criteriaHtml}
          ${errText}
        </div>
      </div>`;
    })
    .join("");

  wireQuestionEvents();
}

function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function wireQuestionEvents() {
  const rerender = () => {
    renderQuestions();
    renderTokens();
  };

  el.questionList.querySelectorAll("[data-qkey]").forEach((input) => {
    input.addEventListener("change", () => {
      const oldKey = input.dataset.qkey;
      const newKey = input.value.trim();
      if (!newKey || newKey === oldKey) {
        renderQuestions();
        return;
      }
      const q = state.questions[oldKey];
      delete state.questions[oldKey];
      state.questions[newKey] = q;
      rerender();
    });
  });

  el.questionList.querySelectorAll("[data-qtype]").forEach((select) => {
    select.addEventListener("change", () => {
      const key = select.dataset.qtype;
      const q = state.questions[key];
      const next = select.value;
      if (next === "choice" && Array.isArray(q.criteria)) {
        q.criteria = Object.fromEntries(
          q.criteria.map((label, i) => [`option_${i + 1}`, label])
        );
      }
      if (next === "score" && !Array.isArray(q.criteria)) {
        q.criteria = Object.entries(q.criteria || {}).map(([, v]) => v);
      }
      if (next === "noul") q.criteria = undefined;
      if (next === "choice" && !q.criteria) {
        q.criteria = { option_a: "first option", option_b: "second option" };
      }
      if (next === "score" && !q.criteria) {
        q.criteria = ["low", "medium", "high"];
      }
      q.type = next;
      rerender();
    });
  });

  el.questionList.querySelectorAll("[data-qinstr]").forEach((input) => {
    input.addEventListener("input", () => {
      state.questions[input.dataset.qinstr].instructions = input.value;
      refreshValidity();
    });
  });

  el.questionList.querySelectorAll("[data-crit-key]").forEach((input) => {
    input.addEventListener("change", () => {
      const [key, idx, field] = input.dataset.critKey.split(":");
      const q = state.questions[key];
      const i = Number(idx);
      if (q.type === "choice") {
        const entries = Object.entries(q.criteria);
        if (field === "k") {
          const [oldK, oldV] = entries[i];
          const rebuilt = {};
          entries.forEach(([k, v], j) => {
            rebuilt[j === i ? (input.value.trim() || oldK) : k] = v;
          });
          q.criteria = rebuilt;
        } else {
          const rebuilt = {};
          entries.forEach(([k, v], j) => {
            rebuilt[k] = j === i ? input.value : v;
          });
          q.criteria = rebuilt;
        }
      } else {
        q.criteria[i] = input.value;
      }
      rerender();
    });
  });

  el.questionList.querySelectorAll("[data-add-crit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const q = state.questions[btn.dataset.addCrit];
      if (q.type === "choice") {
        const n = Object.keys(q.criteria || {}).length + 1;
        q.criteria[`option_${n}`] = `description ${n}`;
      } else {
        q.criteria = [...(q.criteria || []), `level ${q.criteria.length + 1}`];
      }
      rerender();
    });
  });

  el.questionList.querySelectorAll("[data-del-crit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const [key, idx] = btn.dataset.delCrit.split(":");
      const q = state.questions[key];
      const i = Number(idx);
      if (q.type === "choice") {
        const entries = Object.entries(q.criteria);
        entries.splice(i, 1);
        q.criteria = Object.fromEntries(entries);
      } else {
        q.criteria.splice(i, 1);
      }
      rerender();
    });
  });

  el.questionList.querySelectorAll("[data-del-q]").forEach((btn) => {
    btn.addEventListener("click", () => {
      delete state.questions[btn.dataset.delQ];
      rerender();
    });
  });
}

/* ---------------------------------------------------------------- results */

function ringSvg(confidence) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const dash = c * Math.min(1, Math.max(0, confidence ?? 0));
  const color = confidence >= CONFIDENCE_GATE ? "var(--ok)" : "var(--warn)";
  return `
    <svg viewBox="0 0 54 54" aria-hidden="true">
      <circle cx="27" cy="27" r="${r}" fill="none" stroke="#ddd" stroke-width="4" />
      <circle cx="27" cy="27" r="${r}" fill="none" stroke="${color}" stroke-width="4"
        stroke-dasharray="${dash.toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 27 27)" />
    </svg>
    <span class="ring__num">${confidence == null ? "—" : (confidence * 100).toFixed(0) + "%"}</span>`;
}

function renderChoice(a) {
  const dist = a.distribution || {};
  const entries = Object.entries(dist).sort((x, y) => y[1] - x[1]);
  return `
    <div class="rcard__answer">${escapeHtml(a.choice ?? "—")}</div>
    ${a.description ? `<p class="rcard__desc">${escapeHtml(a.description)}</p>` : ""}
    <div class="bars">
      ${entries
        .map(
          ([k, v], i) => `
        <div class="bar${i === 0 ? " bar--top" : ""}">
          <span class="bar__label" title="${escapeAttr(k)}">${escapeHtml(k)}</span>
          <span class="bar__track"><span class="bar__fill" style="width:${(v * 100).toFixed(1)}%"></span></span>
          <span class="bar__val">${(v * 100).toFixed(1)}%</span>
        </div>`
        )
        .join("")}
    </div>`;
}

function renderScore(a) {
  const n = (a.max_score ?? 0) + 1;
  const idx = Math.min(Math.max(a.score ?? 0, 0), n - 1);
  const pct = n === 1 ? 0 : (idx / (n - 1)) * 100;
  return `
    <div class="rcard__answer">${idx}${a.max_score != null ? ` / ${a.max_score}` : ""} · ${escapeHtml(
    a.label ?? ""
  )}</div>
    <div class="scale">
      <div class="scale__track"><span class="scale__marker" style="left:calc(${pct}% - 1px)"><span>${idx}</span></span></div>
      <div class="scale__ticks">
        ${Array.from({ length: n }, (_, i) => `<span>${i}</span>`).join("")}
      </div>
    </div>`;
}

function renderNoul(a) {
  const p = typeof a.noul === "number" ? a.noul : a.answer ? 1 : 0;
  return `
    <div class="rcard__answer">${a.answer === true ? "true" : a.answer === false ? "false" : "—"} · ${(
      p * 100
    ).toFixed(1)}%</div>
    <div class="gauge"><span class="gauge__fill${p < 0.5 ? " is-mid" : ""}" style="width:${(
      p * 100
    ).toFixed(1)}%"></span></div>
    <div class="gauge__scale"><span>0.0 false</span><span>0.5</span><span>1.0 true</span></div>`;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderResults(normalized, raw) {
  const { entries, routing, meta } = normalized;
  const caveat =
    meta.engine === "magnitude"
      ? `<div class="note note--warn">${icon(
          "alert"
        )}<span><strong>較正されていない値です。</strong>${escapeHtml(
          meta.disclaimer || ""
        )} 信頼度ゲートは laya 向けに設計されており、生成モデルには意味をなしません。</span></div>`
      : meta.engine === "mock"
        ? `<div class="note note--warn"><span><strong>モックです。</strong>ブラウザ内の決定論的ヒューリスティックであり、モデル出力でも実測でもありません。</span></div>`
        : "";

  el.routeTag.textContent = routing.model ? `→ ${routing.model}` : "—";
  el.resultMeta.innerHTML = [
    meta.engine === "mock"
      ? '<span class="tag tag--warn">mock engine</span>'
      : meta.engine === "magnitude"
        ? '<span class="tag tag--warn">uncalibrated</span>'
        : '<span class="tag tag--ok">live</span>',
    meta.latency_ms ? `<span class="tag">${meta.latency_ms} ms</span>` : "",
    routing.script ? `<span class="tag">${routing.script}</span>` : "",
    `<span class="tag">${entries.length} questions</span>`,
  ]
    .filter(Boolean)
    .join("");

  el.resultList.innerHTML =
    caveat +
    entries
    .map((entry) => {
      const a = entry.raw || {};
      const body =
        entry.type === "choice"
          ? renderChoice(a)
          : entry.type === "score"
            ? renderScore(a)
            : renderNoul(a);
      const gate =
        meta.engine === "magnitude"
          ? entry.confidence != null
            ? `<div class="note"><span>自己申告の信頼度 ${(
                entry.confidence * 100
              ).toFixed(0)}%（較正なし・閾値判定の対象外）</span></div>`
            : ""
          : entry.confidence != null && entry.confidence < CONFIDENCE_GATE
          ? `<div class="note note--warn">${icon(
              "alert"
            )}<span>信頼度 ${(entry.confidence * 100).toFixed(0)}% は閾値 ${(
              CONFIDENCE_GATE * 100
            ).toFixed(0)}% 未満。自動判定を保留し、人手確認を推奨します。</span></div>`
          : entry.confidence != null
            ? `<div class="note note--ok"><span>信頼度 ${(
                entry.confidence * 100
              ).toFixed(0)}% は閾値以上。自動適用可能です。</span></div>`
            : "";
      return `
      <article class="rcard">
        <header class="rcard__head">
          <span class="rcard__key">${escapeHtml(entry.key)} · <span class="tag">${entry.type}</span></span>
          <span class="ring">${ringSvg(entry.confidence)}</span>
        </header>
        ${body}
        ${gate}
      </article>`;
    })
    .join("");

  el.rawOutput.textContent = JSON.stringify(raw, null, 2);

  const weak = entries.filter((e) => e.confidence != null && e.confidence < CONFIDENCE_GATE);
  el.console?.log(
    "ok",
    `${entries.length} questions answered in ${meta.latency_ms} ms (${routing.model})`
  );
  if (meta.engine === "mock") {
    el.console?.log("warn", "mock engine — 実モデルではなくローカル決定論モックの結果です（latency も実測値ではありません）");
  }
  if (weak.length) {
    el.console?.log("warn", `below gate (<${CONFIDENCE_GATE}): ${weak.map((w) => w.key).join(", ")}`);
  }
}

/* ------------------------------------------------------------- inference */

async function analyze({ silent = false } = {}) {
  const text = el.stateInput.value.trim();
  if (!text) {
    el.console?.log("err", "state が空です");
    el.resultList.innerHTML = `<div class="empty">まず状態テキストを入力してください。</div>`;
    return;
  }

  const errors = validateQuestions(activeQuestions());
  const fatal = Object.keys(errors).filter((k) => k !== "__form");
  if (errors.__form || fatal.length) {
    el.console?.log("err", `question validation failed: ${[errors.__form, ...fatal].filter(Boolean).join(" | ")}`);
    renderQuestions();
    const first = fatal[0];
    if (first) {
      const target = el.questionList.querySelector(`[data-qinstr="${first}"]`);
      target?.scrollIntoView({ block: "center", behavior: "smooth" });
      target?.focus({ preventScroll: true });
    }
    toast("質問セットを修正してください");
    return;
  }

  setBusy(true);
  el.resultList.innerHTML = `<div class="empty"><span class="spin" style="display:inline-block"></span> 推論中…</div>`;

  const payload = currentStateObject();
  try {
    const result = await predict(payload, activeQuestions(), {
      engine: state.engine,
      endpoint: state.engine === "magnitude" ? getMagnitudeEndpoint() : getEndpoint(),
      model: state.engine === "magnitude" ? state.model : undefined,
    });
    state.lastResult = result;
    renderResults(normalizeResult(result, activeQuestions()), result);
    if (!silent) toast(`完了: ${result.meta.latency_ms} ms`);
  } catch (err) {
    const message = err.name === "AbortError" ? "リクエストがタイムアウトしました" : err.message;
    el.resultList.innerHTML = `<div class="empty"><strong>エラー</strong><br />${escapeHtml(
      message
    )}</div>`;
    el.rawOutput.textContent = message;
    el.console?.log("err", message);
    toast("推論に失敗しました");
  } finally {
    setBusy(false);
  }
}

function setBusy(busy) {
  state.busy = busy;
  $("#btn-analyze").disabled = busy;
  $("#btn-console-run").disabled = busy;
  el.consoleState.textContent = busy ? "running" : "idle";
}

/* ------------------------------------------------------------ CSV export */

function toCsv(result, questions) {
  const rows = [["question", "type", "answer", "confidence", "distribution"]];
  for (const [key, q] of Object.entries(questions)) {
    const a = result.answers?.[key] || {};
    let answer = "";
    let dist = "";
    if (q.type === "choice") {
      answer = a.choice ?? "";
      dist = JSON.stringify(a.distribution || {});
    } else if (q.type === "score") {
      answer = a.score ?? "";
      dist = JSON.stringify(a.distribution || {});
    } else {
      answer = a.noul ?? "";
    }
    rows.push([
      key,
      q.type,
      String(answer),
      a.confidence == null ? "" : Number(a.confidence).toFixed(4),
      dist,
    ]);
  }
  return rows
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

/* ----------------------------------------------------------------- setup */

function syncKindTabs() {
  document.querySelectorAll("[data-kind]").forEach((tab) => {
    tab.setAttribute("aria-selected", String(tab.dataset.kind === state.kind));
  });
  el.inputKind.textContent = state.kind;
}

function applyEngine(engine) {
  state.engine = engine;
  setEngine(engine);
  document.querySelectorAll("[data-engine]").forEach((btn) => {
    btn.setAttribute("aria-pressed", String(btn.dataset.engine === engine));
  });
  if (el.engineMagnitude) el.engineMagnitude.hidden = engine !== "magnitude";
  if (engine === "magnitude") {
    el.console?.log(
      "info",
      `engine = magnitude (${getMagnitudeEndpoint()}${state.model ? `, model ${state.model}` : ", model 未選択"})`
    );
    if (!el.modelSelect?.options.length || el.modelSelect.options.length <= 1) refreshModels();
  } else {
    el.console?.log("info", `engine = ${engine}${engine === "laya" ? ` (${getEndpoint()})` : ""}`);
  }
}

async function refreshModels() {
  if (!el.modelSelect) return;
  el.modelSelect.innerHTML = `<option value="">取得中…</option>`;
  el.modelSelect.disabled = true;
  try {
    const models = await listMagnitudeModels();
    if (!models.length) {
      el.modelSelect.innerHTML = `<option value="">モデルなし</option>`;
      el.console?.log("warn", "Magnitude: モデルが未ダウンロードです（デスクトップアプリで取得してください）");
      return;
    }
    el.modelSelect.innerHTML =
      `<option value="">モデルを選択</option>` +
      models.map((m) => `<option value="${escapeAttr(m)}">${escapeHtml(m)}</option>`).join("");
    if (state.model && models.includes(state.model)) el.modelSelect.value = state.model;
    el.console?.log("ok", `Magnitude: ${models.length} モデル (${getMagnitudeEndpoint()})`);
  } catch (err) {
    el.modelSelect.innerHTML = `<option value="">接続失敗</option>`;
    el.console?.log("error", `Magnitude: ${err.message} — デスクトップアプリを開くか \`magnitude serve\` を実行`);
  } finally {
    el.modelSelect.disabled = false;
  }
}

function readFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    el.stateInput.value = String(reader.result || "");
    if (file.name.endsWith(".json")) state.kind = "json";
    else if (file.name.endsWith(".eml")) state.kind = "email";
    syncKindTabs();
    renderTokens();
    el.console?.log("ok", `loaded ${file.name} (${file.size} bytes)`);
  };
  reader.readAsText(file);
}

function wireInput() {
  el.stateInput.addEventListener("input", renderTokens);

  document.querySelectorAll("[data-kind]").forEach((tab) => {
    tab.addEventListener("click", () => {
      state.kind = tab.dataset.kind;
      syncKindTabs();
    });
  });

  el.dropzone.addEventListener("click", () => el.fileInput.click());
  el.dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      el.fileInput.click();
    }
  });
  el.fileInput.addEventListener("change", () => {
    if (el.fileInput.files?.[0]) readFile(el.fileInput.files[0]);
  });

  ["dragenter", "dragover"].forEach((ev) =>
    el.dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      el.dropzone.classList.add("is-over");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    el.dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      el.dropzone.classList.remove("is-over");
    })
  );
  el.dropzone.addEventListener("drop", (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) readFile(file);
  });

  $("#btn-analyze").addEventListener("click", () => analyze());
  $("#btn-add").addEventListener("click", () => {
    let i = 1;
    let key = `question_${i}`;
    while (state.questions[key]) {
      i += 1;
      key = `question_${i}`;
    }
    state.questions[key] = { type: "noul", instructions: "" };
    renderQuestions();
    document.querySelector(`[data-qinstr="${key}"]`)?.focus();
  });

  document.querySelectorAll("[data-engine]").forEach((btn) => {
    btn.addEventListener("click", () => applyEngine(btn.dataset.engine));
  });

  el.modelSelect?.addEventListener("change", (e) => {
    state.model = e.target.value;
    setMagnitudeModel(state.model);
    el.console?.log(state.model ? "ok" : "warn", state.model ? `model = ${state.model}` : "モデルが未選択です");
  });

  el.btnModels?.addEventListener("click", () => {
    refreshModels();
    el.console?.log("info", "モデル一覧を更新します");
  });

  $("#btn-json").addEventListener("click", () => {
    const data = exportJson();
    download("laya-result.json", data, "application/json");
    el.console?.log("ok", "json exported");
  });

  $("#btn-csv").addEventListener("click", () => {
    if (!state.lastResult) {
      el.console?.log("warn", "先に Analyze を実行してください");
      return;
    }
    download("laya-result.csv", toCsv(state.lastResult, activeQuestions()), "text/csv");
    el.console?.log("ok", "csv exported");
  });

  $("#btn-copy").addEventListener("click", async () => {
    const text = el.rawOutput.textContent;
    try {
      await navigator.clipboard.writeText(text);
      el.console?.log("ok", "copied to clipboard");
      toast("コピーしました");
    } catch {
      el.console?.log("err", "clipboard unavailable");
    }
  });

  $("#btn-console-run").addEventListener("click", () => analyze());
  $("#btn-console-clear").addEventListener("click", () => el.console?.execute("clear"));
}

/* ----------------------------------------------------------- console glue */

function buildConsole() {
  const panel = new ConsolePanel($("#terminal"), {
    templates: () => TEMPLATES,

    onTemplate: (id) => {
      const found = TEMPLATES.find((t) => t.id === id);
      if (!found) throw new Error(`unknown template: ${id}  (list with: templates)`);
      loadTemplate(id);
      return `loaded ${id}`;
    },

    onStateInput: (text) => {
      el.stateInput.value = text;
      renderTokens();
      return "state updated";
    },

    onStateShow: () => {
      const text = el.stateInput.value.trim();
      if (!text) return "state is empty";
      const preview = text.length > 400 ? `${text.slice(0, 400)}…` : text;
      return `${preview}\n\n${estimateTokens(text)} tokens · kind=${state.kind}`;
    },

    onQuestionsShow: () => JSON.stringify(activeQuestions(), null, 2),

    onTokens: () => {
      const n = renderTokens();
      return `${n} / ${tokenBudget()} tokens (${((n / tokenBudget()) * 100).toFixed(0)}% of budget)`;
    },

    onEngineShow: () =>
      [
        `engine = ${state.engine}`,
        `endpoint = ${state.engine === "magnitude" ? getMagnitudeEndpoint() : getEndpoint()}`,
        state.engine === "magnitude" ? `model = ${state.model || "(未選択)"}` : null,
      ]
        .filter(Boolean)
        .join("\n"),

    onEngineSet: (name) => {
      applyEngine(name);
      return `engine = ${name}`;
    },

    onEndpoint: (url) => {
      const isMag = state.engine === "magnitude";
      const current = () => (isMag ? getMagnitudeEndpoint() : getEndpoint());
      if (!url) return current();
      if (url === "reset") {
        if (isMag) setMagnitudeEndpoint(null);
        else setEndpoint(null);
        return `endpoint = ${current()} (既定値に戻しました)`;
      }
      const parsed = new URL(url);
      if (!/^https?:$/.test(parsed.protocol)) throw new Error("http(s) の URL を指定してください");
      if (isMag) setMagnitudeEndpoint(parsed.href);
      else setEndpoint(parsed.href);
      return `endpoint = ${current()}`;
    },

    onCurl: () => {
      const payload = { state: currentStateObject(), questions: activeQuestions() };
      if (state.engine === "magnitude") {
        const base = getMagnitudeEndpoint().replace(/\/+$/, "");
        return [
          `POST ${base}/chat/completions`,
          "",
          "※ Magnitude は OpenAI 互換 API です。送信されるのは状態と質問をまとめたプロンプトで、",
          "※ 出力は自己申告値であり較正されていません（laya とは比較不可）。",
          "",
          `curl -sS ${base}/chat/completions \\`,
          `  -H 'Content-Type: application/json' \\`,
          `  -H 'Authorization: Bearer local' \\`,
          `  -d '{"model":"${state.model || "MODEL_ID"}","messages":[{"role":"user","content":"..."}],"temperature":0,"stream":false}'`,
        ].join("\n");
      }
      const compact = JSON.stringify(payload);
      const endpoint = getEndpoint();
      return [
        `POST ${endpoint}`,
        "",
        JSON.stringify(payload, null, 2),
        "",
        `curl -sS ${endpoint} \\`,
        `  -H 'Content-Type: application/json' \\`,
        `  -d '${compact}'`,
      ].join("\n");
    },

    onPredict: () => analyze({ silent: true }).then(() => "done"),

    onJson: () => exportJson(),

    onModels: async () => {
      const models = await listMagnitudeModels();
      if (!models.length) {
        el.console?.log("warn", "モデルが 0 件です。Magnitude デスクトップアプリでモデルをダウンロードしてください");
        return;
      }
      return `magnitude models (${models.length})\n${models.map((m) => `  ${m}`).join("\n")}`;
    },

    onModelSet: (id) => {
      state.model = id;
      setMagnitudeModel(id);
      if (el.modelSelect && [...el.modelSelect.options].some((o) => o.value === id)) {
        el.modelSelect.value = id;
      }
      el.console?.log("ok", `model = ${id}`);
    },
  });

  el.console = panel;
  return panel.start().catch((err) => {
    const host = $("#terminal");
    if (host) {
      host.innerHTML = `<p style="padding:12px;font-family:var(--font-mono);font-size:0.8rem">terminal failed to start: ${escapeHtml(
        err.message
      )}</p>`;
    }
  });
}

/* ------------------------------------------------------------------ boot */

loadTemplate("email-triage");
wireInput();
syncKindTabs();
renderTokens();
applyEngine(getEngine());

buildConsole().then(() => {
  // loadTemplate() ran before the terminal existed, so replay its log line here.
  el.console?.log(
    "info",
    `template loaded: ${state.templateId} (${Object.keys(state.questions).length} questions)`
  );
  const routing = detectScript(stateToText(el.stateInput.value));
  el.console?.log(
    "info",
    `routing check: script=${routing.script} → checkpoint=${routing.checkpoint}`
  );
  el.console?.log("info", `mock engine is offline-deterministic. type: engine laya  (${getEndpoint()})`);
});

document.addEventListener("keydown", (e) => {
  // Note: inside the wterm textarea Ctrl+Enter is claimed by the terminal
  // itself (a modified key), so use `run` there instead.
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    analyze();
  }
});