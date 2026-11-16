---
name: data-query
description: CSV・TSV・JSON・JSON Lines・Parquet のファイル（DB や Excel から書き出したものも）の集計・絞り込み・結合・並べ替え・形の変換が要る作業を頼まれたら、手を付ける前に読む。pandas などのスクリプトを書かずに DuckDB の SQL で行う手順。Shift_JIS の CSV も読める。ファイルを書き換えるとき、グラフを描くときには使わない。
---

# ファイルを DuckDB の SQL で集計する

CSV や JSON の集計は、pandas などのスクリプトを書かずに、DuckDB の CLI で SQL を1本走らせる（スクリプトは入れる・走らせる・直すの往復で遅く、メモリも食う）。ファイルを読み込む手順は要らず、SQL の `FROM` にファイルの名前を書く。

## 道具の場所

DuckDB の CLI（`duckdb`、Windows は `duckdb.exe`）は、PC ごとに一度入れる。この Skill には入っていない。

- 置き場をユーザーの指示が決めていれば、それに従う。決めていなければ、PATH の `duckdb` を探す（Windows は `Get-Command duckdb`、Mac と Linux は `command -v duckdb`）。
- 無ければユーザーに入れてもらう。Windows は `winget install DuckDB.cli`、Mac は `brew install duckdb`。winget が使えない PC と、winget にまだ新しい版が来ていないとき（2026-11-03 時点で winget は 1.5.6 まで）は、DuckDB の GitHub のリリースから Windows 向けの CLI（2.0.0 は `duckdb-cli-windows-amd64.tar.gz`）を落として `duckdb.exe` を置く。DuckDB の公式のインストールスクリプト（install.duckdb.org の `install.ps1`）は、日本語の Windows では CPU の種類（`64 ビット`）を見分けられずに止まる（2026-11-03）ので、このリリースから置く。入れたら、その場所を、その PC で毎回読まれる指示に書き残してもらう。書く1行をユーザーに渡し、どこに書くかはユーザーの決まりに従う。エージェントが自分で落として入れない。
- 無いまま、入れてもらえないときは、量が少なければそのまま読んで集計し、多ければ、ほかに使える集計の手段をユーザーに聞く。

## 走らせ方

```
duckdb -agent -c "SELECT 部門, SUM(金額) AS 金額 FROM '売上.csv' GROUP BY ALL ORDER BY 金額 DESC"
```

- `-c` で SQL を1つ走らせて終わる。結果を自分で読むときは `-agent`（DuckDB 2.0 の agent mode）を付ける。結果は詰めた Markdown の表になり、見出しに列の型が付く（`answer:INTEGER`）。1000行までは全部を出して最後の行に `1000 rows, hash …` と添え、1001行からは最初の20行と最後の20行だけを出して最後の行に `first 20 and last 20 of 2000 rows` と添える。最後の行で、全部か省いたかを見分ける。エラーは JSON（`exception_type`・`exception_message` など）で stderr に出る。`duckdb agent mode on` の知らせも stderr に出る。表の形・型・省いたときの最後の行・JSON のエラーは 2026-11-03 に Windows と Mac の 2.0.0 で、1000行の境目と stderr は Windows だけで確かめた。10KB を超えたときも省くと [公式の docs](https://duckdb.org/docs/2.0/clients/cli/agent_mode) にあるが、確かめていない。公式の実測で、エージェントが読む量が約6割減った（[Agent Mode in the DuckDB CLI](https://duckdb.org/2026/10/09/agent-mode)）。
  - 付けなくても、Claude Code（`CLAUDECODE`）・Codex（`CODEX_SANDBOX` など）など一部の道具が付ける環境変数があり、出力がパイプ（端末でない）なら入る（公式ブログの一覧。Mac では `CLAUDECODE=1` を付けて入るのを確かめた。Windows の Claude Code のシェルでも `-agent` なしで入った。そのときは `AI_AGENT` も付いていて、どの変数で入ったかは切り分けていない）。ただし `-csv` などの出力の形を指定すると、自動では入らない。道具によって入るかが違うので、毎回 `-agent` を書く。
  - `-agent` は 2.0 より前の版には無い。知らないオプションと言われたら `duckdb --version` を見て、ユーザーに上げてもらう（入れ方は上と同じ）。上がるまでは `-agent` を外して `-csv` で走らせ、`LIMIT` を必ず付ける（省いたかを道具が教えないため）。
- `-agent -csv` と並べると、行を省かない（Windows と Mac の 2.0.0 で、2000行が全部出た。公式ブログの「省き方は agent mode のまま」とは違う）。`-agent -json` などほかの形と、そのときのエラーの形は確かめていない。形を指定するときは、`LIMIT` を付けるか `COPY` でファイルに書いて量を抑える。ユーザーに見せる小さな表は `-markdown`。
- 長い SQL は `問い合わせ.sql` に書き、`duckdb -agent -f 問い合わせ.sql`（Windows の PowerShell は `<` を使えないので `-f`）。Windows の PowerShell では、短くても `"` で囲む列の名前か日本語を含む SQL はファイル（UTF-8）にして `-f` で渡す（`-c "…"` の中の `"` が崩れる）。
- 結果をファイルに書くのは SQL の `COPY`：`COPY (SELECT ...) TO '結果.csv' (HEADER)`。Parquet は `TO '結果.parquet'`。`COPY` は同じ名前のファイルを黙って上書きするので、出力先は読むファイルと別の、新しいパスにする。
- 出力を文脈に入れすぎない。agent mode が省いても、行の多い結果は `LIMIT` を付けるか `COPY` でファイルに書き、要る所だけを見る。省かれた結果を全部と思って数を出さない。
- **Windows の PowerShell**：呼ぶ前に `[Console]::OutputEncoding = [Text.Encoding]::UTF8` を実行する。大きな結果は `COPY` でファイルに書く。

## 読み方

- CSV：`FROM '売上.csv'` で、区切り・見出し・型を当てて読む。外れたら `FROM read_csv('売上.csv', header = true, delim = '\t', all_varchar = true)` のように指定する。`all_varchar = true` は型の推測を止め、全部を文字で読む（コードの先頭の 0 を落とさない）。
- Shift_JIS の CSV（Windows の Excel が書いたものなど）：`INSTALL encodings; LOAD encodings;` のあと `read_csv('a.csv', encoding = 'cp932')`。`'shift_jis'` だと `①`・`㈱`・`髙` のような Windows の文字で「not shift_jis encoded」と止まるので、`cp932` を使う（DuckDB 2.0 で確かめた）。`INSTALL` は初回にネットから落とすので、社内のネットワークなどで落ちなければユーザーに伝える。
- JSON・JSON Lines：`FROM 'a.json'` か `read_json('a.jsonl', format = 'newline_delimited')`。入れ子は `unnest` でほどく。
- 複数のファイル：`FROM 'logs/*.csv'`（`filename = true` でファイルの名前の列が付く）。
- 中身をまず見る：`DESCRIBE SELECT * FROM 'a.csv'`（列と型）、`SUMMARIZE SELECT * FROM 'a.csv'`（列ごとの最小・最大・件数・NULL の割合）。
- Excel は、Excel を読む道具で CSV に書き出してから読む。DB は、集計できるものは DB の SQL の中で済ませ、要る行だけを書き出して読む。

## 書き方の注意

- 金額の合計：CSV から読んだ小数は DOUBLE になり、合計に `28468682.40000003` のような端数が出る。金額は `SUM(CAST(金額 AS DECIMAL(18, 2)))` にする。
- 日本語の列の名前は、記号や空白を含むときに `"売上 (千円)"` と `"` で囲む。
- `GROUP BY ALL`（SELECT の集計でない列で束ねる）、`QUALIFY`（窓関数の結果で絞る）、`EXCLUDE`（`SELECT * EXCLUDE (列)`）、`PIVOT` が使える。
- 数を出したら、元の件数（`COUNT(*)`）と合計の1つを突き合わせて、読み落としが無いかを確かめる。

## できないこと

- 元のファイルを書き換える使い方（DuckDB はできてしまうが、この Skill ではしない。`COPY` は別の新しいファイルに書く）。
- グラフ。数を出すところまでにする。
