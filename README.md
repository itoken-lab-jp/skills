# skills

日本語の仕事で AI エージェントを使うときの Skill 集です。日本語の文章を書かせる、Excel や PDF の帳票を読ませる、といった作業の手順と道具が入っています。AI が作ったものを見直させる手順もあります。Skill は、エージェントが作業に合わせて読み込む手順書（`SKILL.md` と、付属の資料・スクリプトのフォルダー）です。共通の形式（[Agent Skills](https://agentskills.io/specification)）のため、Claude Code・Codex・Cursor・GitHub Copilot・Antigravity・Kiro で同じものを使えます。Skill は今後もこのリポジトリに追加します。

## Skill の一覧

| 名前（説明へのリンク） | 使う場面 |
|---|---|
| [japanese-writing](docs/japanese-writing.md) | 日本語の文章（PR や Issue の本文・README・docs・報告・メール・手順書・議事録・記事）を AI に書かせる・直させる・見直させるとき |
| [excel-read](docs/excel-read.md) | Excel（.xlsx・.xlsm・.xls・.xlsb・.ods）を AI に読ませるとき。結合セル・複数行の見出しがある帳票、計算式、Power Query と VBA のコードも読めます。自動で作ったブックを Linux で読ませた測定では、Python のスクリプトの3〜13倍の速さでした（[測り方と条件](docs/excel-read.md#速さとメモリ)） |
| [pdf-read](docs/pdf-read.md) | PDF（資料・表・帳票、スキャン、縦書き）を AI に読ませるとき。スキャンは OCR し、金額などの怪しい所はページの画像で確かめさせます |
| [cold-read](docs/cold-read.md) | AI が書いた文章（README・docs・記事）を、経緯を知らない別のエージェントに読ませて、伝わらない所を見つけるとき |
| [adversarial-review](docs/adversarial-review.md) | 変更（コード・設計・文書）の欠陥を、作った本人の意図を渡さずに別のエージェントに探させるとき。指摘の重さの決め方と、2巡目以降の打ち切り方まで |
| [tacit-knowledge-interview](docs/tacit-knowledge-interview.md) | 人の頭の中にだけある仕事のやり方（判断の基準・例外・コツ）を、AI に本人から聞き取らせ、後任向けの手順書や SKILL.md にするとき。異動・退職の引き継ぎや、自分の仕事を Skill にするときに |
| [judgment-lines](docs/judgment-lines.md) | AI に仕事を任せるときに、自分でやるか人に上げるか、指示に異を唱えるか、決まったら従うかの線を守らせ、報告を結論から書かせ、人の誤りを相手のやる気を壊さずに伝えさせるとき |

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
