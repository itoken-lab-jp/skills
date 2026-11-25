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
- 書き込みの前に確認は出ない。2026-10-30 に Windows で起動したときは、`RefreshWithXMLA` がそのまま通った。
- 読むだけなら `--readonly`。以前あった `--skipconfirmation` は 1.0.0 の README の一覧に無い。
- ツールの一覧（1.0.0、2026-10-30 に起動して確かめた）：`connection_operations`・`dax_query_operations`・`model_operations`・`table_operations`・`column_operations`・`measure_operations`・`relationship_operations`・`partition_operations`・`calculation_group_operations`・`function_operations`・`calendar_operations`・`named_expression_operations`・`transaction_operations`・`trace_operations` ほか、と `accept_eula`。

## 開いている Desktop につなぐ（2026-10-30、Windows、1.0.0）

- 引数は `{"request": {...}}` で包み、キーは小文字で始める。例：`connection_operations` に `{"operation": "Connect", "connectionString": "Provider=MSOLAP;Data Source=localhost:<port>"}`、`dax_query_operations` に `{"operation": "Execute", "resultMode": "Inline", "query": "EVALUATE ..."}`。`connectionName` を省くと最後の接続を使う。
- `ListLocalInstances` は開いている Desktop を見つけなかった（0 件。原因は調べていない）。作者の環境の外では見つけ、どのファイルを開いているかは結果の `parentWindowTitle` で見分けた、という観察がある（版と日付の記録は無い）。プロセスの起動引数のファイル名は、「名前を付けて保存」の前の名前のまま残るので、見分けに使わない。ポートは `%LOCALAPPDATA%\Microsoft\Power BI Desktop\AnalysisServicesWorkspaces\<ワークスペース>\Data\msmdsrv.port.txt`（UTF-16）から読んで `Connect` に渡す。Microsoft Store 版の Desktop は置き場が違うことがある（確かめていない）。
- **つなぐ先を取り違えない。** ワークスペースのフォルダーは、開いている Desktop ごとにあり、異常終了したものが残ることもある。2 つ以上あるときは、ポートを待ち受けているプロセス（`Get-NetTCPConnection -LocalPort <port> -State Listen` の `OwningProcess`）の親（`Get-CimInstance Win32_Process -Filter "ProcessId=<pid>"` の `ParentProcessId`）が、Bridge の CLI の `status` の対象の `pid` と同じものを選ぶ（この選び方は試していない）。つないだら `INFO.VIEW.TABLES()` で対象のモデルの表があるかを見る。
- `resultMode` の既定（`Resource`）は結果を `%TEMP%\PowerBIModelingMCP\QueryResults\` の CSV にも書く。応答の中で読むなら `Inline`。
- `RefreshWithXMLA` の応答は中身が空で、成功したかは続けて流す DAX で見る。
- Desktop を開き直すとポートが変わる（版と日付の記録は無い）。開き直したら、つなぎ直す。

## 開いている Desktop に書くとき

Microsoft の skills-for-fabric の references は「MCP がつながっていれば MCP で書く」とするが、この Skill の既定は TMDL のファイルに書く（差分が残り、Desktop と衝突しない）。

SKILL.md の「守ること」のとおり、モデルは TMDL のファイルに書くのが既定。ユーザーが、開いている Desktop に MCP で書くよう頼んだときだけ、`Connect` して書く。ユーザーの Desktop なので、つなぐ前に SKILL.md の「守ること」どおり未保存の変更が無いかを見る。

- 書く前に、対象のモデルと操作をユーザーに示し、よいと言われてから書く。頼まれたまとまり（メジャーをいくつか足す、など）を書き終えるごとに、保存（Ctrl+S）をユーザーに頼む。保存したら、TMDL のファイルを読んで、書いた変更が入ったかを確かめる。入っていなければ、つないだ先の取り違え（上の節）を疑う。
- `Connect` してから、最後の保存を確かめるまでは、同じモデルの TMDL のファイルを外から書かない。外から書いていなければ「Apply external changes」の帯は出ない。帯が出ていたら、保存を頼まずに止まり、ユーザーに伝える。
- 外の変更の取り込み（「Apply external changes」）の落とし穴（2026-10-01、Desktop 2.158.1177.0 の実測）：
  - MCP で書いて未保存のまま、モデルの側の外の変更を取り込むと、MCP の変更が消えた。レポートの側だけの取り込みなら残った。
  - MCP の接続はモデルの写しを持っていて、取り込みでは更新されない。取り込んだら `Disconnect` → `Connect` で接続を 1 本にしてから読み書きする。
  - 帯が出ている間に保存すると、外の変更が何も言われずに上書きされて消える（SKILL.md の「PBIP を直すとき」）。

## 癖

作者の環境では確かめていない観察で、版と日付の記録が無いものは、当てにする前に確かめる。

- メジャーの `Create` で `dataType` を渡すとエラーになる（新しいメジャーの型は指定できない）。
- メジャーや列の `Rename` で、ほかのメジャーの DAX は追従する。レポートのビジュアル（`visual.json` の参照）と説明文は追従しない。名前を変えたら、[pbir-refs.md](pbir-refs.md) の手順で参照を直す。
- `table_operations` の `CreateFieldParameter` で作ると、列名が `<表名>`・`<表名> Fields`・`<表名> Order` になる。Desktop で作ったときの名前（`Parameter`・`Parameter Fields`、日本語の UI では `パラメーター`・`パラメーター フィールド`）と違う。
- DAX の `DEFINE VAR item = ...` が構文エラーになった。原因（`item` という名前か、MCP の側か）は確かめていない。`DEFINE VAR` 自体は DAX のクエリの正しい書き方なので、避けずに使い、エラーになったら名前を変えて試す。
- パーティション（M）を変えたあと `RefreshWithXMLA` を流しても、外部のソースは読み直されなかった（下の「取り込み直し」の表の `Full` と食い違う。どちらも作者の環境では試していない）。エラーも出ない。値が変わったかを DAX で見て、変わっていなければ Desktop のホームの「更新」にする。
- `ConnectFolder` で書いた変更は、そのままではファイルに入らない。`ExportToTmdlFolder` で書き出す（v0.5.0-beta.14 から警告が出る。1.0.0 で同じかは確かめていない）。
- `dax_query_operations` の `Execute` は既定で 1000 行、上限は 10 万行（`maxRows`）。
- あるメジャーを参照しているメジャーは、`INFO.MEASURES()` を `CONTAINSSTRING` で絞って引ける。

## 取り込み直し（`RefreshWithXMLA`）

skills-for-fabric の `powerbi-report-cli` の `references/authoring/preview-part-04.md`（v0.3.19）は、変更の種類ごとに次のように分けている（作者の環境では試していない）。モデルの定義を読み直したあとに、処理を 1 つずつ順に回す。

| 変更 | 処理 |
| --- | --- |
| メジャー・リレーションシップ・計算列・計算テーブルなど、定義だけの変更 | `refreshType: Calculate` |
| 取り込む列・M の式・パーティション・表を足す・変える | 変えた表かパーティションだけ `refreshType: Full` |
| TMDL を変えずにデータだけ入れ直す | 読み直しは要らず、対象を `Full` |
