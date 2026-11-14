# agent-skills-ja

AI エージェントに日本語の文章を書かせるときに使う Skill 集です。Skill は、エージェントが作業に合わせて読み込む手順書（`SKILL.md` と、付属の資料・スクリプトのフォルダー）です。共通の形式（[Agent Skills](https://agentskills.io/specification)）のため、Claude Code・Codex・Cursor・GitHub Copilot・Antigravity・Kiro で同じものを使えます。Skill は今後もこのリポジトリに追加します。

## Skill の一覧

| 名前 | 使う場面 |
|---|---|
| [japanese-writing](skills/japanese-writing/SKILL.md) | 日本語の文章（PR や Issue の本文・README・docs・報告・メール・手順書・議事録・記事）を AI に書かせる・直させる・見直させるとき |

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

## 入れ方

[skills](https://github.com/vercel-labs/skills)（Vercel が公開している、Skill を各ツールに入れる CLI）で入れます。実行には Node.js が必要です。

```
npx skills add itoken33/agent-skills-ja -g
```

実行すると、入れる Skill と、入れる先のツールを選ぶ画面が出ます。使っているツールをすべて選びます。`-g` を付けると、全部のプロジェクトで使える置き場（ホームフォルダーの下）に入ります。チームでリポジトリごとに共有する場合は、`-g` を付けずにリポジトリのフォルダーで実行し、できたフォルダー（`.agents/skills/` など）をコミットします。

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

MIT ライセンスです（[LICENSE](LICENSE)）。japanese-writing の検査スクリプトは、MIT ライセンスの textlint のルール集の語の一覧を取り入れています。その表示は [THIRD_PARTY_NOTICES.md](skills/japanese-writing/scripts/THIRD_PARTY_NOTICES.md) にあります。
