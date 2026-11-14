# adversarial-review

cold-read が文章の伝わり方を見るのに対して、adversarial-review はコード・設計・文書の変更の欠陥を探します。作った AI に確かめさせると、作ったときの思い込みのまま読んでしまうため、意図の説明を渡さず、差分と守るべき条件（壊してはいけない計算や権限など）だけを別のエージェントに渡して欠陥を探させます。人は「この PR を adversarial-review して」と頼むだけで、、エージェントがレビュアーを立てて結果を受け取ります。

指摘は「誰が、どんなときに、何で困るか」まで書かせ、マージの前に直すもの（Important）と、マージを止めない細かいもの（Nit）に分けます。AI どうしで直す・レビューするを繰り返すと、Nit を直すたびに次のレビューが新しい Nit を出して終わりません。そこで、直すのにロジックを変える Nit はレビューの途中で手を付けず Issue に回し、Important が 0 になった回で打ち切ります。

## 参考にした資料

cold-read と adversarial-review は、次の資料を読んで手順に取り入れました。

| 資料 | 取り入れた所 |
|---|---|
| Claude Code の docs [Code Review](https://code.claude.com/docs/en/code-review) | 指摘を Important と Nit に分ける線 |
| Claude Code の docs [Create custom subagents](https://code.claude.com/docs/en/sub-agents) | サブエージェントに何が読み込まれるか（cold-read で、読み手に文脈を渡さない方法） |
| claude.dev [How the Claude Code team does code review](https://claude.dev/blog/solving-code-review-at-anthropic/)（2026年10月） | 変更の前からあった欠陥に印を付ける。同じ形の欠陥はまとめて出す。Nit をレビューの途中で直さない |
| Anthropic [Harness design for long-running apps](https://www.anthropic.com/engineering/harness-design-long-running-apps)（2026年3月） | 指摘を受け取る AI は、正しい指摘を「大したことはない」と流しやすい。流した指摘も理由と一緒に残させる |
| Anthropic [Redesigning source control at Anthropic](https://www.anthropic.com/engineering/redesigning-source-control)（2026年10月） | 実際に起こる筋書きを書けない心配に応えて直すと、作りすぎになる。そうした指摘は Nit にする |
| Claude [Building agents: When to fold subagents into your main agent loop](https://claude.com/blog/building-agents-when-to-fold-subagents-into-your-main-agent-loop)（2026年10月） | サブエージェントは、作った本人と文脈を分けたい検証や、指示を読まない読み手のように、分ける理由があるときだけ使う |

## 入れ方

```
npx skills add itoken33/skills -g --skill adversarial-review
```

手順の本文は [SKILL.md](../skills/adversarial-review/SKILL.md) です。入れ方の詳しい説明は [README](../README.md#入れ方) にあります。
