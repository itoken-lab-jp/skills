# 根拠

2026-11-27 に、下のページを読んで確認した。中身は要約で、原文の引用ではない。論文は本文の一部と要旨で確認したもので、通しでは読んでいない。

## 論文

1. Alley, M., & Neeley, K. A. (2005). Rethinking the design of presentation slides: A case for sentence headlines and visual evidence. *Technical Communication*, 52(4), 417–426. 名前の見出しと箇条書きの型に代えて、2行までの主張の見出しと、それを支える図の型（assertion-evidence）を勧める。SKILL.md の 5。[書誌](https://pure.psu.edu/en/publications/rethinking-the-design-of-presentation-slides-a-case-for-sentence-/)
2. Garner, J. K., & Alley, M. (2013). How the design of presentation slides affects audience comprehension: A case for the assertion-evidence approach. *International Journal of Engineering Education*, 29(6), 1564–1579. 工学の学生 110 人で、語りと中身を同じにして2つの型を比較した。主張の見出しと図の型のほうが、論述の点が高く（d=0.81）、誤解が少なく、1週間後の想起も高かった。限界：題材は1つ（MRI の仕組み）、事前の知識に群の差があった。SKILL.md の 5 の型を、好みでなく理解の差で選ぶ根拠。[本文](https://www.ijee.ie/articles/Vol29-6/23_ijee2791ns.pdf)、[研究の一覧](https://writing.engr.psu.edu/research.html)（同じ一覧に、主張の見出しで作った発表者のほうが自分でも中身をよく理解した、という 2013 年の学会の報告がある）
3. Yue, C. L., Bjork, E. L., & Bjork, R. A. (2013). Reducing verbal redundancy in multimedia learning: An undesired desirable difficulty? *Journal of Educational Psychology*, 105(2), 266–277. 画面の文字が語りとそっくり同じだと、思い出せる量が落ちた（実験1、105 人）。語りを短くした要約の文字は、文字なしより良かった。学ぶ側は、そっくり同じ文を好んだ（好みと成績が逆）。SKILL.md の 5 の「話す文をそのまま並べない、要約にする」。[本文](https://sites.lifesci.ucla.edu/psych-bjorklab/wp-content/uploads/sites/13/2016/07/YueBjorkBjork2013_redundancy.pdf)
4. Mayer, R. E. の multimedia learning の原則（2009 の本の要約で確認した）：余計なものを除く（coherence）、大事な所に印を付ける（signaling）、語りと同じ文字を追加しない（redundancy）、説明の文字は図の該当の近くに置く（spatial contiguity）、先に言葉を教える（pre-training）。SKILL.md の 3 の言葉の説明と、5 の強調・文字の置き場。[Dartmouth の要約](https://services.dartmouth.edu/TDClient/1806/Portal/KB/PrintArticle?ID=171655)

## 論文でない出どころ（実務の解説）

- **映す資料と配る資料を分ける**：用途が違えば別のデッキにする。映す版のノートに説明を書いて配る版にする手もある。Duarte 社の説明。[The slides you deliver versus the slidedoc you leave behind](https://www.duarte.com/blog/the-slides-you-deliver-versus-the-slidedoc-you-leave-behind/)
- **3秒で分かるか**：スライドの要点が3秒で伝わるかを見る（Glance Test）。Duarte 社。[The Glance Test](https://www.duarte.com/resources/guides-tools/the-glance-test/)
- **聞き手のいま → こじれ → 問い → 答え**：SCQA（Barbara Minto）。[解説](https://managementconsulted.com/scqa-framework/)
- **見出しだけを順に読んで話が通るか**：コンサルの資料作りの確認方法（headline test、horizontal logic）。研究ではない。
- **1分に約 300 字**：日本語の話す速さの目安として広く言われる数字。出どころの一次資料は確認していない。
- **余白を 8 の倍数に、入れ子の角丸は 外 ＝ 中 ＋ すき間**：画面のデザインシステムの考え方。[Material 3 の角丸の段](https://m3.material.io/styles/shape/corner-radius-scale)、[The Math Behind Nesting Rounded Corners](https://cloudfour.com/thinks/the-math-behind-nesting-rounded-corners/)
- **箇条書きの体言止め**：立場が2つある。そろえて使う側は、体言止めか用言止めのどちらかに統一する（混在は見た目が悪く理解しにくい）。飯田英明「[箇条書きスライドは体言止めか用言止めで統一する](https://nakayamashoten.jp/wordpress/conf-presen/7th/)」。避ける側は、周りに補う文脈が無い箇条書きでは曖昧になる（した・する・すべきが分からない）、時制が分からない、とする。杉野幹人『超・箇条書き』の[抜粋](https://diamond.jp/articles/-/338937)、日経クロステック「[体言止めが招く意味不明](https://xtech.nikkei.com/atcl/nxt/column/18/02022/081600015/)」。wording.md は、体言止めにそろえたうえで「を」と時の名詞で意味を残す形にした。
- **上場企業の説明資料の観察**：公開されている資料 24 枚を目で読んで数えた（概算）。箱・箇条の約 85% が体言止め、見出し 12 枚中 10 枚が名詞句かサ変名詞止め、述語まで書く文は見出しの下の1〜2行。読ませる資料なので、話す発表にそのまま当てはまるとは限らない。

## 実際に発表を作って分かったこと

- 骨子を、聞き手の立場を渡した読み手に読ませると、略語、自分の話になる入口が最後だったこと、聞き手の大半に当たらない依頼で止まった。
- 全部の箱を同じ濃い色にすると、どこを見ればよいか分からなくなった。濃い色と差し色を1枚1か所にすると、目が向く所が決まった。
- 図の下に文章を並べると、話す中身と重なった。見出し1行と箇条2〜3にすると収まった。
- 消えていく情報は、矢印の注記では伝わらず、灰色の点線の枠で残すと伝わった。
- 図形を測ると、角丸の半径が 11 通り、段落の間が 6 通りあった。目で「そろっていない」と感じた所は、測ると数でずれていた。
