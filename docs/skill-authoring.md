# skill-authoring

AI に Skill を書かせると、本文は整っていても、肝心の場面で呼ばれない、呼ばれても手順どおりに動かない、ということが起きます。skill-authoring は、AI に Skill（`SKILL.md` と、その付属のファイル）を作らせる・直させるときに、エージェントが従う手順です。入れておくと、Skill を書くときにエージェントがこの手順を読み、次の2つの外れ方を先に避けます。

- エージェントは毎回、入っている Skill の一覧として、名前と description（`SKILL.md` の先頭の frontmatter に書く短い説明）だけを読み、どれを読み込むか（呼ぶか）を決めます。description に、使う人が頼むときの言葉（「Excel を読んで」など）が無ければ、その Skill は呼ばれません。一覧には量の上限があり、Skill が多いと description の後ろは切られます。
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

数字（description の上限 1,024 字、Claude Code が description を切る位置、一覧の量の上限など）は、2026年11月11日に Agent Skills の仕様と Claude Code・Codex の公式の docs で確かめたものです。出典は [SKILL.md](../skills/skill-authoring/SKILL.md) の末尾にあります。ツールの版が上がると変わることがあります。

Claude Code には、Anthropic の公式の skill-creator もあります。Skill の下書きと、Skill を試しに動かして出来を比べる評価ができます。skill-authoring は、Claude Code・Codex・Cursor などのどれにも同じ Skill を入れる前提で書いているため、Claude だけの書き方にはしません。Claude Code を使っているなら、評価を回すところだけ skill-creator を使えます。

この Skill を入れたときと入れないときで、できる Skill の差は測っていません。

## 入れ方

```
npx skills add itoken-lab-jp/skills -g --skill skill-authoring
```

Claude Code・Codex・Cursor・GitHub Copilot・Antigravity に入ります。`-g` は、全部のプロジェクトで使える置き場に入れる指定です。入れ方の詳しい説明は [README](../README.md#入れ方) にあります。

## 変更履歴

- 2026-11-16：本文の書き方に、確かめる問いの並びで足りる Skill は短く書くこと、見分け方の知識は削らないこと、今ある Skill を短くするときは元の場面で比べてから置き換えることを足した
