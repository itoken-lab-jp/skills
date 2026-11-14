# つなぎ先の設定の書き方

SKILL.md の「つなぎ先の設定」の細部。

```toml
[sales]                       # 接続名（query などに渡す）
kind = "oracle"               # postgres・mysql・sqlserver・oracle
host = "db01.example.local"
port = 1521                   # 省略すると種類ごとの既定（5432・3306・1433・1521）
database = "ORCLPDB1"         # Oracle はサービス名。ほかは DB の名前
user = "reader"
password_env = "DB_SALES_PASSWORD"

[report]
kind = "sqlserver"
host = "sql01"
database = "Report"
auth = "windows"              # Windows の認証（Windows だけ。user と password_env は要らない）
trust_cert = true             # 社内の自己署名の証明書を確かめずに通す

[cloudsql]
kind = "mysql"
host = "10.1.2.3"
database = "app"
user = "reader"
password_env = "DB_CLOUDSQL_PASSWORD"
ca_cert = "cloudsql-ca.pem"   # この CA でサーバーの証明書を確かめる（相対パスは db.toml の置き場から）
verify_host = false           # IP でつなぎ、証明書に IP が無いとき（鎖だけ確かめる）
```

- `tls`：暗号化する。sqlserver は既定で `true`、ほかは `false`（`ca_cert` か `trust_cert` を書くと `true`）。Oracle で `true` にすると `tcps://` でつなぐ。サーバーの証明書は、PostgreSQL・SQL Server は OS の証明書ストアの CA で、MySQL は exe に入っている CA の一覧（webpki-roots。OS の証明書ストアではないので、社内の CA を OS に入れても効かない）で確かめる。Oracle は `ca_cert`・`trust_cert` を受け付けない（`tcps://` がどの CA で確かめるかは確かめていない）。
- 自分の CA を使う DB（Cloud SQL・社内の自己署名）で `invalid peer certificate: UnknownIssuer` が出たら、次の順で選ぶ。
  1. `ca_cert`（postgres・mysql）：その DB の CA の証明書（PEM）を置いて確かめる。勧めるのはこちら。Cloud SQL の CA は `gcloud sql instances describe <インスタンス> --format="value(serverCaCert.cert)" > cloudsql-ca.pem` で取れる（ユーザーに取ってもらう）。証明書の名前とつなぐ `host` が合わず `certificate not valid for name` が出たら（Cloud SQL を IP でつなぐときなど）、`verify_host = false` で名前を照らさず鎖だけ確かめる（MySQL の `--ssl-mode=VERIFY_CA`、PostgreSQL の `sslmode=verify-ca`）。`ca_cert` を書くと、MySQL も PostgreSQL も、その CA だけを信じる（公の CA の一覧は使わない）。
  2. `trust_cert`（sqlserver・postgres・mysql）：証明書を確かめずに暗号化だけする（MySQL の `--ssl-mode=REQUIRED`）。CA を取れないときの逃げ道で、相手が本物のサーバーかは確かめないので、使うことをユーザーに伝える。
- `connect_string`（oracle だけ）：`host`・`port`・`database` の代わりに、接続文字列（`db01:1521/ORCLPDB1` や `(DESCRIPTION=...)`）をそのまま書く。暗号化は接続文字列に `tcps://` で書き、`tls` は書かない。
