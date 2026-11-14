# excel-read

AI に Excel を読ませると、Python のライブラリを入れてスクリプトを書き、動かして直す往復が始まります。帳票の形の表（結合セル、2段の見出し、合計の行）は、そのスクリプトでも崩れがちです。excel-read は、Skill に同梱した実行ファイルで Excel を読み、表を CSV や JSON にして渡します。Python や Excel 本体は要りません。

```
excel-read table 売上報告.xlsx --sheet 10月 --header-rows 2
```

結合セルは値を埋め、2段の見出しは「上の見出し/下の見出し」の1つの列名にします。隠した行や、単位の付いた表示形式のように読み違えやすい箇所は、注意として標準エラーに出します。コマンドの一覧は `excel-read --help` で出ます。読めないもの（文字の色や塗り、図形、パスワード付きのファイル）は [references/limits.md](../skills/excel-read/references/limits.md) にあります。

同梱の実行ファイルは Windows（x64）・Mac（Apple シリコン）・Linux（x64）の3つです。Rust で書いたソースは [tools/excel-read](../tools/excel-read) にあり、実行ファイルにはソースの指紋が入っています。このリポジトリの CI は、指紋がソースと合うことと、3つの OS でダミーの帳票を読めることを確かめています。自分で作り直す場合は [tools/excel-read/build-all.sh](../tools/excel-read/build-all.sh) を Linux で実行します。Mac の実行ファイルは、Apple の公証を受けていない署名（ad-hoc 署名）です。ブラウザで zip をダウンロードして展開した場合は、macOS が実行を止めることがあります。

## 速さとメモリ

同じブックを、excel-read と、同じ出力を作る Python のスクリプトで読み比べました。小さいブックほど差が大きく、10万行の表を CSV にする作業では3倍でした。メモリは、excel-read が行数によらず 13MB で、Python は 46〜157MB でした。

| 行数 | ファイル | 作業 | excel-read | Python | excel-read の速さ |
|---:|---:|---|---|---|---:|
| 1,000 | 0.1MB | 全部のセル | 0.03秒・13MB | 0.43秒・46MB | 13倍 |
| 1,000 | 0.1MB | 表を CSV に | 0.05秒・13MB | 0.53秒・81MB | 11倍 |
| 10,000 | 0.5MB | 全部のセル | 0.29秒・13MB | 2.70秒・49MB | 9倍 |
| 10,000 | 0.5MB | 表を CSV に | 0.44秒・13MB | 1.53秒・92MB | 3倍 |
| 100,000 | 5.3MB | 全部のセル | 2.65秒・13MB | 25.07秒・65MB | 9倍 |
| 100,000 | 5.3MB | 表を CSV に | 3.81秒・13MB | 11.42秒・157MB | 3倍 |

- 全部のセル：値と式を JSON Lines に出します。excel-read は `dump --format jsonl`、Python は openpyxl の read_only で同じ形を書くスクリプトです。
- 表を CSV に：1行目を見出しにした表を CSV に出します。excel-read は `table`、Python は `pandas.read_excel(ブック, sheet_name=0).to_csv(出力, index=False)` です。
- 時間は、どちらも1回ずつ別のプロセスで起動してから終わるまで（Python は import も含む）を3回測った中央値です。メモリは最大の使用量（RSS）です。
- 測った環境：2026年11月14日、クラウドの Linux（x64、4コア）、Python 3.13、openpyxl 3.1.5、pandas 3.0.5。ブックは10列（連番・日付・文字・数値・式）で、測定のスクリプトがその場で作ります。結合セルや2段の見出しは入っていません。Windows と Mac では測っていません。

手元で測り直すには、Linux か Mac で `pip install openpyxl pandas` をしてから、次を実行します。

```
python3 tools/excel-read/bench/bench.py --rows 1000,10000,100000 --repeat 3
```

AI にスクリプトを書かせる場合は、このほかに、スクリプトを書いて動かし、崩れた所を直す往復の時間がかかります。この表には、その時間は入っていません。

## 入れ方

```
npx skills add itoken33/skills -g --skill excel-read
```

手順の本文は [SKILL.md](../skills/excel-read/SKILL.md) です。入れ方の詳しい説明は [README](../README.md#入れ方) にあります。
