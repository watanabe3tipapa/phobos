# DEV-MEMO

phobos の実装内容と判断の記録です。利用者が読むのは [README.md](README.md)（日本語）と [README_en.md](README_en.md) が担当し、こちらは「なぜこの形になっているか」を残すための開発者メモです。

- 最終更新: 2026-10-02（commit `dfa0ad4` の時点）
- 対象: 静的サイト 3 ページ + GitHub Pages 自動デプロイ
- バージョン: `0.1.0`（`package.json`）

---

## 1. プロジェクトの骨格

laya（確率つき意思決定モデル）を紹介・試遊・設計解説する静的サイト。bundler なし、フレームワークなし、ビルドは Node によるファイルのコピーだけ。

| ページ | 役割 |
|---|---|
| `index.html` | 紹介 LP。生成ではなく確率を返すこと、チェックポイントと性能、3 つの型、他ページへの導線 |
| `demo.html` | 試遊 Sandbox。入力・質問・結果・コンソールの 4 ペイン |
| `laya_uiux_guide.html` | 実装者向け UI/UX 設計ガイド。3 つの UX 課題、3 カラムレイアウト、インタラクション、実装のポイント |

コンソールのコマンド一覧は `demo.html` 遷移後に `help` で見るか、`README.md` のコンソールリファレンスを参照する。

依存は `@wterm/{core,dom}` 0.5.4 のみ。ターミナルライブラリだけを持ち込み vendoring して、ブラウザから直接 ES Modules で読み込む。

```
npm ci
npm run vendor:check   # vendored コピーの乖離を検出
npm run build          # dist/ を生成
npm run serve          # dist/ をローカル配信
```

---

## 2. ファイルマップ

```
phobos/
├── index.html / demo.html / laya_uiux_guide.html
├── assets/
│   ├── css/  base.css doc.css lp.css play.css
│   ├── js/
│   │   ├── play.js       UI 全体（入力・質問・結果・ゲート表示）
│   │   ├── engine.js     3 エンジンの client、型正規化、storage
│   │   ├── console.js    wterm 上のコマンド REPL
│   │   └── templates.js  8 テンプレート（質問定義とサンプル状態）
│   └── vendor/wterm/     @wterm 0.5.4 の vendored コピー + manifest.json
├── tools/
│   ├── build.mjs         dist/ の組み立て
│   └── vendor-wterm.mjs  vendoring と --check（sha256 ベース）
├── .github/workflows/pages.yml
├── LICENSE               Apache-2.0
├── README.md / README_en.md
└── DEV-MEMO.md           本ファイル
```

`dist/` は `.gitignore` 済み。Pages は Actions が push ごとに生成する。

---

## 3. エンジン設計

`assets/js/engine.js` は 3 種のエンジンを同じ `choice / score / noul` 質問集合に対して動かす。UI 側はエンジンを意識しない。

| エンジン | endpoint | 性質 |
|---|---|---|
| `mock` | なし（ブラウザ内の決定論的ヒューリスティック） | ネットワーク不要。動作確認用。実験結果には使えない |
| `laya` | `http://localhost:8000/v1/systemone` | 較正済みの確率。信頼度ゲートを適用 |
| `magnitude` | `http://127.0.0.1:10100/inference/v1` | OpenAI 互換のテキスト生成。返る確率は自己申告値で未較正 |

### 3.1 質問型

回答空間はリクエスト時に定義する。利用者に型を覚えさせる必要がない。

| 型 | 返すもの | 例 |
|---|---|---|
| `choice` | 全選択肢の確率分布 | 部門振り分け |
| `score` | 各段階にみなされる確率 | 緊急度 |
| `noul` | P(true) | 解約の意思 |

`assets/js/templates.js` に 8 件。`email-triage` / `phishing` / `support-priority` / `guardrail` / `invoice` / `sentiment` / `multilingual` / `custom`。

### 3.2 信頼度ゲート（`CONFIDENCE_GATE = 0.85`）

`assets/js/play.js` の `renderResults` 内で `meta.engine === "magnitude"` を先に分岐する。

- `laya`: 信頼度が閾値未満なら「自動判定を保留し人手確認を推奨」の警告
- `magnitude`: **ゲートを適用しない**。`自己申告の信頼度 91%（較正なし・閾値判定の対象外）` とだけ表示する

これは意図的な作り。生成モデルの自己申告値を laya と同じ物差しで測ると、UI が推測を信頼度のように見せてしまう。laya の 95% と magnitude の 95% は別の意味なので、同じ軸に並べない。

### 3.3 Magnitude との API 契約

`GET {base}/models` → `{ data: [{ id }] }`（`body` が配列でも可）

`POST {base}/chat/completions` → `choices[0].message.content` に JSON 文字列。プロンプトで要求する形を明示している。

```json
{"answers":{"<key>":{"answer":<string|boolean>,"confidence":<number>,"distribution":{...},"probability":<number>}}}
```

`choice` は全選択肢の `distribution`、`noul` は `probability` が必要。`extractJson` はコードフェンスや前置きを許容して JSON だけを取り出す。

---

## 4. コンソール

`assets/js/console.js` の `help` に出ている全コマンド。

| コマンド | 動作 |
|---|---|
| `run` / `curl` | 実行 / 実 API の curl を出力 |
| `templates` / `template <id>` | 一覧 / ロード |
| `state` / `state <text>` | 状態の表示 / 差し替え |
| `questions` | 現在の質問集合をダンプ |
| `tokens` | 512 トークン予算との比較 |
| `engine` / `engine mock\|laya\|magnitude` | 確認 / 切替 |
| `endpoint [url\|reset]` | 確認 / 設定 / リセット |
| `models` / `model <id>` | Magnitude のモデル一覧 / 選択 |
| `json` / `clear` | 最終結果を JSON で / クリア |

`Ctrl/⌘ + ↵` は `analyze()` のショートカット。ただし wterm の textarea 内ではターミナル側が modified key として処理するため、`run` を使う。

storage キー。

| キー | 用途 |
|---|---|
| `phobos.laya.engine` | 選択中のエンジン |
| `phobos.laya.endpoint` | laya の URL |
| `phobos.magnitude.endpoint` | Magnitude の URL |
| `phobos.magnitude.model` | 選択中のモデル |

---

## 5. ビルドとデプロイ

`.github/workflows/pages.yml`。`main` への push で自動実行。

```
checkout → setup-node 22 → npm ci → vendor:check → build → configure-pages → upload → deploy
```

`vendor:check` を CI に入れているのは、vendored コピーが `node_modules` と乖離したまま公開されるのを防ぐため。`assets/vendor/wterm/manifest.json` に sha256 を持たせており、ファイルが直接編集されると失敗する。

### 5.1 Pages 初回作成の注意

`GITHUB_TOKEN` は Pages サイトの**初回作成**ができない。初めて push したときは `configure-pages` が失敗する。対処は次の一手。

```sh
gh api -X POST repos/watanabe3tipapa/phobos/pages -f build_type=workflow
```

作成したあと Actions を rerun する。2 回目以降は成功する。現在は `build_type=workflow`。

### 5.2 ビルド対象

`tools/build.mjs` の `INCLUDE_FILES` と `INCLUDE_DIRS` で決まる。

```
.nojekyll  index.html  demo.html  laya_uiux_guide.html
README.md  README_en.md  LICENSE  assets/
```

---

## 6. ライセンス

- phobos 本体: **Apache-2.0**（`LICENSE`、著作権 2026 watanabe3tipapa）
- `@wterm/{core,dom}` 0.5.4: **Apache-2.0**（`assets/vendor/wterm/*/LICENSE` に同梱）

上流のライセンス本文を `tools/vendor-wterm.mjs` が手動でコピーしている。ベンダリング後もライセンス表示を落とさないこと。

---

## 7. 検証状況

最終検証: **Playwright 1.49.1 + axe-core 4.13.0、36 項目 PASS / 0 FAIL**（console error 0 / page error 0）。

下の 2 つのスイートは**リポジトリに含まれない**。作業用の一時領域で実行したもので、コミットするときの参照先にならない（理由は 7.1）。

| スイート | 内容 | 結果 |
|---|---|---|
| `suite.js` ※未収録 | axe（3 ページ × 3 viewport で 9 件）、JS エラー、mock e2e、エンジン切替と storage、ゲートの静的検査 | 25 PASS / 0 FAIL |
| `mag.js` ※未収録 | Magnitude 結合（契約・警告・ゲート・コンソール） | 11 PASS / 0 FAIL |

- viewport: 390×844 / 768×1024 / 1440×900
- axe: WCAG 2.0/2.1 の A と AA、serious と critical の違反 0
- 動的に確認できた挙動: 4 問のレンダリング、結果 HTML 4,658 bytes、`mock engine` と `→ multilingual` タグ、`laya` 切替の永続化と `aria-pressed`、Magnitude のモデル一覧 2 件の取得と選択の永続化、`uncalibrated` タグ（`live` を出さない）、未較正警告とゲート非適用の表示

### 7.1 テストをリポジトリに置いていない理由

2026-10-02 の判断: **置かない**。

- Playwright は大型のブラウザバイナリを含むため、依存を増やさない
- macOS 13 の環境では最新 Playwright が動かないため、検証環境の pin を合わせる運用が必要になる
- 静的サイトであり、変更の検証は build と vendor:check と目視で足りる

スイートは作業用の一時領域に置いており、リポジトリには含まれない。再検証する場合は同じ手順をやり直す。恒久的にするなら `devDependencies` の追加と `npm test` の整備が必要なので、そのときは別途合意する。

### 7.2 検証中に判明した注意点

Magnitude 結合テストのフェイクサーバには、**CORS ヘッダと正しいレスポンス形の両方**が必要。

- `access-control-allow-origin` が無いと `fetch` がブラウザでブロックされ、CORS エラーになる
- 返り値は `{ answers: { key: { answer, confidence, distribution } } }` である必要。`{ confidence, distribution }` を直で返すと `normalizeResult` が `confidence: null` になり、ゲート非適用の表示が出ない

どちらも実装側の不具合ではなく、テスト側の準備不足だった。

### 7.3 引用数値の検算（2026-10-02）

上流 [BENCHMARKS.md](https://github.com/NandhaKishorM/laya/blob/main/BENCHMARKS.md) と突き合わせて確認済み。我々の文書が引用している値はすべて一致する。

| 指標 | 我々の記載 | 上流の値 |
|---|---:|---:|
| typed-decisions（特化後） | 0.766 | 0.766 |
| typed-decisions（同梱 base） | 0.362 | 0.362 |
| typed-decisions（ランダム） | 0.318 | 0.318 |
| ECE（温度較正後） | 0.081 | 0.081 |
| ECE（Jev） | 0.246 | 0.246 |
| 1 問 p50（T4） | 32.8 ms | 32.8 ms |
| 10 問バッチ（T4） | 72.3 ms | 72.3 ms |

**`Jev` は誤字ではない。** 第三者の製品名で、上流のベンチマークに `Jev 1.13.0 (published)` として記載がある。`README.md`・`README_en.md`・`index.html`・`laya_uiux_guide.html` の 7 箇所の "Jev" はいずれも正当なので、**誤字として修正しないこと**。数値は第三方公開値であり、我々自身的測定ではない（この点は README のドキュメント節に明記済み）。

なお `index.html` の `<title>` は「33ms」と丸めているが、本文とガイドは 32.8 ms。2026-10-02 に `<title>` も 32.8 ms に揃えた。

---

## 8. 判断の記録

### 8.1 用語は Sandbox に統一

公開コミットに "Playground" は存在しない。初回 commit `5e5dfbf` の時点で "Sandbox" 表記であり、README・HTML・JS のいずれにも "playground" は残っていない（`git grep -i playground` で 0 件）。

ファイル名 `demo.html` と `assets/js/play.js` はそのまま残した。公開 URL とファイル構成を壊さないためで、表示文言だけが Sandbox 表記に揃っている。

### 8.2 README の構成

`watanabe3tipapa/quarto-plus` の構成を参照して全面再編。バッジ、クイックリンク、対応表、番号付き手順、連絡先を追加。日英で数値・URL 集合・テーブルを一致させた。英語版にも `[日本語]` のリンクを置いている（CJK を含むのは言語切替のラベルとして意図的なもの）。

### 8.3 表記のルール

- 算用数字と日本語単位の間は全角スペース 1 個（`3 つ`、`3 つの型`、`1 質問あたり`）
- `tools/vendor-wterm.mjs` のライセンスコメントは Apache-2.0。wterm 0.5.4 の実際のライセンスが Apache-2.0 であることと揃えている
- `README_en.md` の CJK 文字は言語切替リンクの `日本語` の 1 箇所のみ。これは意図的なもので、英文本文に日本語は混在させない

コミット済みのファイルに既知の誤字は残っていない。

---

## 9. 既知の残タスク

いずれも動作に影響しない。

| 内容 | 状態 |
|---|---|
| `actions/deploy-pages@v4` が Node.js 20 非推奨警告を出す | デプロイは成功する。v5 への更新は未検証なので保留 |
| README の Version バッジが releases を指す | Release が 0 件。最初の release 作成時に整合する |
| テストがリポジトリにない | 意図的（7.1 参照） |
| `dist/assets/.DS_Store` が出ることがある | `.gitignore` 済み。`tools/build.mjs` での除外は任意 |

---

## 10. 公開状態

`https://watanabe3tipapa.github.io/phobos/`（`main` から自動デプロイ）

2026-10-02 の確認時点で以下がすべて HTTP 200。

```
/  /demo.html  /laya_uiux_guide.html  /LICENSE  /README.md  /README_en.md
```
