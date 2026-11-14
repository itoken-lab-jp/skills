# skills

日本語の仕事で AI エージェントを使うときの Skill 集です。日本語の文章を書かせる、Excel や PDF の帳票を読ませる、といった作業の手順と道具が入っています。AI が作ったものを見直させる手順もあります。Skill は、エージェントが作業に合わせて読み込む手順書（`SKILL.md` と、付属の資料・スクリプトのフォルダー）です。共通の形式（[Agent Skills](https://agentskills.io/specification)）のため、Claude Code・Codex・Cursor・GitHub Copilot・Antigravity・Kiro で同じものを使えます。Skill は今後もこのリポジトリに追加します。

## Skill の一覧

| 名前 | 使う場面 |
|---|---|
| [japanese-writing](skills/japanese-writing/SKILL.md) | 日本語の文章（PR や Issue の本文・README・docs・報告・メール・手順書・議事録・記事）を AI に書かせる・直させる・見直させるとき |
| [excel-read](skills/excel-read/SKILL.md) | Excel（.xlsx・.xlsm・.xls・.xlsb・.ods）を AI に読ませるとき。結合セル・複数行の見出しがある帳票、計算式、Power Query と VBA のコードも読めます |
| [pdf-read](skills/pdf-read/SKILL.md) | PDF（資料・表・帳票、スキャン、縦書き）を AI に読ませるとき。スキャンは OCR し、金額などの怪しい所はページの画像で確かめさせます |
| [cold-read](skills/cold-read/SKILL.md) | AI が書いた文章（README・docs・記事）を、経緯を知らない別のエージェントに読ませて、伝わらない所を見つけるとき |
| [adversarial-review](skills/adversarial-review/SKILL.md) | 変更（コード・設計・文書）の欠陥を、作った本人の意図を渡さずに別のエージェントに探させるとき。指摘の重さの決め方と、2巡目以降の打ち切り方まで |

### japanese-writing

AI が書く日本語は、箇条書きと「**見出し**：説明」の形が多く、文と文をつなぐ接続詞が少なく、話し言葉と書き言葉が混ざります。japanese-writing は、読み手と場面（社内か社外か、メールかチャットか）から文体・順番・長さを決める手順と、こうした形を避ける書き方をエージェントに渡します。

入れる前と後で、変更の記録から作業報告を書かせた例です。

```
入れる前：
- **ブラウザ操作（#104、11/9）**：Web ページを開く・読む・入力する作業の手順。手段の選び方と、ログインや取り消せない操作の扱いを決めた。

入れた後：
11月9日に、Web ブラウザを操作する手順を追加しました。ページを開く手段を選ぶ順序と、ログインや取り消せない操作の扱いを定めています。
```

日本語の文章を書く依頼をすると、エージェントが Skill の説明を見て自動で読み込みます。読み込まれない場合は、依頼に「japanese-writing の Skill を使って」と書きます。

同梱の検査スクリプト `scripts/check.mjs` は、書いた文章のファイルを読み、確認したほうがよい箇所を行番号付きで一覧にします。ファイルは書き換えません。エージェントは Skill の手順に従って実行します。自分で実行する場合は次のとおりです。

```
node skills/japanese-writing/scripts/check.mjs 文章.md
```

### excel-read

AI に Excel を読ませると、Python のライブラリを入れてスクリプトを書き、動かして直す往復が始まります。帳票の形の表（結合セル、2段の見出し、合計の行）は、そのスクリプトでも崩れがちです。excel-read は、Skill に同梱した実行ファイルで Excel を読み、表を CSV や JSON にして渡します。Python や Excel 本体は要りません。

```
excel-read table 売上報告.xlsx --sheet 10月 --header-rows 2
```

結合セルは値を埋め、2段の見出しは「上の見出し/下の見出し」の1つの列名にします。隠した行や、単位の付いた表示形式のように読み違えやすい箇所は、注意として標準エラーに出します。コマンドの一覧は `excel-read --help` で出ます。読めないもの（文字の色や塗り、図形、パスワード付きのファイル）は [references/limits.md](skills/excel-read/references/limits.md) にあります。

同梱の実行ファイルは Windows（x64）・Mac（Apple シリコン）・Linux（x64）の3つです。Rust で書いたソースは [tools/excel-read](tools/excel-read) にあり、実行ファイルにはソースの指紋が入っています。このリポジトリの CI は、指紋がソースと合うことと、3つの OS でダミーの帳票を読めることを確かめています。自分で作り直す場合は [tools/excel-read/build-all.sh](tools/excel-read/build-all.sh) を Linux で実行します。Mac の実行ファイルは、Apple の公証を受けていない署名（ad-hoc 署名）です。ブラウザで zip をダウンロードして展開した場合は、macOS が実行を止めることがあります。

### pdf-read

PDF から文字を取り出すスクリプトを AI に書かせると、表の列や縦書きが崩れがちです。スキャンした PDF は、文字の層（PDF に埋め込まれた文字のデータ）が無いので、取り出しても空になります。pdf-read では、エージェントはスクリプトを書きません。まず PDF に文字の層があるかを調べ、あれば Poppler の `pdftotext -layout` で列の位置を保ったまま読み、無ければページを画像にして tesseract で OCR します。

OCR は日本語の帳票（請求書・伝票・決算の表など）で、マイナスを表す ▲ やカンマをよく誤ります。そこで、tesseract が語ごとに出す確信度が低い語や、`4A410.000` のように形のおかしい数字を拾い、そのページの画像をエージェントが直接見て読み直します。金額・数量・日付・コードは、拾った所が無くても画像と突き合わせます。画像を読めないエージェントでは、確かめていない値をそう書いて報告します。

この Skill には道具が入っていません。Poppler（`pdftotext` や、ページを画像にする `pdftoppm` を含むコマンド群）と tesseract を、エージェントが動く PC に一度入れてください。Windows は winget、Mac は Homebrew、Linux は apt で入ります。日本語の OCR には、標準のデータより精度の高い [tessdata_best](https://github.com/tesseract-ocr/tessdata_best) の `jpn.traineddata` と、縦書き用の `jpn_vert.traineddata` を使います。入れ方と置き場所は [SKILL.md](skills/pdf-read/SKILL.md) の「道具の場所」にあります。

### cold-read

書いた本人の AI は経緯を知っているため、同じ AI に見直させても、説明を省いた言葉が通じるように見えてしまいます。cold-read は、文章の写しだけを、会話も指示ファイル（CLAUDE.md・AGENTS.md など）も読まないサブエージェントに読ませる手順です。読み手には、意味が分からなかった所（「それ何？」）と、自分に何の関係があるか分からなかった所（「だから何？」）を挙げさせます。直したあとは、前の版を見ていない別のサブエージェントに読ませ直します。サブエージェントを立てて読ませ、挙がった所を直すのはエージェントです。人は「この README を cold-read して」と頼むだけです。

### adversarial-review

cold-read が文章の伝わり方を見るのに対して、adversarial-review はコード・設計・文書の変更の欠陥を探します。作った AI に確かめさせると、作ったときの思い込みのまま読んでしまうため、意図の説明を渡さず、差分と守るべき条件（壊してはいけない計算や権限など）だけを別のエージェントに渡して欠陥を探させます。頼み方も同じで、「この PR を adversarial-review して」と頼めば、エージェントがレビュアーを立てて結果を受け取ります。

指摘は「誰が、どんなときに、何で困るか」まで書かせ、マージの前に直すもの（Important）と、マージを止めない細かいもの（Nit）に分けます。AI どうしで直す・レビューするを繰り返すと、Nit を直すたびに次のレビューが新しい Nit を出して終わりません。そこで、直すのにロジックを変える Nit はレビューの途中で手を付けず Issue に回し、Important が 0 になった回で打ち切ります。

この2本は、次の資料を読んで手順に取り入れました。

| 資料 | 取り入れた所 |
|---|---|
| Claude Code の docs [Code Review](https://code.claude.com/docs/en/code-review) | 指摘を Important と Nit に分ける線 |
| Claude Code の docs [Create custom subagents](https://code.claude.com/docs/en/sub-agents) | サブエージェントに何が読み込まれるか（cold-read で、読み手に文脈を渡さない方法） |
| claude.dev [How the Claude Code team does code review](https://claude.dev/blog/solving-code-review-at-anthropic/)（2026年10月） | 変更の前からあった欠陥に印を付ける。同じ形の欠陥はまとめて出す。Nit をレビューの途中で直さない |
| Anthropic [Harness design for long-running apps](https://www.anthropic.com/engineering/harness-design-long-running-apps)（2026年3月） | 指摘を受け取る AI は、正しい指摘を「大したことはない」と流しやすい。流した指摘も理由と一緒に残させる |
| Anthropic [Redesigning source control at Anthropic](https://www.anthropic.com/engineering/redesigning-source-control)（2026年10月） | 実際に起こる筋書きを書けない心配に応えて直すと、作りすぎになる。そうした指摘は Nit にする |
| Claude [Building agents: When to fold subagents into your main agent loop](https://claude.com/blog/building-agents-when-to-fold-subagents-into-your-main-agent-loop)（2026年10月） | サブエージェントは、作った本人と文脈を分けたい検証や、指示を読まない読み手のように、分ける理由があるときだけ使う |

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
npx skills add itoken33/skills -g
```

実行すると、入れる Skill と、入れる先のツールを選ぶ画面が出ます。使っているツールをすべて選びます。1つの Skill だけを入れる場合は、`--skill` で名前を指定します。

```
npx skills add itoken33/skills -g --skill excel-read
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

## 修正の依頼

このリポジトリの Skill は、作者が普段の作業で使っている非公開のリポジトリから書き出しています。修正の依頼は Issue でお知らせください。プルリクエストは直接マージせず、作者の側で反映してから書き出し直します。

## ライセンス

MIT ライセンスです（[LICENSE](LICENSE)）。ほかの人が作ったものを取り入れた所には、それぞれのライセンスの表示を置いています。

- japanese-writing の検査スクリプトは、MIT ライセンスの textlint のルール集から語の一覧を取り入れています（[表示](skills/japanese-writing/scripts/THIRD_PARTY_NOTICES.md)）。
- excel-read の実行ファイルは、Rust のライブラリと、静的にリンクしたランタイム（Rust の標準ライブラリ・musl・mingw-w64）を組み込んでいます（[表示](skills/excel-read/THIRD_PARTY_NOTICES.md)）。
- excel-read の試験に使う `tools/excel-read/fixtures/vba.xlsm` は、calamine の試験ファイルを写したものです（[表示](tools/excel-read/fixtures/LICENSE-calamine.md)）。
