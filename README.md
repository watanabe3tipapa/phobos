# phobos

**テキストは生成しない。確率と信頼度だけを、ひとつの画面へ。**

[laya](https://github.com/NandhaKishorM/laya) は確率つきの意思決定モデルです。生成 AI と違い、回答を文章として書き出すのではなく、質問に対して型つきの答えと確率分布だけを返します。phobos はその性質を、紹介・試遊・設計ガイドの 3 ページで説明します。

[![License](https://img.shields.io/badge/License-Apache%202.0-yellow.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-v0.1.0-blue.svg)](https://github.com/watanabe3tipapa/phobos/releases)
[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-live-blue.svg)](https://watanabe3tipapa.github.io/phobos/)
[![GitHub](https://img.shields.io/github/issues/watanabe3tipapa/phobos.svg)](https://github.com/watanabe3tipapa/phobos/issues)

[日本語](README.md) | [English](README_en.md)

**クイックリンク:** [公開サイト](https://watanabe3tipapa.github.io/phobos/) · [Sandbox](https://watanabe3tipapa.github.io/phobos/demo.html) · [UI/UX 設計ガイド](https://watanabe3tipapa.github.io/phobos/laya_uiux_guide.html) · [コンソールリファレンス](#コンソールリファレンス) · [honest limits](#正直な限界)

## コンセプト

### なぜ「文」ではなく「確率」なのか

生成 AI は読み取れる文章を返します。しかしその文章をどの程度信用すべきかは、本文だけからは読み取れません。判断の根拠として使えるのは、別の数字としての確率です。

laya はこの違いを設計で埋めます。

- 回答空間をリクエスト時に定義する。選択肢をあとから足しても再学習が要らない
- 各選択肢の `[MASK]` マーカー位置を個別にスコアリングし、その位置だけで softmax する
- 生成しない。文の解析も、幻覚も出現しない

学習は **RLCD**（Reinforcement Learning for Calibrated Decisions）です。報酬に厳密妥当なスコアリング規則を使うため、期待報酬を最大化する举動は「確率を正直に報告すること」そのものです。モデルにも、利用側の UI にも、推測を隠すインセンティブが構造的に存在しません。

つまり phobos が描く UI は、答えを隠すためではありません。**確率と信頼度を隠さないため**です。

### 3 つの型

回答空間はリクエスト時に決まるので、利用者に型を覚えさせる必要はありません。実装も利用側も、3 つのプリミティブに収まります。

| 型 | 返すもの | 用途 |
|---|---|---|
| `choice` | 全選択肢の確率分布 | 振り分け、分類、ガードレール |
| `score` | 各段階にみなされる確率 | 緊急度、深刻度、複雑さ |
| `noul` | P(true) | 解約の意思、意図の判定 |

3 つの型のうち `score` は最も弱いプリミティブです（SST-5 で 0.372）。`noul` は `false:` / `true:` という固定ラベルで表現されるため、英語チェックポイントでは状態ではなくラベルに従った答えを返し、明らかに肯定的な入力に「否定」という答えを確信ありで返すことが報告されています（[issue #156](https://github.com/NandhaKishorM/laya/issues/156)）。`noul` の回答が固定的に見える場合は、中立キーを持つ 2 選択肢の `choice` に置き換えて確認してください。

### confidence gating

信頼度が閾値を下回る回答を、自動判定から外して人手確認へ回します。既定の閾値は 0.85 です。

laya 本体の confidence はエントロピー正規化で定義されています。

```
confidence = 1 - H(p) / log(k)
```

`H(p)` は確率分布 `p` のエントロピー、`k` は選択肢数です。分布が鋭いほど confidence は高くなります。モデルカードによれば、**生の状態では過信に傾きます**。温度スケーリングによって平均 ECE が 0.466 から 0.081 まで下がるため、確率を実用として使うなら自分のデータで再較正してから信頼してください。

なお `action.act_probability` は現在ほぼ 1.0 を返し、判別力に乏しく実用的ではありません（AUROC 0.30）。gate の根拠になるのは `confidence` のみです（AUROC 0.77）。

## 主な特徴

### 3 ページ構成

| 営み | phobos の対応物 |
|---|---|
| 答え|score で「緊急度は？」と尋ね、段階ごとの確率を得る |
| 振り分け| `choice` で候補を並べ、分布と最有力を選ぶ |
| 判定|`noul` で P(true) を 1 つの数字で得る |
| 信用できない答えを止める | confidence gating（既定 0.85）で人手確認へ回す |
| 自分で確かめる | Sandbox の 3 エンジン切替とコンソール |
| UI にする| 7 章の UI/UX 設計ガイド |

ファイル構成:

| ファイル | 内容 |
|---|---|
| `index.html` | 紹介 LP。3 つのプリミティブ、較正、速度、多言語、限界、導入手順 |
| `demo.html` | Sandbox。状態入力、質問設計、結果表示の 3 カラム。wterm コンソール付き |
| `laya_uiux_guide.html` | 確率と信頼度を UI に出すための設計ガイド（7 章） |

### 3 つの推論エンジン

Sandbox のエンジンは切り替えられます。3 つとも同じ画面、同じ操作で動きます。

| エンジン | 接続先 | 既定値 | 出力 | 較正 |
|---|---|---|---|---|
| `mock`（既定） | なし。ブラウザ内で完結 | なし | 決定論的ヒューリスティック | なし |
| `laya` | `POST /v1/systemone` | `http://localhost:8000/v1/systemone` | 型つき確率 | あり（温度較正は利用者側の責任） |
| `magnitude` | `POST /inference/v1/chat/completions` | `http://127.0.0.1:10100/inference/v1` | 生成モデルによる自己申告値 | なし |

既定値は `assets/js/engine.js` の定数で、`endpoint` コマンドでいつでも変更できます。

**`mock` は実験結果には使えません。** ネットワークに出ず、同じ入力には常に同じ値を返すだけなので、レイテンシ表示も含めて実測ではありません。検証やベンチマークは必ず `laya` エンジンで行ってください。UI とコンソールには、その旨が常に出ています。

**`magnitude` は比較用です。** テキスト生成エンジンに同じ質問を送り、`confidence` と `distribution` を自己申告させています。返ってきた数字は較正されていないため、laya の確率とは比較できません。選んだ場合のみ、結果の先頭に警告、`uncalibrated` タグ、0.85 ゲートの不適用を表示します。

### その他の機能

- テンプレート 8 種。不正な質問セットを送信前に検出して弾く
- 状態はテキスト、ファイルドロップ、JSON のいずれでも投入できる
- トークン計器。状態の概算トークン数を|English チェックポイントにおける 1 質問あたりの上限 512 トークン|と照合し、超過すると末尾が切れることを事前に知らせる
- JSON と CSV のエクスポート、コピー
- 生レスポンスの表示

### コンソール

`demo.html` の端末は装飾ではありません。現在の状態をそのまま操作できる実コンソールで、入力欄の変更、テンプレートの差し替え、推論、エンジン切替までコマンドで操作できます。wterm 0.5.4 を同梱しており、CDN には依存しません。

## ブラウザで試す

リポジトリを clone しなくても、[公開サイトの Sandbox](https://watanabe3tipapa.github.io/phobos/demo.html) でそのまま触れます。既定の `mock` エンジンならバックエンドも API キーも不要です。

1. 状態テキストを貼り付ける（またはファイルをドロップする）
2. テンプレートを選ぶ
3. `Analyze` を実行する
4. 確率と信頼度を見て、エクスポートする

実モデルを繋ぐ場合も画面は同じです。下の「実モデルと接続する」を参照してください。

## インストールとビルド

### 前提条件

| ツール | 必要バージョン | 確認コマンド |
|---|---:|---|
| Node.js | 22（開発・CI で確認済み） | `node --version` |
| npm | 同梱の npm でよい | `npm --version` |
| Python | >= 3.10（`laya` を使う場合のみ） | `python3 --version` |
| Git | 任意（デプロイ・貢献時） | `git --version` |

依存パッケージは wterm の取り込みにだけ使います。実行時の CDN 依存はありません。

### 基本的な手順

1. リポジトリを取得

```bash
git clone https://github.com/watanabe3tipapa/phobos.git
cd phobos
```

2. 依存をインストールしてビルド

```bash
npm ci
npm run build
npm run serve      # http://localhost:4173/
```

bundler は通りません。`npm run build` は公開対象を `dist/` に抜き出すだけです。

```
index.html ・ demo.html ・ laya_uiux_guide.html ┐
assets/css/（base / lp / play / doc）            ├→ build.mjs → dist/ → GitHub Pages
assets/js/（engine / templates / play / console）┘
assets/vendor/wterm/  … npm から取り込んだ実体（Apache-2.0）
```

### 主要コマンド

| コマンド | 用途 |
|---|---|
| `npm run build` | `dist/` を生成する |
| `npm run serve` | 生成後に `dist/` を `:4173` でプレビューする |
| `npm run vendor` | `@wterm/{core,dom}` を `assets/vendor/wterm/` へ取り込み直す |
| `npm run vendor:check` | 同梱版と `package.json` の pin・SHA の一致を検査する（CI でも実行） |

### 公開

`main` ブランチへの push で自動デプロイします。ワークフローは `npm ci` → `npm run vendor:check` → `npm run build` → Pages アップロード、の順です。ルート直下で配信されるため、ベースパスの書き換えは不要です。

初回のみ、リポジトリの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** に設定してください。

## 実モデルと接続する

### laya

[laya-serve](https://pypi.org/project/laya/) は Router を Jev 互換の HTTP サーバーとして公開します。`POST /v1/systemone` の形式は TypeSafe Jev と同じなので、既存クライアントはベース URL の変更だけで動きます。Jev は第三者の製品名です（[Jev について](#jev-について) を参照）。

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

| 環境変数 | 既定値 | 意味 |
|---|---|---|
| `LAYA_DEVICE` | 自動 | 実行デバイス（`cuda` / `cpu` / `mps`） |
| `LAYA_PRELOAD` | 有効 | 起動時にチェックポイントをまとめて読み込む |
| `LAYA_MODELS` | 空 | 使用するモデル。`english` / `multilingual` / `typed-decisions` で個別に固定できる |
| `LAYA_API_KEY` | 未設定 | 設定すると `Authorization: Bearer <key>` が必須になる |
| `LAYA_THREADS` | 自動 | 推論スレッド数 |
| `LAYA_MAX_CONCURRENT` | 自動 | 同時実行数の上限。超過時は `503` |

`model` を指定しない場合は Router がスクリプトと言語を判定して自動で選びます。接続確認は `GET /health` を使ってください（`loaded` / `revisions` / `device` が返ります）。既定で `0.0.0.0` にバインドし、`LAYA_API_KEY` を設定しない限り認証はありません。ローカル以外から公開する場合は必ず認証を設定してください。

入力バジェットは英語チェックポイントで 1 質問あたり 512 トークン（選択肢に 192、状態に約 320）、多言語チェックポイントで 1024 トークン（選択肢に 256、状態に約 768）です。選択肢の head は固定枠なので、77 選択肢の質問では 1 ラベルあたり 3〜4 トークンしか確保できず、精度が急落します（Banking77 で 0.425）。50 以上の選択肢を 1 問にまとめる場合は、`head_max_len` を上げるか、段階的な 2 段 `choice` に分割してください。

> `laya-serve` という名前の別パッケージは PyPI で deprecated かつ読み取り専用で、保守は終了しています。上記のように `laya[serve]` から入れてください。旧パッケージの接頭辞は `LAYA_SERVE_` で、統合版は `LAYA_` です。

### Magnitude

[Magnitude](https://github.com/magnitudedev/magnitude) は、オープンウェイトのモデルを自分のデバイスで動かす推論エンジンです。カーネルを自分のハードウェアに合わせてコンパイルし、微調整できます。Apache-2.0 です。

Sandbox からは公開されている **OpenAI 互換 API** に直接接続します。

```bash
# モデルはデスクトップアプリで取得します
# サーバーはデスクトップアプリ、または次のコマンドで起動
magnitude serve
```

| 項目 | 値 |
|---|---|
| Base URL | `http://127.0.0.1:10100/inference/v1` |
| モデル一覧 | `GET /inference/v1/models` |
| 推論 | `POST /inference/v1/chat/completions`（`stream: false`） |
| 応答の本文 | `choices[0].message.content` |
| API キー | 同一マシンのクライアントは不要 |

```bash
curl http://127.0.0.1:10100/inference/v1/models
```

操作手順は 3 つです。

1. エンジン切替で `Magnitude` を選ぶ
2. 一覧更新を押すか、コンソールで `models` を実行する
3. `model <id>` で実行するモデルを指定してから `run` を実行する

**この出力は実験結果に使えません。** テキスト生成エンジンが自己申告した数字であり、較正されていないためです。実装は、magnitude を選んだ場合だけ結果先頭に警告、`live` ではなく `uncalibrated` タグ、0.85 ゲートの不適用を表示します。同じ質問に対する「生成」と「較正された決定」の差を見る比較用としてお使いください。

### CORS の扱い

`laya-serve` にはオリジンを許可する環境変数がありません。`demo.html` はブラウザから直接サーバーを叩くため、必ず別オリジンのリクエストになります。

1. **ローカルの検証だけ**: CORS チェックを無効にしたブラウザで動かす（`google-chrome --disable-web-security`）。無効にすると同一オリジンの制約がすべて外れ、他のサービスの認証情報が読み取れる恐れがあります。専用プロファイルで使い、終わったら必ず閉じてください
2. **常用する場合**: `laya-serve` の前に CORS を許可するリバースプロキシを置く
3. **根本対応**: 静的サイトと推論を同一オリジンで配信する

公開済みページの URL は HTTPS ですが、`http://localhost` への通信は許可されます。`localhost` は信頼された origin とみなされ、mixed content としてブロックされないからです。ただし `localhost` は自分のマシンからしか見えません。別の端末から公開サイトを開いた場合、実推論には接続できません（`mock` は動きます）。また `http://192.168.0.10:8000` のような平文のリモートホストは HTTPS ページから読み込めません。

## 自分のデバイスで動かすときの注意

### 動かないときの早見表

| 症状 | 原因 | 対処 |
|---|---|---|
| `demo.html` が真っ白になる | `file://` で直接開いている | HTTP 経由で開く |
| `Failed to resolve module specifier` | 同じく `file://` | 同上 |
| `terminal failed to start` | wterm の WASM 初期化に失敗 | ブラウザのコンソールを確認。GPU 依存はない |
| `npm run vendor:check` が `not installed` で止まる | `node_modules` が無い、または pin と不一致 | `npm ci` |
| `laya` で `Failed to fetch` | サーバーが動いていない | `curl localhost:8000/health` を確認 |
| `laya` で CORS エラー | オリジン不一致 | 上の「CORS の扱い」を参照 |
| `magnitude` で「接続失敗」 | Magnitude が起動していない、またはモデル未取得 | デスクトップアプリを開くか `magnitude serve` を実行して一覧を更新 |
| `magnitude` で「モデルが未選択です」 | モデル ID 未指定 | `models` で取得し、`model <id>` で指定 |
| Copy が反応しない | クリップボード権限、または非セキュアコンテキスト | `http://localhost` 経由で開く |
| フォントの見え方が変わる | Google Fonts に到達できない | 仕様。ローカルフォントへフォールバック |
| エンジン選択が消える | origin が変わった、または保存データを消去した | origin はポートごとに独立 |

### HTTP サーバー経由で必ず開く

`demo.html` は ES Modules と import map を使っているため、`file://` では動きません。Finder のダブルクリックや `open index.html` ではモジュール読み込みが拒否されてページが白くなります。

```bash
npm run build && npm run serve    # http://localhost:4173/
```

`python3 -m http.server 4173` や VS Code の Live Server でも構いません。

### ブラウザに保存される設定

選択したエンジン、エンドポイント、Magnitude のモデル ID は `localStorage` に保存されます。

| キー | 内容 |
|---|---|
| `phobos.laya.engine` | 選択中のエンジン |
| `phobos.laya.endpoint` | laya-serve の URL |
| `phobos.magnitude.endpoint` | Magnitude の Base URL |
| `phobos.magnitude.model` | 実行に使う Magnitude のモデル ID |

- origin ごとに独立しています。`localhost:4173` と `localhost:4174`、公開ページの URL では別々の値です
- プライベートブラウズでは `localStorage` が使えない場合があり、その場合はその場限りの設定で動きます
- 初期状態に戻すには、ブラウザの保存データを消すか、コンソールで `endpoint reset` を実行します

### オフラインで使う

- `mock` エンジンはネットワークなしで完結します。wterm の WASM も同梱ファイルから読み込むため、追加のダウンロードはありません
- 実推論は自分のマシン上のサーバーが要りますが、外部への通信は発生しません
- 例外はフォントだけです。3 ページとも Google Fonts を `<link>` で読み込みます。到達できない場合は `Hiragino Kaku Gothic ProN` などにフォールバックします

### 編集してはいけない場所

| 場所 | 理由 | 正しい手順 |
|---|---|---|
| `assets/vendor/wterm/` | 自動生成。`npm run vendor` が作り直す | `package.json` の pin を変えて `npm run vendor` |
| `dist/` | ビルド生成物。コミット対象外 | `npm run build` |
| vendor 内の `manifest.json` | 同期検査の台帳 | `npm run vendor` が上書きする |

## コンソールリファレンス

| コマンド | 内容 |
|---|---|
| `help` / `?` | コマンド一覧 |
| `run` / `predict` | 現在の状態で推論する |
| `curl` | 実 API を叩くコマンドを表示する |
| `templates` | テンプレート一覧 |
| `template <id>` | テンプレートをエディタに読み込む |
| `state` / `state <text>` | 状態テキストの表示 / 差し替え |
| `questions` | 現在の質問セットをダンプする |
| `tokens` | 512 トークン予算に対する概算 |
| `engine` | 現在のエンジンとエンドポイントを表示する |
| `engine mock\|laya\|magnitude` | エンジンを切り替える |
| `endpoint` / `endpoint <url>` / `endpoint reset` | 実 API の URL を表示 / 設定 / 既定値に戻す |
| `models` | Magnitude のモデル一覧を取得する |
| `model <id>` | 実行に使う Magnitude モデルを指定する |
| `json` | 直近の実行を JSON で出力する |
| `clear` | 画面を消去する |

キー操作は `↑` / `↓` で履歴、`Ctrl+U` / `Ctrl+K` で削除、`Ctrl+L` で消去、入力欄にフォーカスがある状態での `Ctrl/⌘+Enter` で推論です。

## 正直な限界

[Laya モデルカード](https://huggingface.co/convaiinnovations/laya)が示している「Honest Limits」のまとめです。Sandbox で得られる答えと混同しないでください。

- **ゼロショットでは弱く、特化してから使うものです。** 同梱チェックポイントは typed-decisions ベンチマークで 0.362 であり、ランダムに答えた場合の 0.318 も、多数決の 0.461 も下回ります。0.766 は同じベンチマークの訓練スプリットで fine-tune した `laya-typed-decisions` の値です。laya はゼロショットの意思決定エンジンではなく、専門化するための土台です
- **選択肢が多いと崩れる。** head は固定トークン枠なので、50 以上の選択肢は 1 問にまとめないこと
- **`score` が最も弱い。** SST-5 で 0.372
- **`noul` はラベルに従う。** `false:` / `true:` の表現に強く影響されます
- **初期状態では過信です。** 温度較正によって ECE が 0.466 から 0.081 まで改善します
- **`action.act_probability` は使えない。** ほぼ 1.0 を返し、AUROC 0.30
- **英語チェックポイントは英語専用。** それ以外は `laya-multilingual` を使う

## ドキュメント

初心者は次の順で読むと全体像が把握しやすいです。

1. [紹介 LP](https://watanabe3tipapa.github.io/phobos/) — 3 つのプリミティブ、較正、多言語、性能、限界
2. [Sandbox](https://watanabe3tipapa.github.io/phobos/demo.html) — 確率つきの出力を手で触る。3 エンジン切替とコンソール付き
3. [UI/UX 設計ガイド](https://watanabe3tipapa.github.io/phobos/laya_uiux_guide.html) — 確率と信頼度を見せる設計指針（7 章）

本リポジトリと上記の 3 ページで引用している数値は、[Laya モデルカード](https://huggingface.co/convaiinnovations/laya) と [BENCHMARKS.md](https://github.com/NandhaKishorM/laya/blob/main/BENCHMARKS.md) に基づきます。

実装の背景・設計判断・検証結果の記録は [DEV-MEMO.md](https://github.com/watanabe3tipapa/phobos/blob/main/DEV-MEMO.md) にあります。

### Jev について

> Jev は第三者の製品名です（誤字ではありません）。上流のベンチマークでは `Jev 1.13.0 (published)` と記載されています。当リポジトリが Jev として引用している数値（ECE 0.246、typed-decisions 0.727、banking77 0.870、順序ローバストネス 0.13）はすべて**公開済みの第三者の値**であり、当方では測定していません。TypeSafe API へのアクセスがないため、サンプル数・プロンプト・温度較正の条件も laya 側と同一ではありません。同一条件での比較ではない点に注意してください。

## コントリビューション

コントリビューションは歓迎します。大きな変更を行う前に [Issue](https://github.com/watanabe3tipapa/phobos/issues) を立てて相談してください。一般的な手順:

1. リポジトリをフォーク
2. 機能ブランチを作成 (`git checkout -b feature/your-feature`)
3. 変更をコミット (`git commit -m 'Add your feature'`)
4. ブランチをプッシュし、Pull Request を作成

`assets/vendor/wterm/` は手編集せず、`package.json` の pin を変えて `npm run vendor` を実行してください。`npm run vendor:check` が CI で同期を検査します。

## 連絡先

- GitHub: https://github.com/watanabe3tipapa/phobos
- 公開サイト: https://watanabe3tipapa.github.io/phobos/

## ライセンス

Apache-2.0 ライセンス — 詳細はリポジトリの [LICENSE](LICENSE) ファイルを参照してください。同梱の wterm 0.5.4 と laya も Apache-2.0 です。
