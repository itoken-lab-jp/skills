---
name: pdf-read
description: PDF（文字の層のある資料・表・帳票、スキャンした PDF、縦書き）を読む・文字や表を取り出す・スキャンを OCR するときに、使い捨てのスクリプトを書かずに Poppler（pdftotext など）と tesseract で読み、金額などの怪しい所はページの画像を見て確かめる手順。PDF を作る・書き換える・結合するときには使わない。
---

# PDF を読む

PDF は、Python などでスクリプトを書かずに読む。文字の層がある PDF は Poppler の `pdftotext -layout` で読み、スキャン（文字の層が無い）は tesseract で OCR して、怪しい所だけページの画像を見て確かめる。tesseract は文字の一致が 95〜98% あるが、金額の記号（▲・＋）とカンマを誤る。画像を直接読むと正しいが、1ページ数千トークンかかるので、確かめる所だけにする。

## 道具の場所

Poppler（`pdftotext`・`pdftoppm`・`pdfinfo`・`pdffonts`・`pdfimages`）と tesseract は、PC ごとに一度入れる。この Skill には入っていない。

- どこにあるかは、全体の指示ファイル（ホームの CLAUDE.md・AGENTS.md など）にその PC の道具の場所が書いてあれば従う。書いていなければ、PATH を探す（Windows は `Get-Command pdftotext, tesseract`、Mac と Linux は `command -v pdftotext tesseract`）。
- 無ければユーザーに入れてもらう。エージェントが自分で落として入れない。
  - Windows：`winget install oschwartz10612.Poppler`（日本語の言語データ poppler-data を同梱）と `winget install UB-Mannheim.TesseractOCR`。winget が使えない PC は、それぞれの GitHub のリリース（oschwartz10612/poppler-windows、UB-Mannheim/tesseract）から置く。
  - Mac：`brew install poppler tesseract`。
  - Linux：`apt install poppler-utils poppler-data tesseract-ocr`。
- **日本語の OCR のデータは `tessdata_best` を使う。** tesseract に付いてくる標準の日本語のデータは、Windows で数字を丸数字（⑥⑦）で出した。github.com/tesseract-ocr/tessdata_best から `jpn.traineddata` と `jpn_vert.traineddata`（縦書き）を落とし、1つのフォルダー（例：`~/tessdata`）に置く。呼ぶときに `--tessdata-dir` でそのフォルダーを渡す（以下の例では `<tessdata>`）。
- **Poppler は日本語の言語データ（poppler-data）が要る。** 無いと縦書きのフォントの文字を落とし、`Missing language pack for 'Adobe-Japan1'` を大量に出す（クラウドで、手引きの約8万字が落ちた）。この文が出たら、入れ方を見直してもらう。
- 入れたら、場所（Poppler の `bin`、tesseract、`<tessdata>`）を、その PC で毎回読まれる指示に書き残してもらう。書く1行をユーザーに渡し、どこに書くかはユーザーの決まりに従う。
- 入れてもらえないときは、エージェントが PDF や画像を直接読めるなら、それで読む（ページが多いと重い）。

以下、Windows ではフルパスか PATH の名前で呼ぶ。Windows の PowerShell では、呼ぶ前に `[Console]::OutputEncoding = [Text.Encoding]::UTF8` を実行し、出力はファイルに書いてそれを読む（Windows PowerShell 5.1 の `>` は UTF-16 のファイルになるので使わない）。

## 進め方

1. **形を見る**：`pdfinfo 資料.pdf`（ページ数・大きさ・暗号化）と `pdffonts 資料.pdf`。
   - `pdffonts` の表が空で、`pdfimages -list 資料.pdf` にページごとの画像が出るなら、スキャン（文字の層が無い）。手順3へ。`pdfimages -list` の `x-ppi` がスキャンの解像度。
   - `pdffonts` は文書全体のフォントを出すので、文字の層のあるページとスキャンのページが混ざった PDF（スキャンした添付を足した資料など）は見分けられない。手順2で出力が空か極端に少ないページは、`pdfimages -list -f 5 -l 5 資料.pdf` でそのページの画像を見て、スキャンなら手順3へ回す。
   - フォントがあり、`uni` の列に `no` があるフォントは、文字に戻す表（ToUnicode）を持たない。そこの文字は化ける（`䚷` のような字や `�` が出る）。手順2で出た文字が化けていたら、そのページは手順3（OCR）か手順4（画像を見る）で読む。
   - 暗号化されていて読めなければ、ユーザーにパスワードを聞く（`-upw`・`-opw` で渡す）。
2. **文字の層を読む**：`pdftotext -layout -enc UTF-8 資料.pdf 資料.txt`。ページを絞るときは `-f 3 -l 5`。
   - `-layout` は、表の列を空白でそろえて出す。表の読み取りは、この空白の位置で列を見分ける。列の境が怪しい所は、手順4で画像を見て確かめる。
   - 文字の層には、画面に見えない文字（切り抜かれて見えない記入例、白い文字、重ね書き）が入ることがある。見えている内容と違う文が混ざったら、そのページの画像を見て確かめる。
   - 出力が大きいときは、文脈に全部入れず、要るページや文字を探してから読む。
3. **スキャンを OCR する**：ページを画像にしてから tesseract に渡す（tesseract は PDF を直接読まない）。
   ```
   pdftoppm -r 200 -gray -png -f 1 -l 1 -singlefile スキャン.pdf page-1
   tesseract page-1.png page-1 -l jpn --psm 3 --tessdata-dir <tessdata> txt tsv
   ```
   - 1ページずつ `-f N -l N -singlefile` で出し、名前にページの番号を入れる。`-singlefile` を付けずに範囲で出すと、番号が総ページ数の桁で 0 埋めされる（14ページの PDF なら `page-01.png`）。
   - `-r` は、`pdfimages -list` の `x-ppi`（スキャンの解像度）に合わせる。上げても読めるようにはならず、200dpi のスキャンを 300dpi で画像にすると、文字の一致が 0.974 から 0.938 に下がった。解像度が分からなければ 200〜300。
   - 縦書きのページは `-l jpn_vert` にする（Windows の測定で、縦書きの試料の文字の一致 0.991）。
   - `txt tsv` で、文字（`page-1.txt`）と語ごとの位置と確信度（`page-1.tsv`）を1回で出す。`page-1` は出力の名前（拡張子は tesseract が付ける）。
   - ページが多ければ、ページごとに繰り返す。1ページ 1〜4秒かかるので、数十ページを超えるときは、要るページから先に読む。
4. **怪しい所を画像で確かめる**：OCR の結果は、そのまま数字として使わない。
   - `page-1.tsv` の `conf`（確信度、0〜100）が低い語を拾う。クラウドで標準の日本語のデータを使って表の1ページを測ったとき、正しい数字は 84〜95、誤読は 3〜53 だった（`4A410.000` が 47、`寺` が 3、`+4.689` が 53）。ただし正しい語でも 40 前後のことがあり、確信度が高いまま誤る場合もありうる。`tessdata_best` での分かれ方は確かめていない。目安は 60 未満。TSV は SQL で集計できる道具（DuckDB など）で絞れる（次の問い合わせは走らせて確かめていない。列が崩れたら `read_csv` の引数を直す）：`duckdb -agent -c "SELECT page_num, line_num, conf, text FROM read_csv('page-1.tsv', delim = '\t', quote = '', all_varchar = true) WHERE text <> '' AND conf::DOUBLE BETWEEN 0 AND 60"`。
   - 確信度のほかに、形のおかしい数字（カンマの代わりの `.` や `′`、`,.` のつながり、数字に混ざった漢字や英字）と、合計が内訳の和に合わない所も拾う。
   - 拾った所があるページは、手順3で作ったページの画像をエージェントが直接見て、その語を読み直す。金額・数量・日付・コード（帳票の値）は、拾った所が無くても画像と突き合わせる。
   - 画像を直接見られないエージェントは、確かめていない値をそう書いて報告する。
5. **報告する**：どのページをどの手段で読んだか（文字の層／OCR／画像）、画像で直した所、確かめられなかった所を書く。化けたフォントや見えない文字があったら、それも書く。

## しないこと

- PDF を作る・書き換える・結合する・分ける。この Skill は読むだけ。
- 読むためのスクリプト（Python の pypdf・pdfplumber など）を書く。上の道具で読めない形（フォームの入力値、注釈、添付ファイルなど）に当たったら、何が読めなかったかをユーザーに伝えてから手段を決める。

## 測っていないこと

本物のスキャン（紙を読み取った PDF。測ったのは画像にノイズと傾きを足したもの）、手書き、罫線の多い帳票のスキャン、`tessdata_best` での確信度、手順4の DuckDB の問い合わせ、Mac での入れ方と動き（brew の Poppler に poppler-data が付くかを含む）。画像を直接読む精度は Claude でだけ測った。Kiro は、指示なしで PDF を渡すと PyMuPDF で文字を取り出し、崩れたのでページを画像にして読んだ（2026-11-06）ので、画像は読める。Kiro の精度と、Codex・Antigravity が PC の画像ファイルを開いて読めるかは確かめていない。
