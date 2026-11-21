# skill-authoring

AI に Skill を書かせると、本文は整っていても、肝心の場面で呼ばれない、呼ばれても手順どおりに動かない、ということが起きます。skill-authoring は、AI に Skill（`SKILL.md` と、その付属のファイル）を作らせる・直させるときに、エージェントが従う手順です。入れておくと、Skill を書くときにエージェントがこの手順を読み、次の2つの外れ方を先に避けます。

- エージェントは毎回、入っている Skill の一覧として、名前と description（`SKILL.md` の先頭の frontmatter に書く短い説明）だけを読み、どれを読み込むか（呼ぶか）を決めます。description に、使う人が頼むときの言葉（「Excel を読んで」など）が無ければ、その Skill は呼ばれません。試した範囲では、Skill が開かれたのは頼みを受け取ってすぐで、「報告する前に読む」のように作業の途中の節目で書いた description は、当たる場面でもほとんど読まれませんでした（15回のうち1回。2026年11月16日、Claude Code）。一覧には量の上限があり、Skill が多いと description の後ろは切られます。
- 会話が長くなってツールが要約（compaction）すると、読み込んだ Skill の本文は先頭の一定量しか戻りません。本文が長いと、後ろに書いた決まりは作業の途中で消えます。

## 使い方

入れたあとは、ふだんどおりに頼みます。

> 毎週の売上の集計のやり方を Skill にして

> この Skill、関係ない頼みでも呼ばれるので直して

エージェントは、SKILL.md の次の順で進めます。

1. Skill にするかを決める。毎回要ることは指示ファイル（CLAUDE.md・AGENTS.md など）に、毎回必ず起きてほしいこと（編集のあとの整形など）はツールのフックや CI に置き、Skill にしない。書く前に、その Skill で済ませたい難しい頼みを1つ、Skill 無しで会話の中で最後までやり、うまくいったやり方を手順に書き起こす
2. description を書く。使う人が実際に言う言葉と扱うファイルの種類を、いちばん多い使い道から先に書く
3. 本文を書く。大事な決まりを上に置き、要約のあとも全文が戻る長さ（500 行・5,000 トークン未満）に収める。細部は Skill のフォルダーの `references/` に、形の検査や数の突き合わせのように答えが1つに決まる確かめはスクリプトにして `scripts/` に分ける
4. 作ったあとに確かめる。新しい会話で言い方を変えた頼みを出し、Skill が呼ばれるか、手順どおりに進むか、Skill が無いときより聞き返しと手戻りが減ったかを見る。呼ばれない・関係ない頼みで呼ばれる（呼ばれすぎる）・従われないときの直し方も、SKILL.md に書いています

Skill の形は、同梱の検査で確かめられます（Node 18 以上だけで動きます）。Skill を並べたフォルダーか、Skill 1つのフォルダーを渡します。

```
node ~/.agents/skills/skill-authoring/scripts/check-skills.mjs ./skills
```

`~/.agents/skills/` は `-g` で入れたときの置き場の一例で、入れた先はツールによって違います。frontmatter の欄と name・description の形、本文の長さ（既定は 6,500 字・500 行。`--max-chars`・`--max-lines` で変えられます）、Skill のフォルダーの README、リンク切れ、SKILL.md から直接指されていない references を見て、問題があればファイルと中身を1行ずつ出し、終了コード 1 で終わります。CI に入れるときは `--json` で結果を JSON にもできます。

数字（description の上限 1,024 字、Claude Code が description を切る位置、一覧の量の上限など）は、2026年11月11日に Agent Skills の仕様と Claude Code・Codex の公式の docs で確かめたものです。出典は [references/sources.md](../skills/skill-authoring/references/sources.md) にあります。ツールの版が上がると変わることがあります。

Claude Code には、Anthropic の公式の skill-creator もあります。Skill の下書きと、Skill を試しに動かして出来を比べる評価ができます。skill-authoring は、Claude Code・Codex・Cursor などのどれにも同じ Skill を入れる前提で書いているため、Claude だけの書き方にはしません。Claude Code を使っているなら、評価を回すところだけ skill-creator を使えます。

この Skill を入れたときと入れないときで、できる Skill の差は測っていません。

## 入れ方

```
npx skills add itoken-lab-jp/skills -g --skill skill-authoring
```

Claude Code・Codex・Cursor・GitHub Copilot・Antigravity に入ります。`-g` は、全部のプロジェクトで使える置き場に入れる指定です。入れ方の詳しい説明は [README](../README.md#入れ方) にあります。

## 変更履歴

- 2026-11-16：本文の書き方に、確かめる問いの並びで足りる Skill は短く書くこと、見分け方の知識は削らないこと、今ある Skill を短くするときは元の場面で比べてから置き換えることを足した
- 2026-11-16：description の書き方に、いつ使うかは頼みを受け取った時点で分かる言葉で書くこと（途中の節目で書くと読まれない）、「手を付ける前に読む」と書く Skill は絞ること（同じ頼みに当たるほかの Skill を読まれなくすることがある）を足した。確かめ方に、ほかの Skill も入った状態で試すことを足した。根拠は、自分で試した数字を足して `references/sources.md` に分けた
- 2026-11-16：`references/sources.md` の言い回しを1か所直した（中身は同じ）
- 2026-11-18：本文の分け方に、references は開かれないことが多いので外すと出来が変わる決まりは本文に置くこと、references は「〜のときは、先に references/〜を読む」といつ開くかを動作で指すことを足した。確かめ方に、references が開かれたかを見ること（中身をプロンプトに入れた試しでは分からない）を足した。根拠と試した範囲は `references/sources.md` に足した。字数に収めるため、理由の文と重なる案内を数か所削った
- 2026-11-19：Skill の形の検査 `scripts/check-skills.mjs`（Node だけで動く）を足した。Skill を並べたフォルダーに走らせると、frontmatter の欄と name・description の形、本文の長さ（既定 6,500 字・500 行）、README の有無、リンク切れ、SKILL.md から2段目の references を見て、問題があれば終了コード 1 で返す。作ったあとの確かめの「形」から、この検査を指した
- 2026-11-21：二通りに読める文を、読み方が1つに決まる形に直した（事情を知らない AI に読ませて挙がった箇所）。主語や指す物の書き足しで、前後から読み取れた意図に合わせた
