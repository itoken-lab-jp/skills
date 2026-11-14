# Power BI Authoring MCP（旧 Power BI Modeling MCP）

`@microsoft/powerbi-modeling-mcp`。名前が Power BI Authoring MCP に変わり、ローカル版が一般提供になった（npm の 1.0.0、2026-09-25）。パッケージ名は変わっていない。テーブル・列・メジャー・リレーションシップの作成と変更、DAX のクエリ（10 万行まで）、RLS のロール、翻訳、パーティション、計算グループ、DAX のユーザー定義関数、トランザクション、トレースを扱う。レポートのページやモデルの図のレイアウトは変えられない。

## ローカル版とホスト版

PBIP と開いている Desktop に届くのはローカル版だけ。両方を同時に登録しない（ツールが重なって振り分けが曖昧になる、と Learn にある）。

| | ローカル版（一般提供） | ホスト版（プレビュー） |
| --- | --- | --- |
| 動かし方 | `npx -y @microsoft/powerbi-modeling-mcp@<版> --start`（stdio） | `https://api.fabric.microsoft.com/v1/mcp/powerbi/authoring`（Streamable HTTP） |
| 届く先 | PBIP・TMDL のファイル、開いている Desktop、Fabric のワークスペース | Fabric のワークスペースだけ |
| 認証 | Entra ID の対話のサインイン、サービス プリンシパル | Entra ID |

- 接続先は 3 通り。PBIP は `<名前>.SemanticModel/definition` のフォルダーを渡す（`.pbip` のファイルではない）。開いている Desktop はファイル名で、Fabric はワークスペース名とセマンティックモデル名で指す。
- Windows で MCP の設定に `npx` を直接書くと起動しなかった。`node` から npx を呼ぶ形にする。
- 起動は Windows と Linux で確かめた。Mac は Apple シリコンだけ（npm の optionalDependencies に Intel の Mac の版が無い）。
- 読むだけなら `--readonly`。以前あった `--skipconfirmation` は 1.0.0 の README の一覧に無い。
- ツールの一覧（1.0.0、2026-10-30 に起動して確かめた）：`connection_operations`・`dax_query_operations`・`model_operations`・`table_operations`・`column_operations`・`measure_operations`・`relationship_operations`・`partition_operations`・`calculation_group_operations`・`function_operations`・`calendar_operations`・`named_expression_operations`・`transaction_operations`・`trace_operations` ほか、と `accept_eula`。

## 開いている Desktop につなぐ（2026-10-30、Windows、1.0.0）

- 引数は `{"request": {...}}` で包み、キーは小文字で始める。例：`connection_operations` に `{"operation": "Connect", "connectionString": "Provider=MSOLAP;Data Source=localhost:<port>"}`、`dax_query_operations` に `{"operation": "Execute", "resultMode": "Inline", "query": "EVALUATE ..."}`。`connectionName` を省くと最後の接続を使う。
- `ListLocalInstances` は開いている Desktop を見つけなかった（0 件。原因は調べていない）。ポートは `%LOCALAPPDATA%\Microsoft\Power BI Desktop\AnalysisServicesWorkspaces\<ワークスペース>\Data\msmdsrv.port.txt`（UTF-16）から読んで `Connect` に渡す。Microsoft Store 版の Desktop は置き場が違うことがある（確かめていない）。
- **つなぐ先を取り違えない。** ワークスペースのフォルダーは、開いている Desktop ごとにあり、異常終了したものが残ることもある。2 つ以上あるときは、ポートを待ち受けているプロセス（`Get-NetTCPConnection -LocalPort <port> -State Listen` の `OwningProcess`）の親（`Get-CimInstance Win32_Process -Filter "ProcessId=<pid>"` の `ParentProcessId`）が、Bridge の CLI の `status` の対象の `pid` と同じものを選ぶ（この選び方は試していない）。つないだら `INFO.VIEW.TABLES()` で対象のモデルの表があるかを見る。
- `resultMode` の既定（`Resource`）は結果を `%TEMP%\PowerBIModelingMCP\QueryResults\` の CSV にも書く。応答の中で読むなら `Inline`。
- `RefreshWithXMLA` の応答は中身が空で、成功したかは続けて流す DAX で見る。

## 取り込み直し（`RefreshWithXMLA`）

skills-for-fabric の `powerbi-report-cli` の `references/authoring/preview-part-04.md`（v0.3.19）は、変更の種類ごとに次のように分けている（作者の環境では試していない）。モデルの定義を読み直したあとに、処理を 1 つずつ順に回す。

| 変更 | 処理 |
| --- | --- |
| メジャー・リレーションシップ・計算列・計算テーブルなど、定義だけの変更 | `refreshType: Calculate` |
| 取り込む列・M の式・パーティション・表を足す・変える | 変えた表かパーティションだけ `refreshType: Full` |
| TMDL を変えずにデータだけ入れ直す | 読み直しは要らず、対象を `Full` |
