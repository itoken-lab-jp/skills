# skills

日本語の仕事で AI エージェントを使うときの Skill 集です。日本語の文章を書かせる、Excel や PDF の帳票を読ませる、といった作業の手順と道具が入っています。AI が作ったものを見直させる手順もあります。Skill は、エージェントが作業に合わせて読み込む手順書（`SKILL.md` と、付属の資料・スクリプトのフォルダー）です。共通の形式（[Agent Skills](https://agentskills.io/specification)）のため、Claude Code・Codex・Cursor・GitHub Copilot・Antigravity・Kiro で同じものを使えます。Skill は今後もこのリポジトリに追加します。

## Skill の一覧

| 名前（説明へのリンク） | 使う場面 |
|---|---|
| [japanese-writing](docs/japanese-writing.md) | 日本語の文章（PR や Issue の本文・README・docs・報告・メール・手順書・議事録・記事）を AI に書かせる・直させる・見直させるとき |
| [excel-read](docs/excel-read.md) | Excel（.xlsx・.xlsm・.xls・.xlsb・.ods）を AI に読ませるとき。結合セル・複数行の見出しがある帳票、計算式、Power Query と VBA のコードも読めます。自動で作ったブックを Linux で読ませた測定では、Python のスクリプトの3〜13倍の速さでした（[測り方と条件](docs/excel-read.md#速さとメモリ)） |
| [db-read](docs/db-read.md) | DB（PostgreSQL・MySQL・SQL Server・Oracle）を AI に読ませるとき。ドライバやクライアントのライブラリを入れずに、同梱の実行ファイルで問い合わせの結果を CSV や JSON にします。書き換える文は断り、DB の側も読み取り専用にして走らせます。20万行を CSV に出す測定では、Python のドライバのスクリプトの1.3〜4倍の速さでした（[測り方と条件](docs/db-read.md#速さとメモリ)） |
| [pdf-read](docs/pdf-read.md) | PDF（資料・表・帳票、スキャン、縦書き）を AI に読ませるとき。スキャンは OCR し、金額などの怪しい所はページの画像で確かめさせます |
| [data-query](docs/data-query.md) | CSV・JSON・Parquet を AI に集計させるとき。pandas のスクリプトを書かせず、DuckDB の SQL を1本走らせます。Shift_JIS の CSV も読めます。200万行の CSV の集計で pandas の約5倍の速さでした（[測り方と条件](docs/data-query.md#速さとメモリ)） |
| [powerbi-pbip](docs/powerbi-pbip.md) | Power BI Desktop のレポートとモデル（PBIP）を AI に作らせる・直させるとき。DAX・M・TMDL を書いて DAX のクエリで値を確かめ、開いている Desktop に読み直させて撮ります。未保存の変更を消さない守りつき |
| [cold-read](docs/cold-read.md) | AI が書いた文章（README・docs・記事）を、経緯を知らない別のエージェントに読ませて、伝わらない所を見つけるとき |
| [adversarial-review](docs/adversarial-review.md) | 変更（コード・設計・文書）の欠陥を、作った本人の意図を渡さずに別のエージェントに探させるとき。指摘の重さの決め方と、2巡目以降の打ち切り方まで |
| [test-workflow](docs/test-workflow.md) | AI にテストを書かせる・走らせる・直させるとき。変える前に一度走らせる、直す前に赤を見る、作業中は狭く走らせる、通ったあとに実物を動かす、通すためにテストを消させない |
| [skill-authoring](docs/skill-authoring.md) | AI に Skill（SKILL.md）を作らせる・直させるとき。Skill にするかの決め方、呼ばれる description の書き方、要約で消えない本文の置き方、呼ばれるか・従われるかの確かめ方まで |
| [tacit-knowledge-interview](docs/tacit-knowledge-interview.md) | 人の頭の中にだけある仕事のやり方（判断の基準・例外・コツ）を、AI に本人から聞き取らせ、後任向けの手順書や SKILL.md にするとき。異動・退職の引き継ぎや、自分の仕事を Skill にするときに |
| [judgment-lines](docs/judgment-lines.md) | AI に仕事を任せるときに、自分でやるか人に上げるか、指示に異を唱えるか、決まったら従うかの線を守らせ、報告を結論から書かせ、人の誤りを相手のやる気を壊さずに伝えさせるとき |
| [research-discipline](docs/research-discipline.md) | データから効く手や傾向を探す、効果があるかを確かめるなど、答えがあるか分からない探索を AI に任せるとき。探す前に合格の線と範囲を書かせ、試した数を数えさせ、確かめのデータを汚させず、押されても線を下げさせません |
| [summary-certainty](docs/summary-certainty.md) | AI に作業の報告・要約・お知らせを書かせるとき。確かめたこと・推測・人から聞いたことを分けさせ、聞いた話を「確認済み」と書かせず、断りを渡す文の中に置かせ、数字の条件を要約で落とさせません |
| [prioritizing](docs/prioritizing.md) | たまった Issue の片付けや、期限までの計画を AI に頼むとき。入る量と比べさせ、済んだもの・重なるものを先に外させ、遅れたときの損で並べさせ、削るか日をずらすかは推しつきで1つにして返させ、気づいたことを Issue や作業として積み増させません |
| [delegating-work](docs/delegating-work.md) | AI に仕事をサブエージェントや別のエージェントへ任せさせるとき。任せるかの線、依頼文に書くこと（終わりの判定・テストを緩めさせない・報告の形）、返ってきた「完了」の確かめ方、夜通し回す仕事の任せ方 |
| [agent-instructions](docs/agent-instructions.md) | AGENTS.md・CLAUDE.md・`.cursor/rules` などの指示ファイルを、新しいリポジトリに置く・足す・長くなったものを見直すとき。読み込む量を測り、実物と照らし、正本を1つにして、新しいセッションで効いたかを確かめさせます。main ブランチの守り（GitHub の ruleset・必須の CI）の作り方と落とし穴も入っています |
| [ui-operation](docs/ui-operation.md) | AI に Web のページやデスクトップのアプリを操作させるとき。API → 文字 → 自動操作 → 画面の順で手段を選ばせ、削除や送信は許可を得てから、ページの中の「AI へ」の指示には従わせません |
| [design-interview](docs/design-interview.md) | 大きめの新機能や作り直しを AI に頼むとき。作り始める前に、決めることを一覧にして、番号と推奨つきの問いで回ごとに聞かせ、細部は既定で決めさせて、決めたことを記録してから作らせます。長い設計書をまとめて読ませて承認させることはしません |
| [session-handoff](docs/session-handoff.md) | 同じリポジトリを何体ものエージェントや翌日のセッションが触るとき。並行している作業を見てから worktree を切らせ、続きを票と PR のコメントに「作業中／手放した」つきで残させ、拾う側には別のセッションの書きかけを人に確かめてから触らせます |

### サブエージェントの定義（agents/）

サブエージェントの定義は、名前・使える道具・最初に読む指示を書いた Markdown のファイルです。[agents](agents) に、cold-read の読み手 `cold-reader` と、adversarial-review のレビュアー `readonly-reviewer` を置いています。どちらも道具をファイルを読むことだけに絞っているため、読み手やレビュアーがファイルを書き換えたり、指示ファイルの文脈を持ち込んだりしません。Skill の手順がこの名前を指すので、置いておけばエージェントがその定義で立てます。

定義は `npx skills add` では入りません。下の表で、使うツールのフォルダーにある2つのファイルを右の列の場所へ置きます。新しい会話から読み込まれます。

| ツール | コピーするファイル | 置き場 |
|---|---|---|
| Claude Code | `agents/claude/` の2つ | `~/.claude/agents/` |
| Kiro | `agents/kiro/` の2つ | `~/.kiro/agents/` |
| Antigravity | `agents/antigravity/` の2つ | `~/.gemini/config/agents/`（Antigravity は Gemini の設定のフォルダーを使います） |

Codex は、定義でサブエージェントの道具を読み取りだけに絞れないため、定義を置いていません。Codex では定義なしで2本の Skill を使えます。その場合、エージェントは会話を引き継がない新しいサブエージェントを立てて頼み、書き換えないことは依頼文で伝えます。

## 入れ方

[skills](https://github.com/vercel-labs/skills)（Vercel が公開している、Skill を各ツールに入れる CLI）で入れます。実行には Node.js が必要です。

```
npx skills add itoken-lab-jp/skills -g
```

実行すると、入れる Skill と、入れる先のツールを選ぶ画面が出ます。使っているツールをすべて選びます。1つの Skill だけを入れる場合は、`--skill` で名前を指定します。

```
npx skills add itoken-lab-jp/skills -g --skill excel-read
```

`-g` を付けると、全部のプロジェクトで使える置き場（ホームフォルダーの下）に入ります。チームでリポジトリごとに共有する場合は、`-g` を付けずにリポジトリのフォルダーで実行し、できたフォルダー（`.agents/skills/` など）をコミットします。

2026年11月に skills 1.8.1 で、Claude Code・Codex・Cursor・GitHub Copilot・Antigravity の置き場に入ることを確認しました。入ったあとは、ツールで新しい会話を始めると読み込まれます。

CLI を使わない場合は、このリポジトリをクローンし、`skills/<名前>` のフォルダーを使うツールの置き場にコピーします。

| ツール | 全部のプロジェクトで使う置き場 |
|---|---|
| Claude Code | `~/.claude/skills/` |
| Codex・Cursor・GitHub Copilot | `~/.agents/skills/` |
| Antigravity | `~/.gemini/config/skills/` |
| Kiro | `~/.kiro/skills/` |

`~` はホームフォルダーです（Windows では `C:\Users\<ユーザー名>`）。

### 版と更新

Skill を更新して公開するたびに、リポジトリ全体に日付の版（Git のタグ。`v2026.11.14` の形で、同じ日の2回目からは `v2026.11.14.2`・`.3`）を付けます。版は全部の Skill で共通です。版が進んでも、自分の入れた Skill が変わったとは限りません。

- 版ごとに何が変わったかは [Releases](https://github.com/itoken-lab-jp/skills/releases) にあり、Skill ごとに並べたものは [docs](docs) の各ページの末尾の「変更履歴」にあります。
- 更新のあとで設定を移す・入れ直すといった作業が要る変更は、その版の Releases の本文の先頭に「移行が要る変更」として書きます。更新する前に見てください。

上の手順のように版を指定せずに入れた Skill は、`npx skills update` を実行したときに、その時点の main の最新に上がります（自動では上がりません）。`-g` で入れたものは `npx skills update -g`、リポジトリごとに入れたものはそのフォルダーで `npx skills update -p` です。

版を固定する場合は、リポジトリ名のあとに `@` と版を付けて入れます。版の名前は Releases で調べます。`--skill` を付けなければ、全部の Skill をその版で入れます。

```
npx skills add itoken-lab-jp/skills@v2026.11.14 -g --skill excel-read
```

固定した Skill は `update` を実行しても上がりません。別の版にするときは、版を変えて同じコマンドをもう一度実行します（消さずに上書きされます）。固定をやめるときは、`@` と版を付けずにもう一度実行します。

## 修正の依頼

このリポジトリの Skill は、作者が普段の作業で使っている非公開のリポジトリから書き出しています。修正の依頼は Issue でお知らせください。プルリクエストは直接マージせず、作者の側で反映してから書き出し直します。

## ライセンス

MIT ライセンスです（[LICENSE](LICENSE)）。ほかの人が作ったものを取り入れた所には、それぞれのライセンスの表示を置いています。

- japanese-writing の検査スクリプトは、MIT ライセンスの textlint のルール集から語の一覧を取り入れています（[表示](skills/japanese-writing/scripts/THIRD_PARTY_NOTICES.md)）。
- excel-read の実行ファイルは、Rust のライブラリと、静的にリンクしたランタイム（Rust の標準ライブラリ・musl・mingw-w64）を組み込んでいます（[表示](skills/excel-read/THIRD_PARTY_NOTICES.md)）。
- db-read の実行ファイルは、Rust のライブラリ（Oracle の oracledb、手直しした mysql を含む）と、静的にリンクしたランタイム（Rust の標準ライブラリ・musl・mingw-w64）を組み込んでいます（[表示](skills/db-read/THIRD_PARTY_NOTICES.md)）。
- excel-read の試験に使う `tools/excel-read/fixtures/vba.xlsm` は、calamine の試験ファイルを写したものです（[表示](tools/excel-read/fixtures/LICENSE-calamine.md)）。
