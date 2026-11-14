---
name: powerbi-pbip
description: AI から Power BI Desktop のレポートとセマンティックモデルを作る・直す・確かめるときの手順。PBIP（PBIR の JSON・TMDL）を直接直す、DAX のメジャー・計算列・計算テーブルや Power Query（M）の表を書く、DAX のクエリで値を確かめる、開いている Desktop に読み直させて撮る（Desktop Bridge）、Power BI Authoring MCP（旧 Power BI Modeling MCP）やレポートの CLI を使うときに読む。手段の選び方と、変更の種類ごとの入れ方、未保存の変更を消さない守り。Power BI サービスへの発行・配置には使わない。リポジトリに Power BI の Skill や定めがあれば、そちらが先。
---

# AI から Power BI Desktop を操作する

PBIP は Power BI Desktop の保存形式の一つで、レポートとモデルをテキストのフォルダーに分けて保存する（`<名前>.pbip`、`<名前>.Report/`、`<名前>.SemanticModel/`）。レポートの中身が PBIR（JSON）、モデル（セマンティックモデル）の中身が TMDL。Desktop は Windows だけで動く。ここに書いた道具の版と動きは 2026-10 時点で、どれもプレビューを含む。

## 始める前に確かめる

1. **対象が PBIP か。** `.pbip` と `<名前>.SemanticModel/definition/` があれば PBIP。`.pbix` だけなら、Desktop の「名前を付けて保存」で「Power BI プロジェクト ファイル (*.pbip)」にしてもらうかをユーザーに聞く。返事を待つ間は、頼まれた式の下書きまで進める。
2. **Desktop と同じ Windows で動いているか。** 違う（クラウドの Linux など）なら、ファイルを直すことと DAX の下書きまでにし、読み直しと値の確認は、手順を渡してユーザーに頼む。
3. **Desktop が開いているか、誰が開いたか。** このセッションで自分が開いた（`powerbi-desktop open` など）もののほかは、ユーザーのものとして扱う。
4. **使える道具。** PATH に `powerbi-desktop`（Bridge の CLI）、ツールの一覧に `dax_query_operations`（Authoring MCP）、画面操作の道具があるか。Bridge の CLI が無ければ、保存と読み直しをユーザーに頼む。MCP が無ければ DAX は Desktop の DAX クエリ ビューで流す。画面操作の道具が無ければ、押す所をユーザーに頼む。

## 手段の順

速くて外れにくい順に、届く一番上を使う。

1. **PBIP のファイルを直接直す**（PBIR の JSON、TMDL）。レポートを直したら、レポートの CLI（`@microsoft/powerbi-report-authoring-cli` の `powerbi-report-author validate <名前>.Report`）で検査する。
2. **開いている Desktop に読み直させて撮る。** Desktop Bridge の CLI（`@microsoft/powerbi-desktop-bridge-cli` の `powerbi-desktop`）の `status`・`reload`・`screenshot`。モデルの変更は、下の「Desktop に入れる」のモデルごとの読み直しが要る。
3. **MCP でモデルを読む・DAX を流す・取り込み直す。** Power BI Authoring MCP（`@microsoft/powerbi-modeling-mcp`）。モデルを書くのは 1 のファイルにする。
4. **画面操作。** 撮影に写らないもの（書式ペイン、クリック・ホバー・ドリル、ホームの「更新」）だけ。

メジャーを足して値を確かめる頼みは、下の「値を確かめる」の 1〜4 の順に進める。

## 守ること

- **読み直す前に、未保存の変更が無いかを見る。** Bridge の CLI の `reload` は、未保存の変更を確認なしに捨ててディスクの状態にする（Desktop で消したビジュアルが戻った。2026-10-07）。`powerbi-desktop status` の `hasUnsavedChanges` が true なら止まり、ユーザーに保存してもらう。
- **自分で開いた Desktop でなければ、読み直し・取り込み直し（MCP の `RefreshWithXMLA` など）をしない。** ユーザーの未保存の変更を消してしまう。ユーザーの Desktop なら、保存してもらってから、読み直してよいかを聞く。2 つ以上開いているときは、`status` の `pid` を `--pid` で渡し、`currentFilePath` が対象の PBIP かを見る。
- **Desktop で同じ PBIP を開いたまま、MCP でモデルに書き込まない**（衝突する）。モデルはファイル（TMDL）に書く。
- **Authoring MCP の EULA は、エージェントが受け入れない。** npm 版は EULA を受け入れるまでほかのツールを止める。`accept_eula` を呼ぶ・`--accept-eula` や `PBI_MODELING_MCP_ACCEPT_EULA` を付けるのは、ユーザーが条文を読んで同意すると自分の言葉で書いたときだけ。MCP が設定に無ければ、エージェントが自分で足さず、入れるかをユーザーに聞く。それまでは Desktop の DAX クエリ ビューを使う。
- **MCP の書き込みの確認に頼らない。** 既定は `--readwrite`。2026-10-30 に Windows で起動したときは確認が出ず、`RefreshWithXMLA` がそのまま通った。書き込む前に、対象のモデルと操作をユーザーに示す。読むだけなら `--readonly` で起動する。
- **npm の道具は版を固定する**（`npx -y @microsoft/powerbi-modeling-mcp@1.0.0 --start` のように）。0.x の CLI は形が変わりうる。

## PBIP を直すとき

- 直す前に、Desktop で開いているなら保存してもらう（Desktop は保存するまでファイルに書かない）。ディスクのファイルが正。
- 文字コードは BOM の無い UTF-8。パスは 260 文字まで。
- `unappliedChanges.json`（`.SemanticModel` のフォルダー）があるときは、Desktop で保留中の変更を先に適用してもらってから TMDL を直す。適用しないままだと、外からの式の変更が捨てられる。
- フォルダー名の決まり、外から直さないファイル、PBIR を読むときの当たりの付け方は [references/pbip-files.md](references/pbip-files.md)。レポートの CLI は [references/report-cli.md](references/report-cli.md)。

## モデルを書く（DAX・M・TMDL）

- 表ごとに `definition/tables/<表>.tmdl`。メジャーは、集計する列のある表（前年比なら金額の列のある表）のファイルに `measure 名前 = 式` で書き、`formatString`（`0.0%`、`#,0` など）を付ける。説明は `///` の行に書く。
- 足した物には `lineageTag` を書かず、ほかの物の `lineageTag` を写さない（保存のときに Desktop が付ける）。
- M でエラーの行を捨てる（`Table.RemoveRowsWithErrors` など）と、何が落ちたかが見えなくなる。頼まれない限り使わず、エラーは直す。
- 書き方は、Microsoft の skills-for-fabric（MIT）の `skills/semantic-model-authoring/references/` を、版のタグを付けて（`https://github.com/microsoft/skills-for-fabric/blob/v0.3.20/...`）要る所だけ読む。DAX（`CALCULATE`、時間の関数、ユーザー定義関数）は `dax-guidelines.md`、遅いメジャーは `dax-perf-decision-guide.md`、TMDL の書式は `tmdl-guidelines.md`。公式は「MCP がつながっていれば MCP で書く」とするが、この手順では TMDL のファイルに書く（差分が残り、Desktop と衝突しない）。

### 値を確かめる

メジャーを書いたら、ビジュアルに使う前に DAX のクエリで値を確かめる。期待する数は、元のデータ（CSV・Excel・DB）の小さな範囲を集計して先に出しておき、クエリの結果と並べる。

```dax
EVALUATE
SUMMARIZECOLUMNS(
    '売上'[部門],
    "金額", [売上金額]
)
ORDER BY '売上'[部門]
```

次の 1〜4 の順に進める。順を変えると、TMDL への変更が消えたり、前の式の値を確かめたりする。

1. **Desktop で PBIP を開き、保存してから TMDL を直す。** 開いていなければ、`powerbi-desktop open <名前>.pbip` で開く。`.pbi/cache.abf` の無い PBIP（git から取り出したばかりのものなど）はデータが空のまま開くので、開いたらホームの「更新」で取り込み、保存する（画面操作か、ユーザーに頼む）。
2. **TMDL を直す。**
3. **Desktop に入れる**（下の表）。
4. **DAX を流す。** Authoring MCP がつながっていれば `connection_operations` でつなぎ、`dax_query_operations` で流す。つながっていなければ、Desktop の DAX クエリ ビューに貼って流す（画面操作か、クエリを渡してユーザーに頼み、結果をもらう）。

DAX の結果が 0 行でエラーも無いときは、まずデータが取り込まれているか（1）を疑う。DAX のクエリで正しくても、ビジュアルに届く値が同じとは限らない（凡例・スライサー・ビジュアルのフィルターはクエリと違う文脈で入る）。ビジュアルに使うときは、撮影でも見る。

MCP のつなぎ方（引数の形、ポートの見つけ方、つなぐ先の取り違え）は [references/authoring-mcp.md](references/authoring-mcp.md)。

## Desktop に入れる

Bridge の CLI の `reload` はレポートだけを読み直し、**モデルの定義（TMDL）は読み直さない**（CLI 1.0.0）。データは、どちらの読み直しでも入らない。作者の環境（2026-10-06〜07、Desktop 2.158.1177.0）で確かめた入れ方：

| 変更 | 入れ方 |
| --- | --- |
| レポート（ページ・ビジュアルの追加と削除・フィールドの付け替え）、テーマ、カスタムビジュアルの差し替え | `powerbi-desktop reload` |
| メジャー | モデルごとの読み直し |
| 表を足す | モデルごとの読み直しのあと、ホームの「更新」（読み直しだけでは定義だけ入り、中身は空） |
| 計算列 | モデルごとの読み直し。「計算列を手動で更新する必要があります」の帯が出たら「今すぐ更新」 |
| リレーションシップ | モデルごとの読み直しのあと、帯の「今すぐ更新」（押すまで集計は前のまま） |
| データの値（M の式の中身） | ホームの「更新」 |

- **モデルごとの読み直し**は、同梱の `scripts/desktop-reload.mjs`（Node.js。Windows だけ）で行う。未保存の変更が無いと確かめられなければ（応答に値が無いときも）止まり、Desktop が 2 つ以上開いていれば `--pid` を求める。`--report-only` で CLI の `reload` と同じになる。Node.js が無いときや、スクリプトが動かないときは、保存して Desktop を閉じ、開き直してもらう。

  ```
  node <この SKILL.md のあるフォルダー>/scripts/desktop-reload.mjs [--pid <pid>]
  ```

- 「更新」「今すぐ更新」のあとは未保存になるので、次の読み直しの前に保存してもらう（保存で `cache.abf` も書かれる）。保存すると Desktop が TMDL にも書く（日付の列のある表を足したときの自動の日付テーブル `LocalDateTable_…` など）。git で管理しているなら、この差分をコミットに入れるかをユーザーに聞く。
- Authoring MCP がつながっていれば、「更新」「今すぐ更新」を MCP の `RefreshWithXMLA` に置き換えられる（定義だけの変更は `Calculate`、取り込みの変更は変えた表だけ `Full`）。自分で開いた Desktop だけに使う。

撮影・色・Bridge が切られているときの代わりは [references/desktop-bridge.md](references/desktop-bridge.md)。

## 出典

Microsoft Learn の [Power BI MCP servers overview](https://learn.microsoft.com/power-bi/developer/mcp/mcp-servers-overview)・[Desktop Bridge](https://learn.microsoft.com/power-bi/developer/agentic/power-bi-desktop-bridge-overview)・[Report Authoring skill](https://learn.microsoft.com/power-bi/developer/agentic/power-bi-report-authoring-skill-overview)・PBIP の各ページと、各 npm パッケージの README・CHANGELOG・`dist/cli.js` で、2026-10-06〜10-30 に確かめた。日付と版の付いた動きは、作者の Windows の Desktop での実測。版が上がったら確かめ直す。
