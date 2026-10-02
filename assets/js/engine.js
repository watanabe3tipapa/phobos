/**
 * Inference adapter.
 *
 * Two engines:
 *   - "mock"  deterministic, offline heuristic scorer. Used by default so the
 *             static GitHub Pages build works with no backend. Output shape is
 *             identical to the real engine, but the probabilities are NOT model
 *             output. Every mock result is labelled as such.
 *   - "laya"  POSTs to a laya-serve / Jev-compatible endpoint at
 *             /v1/systemone. Calibrated probabilities.
 *   - "magnitude"  POSTs to a Magnitude OpenAI-compatible endpoint. It is a
 *             text generator, so the numbers it returns are self-reported and
 *             NOT calibrated.
 */

const DEFAULT_ENDPOINT = "http://localhost:8000/v1/systemone";
const STORAGE_KEY = "phobos.laya.endpoint";
const ENGINE_KEY = "phobos.laya.engine";
const ENGINES = ["mock", "laya", "magnitude"];

/** Last engine the user picked. Falls back to the offline mock. */
export function getEngine() {
  try {
    const saved = localStorage.getItem(ENGINE_KEY);
    return ENGINES.includes(saved) ? saved : "mock";
  } catch {
    return "mock";
  }
}

export function setEngine(engine) {
  if (!ENGINES.includes(engine)) throw new Error(`unknown engine: ${engine}`);
  try {
    localStorage.setItem(ENGINE_KEY, engine);
  } catch {
    /* private mode: keep the in-memory value only */
  }
}

export function getEndpoint() {
  try {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_ENDPOINT;
  } catch {
    return DEFAULT_ENDPOINT;
  }
}

export function setEndpoint(url) {
  try {
    if (url) localStorage.setItem(STORAGE_KEY, url);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode: keep the in-memory value only */
  }
}

/* ------------------------------------------------------------------ tokens */

const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const LATIN = /[A-Za-z]/;

/** Rough token estimate: CJK ~1 token/char, latin ~1 token/4 chars. */
export function estimateTokens(text) {
  const s = typeof text === "string" ? text : JSON.stringify(text ?? "");
  let cjk = 0;
  let other = 0;
  for (const ch of s) {
    if (CJK.test(ch)) cjk += 1;
    else other += 1;
  }
  return Math.round(cjk + other / 3.2);
}

export function tokenBudget() {
  return 512;
}

/* ------------------------------------------------- script / language routing */

/** Mirrors the Router heuristic described in the Laya model card. */
export function detectScript(text) {
  const s = typeof text === "string" ? text : JSON.stringify(text ?? "");
  let latin = 0;
  let devanagari = 0;
  let han = 0;
  let cyrillic = 0;
  let arabic = 0;
  let letters = 0;

  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp < 0x0080) continue;
    if (!/\p{L}/u.test(ch)) continue;
    letters += 1;
    if (LATIN.test(ch)) latin += 1;
    else if (cp >= 0x0900 && cp <= 0x097f) devanagari += 1;
    else if ((cp >= 0x3040 && cp <= 0x30ff) || (cp >= 0x3400 && cp <= 0x9fff)) han += 1;
    else if (cp >= 0x0400 && cp <= 0x04ff) cyrillic += 1;
    else if (cp >= 0x0600 && cp <= 0x06ff) arabic += 1;
  }

  if (letters === 0) return { script: "unknown", checkpoint: "english", ratio: 1, reason: "no letters in state" };

  const counts = { latin, devanagari, han, cyrillic, arabic };
  const script = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  const ratio = counts[script] / letters;

  if (script !== "latin" && ratio >= 0.5) {
    return {
      script,
      checkpoint: "multilingual",
      ratio,
      reason: `non-Latin script (${script}, ${(ratio * 100).toFixed(0)}% of letters); the English checkpoint cannot read it`,
    };
  }
  if (ratio < 0.7) {
    return {
      script: "mixed",
      checkpoint: "multilingual",
      ratio,
      reason: `mixed scripts (dominant ${script} at ${(ratio * 100).toFixed(0)}%)`,
    };
  }
  return {
    script: "latin",
    checkpoint: "english",
    ratio,
    reason: "Latin script dominant; ModernBERT-large checkpoint",
  };
}

export function stateToText(state) {
  if (typeof state === "string") return state;
  if (state && typeof state === "object") {
    return Object.entries(state)
      .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join("\n");
  }
  return "";
}

/* ------------------------------------------------------------- mock engine */

const LEXICON = {
  billing: ["invoice", "bill", "charge", "charged", "refund", "payment", "price", "請求", "料金", "返金", "支払", "账单", "退款", "भुगतान", "राशि"],
  technical: ["error", "bug", "crash", "500", "timeout", "outage", "server", "exception", "エラー", "不具合", "障害", "落ちる", "报错", "错误"],
  security: ["phishing", "password", "credential", "verify", "spoof", "malware", "フィッシング", "パスワード", "認証", "钓鱼"],
  churn: ["cancel", "churn", "leave", "competitor", "解約", "やめる", "Canceled", "cancel our", "退出"],
  urgent: ["asap", "urgent", "immediately", "today", "now", "blocked", "outage", "緊急", "至急", "すぐ", "urgent"],
  positive: ["great", "love", "improvement", "happy", "thanks", "perfect", "良い", "嬉しい", "改善", "ありがとう"],
  negative: ["bad", "broken", "fail", "worst", "disappointed", "遅い", "壊れ", "失望", "最悪", "投诉"],
  invoice: ["invoice", "amount", "vendor", "po_number", "請求", "金額"],
  complaint: ["complaint", "fails", "broken", "issue", "problem", "投诉", "問題", "不具合"],
  feature: ["please add", "feature request", "would like", "should have", "機能", "追加して"],
  account: ["password", "login", "account", "permission", "パスワード", "ログイン", "アカウント"],
  sales: ["quote", "contract", "upgrade", "plan", "pricing", "契約", "見積"],
  human: ["reviewer", "human", "manual", "確認", "レビュー"],
  selfharm: ["self-harm", "suicide", "overdose", "hurt myself", "自殺", "自傷"],
  cyber: ["malware", "exploit", "payload", "ransomware", "keylogger", "マルウェア"],
  chemistry: ["chemical", "reflux", "precursor", "explosive", "化学", "爆発"],
  harassment: ["threat", "abuse", "idiot", "脅迫"],
  medical: ["diagnos", "prescription", "dose", "救急"],
};

function hits(text, key) {
  const words = LEXICON[key] || [];
  const lower = text.toLowerCase();
  let n = 0;
  for (const w of words) {
    if (lower.includes(w.toLowerCase())) n += 1;
  }
  return n;
}

/** Deterministic 32-bit hash so identical input yields identical mock output. */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function jitter(seed, i, spread) {
  const x = Math.sin((seed % 100000) * 12.9898 + i * 78.233) * 43758.5453;
  const frac = x - Math.floor(x);
  return (frac - 0.5) * spread;
}

function softmax(scores, temperature = 1) {
  const max = Math.max(...scores);
  const exps = scores.map((s) => Math.exp((s - max) / temperature));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

/** Keyword heuristics per choice question, keyed by question name. */
const CHOICE_HINTS = {
  department(text) {
    const b = hits(text, "billing");
    const t = hits(text, "technical");
    const s = hits(text, "sales");
    const a = hits(text, "account");
    return { billing: b, technical: t, sales: s, other: 0.4 + (t === 0 ? 0 : -t) };
  },
  severity(text) {
    const blocking = /\b500\b|outage|revenue|all users|cannot|unable|total|停止|停止中|全面|障害/.test(text);
    const few = /one feature|single user|cosmetic|軽微|一部のみ/.test(text);
    return {
      sev1: blocking ? 6 : 0.5,
      sev2: blocking ? 2.5 : few ? 3 : 1.2,
      sev3: blocking ? 0.6 : few ? 3.5 : 2.4,
      sev4: blocking ? 0.2 : few ? 0.6 : 2.2,
    };
  },
  harmful_category(text) {
    const cy = hits(text, "chemistry");
    const cyb = hits(text, "cyber");
    const hh = hits(text, "harassment");
    const md = hits(text, "selfharm") + hits(text, "medical");
    const none = cy + cyb + hh + md === 0 ? 3.2 : 0.2;
    return { none, chemistry: cy * 2 + 0.1, cyber: cyb * 2 + 0.1, harassment: hh * 2 + 0.1, medical: md * 2 + 0.1 };
  },
  sentiment(text) {
    const p = hits(text, "positive");
    const n = hits(text, "negative");
    return { positive: p * 1.6 + 0.6, neutral: Math.abs(p - n) < 1 ? 2.4 : 0.5, negative: n * 1.6 + 0.6 };
  },
  payment_action(text) {
    const dup = /duplicate|二重|重複|invoice no|INV-/.test(text);
    const po = /po_number|PO-\d+/.test(text);
    return {
      auto_approve: dup ? 0.2 : po ? 4.2 : 1.4,
      approve: dup ? 0.8 : po ? 2.6 : 2.2,
      hold: po ? 0.5 : 2.4,
      reject: dup ? 3.4 : 0.3,
    };
  },
  script_family(text) {
    const d = detectScript(text);
    const w = { latin: 0.3, devanagari: 0.3, han: 0.3, cyrillic: 0.3, arabic: 0.3 };
    w[d.script] = 6;
    return w;
  },
  topic(text) {
    const b = hits(text, "billing");
    const t = hits(text, "technical");
    const a = hits(text, "account");
    return { billing: b * 1.8 + 0.3, technical: t * 1.8 + 0.3, account: a * 1.8 + 0.3, other: 0.7 };
  },
  language_family(text) {
    return CHOICE_HINTS.script_family(text);
  },
};

function genericChoiceScores(text, criteria) {
  const keys = Object.keys(criteria);
  const scores = {};
  for (const k of keys) {
    const desc = String(criteria[k]);
    scores[k] = 0.8 + hits(text, k.toLowerCase()) * 0.9 + (desc.length > 0 ? 0.2 : 0);
  }
  return scores;
}

function mockAnswer(text, q, seed) {
  if (q.type === "choice") {
    const keys = Object.keys(q.criteria || {});
    if (keys.length === 0) throw new Error("choice question has no criteria");
    const hinted = CHOICE_HINTS[q.key] ? CHOICE_HINTS[q.key](text) : null;
    const raw = hinted || genericChoiceScores(text, q.criteria);
    const scores = keys.map((k, i) => {
      const base = raw[k] ?? 0.5;
      return base + jitter(seed, i, 0.5);
    });
    const probs = softmax(scores, 0.85);
    const dist = {};
    keys.forEach((k, i) => (dist[k] = probs[i]));
    const top = keys[probs.indexOf(Math.max(...probs))];
    return {
      choice: top,
      confidence: probs[probs.indexOf(Math.max(...probs))],
      distribution: dist,
      description: q.criteria[top],
    };
  }

  if (q.type === "score") {
    const n = q.criteria.length;
    const signals = q.criteria.map((label) => {
      const l = String(label).toLowerCase();
      let s = 0.9 + jitter(seed, l.length, 0.3);
      if (/(not urgent|benign|mild|trivial|none|light)/.test(l)) s += hits(text, "negative") * 0.1;
      if (/(blocking|urgent|critical|credential|explosive|heavy)/.test(l)) s += hits(text, "urgent") * 0.5;
      if (/(suspicious|moderate|strong|deceptive)/.test(l)) s += hits(text, "security") * 0.2;
      return s;
    });
    const probs = softmax(signals, 1.05);
    const idx = probs.indexOf(Math.max(...probs));
    const spread = Math.abs(probs[idx] - (probs[idx - 1] ?? 0)) + Math.abs(probs[idx] - (probs[idx + 1] ?? 0));
    return {
      score: idx,
      max_score: n - 1,
      label: q.criteria[idx],
      confidence: Math.min(0.99, 0.55 + spread * 1.1),
      distribution: q.criteria.reduce((acc, label, i) => ({ ...acc, [label]: probs[i] }), {}),
    };
  }

  const t = text.toLowerCase();
  const triggers = [
    ["churn", /cancel|churn|leave|解約|やめる|退出|terminate/],
    ["security", /phishing|spoof|verify your account|フィッシング|認証情報/],
    ["refund", /refund|返金|退还|वापस/],
    ["duplicate", /duplicate|二重|重複|twice/],
    ["threshold", /348000|350000|over|超/],
    ["complaint", /complaint|fails|broken|投诉|不具合|失敗/],
    ["feature", /please add|feature request|would like|機能.*追加|追加して/],
    ["urgent", /asap|urgent|immediately|today|blocking|緊急|至急/],
    ["sla", /sla|deadline|response time|期限/],
    ["customer", /customer|paying|revenue|顧客|収益/],
    ["reproduce", /reproducib|10 out of 10|再現/],
    ["human", /human|manual|reviewer|確認|レビュー/],
    ["immediate", /immediately|today|now|すぐ|今日中/],
  ];

  let raw = 0.5;
  let matched = null;
  for (const [name, re] of triggers) {
    if (re.test(t)) {
      raw = Math.max(raw, 1.6 + hits(text, "urgent") * 0.4);
      matched = name;
    }
  }
  const seedJitter = jitter(seed, 99, 0.8);
  const rawFalse = 0.7 + seedJitter;
  const rawTrue = raw + seedJitter * 0.5;
  const pTrue = rawTrue / (rawTrue + rawFalse);
  return {
    noul: Number(pTrue.toFixed(4)),
    answer: pTrue >= 0.5,
    confidence: Math.min(0.99, Math.abs(pTrue - 0.5) * 2 + 0.42),
    trigger: matched,
  };
}

export async function runMock(state, questions) {
  const text = stateToText(state);
  if (!text.trim()) throw new Error("state が空です");
  const seed = hash(text);
  const routing = detectScript(text);
  const answers = {};
  for (const [key, q] of Object.entries(questions)) {
    answers[key] = mockAnswer(text, q, seed);
  }
  // Simulated latency, stable for a given input, in the documented 33-160 ms band.
  const latency_ms = Number((33 + (seed % 120)).toFixed(1));
  await new Promise((r) => setTimeout(r, 420));
  return {
    answers,
    routing: { model: routing.checkpoint, script: routing.script, reason: routing.reason },
    meta: { engine: "mock", latency_ms, model: "mock-heuristic-v1", disclaimer: "ローカル決定論モック。実モデルの推論結果ではなく、latency_ms も実測値ではありません。" },
  };
}

/* ------------------------------------------------------------ real engine */

export async function runLaya(state, questions, options = {}) {
  const endpoint = options.endpoint || getEndpoint();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 60000);
  const started = performance.now();

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
      },
      body: JSON.stringify({ state, questions }),
      signal: controller.signal,
    });

    const bodyText = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}: ${bodyText.slice(0, 400)}`);
    }
    let payload;
    try {
      payload = JSON.parse(bodyText);
    } catch {
      throw new Error(`レスポンスが JSON ではありません: ${bodyText.slice(0, 200)}`);
    }
    const data = payload.result || payload;
    return {
      answers: data.answers || {},
      routing: data.routing || {},
      meta: {
        engine: "laya",
        latency_ms: Number((performance.now() - started).toFixed(1)),
        model: data.routing?.model || "unknown",
        endpoint,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function predict(state, questions, options = {}) {
  if (options.engine === "laya") return runLaya(state, questions, options);
  if (options.engine === "magnitude") return runMagnitude(state, questions, options);
  return runMock(state, questions);
}

/** Normalise an engine result into a shape the renderer can consume. */
export function normalizeResult(result, questions) {
  const entries = Object.entries(questions).map(([key, q]) => {
    const a = result.answers?.[key] || {};
    return {
      key,
      type: q.type,
      instructions: q.instructions,
      criteria: q.criteria,
      confidence: typeof a.confidence === "number" ? a.confidence : null,
      raw: a,
    };
  });
  return {
    entries,
    routing: result.routing || {},
    meta: result.meta || {},
  };
}
/* ------------------------------------------------------------- magnitude */

/**
 * Magnitude (https://github.com/magnitudedev/magnitude) is a *text generation*
 * engine, not a typed-decision engine. It exposes an OpenAI-compatible API, so
 * we can ask it the same questions, but the numbers it returns are the model's
 * own self-reported estimates — they are NOT calibrated and NOT comparable to
 * laya's. Every magnitude result is labelled as such.
 *
 * API shape (docs/api/overview.mdx, docs/api/endpoints.mdx):
 *   GET  {base}/models
 *   POST {base}/chat/completions  -> choices[0].message.content
 */
const MAGNITUDE_DEFAULT_ENDPOINT = "http://127.0.0.1:10100/inference/v1";
const MAGNITUDE_ENDPOINT_KEY = "phobos.magnitude.endpoint";
const MAGNITUDE_MODEL_KEY = "phobos.magnitude.model";

export function getMagnitudeEndpoint() {
  try {
    return localStorage.getItem(MAGNITUDE_ENDPOINT_KEY) || MAGNITUDE_DEFAULT_ENDPOINT;
  } catch {
    return MAGNITUDE_DEFAULT_ENDPOINT;
  }
}

export function setMagnitudeEndpoint(url) {
  try {
    if (url) localStorage.setItem(MAGNITUDE_ENDPOINT_KEY, url);
    else localStorage.removeItem(MAGNITUDE_ENDPOINT_KEY);
  } catch {
    /* private mode */
  }
}

export function getMagnitudeModel() {
  try {
    return localStorage.getItem(MAGNITUDE_MODEL_KEY) || "";
  } catch {
    return "";
  }
}

export function setMagnitudeModel(id) {
  try {
    if (id) localStorage.setItem(MAGNITUDE_MODEL_KEY, id);
    else localStorage.removeItem(MAGNITUDE_MODEL_KEY);
  } catch {
    /* private mode */
  }
}

/** Health check + model catalogue. An empty list means Magnitude is not running. */
export async function listMagnitudeModels(endpoint = getMagnitudeEndpoint()) {
  const base = endpoint.replace(/\/+$/, "");
  const res = await fetch(`${base}/models`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const body = await res.json();
  const list = Array.isArray(body) ? body : body.data || [];
  return list
    .map((m) => (typeof m === "string" ? m : m.id))
    .filter((id) => typeof id === "string" && id);
}

function buildMagnitudePrompt(state, questions) {
  const lines = Object.entries(questions).map(([key, q]) => {
    if (q.type === "choice") {
      const opts = Object.entries(q.criteria || {}).map(([k, v]) => `"${k}": "${v}"`).join(", ");
      return `- "${key}" (choice): pick one of {${opts}}. Answer with the KEY.`;
    }
    if (q.type === "score") {
      const opts = (q.criteria || []).map((v) => `"${v}"`).join(", ");
      return `- "${key}" (score): pick one of [${opts}]. Answer with the LABEL.`;
    }
    return `- "${key}" (noul): answer true or false.`;
  });

  const stateText = typeof state === "string" ? state : JSON.stringify(state, null, 2);

  return `You are answering a fixed set of typed questions about the state below.
Answer with JSON only. No prose, no markdown fence, no explanation.

Rules:
- "confidence" is your own estimate between 0 and 1. It is NOT calibrated.
- For "choice" also give "distribution": a probability for EVERY key, summing to 1.
- For "noul" give "probability" between 0 and 1.
- Use the exact key names given to you. Do not invent keys.

Output shape:
{"answers":{"<key>":{"answer":<string|boolean>,"confidence":<number>,"distribution":{...},"probability":<number>}}}

Questions:
${lines.join("\n")}

State:
${stateText}`;
}

/** Pull a JSON object out of a chat completion, tolerating fences and chatter. */
function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [];
  if (fenced) candidates.push(fenced[1]);
  candidates.push(text);
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));

  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c.trim());
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error("応答から JSON を抽出できませんでした（models が未取得か、JSON 以外の応答）");
}

const clamp01 = (n) => (typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null);

function normalizeDistribution(dist, criteria) {
  const keys = Object.keys(criteria || {});
  const out = {};
  let total = 0;
  for (const k of keys) {
    const v = clamp01(dist?.[k]);
    if (v != null) {
      out[k] = v;
      total += v;
    }
  }
  if (!Object.keys(out).length) return null;
  // Renormalise so the bars always sum to 1 even if the model did not.
  if (total > 0 && Math.abs(total - 1) > 1e-6) {
    for (const k of Object.keys(out)) out[k] = out[k] / total;
  }
  return out;
}

function toLayaShape(key, q, a) {
  if (q.type === "choice") {
    const dist = normalizeDistribution(a.distribution, q.criteria) || {};
    const pick = Object.keys(q.criteria || {}).includes(a.answer)
      ? a.answer
      : Object.entries(dist).sort((x, y) => y[1] - x[1])[0]?.[0] || null;
    return {
      choice: pick,
      description: pick != null ? q.criteria[pick] : null,
      distribution: dist,
      confidence: clamp01(a.confidence),
    };
  }
  if (q.type === "score") {
    const labels = q.criteria || [];
    let idx = labels.indexOf(a.answer);
    if (idx === -1 && typeof a.answer === "number") idx = a.answer;
    if (idx === -1) idx = 0;
    return {
      score: idx,
      max_score: Math.max(0, labels.length - 1),
      label: labels[idx] ?? null,
      confidence: clamp01(a.confidence),
    };
  }
  const p = clamp01(a.probability ?? a.noul);
  return {
    answer: typeof a.answer === "boolean" ? a.answer : p != null ? p >= 0.5 : null,
    noul: p,
    confidence: clamp01(a.confidence),
  };
}

export async function runMagnitude(state, questions, options = {}) {
  const base = (options.endpoint || getMagnitudeEndpoint()).replace(/\/+$/, "");
  const model = options.model || getMagnitudeModel();
  if (!model) throw new Error("モデルが未選択です。`models` で一覧を取得して `model <id>` で指定してください");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 120000);
  const started = performance.now();

  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Magnitude does not check the key on the local machine; some clients
        // refuse to send none at all.
        Authorization: "Bearer local",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: "You answer typed questions about a state. You always reply with JSON only.",
          },
          { role: "user", content: buildMagnitudePrompt(state, questions) },
        ],
        temperature: 0,
        max_tokens: options.maxTokens || 1024,
        stream: false,
      }),
      signal: controller.signal,
    });

    const bodyText = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}: ${bodyText.slice(0, 400)}`);
    }
    const body = JSON.parse(bodyText);
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error(`想定外の応答形状: ${bodyText.slice(0, 200)}`);
    }

    const parsed = extractJson(content);
    const answers = {};
    for (const [key, q] of Object.entries(questions)) {
      const raw = parsed.answers?.[key];
      if (!raw || typeof raw !== "object") continue;
      answers[key] = toLayaShape(key, q, raw);
    }

    return {
      answers,
      routing: { model: body.model || model },
      meta: {
        engine: "magnitude",
        latency_ms: Number((performance.now() - started).toFixed(1)),
        model: body.model || model,
        endpoint: base,
        calibrated: false,
        usage: body.usage || null,
        disclaimer:
          "生成モデル（Magnitude）の自己申告値です。較正されていないため、laya の確率・信頼度とは比較できません。",
      },
      raw: { content },
    };
  } finally {
    clearTimeout(timer);
  }
}
