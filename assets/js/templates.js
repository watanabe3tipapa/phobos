/**
 * Question templates for the Laya sandbox.
 * Shapes match the `laya-serve` POST /v1/systemone schema.
 *
 * choice: criteria is an object of { key: description }
 * score:  criteria is an ordered array of scale labels
 * noul:   boolean question, no criteria
 */

export const TEMPLATES = [
  {
    id: "email-triage",
    icon: "mail",
    name: "メール振り分け",
    description: "サポート受信箱の自動振り分け。部門・緊急度・解約リスクをまとめて判定。",
    kind: "email",
    stateSample: `From: watanabe3tipapa@example.com
Subject: 3月分の請求が二重でございます

こんにちは。3月分の請求書が二重で請求されています。昨日の午後にも同じ金額の明細が
表示されました。Duplicate charge on invoice #4411. If this is not refunded today
we will cancel our plan.`,
    questions: {
      department: {
        type: "choice",
        instructions: "Which department should handle this request?",
        criteria: {
          billing: "invoices, payments, refunds, charges",
          technical: "bugs, outages, system errors",
          sales: "pricing, plans, new contracts",
          other: "everything else",
        },
      },
      urgency: {
        type: "score",
        instructions: "How urgent is this request?",
        criteria: ["not urgent", "within a week", "within 24 hours", "blocking"],
      },
      churn_risk: {
        type: "noul",
        instructions: "Does the customer threaten to cancel or leave?",
      },
      refund_requested: {
        type: "noul",
        instructions: "Does the customer explicitly request a refund?",
      },
    },
  },
  {
    id: "phishing",
    icon: "shield",
    name: "フィッシング検知",
    description: "疑わしいメールをガードレールで判定。危険度と自動ブロックの必要性を返す。",
    kind: "raw",
    stateSample:
      "From: IT-Support <it-support@micros0ft-login.com>\nSubject: URGENT: Your mailbox will be closed in 24 hours\n\nDear user, we detected unusual activity on your account.\nVerify immediately at http://micros0ft-login.com/verify or your\nmailbox will be permanently deleted.\n\nIT Support Team",
    questions: {
      is_phishing: {
        type: "noul",
        instructions: "Is this message a phishing or social engineering attempt?",
      },
      threat_level: {
        type: "score",
        instructions: "How severe is the harm if the recipient acts on this?",
        criteria: ["benign", "suspicious", "clearly deceptive", "credential theft"],
      },
      should_block: {
        type: "noul",
        instructions: "Should this message be blocked or quarantined automatically?",
      },
      spoofed_domain: {
        type: "noul",
        instructions: "Does the sender domain impersonate a well-known brand?",
      },
    },
  },
  {
    id: "support-priority",
    icon: "ticket",
    name: "サポート優先度",
    description: "チケットのトリアージ。重大度・再現性・顧客影響・SLAリスクを判定。",
    kind: "raw",
    stateSample:
      "Ticket #4471: Checkout page returns HTTP 500 for all Safari 17 users.\nStarted right after the 14:02 deploy. Estimated revenue impact 12k EUR/hour.\nReproducible 10 out of 10 attempts in production. Rollback not attempted yet.\nOn-call engineer is 4 hours away.",
    questions: {
      severity: {
        type: "choice",
        instructions: "How severe is this incident?",
        criteria: {
          sev1: "full outage or revenue loss, many users",
          sev2: "degraded, workaround exists",
          sev3: "one feature broken, few users",
          sev4: "cosmetic or minor",
        },
      },
      reproducible: {
        type: "noul",
        instructions: "Is the issue reliably reproducible?",
      },
      customer_impacting: {
        type: "noul",
        instructions: "Are paying customers directly impacted?",
      },
      sla_breach_risk: {
        type: "noul",
        instructions: "Is there a risk of missing an SLA deadline?",
      },
    },
  },
  {
    id: "guardrail",
    icon: "alert",
    name: "AIガードレール",
    description: "LLMの回答ログを検査。ブロック可否と害のカテゴリを判定。",
    kind: "raw",
    stateSample:
      "Sure, here is how to make the compound. Step 1: obtain the precursor\nchemicals listed below. Step 2: heat under reflux for three hours.\nNote that this mixture reacts violently with ammonia and produces a\ntoxic gas, so keep the windows wide open.",
    questions: {
      should_block: {
        type: "noul",
        instructions: "Should this response be blocked before reaching the user?",
      },
      harmful_category: {
        type: "choice",
        instructions: "Which harm category best applies?",
        criteria: {
          none: "safe, ordinary content",
          chemistry: "unsafe chemical or explosive instructions",
          cyber: "malware or intrusion assistance",
          harassment: "abusive or threatening content",
          medical: "self-harm or medical danger",
        },
      },
      needs_human_review: {
        type: "noul",
        instructions: "Does this need a human reviewer before release?",
      },
    },
  },
  {
    id: "invoice",
    icon: "invoice",
    name: "請求処理",
    description: "請求書・経費精算の自動判定。支払区分・重複・閾値超過を判定。",
    kind: "json",
    stateSample: `{
  "invoice_no": "INV-2024-04411",
  "vendor": "Acme Cloud Services KK",
  "amount_jpy": 348000,
  "due": "2024-04-15",
  "po_number": "PO-99120",
  "line_items": [
    { "desc": "Compute instance A3 x 720h", "amount_jpy": 312000 },
    { "desc": "Egress 4.2TB", "amount_jpy": 36000 }
  ]
}`,
    questions: {
      payment_action: {
        type: "choice",
        instructions: "What should happen to this invoice?",
        criteria: {
          auto_approve: "within policy, PO matched, under threshold",
          approve: "valid but needs a second approver",
          hold: "missing PO or contract mismatch",
          reject: "duplicate or invalid",
        },
      },
      duplicate: {
        type: "noul",
        instructions: "Does this look like a duplicate of a previously paid invoice?",
      },
      over_threshold: {
        type: "noul",
        instructions: "Is the amount above the 300,000 JPY auto-approval threshold?",
      },
      complexity: {
        type: "score",
        instructions: "How much manual review does this invoice need?",
        criteria: ["trivial", "light", "moderate", "heavy"],
      },
    },
  },
  {
    id: "sentiment",
    icon: "chart",
    name: "感情・満足度",
    description: "レビューやサポート会話の感情分析。強度と投诉の有無を判定。",
    kind: "raw",
    stateSample:
      "The new dashboard is a genuine improvement, load times dropped noticeably.\nOne complaint: the export button still fails silently when the date range\nexceeds a year. Otherwise very happy with this update, the new filters\nare exactly what we needed.",
    questions: {
      sentiment: {
        type: "choice",
        instructions: "What is the overall sentiment?",
        criteria: {
          positive: "satisfied, praise",
          neutral: "factual, no clear lean",
          negative: "unsatisfied, complaints",
        },
      },
      intensity: {
        type: "score",
        instructions: "How strongly is the sentiment expressed?",
        criteria: ["mild", "moderate", "strong", "very strong"],
      },
      has_complaint: {
        type: "noul",
        instructions: "Does the text contain an unresolved complaint?",
      },
      mentions_feature_request: {
        type: "noul",
        instructions: "Does the user request a new feature?",
      },
    },
  },
  {
    id: "multilingual",
    icon: "globe",
    name: "多言語ルーティング",
    description: "言語自動検出のデモ。日本語・英語・ヒンディー語を同じ質問で判定。",
    kind: "raw",
    stateSample:
      "मुझसे मार्च में दो बार शुल्क लिया गया, कृपया डुप्लिकेट राशि वापस करें। अन्यथा हम अपनी योजना रद्द कर देंगे।",
    questions: {
      script_family: {
        type: "choice",
        instructions: "Which script is this text written in?",
        criteria: {
          latin: "Latin alphabet, including English",
          devanagari: "Devanagari",
          han: "Chinese or Japanese characters",
          cyrillic: "Cyrillic",
          arabic: "Arabic",
        },
      },
      topic: {
        type: "choice",
        instructions: "What is this message about?",
        criteria: {
          billing: "invoices, payments, refunds",
          technical: "bugs and outages",
          account: "login, permissions, profile",
          other: "everything else",
        },
      },
      is_urgent: {
        type: "noul",
        instructions: "Is the sender demanding immediate action?",
      },
    },
  },
  {
    id: "custom",
    icon: "plus",
    name: "カスタム",
    description: "ゼロから質問セットを組み立てる。",
    kind: "raw",
    stateSample: "ここに状態テキストを貼り付けてください。",
    questions: {},
  },
];

export function getTemplate(id) {
  return TEMPLATES.find((t) => t.id === id) || TEMPLATES[TEMPLATES.length - 1];
}

/** Normalized question list, used for validation and rendering. */
export function normalizeQuestions(questions) {
  return Object.entries(questions || {}).map(([key, q]) => ({
    key,
    type: q.type,
    instructions: q.instructions || "",
    criteria: q.criteria,
  }));
}

/** Validation errors keyed by question name, plus __form for whole-form issues. */
export function validateQuestions(questions) {
  const errors = {};
  const entries = normalizeQuestions(questions);

  if (entries.length === 0) {
    errors.__form = "質問が 1 つもありません。テンプレートを選ぶか、追加してください。";
    return errors;
  }

  for (const q of entries) {
    const problems = [];
    if (!/^[A-Za-z0-9_]+$/.test(q.key)) {
      problems.push("キーは英数字とアンダースコアのみ");
    }
    if (!["choice", "score", "noul"].includes(q.type)) {
      problems.push("型は choice / score / noul のいずれか");
    }
    if (!q.instructions.trim()) {
      problems.push("instructions が空");
    }
    if (q.type === "choice") {
      if (Array.isArray(q.criteria)) problems.push("choice の criteria はオブジェクト形式");
      else if (!q.criteria || typeof q.criteria !== "object") problems.push("criteria が未設定");
      else if (Object.keys(q.criteria).length < 2) problems.push("choice は選択肢が 2 つ以上必要");
    }
    if (q.type === "score") {
      if (!Array.isArray(q.criteria)) problems.push("score の criteria は配列が必要");
      else if (q.criteria.length < 2) problems.push("score は段階が 2 つ以上必要");
      else if (q.criteria.some((c) => !String(c).trim())) problems.push("空の段階があります");
    }
    if (problems.length) errors[q.key] = problems.join(" / ");
  }
  return errors;
}
