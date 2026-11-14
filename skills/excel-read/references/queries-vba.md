# Power Query と VBA


## 使い方

- `excel-read queries ブック.xlsx`：Power Query の M のコード（`section Section1;` から始まる、全部のクエリの定義）をそのまま出す。.xlsx・.xlsm・.xlsb だけ。読み込んだ結果の表は、多くは Excel のテーブルになっているので `table --table` で読む。「結果に何が入らなかったか」（エラーの行を捨てる `Table.RemoveRowsWithErrors`、シートの名前の決め打ちなど）は、定義と結果の両方を見て初めて分かる。
- `excel-read vba ブック.xlsm`：VBA のモジュールごとに `' ===== 名前 =====` の行に続けてコードを出す（ThisWorkbook やシートのモジュールも）。.xlsm・.xls・.xlsb。
- どちらも、無ければ標準出力は空で、標準エラーに「ありません」と出る（終了コード 0）。
- 読むだけで、実行も更新もしない。
