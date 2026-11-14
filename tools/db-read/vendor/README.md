# 手直しして使うクレート

`Cargo.toml` の `[patch.crates-io]` で、crates.io の版の代わりにここを使う。

- `mysql`（28.0.4、MIT・Apache-2.0）：`src/io/tls/rustls_io.rs` の1か所だけ変えた。`root_cert_path`（db.toml の `ca_cert`）があるときは、組み込みの公の CA の一覧（webpki-roots）を足さず、その CA だけを信じる。元のままだと、`verify_host = false`（`skip_domain_validation`）と合わせると、公の CA が出した証明書なら名前を問わず通った（自動レビューの指摘）。SslOpts には一覧を外す手も、検証器を渡す手も無い。
  - 版を上げるときは、新しい版のソースを crates.io から取ってきて同じ手直しをするか、上流に同じ手が入っていればこの手直しを外す。
  - 変えたファイルは exe の指紋（`build.rs`・`test/db-read.test.mjs`）に入れてある。
