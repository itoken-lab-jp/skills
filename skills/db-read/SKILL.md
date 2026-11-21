---
name: db-read
description: DB（PostgreSQL・MySQL・SQL Server・Oracle）を読む・表や列を調べる・問い合わせの結果を CSV や JSON にするときに、使い捨てのスクリプトやドライバを入れずに、この Skill に入っている道具 db-read で読む手順。読むだけで、書き換えはしない。DB を書き換えるとき、DB の管理（ユーザー・権限・バックアップ）には使わない。
---

# DB を読む

DB は、Python などでドライバを入れてスクリプトを書かずに、この Skill に入っている道具 `db-read` で読む（スクリプトは入れる・走らせる・直すの往復で遅く、メモリも食う）。どの DB もクライアントのライブラリ（Oracle の Instant Client・ODBC のドライバなど）は要らない。この道具が使える間は、読み取りのためのスクリプトを書かない。

## 道具の場所

この SKILL.md と同じフォルダーの `scripts/` に、OS ごとの実行ファイルがある。PATH には入っていないので、フルパスで呼ぶ（パスに空白があれば引用符で囲む）。実行の権限は付けてある。

- Windows（x64）：`scripts/windows-x64/db-read.exe`
- Mac（Apple シリコン）：`scripts/mac-arm64/db-read`
- Linux（x64）：`scripts/linux-x64/db-read`

この Skill のフォルダーはエージェントごとに違う（Claude は `~/.claude/skills/db-read`、Codex は `~/.agents/skills/db-read`、Antigravity のアプリと IDE は `~/.gemini/config/skills/db-read`、Antigravity CLI は `~/.gemini/antigravity-cli/skills/db-read`、Kiro は `~/.kiro/skills/db-read`）。中身はどれも同じ。上の3つの OS に当たらない機械（Intel の Mac、ARM の Windows など）では動かないので、下の「読めないとき」に進む。以下、例ではフルパスを `db-read` と略す。`db-read --help` で全部のコマンドと引数が出る。

## つなぎ先の設定

つなぎ先は、PC ごとの `~/.config/db-read/db.toml`（Windows は `%USERPROFILE%\.config\db-read\db.toml`）に名前を付けて書く。リポジトリには置かない。パスワードはファイルにも引数にも書かず、環境変数の名前を書く（環境変数はユーザーに入れてもらう。エージェントがパスワードを聞いて書き込まない）。

設定を書く前と、つなぐときにエラーが出たときは [references/connections.md](references/connections.md) を読む。設定の例（Oracle、SQL Server の Windows の認証、Cloud SQL の MySQL）、暗号化（`tls`）、自分の CA を使う DB で `UnknownIssuer` や `certificate not valid for name` が出たときの `ca_cert`・`verify_host`・`trust_cert` の選び方、Oracle の `connect_string` と暗号化（`ca_cert`・`trust_cert` は受け付けない）がある。

- 設定が無い、または目的の DB が無いときは、ユーザーに行き先（種類・ホスト・DB の名前・ユーザー）を聞いて書く。読むだけの権限のユーザーを使うよう勧める。ホームの設定の書き換えは権限の判定で止められることがあるので、止められたら別の道で書かず、書く中身をユーザーに渡す。
- 別の場所の設定を使うときは `--config 設定.toml` か、環境変数 `DB_READ_CONFIG`。
- `db-read conns` で、書いてある接続の名前と行き先が出る（パスワードは出さない）。

## 進め方

1. **表を探す**：`db-read tables sales`（`--schema 名前` で別のスキーマ）。`schema,name,type` の CSV で出る。既定は、Oracle はログインしたユーザーのスキーマ、SQL Server はそのユーザーの既定のスキーマ（`SCHEMA_NAME()`。多くは `dbo`）。
2. **列を見る**：`db-read columns sales 売上明細`（`スキーマ.表` も可）。`name,type,nullable` が出る。
3. **問い合わせる**：`db-read query sales "SELECT 部門, SUM(金額) AS 金額 FROM 売上明細 WHERE 年月 = '2026-10' GROUP BY 部門"`。長い SQL は `--file 問い合わせ.sql`。
   - 集計・絞り込み・結合は、できるだけ DB の SQL の中で行う。DB から全部の行を出してから手元で集計しない（重いのは転送）。
   - 大きな表は、まず `COUNT(*)` で行数を見てから出す。
4. **出力を受け取る**：既定は標準出力に CSV（見出しの行付き）。標準出力には先頭の 200 行までを出し、続きがあれば標準エラーに「200 行で止めた」と出る。全部が要るなら `--out 結果.csv` でファイルに書く（`--out` のときは行数で止めない）。`--max-rows 1000` で行数を変え、`--max-rows 0` で全部。`--format jsonl` で1行1件の JSON、`--bom` で先頭に BOM を付ける（ユーザーが Excel で開く CSV のとき）。
5. **集計に回す**：DB の SQL で済ませられなかった集計は、出した CSV や JSON を、量が少なければそのまま読んで行い、多ければ SQL で集計できる道具（DuckDB など）で行う。

## 共通の約束

- 出力は UTF-8（BOM なし）。**Windows の PowerShell**：コンソールの文字コードが UTF-8 でないと化けるので、呼ぶ前に `[Console]::OutputEncoding = [Text.Encoding]::UTF8` を実行し、大きな出力は `--out` で書いてそのファイルを読む（Windows PowerShell 5.1 の `>` は UTF-16 のファイルになるので使わない）。
- **標準エラーも必ず読む**。終了コードが 0 でも、行数で止めた・0行だった・同じ名前の列に `_2` を付けた、を `db-read: 注意：…` で知らせる。
- 値の書き方：数は DB が返した桁のまま（大きな整数も小数の桁も丸めない。JSON でも数として出す）、日時は `2026-10-30T14:05:06.123`（秒の小数は DB が返した桁のまま。MySQL は列の桁まで 0 で埋まる）、時差付きは `+09:00` か `Z`（Oracle の時差付きの列は UTC に直った時刻で `Z`）、日付は `2026-10-30`（Oracle の DATE は時刻を持つので `2026-10-30T00:00:00`）、真偽は `true`・`false`（MySQL の BOOLEAN は中身が数なので `1`・`0`）、バイト列は `0x00FF`、NULL は CSV では空、JSON では `null`。
- 列の名前は DB が返したまま（Oracle は引用符で囲まない名前が大文字になる）。
- 終了コード：0 は成功、1 は読めない（設定・接続・SQL の誤り。DB の言葉と行き先が標準エラーに出る）、2 は使い方の誤り。1 のときの標準出力は途中までのことがあるので使わない（`--out` のファイルは書き換えず、前の中身のまま残す）。

## 読むだけの守り

本番の DB を誤って書き換えないことと、読むことで本番を止めないことが目的。

- 本当の守りは、読むだけの権限のユーザーでつなぐこと。道具の守りは誤操作よけにとどまる。書き換えが要る作業はこの道具ではしない。ユーザーに確かめてから、別の手段で行う。
- 道具は、`SELECT`・`WITH`・`SHOW`・`DESCRIBE`・`DESC`・`EXPLAIN` で始まる文1つだけを通し、DB の側も読み取り専用にしてから走らせる。断られたら（終了コード 1）、文を分けるか、書き換えを含まない形に直す。断られた理由が分からないときは [references/guard.md](references/guard.md) を読む（どの DB で何を断るかの細部）。
- 守りが見るのは文の形で、`SELECT` の中から呼ぶ関数の中身は見ない。副作用のある関数（Oracle の自律型トランザクションの関数、PostgreSQL の `pg_cancel_backend`・`dblink` など）は、読み取り専用でも書き換えや操作が確定することがあるので、呼ばない。
- 読むだけでも、重い `SELECT` は本番の DB の負荷とロックになる（SQL Server の既定の隔離レベルでは、読んでいる間の共有ロックが更新を待たせる）。大きな表は、件数を見てから、絞って読む。

## できないこと

- 書き換え（上の通り）。ストアドプロシージャの呼び出し。
- 問い合わせの途中で値を渡すこと（バインド変数）。SQL に書き込む（文字は `'` を重ねて囲む）。
- Oracle のウォレット・Kerberos・LDAP の名前解決、SQL Server の Kerberos（Windows の認証は Windows の PC だけ）。PostgreSQL・MySQL のクライアントの証明書。
- Oracle の LONG・XMLType・オブジェクト型の列、PostgreSQL の配列や独自の型は、文字か読めない列（終了コード 1）になる。読めない列は SQL で文字に直す（Oracle は `TO_CHAR`、PostgreSQL は `::text`）。
- DB2・SQLite などほかの DB。

## 読めないとき

- つながらない（時間切れ・拒否）：行き先・ポート・VPN・ファイアウォールを疑い、ユーザーに伝える。15秒で時間切れになる。
- 認証の誤り：パスワードの環境変数が入っているかを `db-read` の言葉で確かめ（「環境変数 X にパスワードがありません」）、ユーザーに入れてもらう。パスワードを会話に書いてもらわない。
- 実行ファイルが起動しない（アクセスが拒否された、ウイルス対策が止めた）ときは、業務用の PC の制限（AppLocker・Defender など）のことがある。外そうとせず、ユーザーに伝える。

道具がエラーで止まった、合う実行ファイルが無い、のどちらかなら、理由をユーザーに伝えてから、ほかの手段に移る。どの手段が使えるかは、全体の指示ファイル（`~/.claude/CLAUDE.md`・`~/.codex/AGENTS.md` など）にその PC の事情が書いてあれば従う。
