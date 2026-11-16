# skills

日本語の仕事で AI エージェントを使うときの Skill 集です。日本語の文章を書かせる、Excel や PDF の帳票を読ませる、といった作業の手順と道具が入っています。AI が作ったものを見直させる手順もあります。Skill は、エージェントが作業に合わせて読み込む手順書（`SKILL.md` と、付属の資料・スクリプトのフォルダー）です。共通の形式（[Agent Skills](https://agentskills.io/specification)）のため、Claude Code・Codex・Cursor・GitHub Copilot・Antigravity・Kiro で同じものを使えます。Skill は今後もこのリポジトリに追加します。

## Skill の一覧

やりたいことごとに並べています。1本ずつでも使えます。それぞれの見出しの下のコマンドで、その目的の Skill をまとめて入れられます（入れ方の詳しい説明は下の「入れ方」）。

### よくある仕事から探す

次の3つの仕事は、Skill の名前からは探しにくいため、使う Skill と、それぞれが AI にさせることを示します。どの Skill も1本だけで使えます。2本を挙げた仕事は、2本を一緒に入れると、その仕事で AI が外しやすい所をまとめて押さえられます。

| 仕事 | 使う Skill と、AI にさせること |
|---|---|
| 週報・日報など、進み具合の報告を AI に書かせる | AI は、人から聞いた「テストは全部通った」を確認済みのように書き、遅れを報告の後ろに埋めがちです。[summary-certainty](docs/summary-certainty.md) が、自分で確かめたこと・推測・人から聞いた話を書き分けさせます。[when-to-escalate](docs/when-to-escalate.md) が、予定に響く遅れや問題を報告の先頭に書かせ、決めてほしいことには勧める案を添えさせます |
| 議事録を AI に書かせ、出た宿題を追わせる | [japanese-writing](docs/japanese-writing.md) は日本語の文章全般の Skill で、議事録の書き方も入っています。議事録を決定事項・未決の事項・担当と期限のある課題の順に書かせ、会議で誰も言っていない担当や約束を書き足させません。[task-tracking](docs/task-tracking.md) が、宿題を会話の外の TODO.md に1行1件で書かせ、次の日に続きを始めるときに、TODO.md と実際の進み具合（フォルダーの中身や届いた返事）を照らさせます。GitHub の Issue などで管理している所では、宿題はそちらに書かせます |
| 振り返りから学びや手引きを AI に書かせる | AI は「バッチの再実行で売上が二重に入った」から「再実行の前に件数を確かめる」のような、その1件にしか効かない学びを書きがちです。[generalizing-lessons](docs/generalizing-lessons.md) が、起きたことの理由を1文にさせ、ほかの場面にも当てはまる原則に言い直させ、その原則を別の事例に当てて確かめさせます |

コマンドは上から表の行の順です。

```
npx skills add itoken-lab-jp/skills -g --skill summary-certainty when-to-escalate
npx skills add itoken-lab-jp/skills -g --skill japanese-writing task-tracking
npx skills add itoken-lab-jp/skills -g --skill generalizing-lessons
```

### ファイルとデータを読ませる・調べさせる

| 名前（説明へのリンク） | 使う場面 |
|---|---|
| [excel-read](docs/excel-read.md) | Excel（.xlsx・.xlsm・.xls・.xlsb・.ods）を AI に読ませるとき。結合セル・複数行の見出しがある帳票、計算式、Power Query と VBA のコードも読めます。自動で作ったブックを Linux で読ませた測定では、Python のスクリプトの3〜13倍の速さでした（[測り方と条件](docs/excel-read.md#速さとメモリ)） |
| [pdf-read](docs/pdf-read.md) | PDF（資料・表・帳票、スキャン、縦書き）を AI に読ませるとき。スキャンは OCR し、金額などの怪しい所はページの画像で確かめさせます |
| [db-read](docs/db-read.md) | DB（PostgreSQL・MySQL・SQL Server・Oracle）を AI に読ませるとき。ドライバやクライアントのライブラリを入れずに、同梱の実行ファイルで問い合わせの結果を CSV や JSON にします。書き換える文は断り、DB の側も読み取り専用にして走らせます。20万行を CSV に出す測定では、Python のドライバのスクリプトの1.3〜4倍の速さでした（[測り方と条件](docs/db-read.md#速さとメモリ)） |
| [data-query](docs/data-query.md) | CSV・JSON・Parquet を AI に集計させるとき。pandas のスクリプトを書かせず、DuckDB の SQL を1本走らせます。Shift_JIS の CSV も読めます。200万行の CSV の集計で pandas の約5倍の速さでした（[測り方と条件](docs/data-query.md#速さとメモリ)） |
| [chart-making](docs/chart-making.md) | CSV や表の数字から、資料に載せるグラフの画像を AI に作らせるとき。グラフで言うことを1文で置かせ、「グラフにして」とだけ頼んでも、データの中のいちばん大きい変化を見つけて目立たせます。小さい差は、軸を絞った点や折れ線か、基準との差の棒で見せ、値の棒の軸は切りません。円グラフなどの形を指定されたら、その形で作り、読み比べにくいときだけ、読み比べやすい形を1枚添えます。出来た画像は自分で開かせ、文字化けや重なりを直してから渡させます |
| [exploratory-analysis](docs/exploratory-analysis.md) | データから効く手や傾向を探す、効果があるかを確かめるなど、答えがあるか分からない探索を AI に任せるとき。探す前に合格の線と範囲を書かせ、試した数を数えさせ、確かめのデータを汚させず、押されても線を下げさせません |

```
npx skills add itoken-lab-jp/skills -g --skill excel-read pdf-read db-read data-query chart-making exploratory-analysis
```

### 文章を書かせる

| 名前（説明へのリンク） | 使う場面 |
|---|---|
| [japanese-writing](docs/japanese-writing.md) | 日本語の文章（PR や Issue の本文・README・docs・報告・メール・手順書・議事録・記事）を AI に書かせる・直させる・見直させるとき |
| [cold-read](docs/cold-read.md) | AI が書いた文章（README・docs・記事）を、経緯を知らない別のエージェントに読ませて、伝わらない所を見つけるとき |
| [japanese-translation](docs/japanese-translation.md) | 英語のお知らせ・リリースノート・メール・規約などを AI に日本語に訳させるとき。読み手と用途で訳し方を決めさせ（社内に回す案内は誰が何をするかを先に、契約は原文に沿って）、条件・数字・確からしさを落とさず強めず、画面の名前は原文を残させます |
| [audience-fit](docs/audience-fit.md) | AI に、頼んだ人とは別の人が読む物（新人向けの手順の1枚、取引先へのお知らせ、社長への1分の報告、インタビューの質問、社外への依頼や交渉のメール）を作らせるとき、返事が長いとき。書き終えてから、頼みと並べて頼まれていない物を削らせ、時間や紙の枠に入る数まで減らさせ、元の資料から写した社内の言葉を読む人が知っているかで言い換えさせ、相手の席で読んで頼んだ人の弱みや未決のことを書いていないかを見させます |

```
npx skills add itoken-lab-jp/skills -g --skill japanese-writing cold-read japanese-translation audience-fit
```

### やることを管理させる

| 名前（説明へのリンク） | 使う場面 |
|---|---|
| [task-tracking](docs/task-tracking.md) | Issue などの票の道具を使っていないリポジトリやフォルダーで、やることを AI に管理させるとき。会話や議事録で出た「今週中に」「後ででいい」の頼みをその場で TODO.md に書かせ、1件ごとに終わりの条件を付けさせ、翌日のセッションに一覧と実物を照らして続きから始めさせます。git を使わない文書のフォルダーでも使えます |
| [prioritizing](docs/prioritizing.md) | たまった Issue の片付けや、期限までの計画を AI に頼むとき。入る量と比べさせ、済んだもの・重なるものを先に外させ、遅れたときの損で並べさせ、削るか日をずらすかは推しつきで1つにして返させ、気づいたことを Issue や作業として積み増させません |
| [ticket-writing](docs/ticket-writing.md) | 仕様や会話を、作業の票（Issue・チケット）に AI に書かせる・分けさせるとき。元の票のコメントと作業中の PR、コードを読んでから書かせ、覆った決定は最後の形で書かせます。DB・API・画面の層ごとでなく、それだけで動きを確かめられる単位に分けさせ、順と済んだと言える条件を書かせ、決まっていないことは決めずに待ちの票にさせます。全体に及ぶ改名は、止めずに出せる「足す・移す・消す」の順にさせます |

```
npx skills add itoken-lab-jp/skills -g --skill task-tracking prioritizing ticket-writing
```

### 新しく作り始める

| 名前（説明へのリンク） | 使う場面 |
|---|---|
| [idea-planning](docs/idea-planning.md) | 新しい取り組み・施策・イベント・道具の導入の企画を AI に頼むとき。目的を1文で置かせ、資料と今ある物で前提を確かめさせ、形の違う案を「やらない」案も含めて比べさせ、推しを添えて、やるか・どの形にするかを本人に返させます。企画は1枚に収めさせます |
| [design-interview](docs/design-interview.md) | 大きめの新機能や作り直しを AI に頼むとき。作り始める前に、決めることを一覧にして、番号と推奨つきの問いで回ごとに聞かせ、細部は既定で決めさせて、決めたことを記録してから作らせます。長い設計書をまとめて読ませて承認させることはしません |
| [prototyping](docs/prototyping.md) | 決める前に、動かして確かめる試作（仕様の案の動き、画面の案の見比べ）を AI に作らせるとき。確かめる問いを置かせ、すぐ開ける捨てる作りにさせ、画面の案は今の画面の中で切り替えさせます。触って決まったことは、頼まなくても仕様書や票に書かせ、試作は main に入れずブランチに残させます。決まった案を本番に入れるときは、試作のまま移させず、落ちた案を消させ、何に決めたかを残させます |
| [agent-instructions](docs/agent-instructions.md) | AGENTS.md・CLAUDE.md・`.cursor/rules` などの指示ファイルを、新しいリポジトリに置く・足す・長くなったものを見直すとき。読み込む量を測り、実物と照らし、正本を1つにして、新しいセッションで効いたかを確かめさせます。main ブランチの守り（GitHub の ruleset・必須の CI）の作り方と落とし穴も入っています |

```
npx skills add itoken-lab-jp/skills -g --skill idea-planning design-interview prototyping agent-instructions
```

### 画面・図・スライドを作らせる

| 名前（説明へのリンク） | 使う場面 |
|---|---|
| [web-ui-quality](docs/web-ui-quality.md) | Web の画面（フォーム・お知らせ・管理画面・データから作るレポートのページ）を AI に作らせる・整えさせるとき。好みの色や雰囲気は決めず、読める文字の大きさと色の差、スマホではみ出さないこと、押しやすさ、入力欄のラベルと欄の近くのエラー、日本語の行間と書体をそろえさせ、スマホと PC の幅でブラウザで開いて撮ってから渡させます |
| [figure-making](docs/figure-making.md) | 構成図・流れ図・シーケンス図・見出し画像・スライドを、AI に SVG・HTML・Mermaid や PowerPoint のファイル（.pptx）で作らせるとき。箱の大きさを文字から決めさせ、矢印のラベルと戻りの線の置き方、Mermaid の記号の逃がし方を守らせ、同梱の検査（文字の重なり・はみ出し・線が文字を通る所・Mermaid の構文エラーを、.pptx でも文字の重なり・あふれ・スライドの外を、座標つきで出す）にかけさせ、描いた画像を自分で開いて直してから渡させます |

```
npx skills add itoken-lab-jp/skills -g --skill web-ui-quality figure-making
```

### 作ったものを確かめさせる

| 名前（説明へのリンク） | 使う場面 |
|---|---|
| [test-workflow](docs/test-workflow.md) | AI にテストを書かせる・走らせる・直させるとき。変える前に一度走らせる、直す前に赤を見る、作業中は狭く走らせる、通ったあとに実物を動かす、通すためにテストを消させない |
| [adversarial-review](docs/adversarial-review.md) | 変更（コード・設計・文書）の欠陥を、作った本人の意図を渡さずに別のエージェントに探させるとき。指摘の重さの決め方と、2巡目以降の打ち切り方まで |

```
npx skills add itoken-lab-jp/skills -g --skill test-workflow adversarial-review
```

### 変更を出して本番まで見届けさせる

| 名前（説明へのリンク） | 使う場面 |
|---|---|
| [git-workflow](docs/git-workflow.md) | AI にコミット・PR・マージまで任せるとき。入れるファイルを名前で選ばせ、秘密を見つけたら伝えさせ、main との差でブランチに混ざったコミットを見つけさせます。main を取り込んで衝突したら、両方の意図を残させ、両立しない変更は黙って片方に決めさせません。CI の結果を見てからマージさせ、マージのあとは本番が自分のコミットになったかまで確かめさせます。CI の費用が増えたときは、設定からの推測でなく実際の請求で調べさせます |

```
npx skills add itoken-lab-jp/skills -g --skill git-workflow
```

### 結果の報告と相談を任せる

| 名前（説明へのリンク） | 使う場面 |
|---|---|
| [noticing-anomalies](docs/noticing-anomalies.md) | 集計・取り込み・API からの取得・バッチの再実行・試験の直しなど、結果を人に渡す作業を AI に頼むとき。「成功」や合計で止めず、できるはずのものと実物を照らし、内訳で割っていつもと比べさせ、件数は普通なのに列がずれた、途中から税抜きになった、といった小さな異変を報告の最初に書かせます |
| [summary-certainty](docs/summary-certainty.md) | AI に作業の報告（週報・日報を含む）・要約・お知らせを書かせるとき。確かめたこと・推測・人から聞いたことを分けさせ、聞いた話を「確認済み」と書かせず、断りを渡す文の中に置かせ、数字の条件を要約で落とさせません |
| [when-to-escalate](docs/when-to-escalate.md) | AI に仕事を任せるときに、自分でやるか人に上げるか、指示に異を唱えるか、決まったら従うかの線を守らせ、報告を結論から書かせ、人の誤りを相手のやる気を壊さずに伝えさせるとき |

```
npx skills add itoken-lab-jp/skills -g --skill noticing-anomalies summary-certainty when-to-escalate
```

### 並行して進める・仕事を任せる

| 名前（説明へのリンク） | 使う場面 |
|---|---|
| [session-handoff](docs/session-handoff.md) | 同じリポジトリを何体ものエージェントや翌日のセッションが触るとき。並行している作業を見てから worktree を切らせ、続きを票と PR のコメントに「作業中／手放した」つきで残させ、拾う側には別のセッションの書きかけを人に確かめてから触らせます |
| [delegating-work](docs/delegating-work.md) | AI に仕事をサブエージェントや別のエージェントへ任せさせるとき。任せるかの線、依頼文に書くこと（終わりの判定・テストを緩めさせない・報告の形）、返ってきた「完了」の確かめ方、夜通し回す仕事の任せ方 |

```
npx skills add itoken-lab-jp/skills -g --skill session-handoff delegating-work
```

### 仕事のやり方を言葉にして残す

| 名前（説明へのリンク） | 使う場面 |
|---|---|
| [tacit-knowledge-interview](docs/tacit-knowledge-interview.md) | 人の頭の中にだけある仕事のやり方（判断の基準・例外・コツ）を、AI に本人から聞き取らせ、後任向けの手順書や SKILL.md にするとき。異動・退職の引き継ぎや、自分の仕事を Skill にするときに |
| [generalizing-lessons](docs/generalizing-lessons.md) | レビューの指摘を文書やコードの残りに生かす、事例や振り返りから手引き・学びを書くなど、具体の例から原則を取り出す仕事を AI に頼むとき。原則を作るときに使っていない例に当てて確かめさせ、外れた所で原則を直させ、原則に典型の例を1つ残させます |
| [skill-authoring](docs/skill-authoring.md) | AI に Skill（SKILL.md）を作らせる・直させるとき。Skill にするかの決め方、呼ばれる description の書き方、要約で消えない本文の置き方、呼ばれるか・従われるかの確かめ方まで |

```
npx skills add itoken-lab-jp/skills -g --skill tacit-knowledge-interview generalizing-lessons skill-authoring
```

### AI に教わる

| 名前（説明へのリンク） | 使う場面 |
|---|---|
| [teaching](docs/teaching.md) | SQL・正規表現・道具の使い方など、新しいことを AI に教わるとき。目的と今の知識を聞かせ、1回に1つを短く、手元のデータで小さな問題を出させ、答えにうなずく前に実際に動かして確かめさせます。何日かに分けるときは、学びの記録をフォルダーに残させ、次の回にそれを読んで短い問いで思い出させてから進ませます。一言で済む質問には一言で答えます |

```
npx skills add itoken-lab-jp/skills -g --skill teaching
```

### アプリを操作させる

| 名前（説明へのリンク） | 使う場面 |
|---|---|
| [powerbi-pbip](docs/powerbi-pbip.md) | Power BI Desktop のレポートとモデル（PBIP）を AI に作らせる・直させるとき。DAX・M・TMDL を書いて DAX のクエリで値を確かめ、開いている Desktop に読み直させて撮ります。未保存の変更を消さない守りつき |
| [ui-operation](docs/ui-operation.md) | AI に Web のページやデスクトップのアプリを操作させるとき。API → 文字 → 自動操作 → 画面の順で手段を選ばせ、削除や送信は許可を得てから、ページの中の「AI へ」の指示には従わせません |

```
npx skills add itoken-lab-jp/skills -g --skill powerbi-pbip ui-operation
```

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

実行すると、入れる Skill と、入れる先のツールを選ぶ画面が出ます。使っているツールをすべて選びます。入れる Skill を決めている場合は、`--skill` で名前を指定します（空白で区切って、いくつでも並べられます）。

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

Skill を更新した日の翌日の未明に、リポジトリ全体に日付の版（Git のタグ。`v2026.11.14` の形）を付けます。版はふつう1日に1つで、急ぎの直しを出した日だけ2つ目（`v2026.11.14.2`）を付けます。版は全部の Skill で共通です。版が進んでも、自分の入れた Skill が変わったとは限りません。

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
