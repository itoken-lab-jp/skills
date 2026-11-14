# 読むだけの守りの細部

SKILL.md の「読むだけの守り」の細部。道具に断られた理由を知りたいとき、Oracle で読み取り専用ゆえのエラーが出たときに読む。

## 道具が DB につなぐ前に断るもの

- 最初の語が `SELECT`・`WITH`・`SHOW`・`DESCRIBE`・`DESC`・`EXPLAIN` でない文（`INSERT`・`UPDATE`・`DELETE`・`CREATE`・`EXEC`・`BEGIN` など）と、`;` で区切った2つ目の文。終了コード 1。
- SQL Server は `;` の無い2つ目の文を続けられるので、文字列とコメントの外に `COMMIT`・`DELETE`・`INTO`・`EXEC`・`SET`・`OPENQUERY` などの語があれば断る（`[delete]` のように囲んだ列の名前は通る）。読み違えを避けるため、`]]` を含む SQL と、入れ子のコメント（`/*` の中の `/*`）も断る。結果の表が2つ以上ある文も断る。

## DB の側の読み取り専用

- PostgreSQL・MySQL はセッションを、Oracle はトランザクションを読み取り専用にする（`WITH ... DELETE` や `SELECT ... FOR UPDATE` は DB が断る）。MySQL は文を2つ以上含むものを DB の側で断る。
- SQL Server はトランザクションに入れて最後に巻き戻す。文の中でトランザクションが閉じられていたら、書き換えが確定したおそれがあると知らせて終了コード 1。

## Oracle で読み取り専用ゆえに出るエラー

- `EXPLAIN PLAN FOR ...` は PLAN_TABLE に書き込むので、`ORA-01456` で通らない。実行計画は使えない。
- 直前に作り直された表を読むと `ORA-01466` になることがある。少し待って読み直す。
