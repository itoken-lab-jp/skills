# Power BI Desktop Bridge（プレビュー）

開いている Desktop に、名前付きパイプ（`pbi-desktop-bridge-{processId}`、JSON-RPC 2.0、ローカルだけ）で外から話しかける仕組み。2026-06 の Desktop からある。Desktop の「オプション」の「セキュリティ」の Desktop Bridge の設定（既定でオン）が要る。Windows だけ。

CLI の `powerbi-desktop`（`@microsoft/powerbi-desktop-bridge-cli`、1.0.0）のコマンド：

| コマンド | すること |
| --- | --- |
| `status` | 開いている Desktop ごとのファイル、未保存の変更の有無（`hasUnsavedChanges`）、PBIR のページの一覧 |
| `manifest` | その Desktop が受け付けるメソッドの一覧 |
| `open <report>` | PBIP・PBIX を Desktop で開く |
| `reload` | 開いている PBIP・PBIR をディスクから読み直す。レポートだけで、モデルの定義（TMDL）は読み直さない |
| `screenshot <page-id>`・`screenshot-all` | レポートのページを PNG で撮る |

どのコマンドも `--pid` を取る。

## 作者の環境で確かめたこと（2026-10-06〜07、Desktop 2.158.1177.0）

- `reload` は読み込みが終わってから返り（7 秒ほど）、直後の `screenshot` でカスタムビジュアルまで描かれていた。撮影は Desktop を前に出さず 2 秒ほどで、画面操作の許可も要らない。
- レポートのページ・ビジュアルの追加と削除、フィールドの付け替え、`definition/report.json`、テーマ、カスタムビジュアルの差し替えと書式ペインのカードは、閉じずに `reload` で入った。閉じて開き直さないと入らない変更は、試した中には無かった。試していない：列の型の変更、`definition.pbir` の参照先、`semanticModelDiagramLayout.json`。
- **モデル（TMDL）の変更は CLI の `reload` では入らない。** Bridge の `file.reload/v1` には `reloadModelDefinition`（Bridge の既定は true）があるが、CLI 1.0.0 は常に false を渡す（`dist/cli.js`）。メジャーを足してビジュアルに付けると、CLI の `reload` では「1 つ以上のフィールドに問題があります」になった。同梱の `scripts/desktop-reload.mjs` は true で送る。
- **データは読み直しでは入らない**（モデルごとでも）。M の式の値を変えても前の値のままで、ホームの「更新」で入った。「更新」のあとは `hasUnsavedChanges: true` になる。
- 読み直しはビジュアルの選択を外す。書式ペインを見るときは選び直す。
- reload は `cache.abf` を読み直さず、フィルターと画面の一部が戻る。
- **色は開き方で変わる。** CLI の `open` で開いた Desktop の撮影では、`#ff00ff` が `#e43cfb`、`#118DFF` が `#518AFB` になった（モニターの色のプロファイルに合わせて変換される）。環境変数 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--force-color-profile=srgb` を付けて起動した Desktop なら、撮影でも設定値どおりだった。ほかの Desktop が開いていると、この設定の Desktop は立ち上がらずに止まった（2026-09-29）ので、先に閉じる。

## 使うときの注意

- `screenshot` が撮るのはページの描画（キャンバスと上の帯）だけ。書式ペインや、クリック・ホバーの操作は画面操作で確かめる。
- CLI には閉じるコマンドが無い。自分で開いた Desktop は、終わったら通常の閉じ方で閉じる。
- 1 つの Desktop には 1 度に 1 つの操作しか通らない。
- Desktop を上げたら、新しいメソッドを使う前に `manifest` で受け付けるかを見る（無いメソッドは `-32601 MethodNotFound`）。
- 管理された PC では、管理者がポリシーで Bridge を切っていることがある（`HKLM\SOFTWARE\Policies\Microsoft\Power BI Desktop` の `DesktopNamedPipeBridge` が `0`。Learn）。`status` がつながらないときは、まず `reg query "HKLM\SOFTWARE\Policies\Microsoft\Power BI Desktop" /v DesktopNamedPipeBridge` で見る。切られていれば、プレビューの機能「Detect and reload external PBIP changes」（2026-08 以降の Desktop、「オプション」の「プレビュー機能」、入れたら再起動）で、保存したファイルの変更を Desktop が見つけて「Apply external changes」の帯を出す。帯は画面操作で押す（Learn。作者の環境では試していない）。それも使えなければ、保存して閉じ、直して、開き直す。
- 外のブログや Skill に「テーマと TMDL の外からの変更は、Desktop を開き直さないと入らない」と書いたものがあるが、上の実測では読み直しで入った。古い情報より、手元の版での実測を正にする。

## 選ばない手段（2026-10-26）

| 手段 | 理由 |
| --- | --- |
| Tabular Editor の CLI `te` | モデルの作業は Authoring MCP で足りる。限定のパブリック プレビューは 2026-09-30 までで、そのあとはライセンスが要るとしていた（その後の条件は確かめていない） |
| Fabric CLI `fab`、fabric-cicd | サービスのワークスペースへの配置で、Desktop の作業ではない |
| 個人の作った CLI・Skill（Python の `pbir`、pbi-tools など） | 公式の CLI と重なる。文を写すときは、ライセンス（GPL などは MIT と合わない）を先に見る |
