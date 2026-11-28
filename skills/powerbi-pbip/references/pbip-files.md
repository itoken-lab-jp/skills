# PBIP のファイルを修正するときの細部

PBIP と PBIR は一般提供で、PBIR が既定の形式（2026-10-26 に Learn の「Edit PBIP files outside Power BI Desktop」「Power BI Desktop project report folder」「Power BI Desktop projects」で確認した）。Desktop が外からの変更を見つけて読み直す仕組みと Desktop Bridge はプレビュー。

- ページ・ビジュアルのフォルダー名を変えたら、Desktop を開き直す。名前は英数字・`_`・`-` だけ（外れると Desktop はそのフォルダーを無視する）。
- 外から修正しないファイルの一覧は SKILL.md の本文にある。PBIR の `definition/report.json` は別のファイルで、修正して `reload` で入ることを作者が確認した（2026-10-06）。
- パスが 260 文字を超えると、保存や読み込みが落ちる。深い所に置いたコピーは、短いパスのジャンクションから開く。
- PBIR を読むときは、JSON を全部開く前に、レポートの CLI の `preview-pages`・`preview-visuals`・`preview-filters`（ページ・ビジュアル・フィルターの一覧と、それぞれのファイルのパス）で当たりを付ける。

## 画面のビジュアルとフォルダーを対応させる

Desktop の「オプション」の「レポートの設定」の「レポート オブジェクト」で「Copy object names when right clicking on report objects」を入れる。ビジュアルを右クリックして「Copy object name」で名前を取り、PBIR のフォルダーと突き合わせる（Learn。日本語の UI での名前は確認していない）。
