# レポートの CLI `powerbi-report-author`

`@microsoft/powerbi-report-authoring-cli`（2026-10-16 に 0.5.0、MIT）。0.x はプレビューで形が変わりうるので、版を固定する（`npx -y @microsoft/powerbi-report-authoring-cli@0.5.0 ...` か、プロジェクトの devDependency）。Microsoft の skills-for-fabric にある `powerbi-report-cli` が呼ぶ道具で、それを入れなくても使える。

| コマンド | 使いどころ |
| --- | --- |
| `validate <.Report>` | 手で書いた PBIR を Desktop で開く前に検査する。誤検出があるので、警告は中身を見て判断する（2026-10-16：標準のウォーターフォールのドリルの階層（Category に複数、`active` は先頭だけ）を役割の上限超えとし、Desktop が付けたテーマのファイル名を名前の不一致とした） |
| `catalog describe <visualType>` | 標準ビジュアルの役割名・上限・必須 |
| `formatting list-objects`・`describe-object`・`search` | 標準ビジュアルの書式のカードとプロパティ、値の型 |
| `expr encode <値> --kind <bool・number・integer・string・color・themeColor>` | PBIR の値の書き方 |
| `scaffold` | 新しいレポートの雛形（オフラインで作れる） |
| `preview-pages`・`preview-visuals`・`preview-filters`・`preview-themes` | ページ・ビジュアル・フィルター・テーマの一覧と、それぞれのファイルのパス。PBIR を全部読む前の当たり付け |
| `preview <.Report> --host desktop`（`--status`・`--reload`・`--reload-with-model`・`--screenshot <png> [--page <id>・--all-pages]`） | 開いている Desktop への読み直しと撮影を、渡したフォルダーに結び付けて行う |

- 載っているのは標準ビジュアルだけで、Desktop の新しい版に遅れる。2026-10-16 の 0.5.0 では、標準のウォーターフォールの `plotArea` は `transparency` だけで、10 月版の 1 色の塗りがまだ無かった。カスタムビジュアルの visual.json は「未知の visualType」の警告になり、中は見ない。
- `preview <.Report> --host desktop` は、渡したフォルダーを開いている Desktop にだけつなぎ、違うファイルの窓や確かめられない窓では、読み直しも撮影もせずに失敗する。Desktop は起動せず、つなぐだけ。`--status` の `details.hasUnsavedChanges` は、分からないときは false でなく null。`--reload` が未保存の変更を捨てるのは Bridge の CLI と同じ。`--reload-with-model` はモデルの定義ごと読み直す（0.5.0 の CHANGELOG・`--help`・`dist/cli.js`、2026-10-26）。どれも実機では試していない。取り違えを止められるので、試して使えたら Bridge の CLI より先に選ぶ。
- `preview --host service`（ヘッドレスのブラウザー）は、発行済みのモデルとワークスペースが要る。

## skills-for-fabric の `powerbi-report-cli` について

Learn の名前は「Power BI Report skill」（以前は `powerbi-report-authoring`）。手順の考え方（validate のあとは読み込み・変えたページを全部撮る・見直す・直すを繰り返す、status を先に見て未保存なら止まる、reload と撮影を別のコマンドにする）は、この Skill と同じ。入れて使うときは、その縛りの規則（Desktop のコマンドが失敗したら原因を調べずにターンを終える、撮った画像を消す、頼まれなくてもサービスのプレビューを開く）が自分の作業に合うかを先に見る。
