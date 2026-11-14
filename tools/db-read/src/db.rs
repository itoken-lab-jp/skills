// DB ごとの接続と読み取り。どの DB も、問い合わせの前に DB の側を読み取り専用にする
// （PostgreSQL・MySQL はセッションを、Oracle はトランザクションを。SQL Server はトランザクションに入れて最後に巻き戻す）。
// 値は、数は DB が返した文字のまま、日時は 2026-01-02T03:04:05 の形にそろえる。
use crate::config::{Conn, Kind};
use crate::out::{Cell, Sink};
use std::time::Duration;

pub enum Request {
    Tables(Option<String>),
    Columns(String),
    Query(String),
}

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const MULTI_RESULTS: &str = "結果の表が2つ以上ある。文は1つにする";

// 文字の値を SQL の文字列に入れる（' を重ねる）
fn lit(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

// "schema.table" を分ける
fn split_table(t: &str) -> (Option<&str>, &str) {
    match t.rsplit_once('.') {
        Some((s, n)) => (Some(s), n),
        None => (None, t),
    }
}

fn catalog_sql(kind: Kind, req: &Request) -> Option<String> {
    match req {
        Request::Query(_) => None,
        Request::Tables(schema) => Some(match kind {
            Kind::Postgres => format!(
                "SELECT table_schema AS schema, table_name AS name, table_type AS type FROM information_schema.tables WHERE table_schema = {} ORDER BY 1, 2",
                schema.as_deref().map(lit).unwrap_or("current_schema()".into())
            ),
            Kind::Mysql => format!(
                "SELECT table_schema AS `schema`, table_name AS name, table_type AS type FROM information_schema.tables WHERE table_schema = {} ORDER BY 1, 2",
                schema.as_deref().map(lit).unwrap_or("DATABASE()".into())
            ),
            Kind::Sqlserver => format!(
                "SELECT TABLE_SCHEMA AS [schema], TABLE_NAME AS name, TABLE_TYPE AS type FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = {} ORDER BY 1, 2",
                schema.as_deref().map(lit).unwrap_or("SCHEMA_NAME()".into())
            ),
            Kind::Oracle => {
                let owner = schema.as_deref().map(|s| format!("IN ({o}, UPPER({o}))", o = lit(s))).unwrap_or("= USER".into());
                format!(
                    "SELECT owner AS \"schema\", object_name AS \"name\", object_type AS \"type\" FROM all_objects WHERE owner {owner} AND object_type IN ('TABLE', 'VIEW', 'MATERIALIZED VIEW') ORDER BY 1, 2"
                )
            }
        }),
        Request::Columns(t) => {
            let (schema, name) = split_table(t);
            Some(match kind {
                Kind::Postgres => format!(
                    "SELECT column_name AS name, data_type AS type, is_nullable AS nullable FROM information_schema.columns WHERE table_name = {} AND table_schema = {} ORDER BY ordinal_position",
                    lit(name),
                    schema.map(lit).unwrap_or("current_schema()".into())
                ),
                Kind::Mysql => format!(
                    "SELECT column_name AS name, column_type AS type, is_nullable AS nullable FROM information_schema.columns WHERE table_name = {} AND table_schema = {} ORDER BY ordinal_position",
                    lit(name),
                    schema.map(lit).unwrap_or("DATABASE()".into())
                ),
                Kind::Sqlserver => format!(
                    "SELECT COLUMN_NAME AS name, DATA_TYPE AS type, IS_NULLABLE AS nullable FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = {} AND TABLE_SCHEMA = {} ORDER BY ORDINAL_POSITION",
                    lit(name),
                    schema.map(lit).unwrap_or("SCHEMA_NAME()".into())
                ),
                Kind::Oracle => format!(
                    "SELECT column_name AS \"name\", data_type || CASE WHEN data_type IN ('VARCHAR2', 'NVARCHAR2', 'CHAR', 'NCHAR') THEN '(' || char_length || ')' WHEN data_type = 'RAW' THEN '(' || data_length || ')' WHEN data_type = 'NUMBER' AND data_precision IS NOT NULL THEN '(' || data_precision || ',' || data_scale || ')' END AS \"type\", CASE nullable WHEN 'Y' THEN 'YES' ELSE 'NO' END AS \"nullable\" FROM all_tab_columns WHERE table_name IN ({n}, UPPER({n})) AND owner {} ORDER BY column_id",
                    schema.map(|s| format!("IN ({o}, UPPER({o}))", o = lit(s))).unwrap_or("= USER".into()),
                    n = lit(name)
                ),
            })
        }
    }
}

pub fn run(conn: &Conn, req: &Request, sink: &mut Sink) -> Result<(), String> {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let sql = match req {
        Request::Query(q) => q.clone(),
        _ => catalog_sql(conn.kind, req).unwrap(),
    };
    let r = match conn.kind {
        Kind::Postgres => pg::run(conn, &sql, sink),
        Kind::Mysql => my::run(conn, &sql, sink),
        Kind::Sqlserver => ms::run(conn, &sql, sink),
        Kind::Oracle => ora::run(conn, &sql, sink),
    };
    let r = r.map_err(|e| format!("{}（{}）：{e}", conn.kind.name(), conn.describe()));
    if r.is_ok() && matches!(req, Request::Columns(_)) && sink_rows_zero(sink) {
        return Err("その表が見つかりません（名前・スキーマ・見る権限を確かめる）".into());
    }
    r
}

fn sink_rows_zero(sink: &Sink) -> bool {
    sink.rows() == 0
}

fn hex(b: &[u8]) -> String {
    let mut s = String::with_capacity(2 + b.len() * 2);
    s.push_str("0x");
    for x in b {
        s.push_str(&format!("{x:02X}"));
    }
    s
}

// "2026-01-02 03:04:05" → "2026-01-02T03:04:05"
fn iso(s: &str) -> String {
    match s.find(' ') {
        Some(i) if i == 10 => format!("{}T{}", &s[..i], &s[i + 1..]),
        _ => s.to_string(),
    }
}

// PostgreSQL の TLS。既定は OS の証明書ストアの CA で確かめる。ca_cert はその CA だけで確かめ（verify_host = false なら
// ホスト名を照らさず鎖だけ）、trust_cert は証明書を確かめずに暗号化だけする。MySQL は mysql クレートの SslOpts で同じ形にする。
fn tls_config(conn: &Conn) -> Result<rustls::ClientConfig, String> {
    use rustls::pki_types::{pem::PemObject, CertificateDer};
    use std::sync::Arc;
    let builder = rustls::ClientConfig::builder();
    if conn.trust_cert {
        let provider = rustls::crypto::CryptoProvider::get_default().ok_or("暗号の実装が入っていない")?.clone();
        return Ok(builder.dangerous().with_custom_certificate_verifier(Arc::new(verify::Any(provider))).with_no_client_auth());
    }
    let mut roots = rustls::RootCertStore::empty();
    match &conn.ca_cert {
        Some(path) => {
            let certs: Vec<CertificateDer> = CertificateDer::pem_file_iter(path)
                .and_then(|it| it.collect::<Result<_, _>>())
                .map_err(|e| format!("ca_cert {} を読めません（{e}）", path.display()))?;
            if certs.is_empty() {
                return Err(format!("ca_cert {} に証明書（-----BEGIN CERTIFICATE-----）がありません", path.display()));
            }
            for c in certs {
                roots.add(c).map_err(|e| format!("ca_cert {} の証明書を使えません（{e}）", path.display()))?;
            }
        }
        None => {
            for cert in rustls_native_certs::load_native_certs().certs {
                let _ = roots.add(cert);
            }
        }
    }
    if conn.ca_cert.is_some() && !conn.verify_host() {
        let inner = rustls::client::WebPkiServerVerifier::builder(Arc::new(roots)).build().map_err(|e| e.to_string())?;
        return Ok(builder.dangerous().with_custom_certificate_verifier(Arc::new(verify::ChainOnly(inner))).with_no_client_auth());
    }
    Ok(builder.with_root_certificates(roots).with_no_client_auth())
}

mod verify {
    use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
    use rustls::client::WebPkiServerVerifier;
    use rustls::crypto::{verify_tls12_signature, verify_tls13_signature, CryptoProvider};
    use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
    use rustls::{CertificateError, DigitallySignedStruct, Error, SignatureScheme};
    use std::sync::Arc;

    // trust_cert：証明書は確かめない。鍵交換の署名は確かめる（証明書の鍵を持つ相手と話していること）
    #[derive(Debug)]
    pub struct Any(pub Arc<CryptoProvider>);

    impl ServerCertVerifier for Any {
        fn verify_server_cert(&self, _: &CertificateDer<'_>, _: &[CertificateDer<'_>], _: &ServerName<'_>, _: &[u8], _: UnixTime) -> Result<ServerCertVerified, Error> {
            Ok(ServerCertVerified::assertion())
        }
        fn verify_tls12_signature(&self, m: &[u8], c: &CertificateDer<'_>, d: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, Error> {
            verify_tls12_signature(m, c, d, &self.0.signature_verification_algorithms)
        }
        fn verify_tls13_signature(&self, m: &[u8], c: &CertificateDer<'_>, d: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, Error> {
            verify_tls13_signature(m, c, d, &self.0.signature_verification_algorithms)
        }
        fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
            self.0.signature_verification_algorithms.supported_schemes()
        }
    }

    // ca_cert と verify_host = false：鎖・期限は確かめ、ホスト名の食い違いだけを通す
    #[derive(Debug)]
    pub struct ChainOnly(pub Arc<WebPkiServerVerifier>);

    impl ServerCertVerifier for ChainOnly {
        fn verify_server_cert(&self, e: &CertificateDer<'_>, i: &[CertificateDer<'_>], n: &ServerName<'_>, o: &[u8], now: UnixTime) -> Result<ServerCertVerified, Error> {
            match self.0.verify_server_cert(e, i, n, o, now) {
                Err(Error::InvalidCertificate(CertificateError::NotValidForName | CertificateError::NotValidForNameContext { .. })) => Ok(ServerCertVerified::assertion()),
                r => r,
            }
        }
        fn verify_tls12_signature(&self, m: &[u8], c: &CertificateDer<'_>, d: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, Error> {
            self.0.verify_tls12_signature(m, c, d)
        }
        fn verify_tls13_signature(&self, m: &[u8], c: &CertificateDer<'_>, d: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, Error> {
            self.0.verify_tls13_signature(m, c, d)
        }
        fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
            self.0.supported_verify_schemes()
        }
    }
}

mod pg {
    use super::*;
    use futures_util::{pin_mut, TryStreamExt};
    use tokio_postgres::types::Type;
    use tokio_postgres::SimpleQueryMessage;

    #[derive(Clone, Copy)]
    enum K {
        Num,
        Bool,
        Stamp,
        Bytes,
        Text,
    }

    // "2026-10-30 05:05:06+00" → "2026-10-30T05:05:06+00:00"
    fn stamp(v: &str) -> String {
        let s = iso(v);
        let b = s.as_bytes();
        let n = b.len();
        if n > 3 && (b[n - 3] == b'+' || b[n - 3] == b'-') && s.len() > 19 {
            return format!("{s}:00");
        }
        s
    }

    fn kind_of(t: &Type) -> K {
        match *t {
            Type::INT2 | Type::INT4 | Type::INT8 | Type::OID | Type::FLOAT4 | Type::FLOAT8 | Type::NUMERIC => K::Num,
            Type::BOOL => K::Bool,
            Type::TIMESTAMP | Type::TIMESTAMPTZ => K::Stamp,
            Type::BYTEA => K::Bytes,
            _ => K::Text,
        }
    }

    // tokio-postgres の Display は「db error」としか言わないので、DB の文を出す
    fn pe(e: tokio_postgres::Error) -> String {
        match e.as_db_error() {
            Some(d) => format!("{} {}", d.code().code(), d.message()),
            None => {
                // TLS の失敗は原因（invalid peer certificate: UnknownIssuer など）が source の側にある
                let mut msg = e.to_string();
                let mut src = std::error::Error::source(&e);
                while let Some(s) = src {
                    msg.push_str(&format!("：{s}"));
                    src = s.source();
                }
                msg
            }
        }
    }

    pub fn run(conn: &Conn, sql: &str, sink: &mut Sink) -> Result<(), String> {
        let mut cfg = tokio_postgres::Config::new();
        cfg.host(conn.host()).port(conn.port()).user(conn.user()?).password(conn.password()?).connect_timeout(CONNECT_TIMEOUT);
        if let Some(d) = &conn.database {
            cfg.dbname(d);
        }
        cfg.application_name("db-read");
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().map_err(|e| e.to_string())?;
        rt.block_on(async {
            let client = if conn.tls() {
                cfg.ssl_mode(tokio_postgres::config::SslMode::Require);
                let (c, cn) = cfg.connect(tokio_postgres_rustls::MakeRustlsConnect::new(tls_config(conn)?)).await.map_err(pe)?;
                tokio::spawn(cn);
                c
            } else {
                let (c, cn) = cfg.connect(tokio_postgres::NoTls).await.map_err(pe)?;
                tokio::spawn(cn);
                c
            };
            client.batch_execute("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY").await.map_err(pe)?;
            // 列の型は prepare で知り、値は文字の形（DB の表し方のまま）で流しながら受け取る
            let st = client.prepare(sql).await.map_err(pe)?;
            let kinds: Vec<K> = st.columns().iter().map(|c| kind_of(c.type_())).collect();
            sink.header(st.columns().iter().map(|c| c.name().to_string()).collect())?;
            let stream = client.simple_query_raw(sql).await.map_err(pe)?;
            pin_mut!(stream);
            let mut cells = Vec::with_capacity(kinds.len());
            while let Some(msg) = stream.try_next().await.map_err(pe)? {
                if let SimpleQueryMessage::Row(r) = msg {
                    cells.clear();
                    for (i, k) in kinds.iter().enumerate() {
                        cells.push(match (r.get(i), k) {
                            (None, _) => Cell::Null,
                            (Some(v), K::Num) if v.parse::<f64>().map(|f| f.is_finite()).unwrap_or(false) => Cell::Num(v.to_string()),
                            (Some(v), K::Bool) => Cell::Bool(v == "t"),
                            (Some(v), K::Stamp) => Cell::Text(stamp(v)),
                            // bytea の文字の形は \x00ff。ほかの DB とそろえて 0x00FF にする
                            (Some(v), K::Bytes) => Cell::Text(format!("0x{}", v.trim_start_matches("\\x").to_uppercase())),
                            (Some(v), _) => Cell::Text(v.to_string()),
                        });
                    }
                    if !sink.row(&cells)? {
                        break;
                    }
                }
            }
            Ok(())
        })
    }
}

mod my {
    use super::*;
    use mysql::consts::ColumnType as T;
    use mysql::prelude::Queryable;

    #[derive(Clone, Copy)]
    enum K {
        Num,
        Stamp,
        Binary,
        Text,
    }

    pub fn run(conn: &Conn, sql: &str, sink: &mut Sink) -> Result<(), String> {
        let mut opts = mysql::OptsBuilder::new()
            .ip_or_hostname(Some(conn.host()))
            .tcp_port(conn.port())
            .user(Some(conn.user()?))
            .pass(Some(conn.password()?))
            .db_name(conn.database.clone())
            .prefer_socket(false)
            .tcp_connect_timeout(Some(CONNECT_TIMEOUT))
            .init(vec!["SET NAMES utf8mb4", "SET SESSION TRANSACTION READ ONLY"]);
        if conn.tls() {
            // 既定は mysql クレートに入っている CA の一覧（webpki-roots。OS の証明書ストアではない）で確かめる。
            // ca_cert があるときは、その CA だけで確かめる（mysql クレートの手直し。vendor/README.md）
            let ssl = mysql::SslOpts::default()
                .with_root_cert_path(conn.ca_cert.clone())
                .with_danger_skip_domain_validation(conn.ca_cert.is_some() && !conn.verify_host())
                .with_danger_accept_invalid_certs(conn.trust_cert);
            if let Some(ca) = &conn.ca_cert {
                std::fs::metadata(ca).map_err(|e| format!("ca_cert {} を読めません（{e}）", ca.display()))?;
            }
            opts = opts.ssl_opts(ssl);
        }
        let mut c = mysql::Conn::new(opts).map_err(|e| e.to_string())?;
        // mysql クレートはいつも複数の文を許してつなぐ。prepare は1文しか受けないので、先に通して2つ目以降の文を断る
        // （文字列の中の \' や # のコメントの読み方の違いで、guard の見立てとずれても、ここで止まる）
        let st = c.prep(sql).map_err(|e| e.to_string())?;
        let _ = c.close(st);
        let mut res = c.query_iter(sql).map_err(|e| e.to_string())?;
        let cols = res.columns();
        let kinds: Vec<K> = cols
            .as_ref()
            .iter()
            .map(|c| match c.column_type() {
                T::MYSQL_TYPE_TINY
                | T::MYSQL_TYPE_SHORT
                | T::MYSQL_TYPE_LONG
                | T::MYSQL_TYPE_INT24
                | T::MYSQL_TYPE_LONGLONG
                | T::MYSQL_TYPE_FLOAT
                | T::MYSQL_TYPE_DOUBLE
                | T::MYSQL_TYPE_DECIMAL
                | T::MYSQL_TYPE_NEWDECIMAL
                | T::MYSQL_TYPE_YEAR => K::Num,
                T::MYSQL_TYPE_DATETIME | T::MYSQL_TYPE_TIMESTAMP | T::MYSQL_TYPE_DATETIME2 | T::MYSQL_TYPE_TIMESTAMP2 => K::Stamp,
                // 文字の型で文字集合が 63（binary）のものは BINARY・VARBINARY・BLOB。BIT もバイトで返る
                T::MYSQL_TYPE_BIT => K::Binary,
                T::MYSQL_TYPE_STRING
                | T::MYSQL_TYPE_VAR_STRING
                | T::MYSQL_TYPE_VARCHAR
                | T::MYSQL_TYPE_BLOB
                | T::MYSQL_TYPE_TINY_BLOB
                | T::MYSQL_TYPE_MEDIUM_BLOB
                | T::MYSQL_TYPE_LONG_BLOB
                    if c.character_set() == 63 =>
                {
                    K::Binary
                }
                _ => K::Text,
            })
            .collect();
        sink.header(cols.as_ref().iter().map(|c| c.name_str().to_string()).collect())?;
        let mut cells = Vec::with_capacity(kinds.len());
        if let Some(set) = res.iter() {
            for row in set {
                let row = row.map_err(|e| e.to_string())?;
                cells.clear();
                for (v, k) in row.unwrap().into_iter().zip(&kinds) {
                    cells.push(match (v, k) {
                        (mysql::Value::NULL, _) => Cell::Null,
                        (mysql::Value::Bytes(b), K::Binary) => Cell::Text(hex(&b)),
                        (mysql::Value::Bytes(b), k) => {
                            let s = String::from_utf8_lossy(&b).into_owned();
                            match k {
                                K::Num => Cell::Num(s),
                                K::Stamp => Cell::Text(iso(&s)),
                                _ => Cell::Text(s),
                            }
                        }
                        (other, _) => Cell::Text(other.as_sql(true).trim_matches('\'').to_string()),
                    });
                }
                if !sink.row(&cells)? {
                    break;
                }
            }
        }
        Ok(())
    }
}

mod ms {
    use super::*;
    use futures_util::TryStreamExt;
    use tiberius::{AuthMethod, ColumnData as D, EncryptionLevel, FromSql};
    use tokio_util::compat::TokioAsyncWriteCompatExt;

    fn cell(d: &D<'static>) -> Cell {
        let t = |s: Option<String>| s.map(Cell::Text).unwrap_or(Cell::Null);
        let n = |s: Option<String>| s.map(Cell::Num).unwrap_or(Cell::Null);
        match d {
            D::Bit(v) => v.map(Cell::Bool).unwrap_or(Cell::Null),
            D::U8(v) => n(v.map(|x| x.to_string())),
            D::I16(v) => n(v.map(|x| x.to_string())),
            D::I32(v) => n(v.map(|x| x.to_string())),
            D::I64(v) => n(v.map(|x| x.to_string())),
            D::F32(v) => n(v.filter(|x| x.is_finite()).map(|x| x.to_string())),
            D::F64(v) => n(v.filter(|x| x.is_finite()).map(|x| x.to_string())),
            D::Numeric(v) => n(v.map(|x| x.to_string())),
            D::String(v) => t(v.as_ref().map(|x| x.to_string())),
            D::Guid(v) => t(v.map(|x| x.to_string().to_uppercase())),
            D::Binary(v) => t(v.as_ref().map(|x| hex(x))),
            D::Xml(v) => t(v.as_ref().map(|x| x.to_string())),
            D::Date(_) => t(chrono::NaiveDate::from_sql(d).ok().flatten().map(|x| x.to_string())),
            D::Time(_) => t(chrono::NaiveTime::from_sql(d).ok().flatten().map(|x| x.to_string())),
            D::DateTime(_) | D::SmallDateTime(_) | D::DateTime2(_) => {
                t(chrono::NaiveDateTime::from_sql(d).ok().flatten().map(|x| x.format("%Y-%m-%dT%H:%M:%S%.f").to_string()))
            }
            D::DateTimeOffset(_) => t(chrono::DateTime::<chrono::FixedOffset>::from_sql(d)
                .ok()
                .flatten()
                .map(|x| x.format("%Y-%m-%dT%H:%M:%S%.f%:z").to_string())),
        }
    }

    pub fn run(conn: &Conn, sql: &str, sink: &mut Sink) -> Result<(), String> {
        let mut cfg = tiberius::Config::new();
        cfg.host(conn.host());
        cfg.port(conn.port());
        cfg.application_name("db-read");
        if let Some(d) = &conn.database {
            cfg.database(d);
        }
        if conn.windows_auth() {
            #[cfg(windows)]
            cfg.authentication(AuthMethod::Integrated);
            #[cfg(not(windows))]
            return Err("auth = \"windows\" は Windows でだけ使えます".into());
        } else {
            cfg.authentication(AuthMethod::sql_server(conn.user()?, conn.password()?));
        }
        cfg.encryption(if conn.tls() { EncryptionLevel::Required } else { EncryptionLevel::NotSupported });
        if conn.trust_cert {
            cfg.trust_cert();
        }
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().map_err(|e| e.to_string())?;
        rt.block_on(async {
            let tcp = tokio::time::timeout(CONNECT_TIMEOUT, tokio::net::TcpStream::connect(cfg.get_addr()))
                .await
                .map_err(|_| "接続が時間切れ".to_string())?
                .map_err(|e| e.to_string())?;
            tcp.set_nodelay(true).map_err(|e| e.to_string())?;
            let mut c = tiberius::Client::connect(cfg, tcp.compat_write()).await.map_err(|e| e.to_string())?;
            // SQL Server にはセッションを読み取り専用にする手が無いので、トランザクションに入れて必ず巻き戻す
            c.simple_query("SET XACT_ABORT ON; BEGIN TRANSACTION").await.map_err(|e| e.to_string())?.into_results().await.map_err(|e| e.to_string())?;
            let result: Result<(), String> = async {
                let mut s = c.simple_query(sql).await.map_err(|e| e.to_string())?;
                let cols = s.columns().await.map_err(|e| e.to_string())?.map(|c| c.iter().map(|c| c.name().to_string()).collect::<Vec<_>>());
                sink.header(cols.ok_or("結果の表を返さない文でした（書き換えていれば巻き戻した）")?)?;
                let mut rows = s.into_row_stream();
                let mut cells = Vec::new();
                while let Some(r) = rows.try_next().await.map_err(|e| e.to_string())? {
                    if r.result_index() != 0 {
                        return Err(MULTI_RESULTS.to_string());
                    }
                    cells.clear();
                    for d in r.into_iter() {
                        cells.push(cell(&d));
                    }
                    if !sink.row(&cells)? {
                        break;
                    }
                }
                Ok(())
            }
            .await;
            // 巻き戻す前に、文の中でトランザクションが閉じられていないかを見る（閉じられていれば、書き換えが確定したおそれがある）
            let open = match c.simple_query("SELECT @@TRANCOUNT").await {
                Ok(s) => s.into_row().await.ok().flatten().and_then(|r| r.get::<i32, _>(0)),
                Err(_) => None,
            };
            // 巻き戻す。途中でやめて結果が残っているなどで送れなくても、接続を閉じれば SQL Server が巻き戻す
            if let Ok(s) = c.simple_query("IF @@TRANCOUNT > 0 ROLLBACK").await {
                let _ = s.into_results().await;
            }
            if result.is_ok() && open.is_some() && open != Some(1) {
                return Err("文の中でトランザクションが閉じられた。書き換えが確定したおそれがある".into());
            }
            result
        })
    }
}

mod ora {
    use super::*;
    use oracledb::{OracleIntervalDS, OracleIntervalYM, OracleNumber, OracleTimestamp};

    #[derive(Clone, Copy)]
    enum K {
        Num,
        Float,
        Double,
        Bool,
        Stamp,
        Binary,
        IntervalDs,
        IntervalYm,
        Text,
    }

    fn e(err: oracledb::Error) -> String {
        err.to_string()
    }

    fn stamp(t: &OracleTimestamp) -> String {
        let mut s = format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}", t.year(), t.month(), t.day(), t.hour(), t.minute(), t.second());
        if t.nanoseconds() > 0 {
            s.push_str(format!(".{:09}", t.nanoseconds()).trim_end_matches('0'));
        }
        // 時差付きの列は UTC にした時刻で届く
        if t.is_utc() {
            s.push('Z');
        }
        s
    }

    pub fn run(conn: &Conn, sql: &str, sink: &mut Sink) -> Result<(), String> {
        let target = match &conn.connect_string {
            Some(cs) => cs.clone(),
            None => {
                let svc = conn.database.as_deref().ok_or("oracle には database（サービス名）か connect_string が要ります")?;
                let scheme = if conn.tls() { "tcps://" } else { "" };
                format!("{scheme}{}:{}/{svc}", conn.host(), conn.port())
            }
        };
        let cfg = oracledb::Config::default()
            .set_credentials(conn.user()?, &conn.password()?)
            .set_connect_string(&target)
            .map_err(e)?
            .set_transport_connect_timeout(Some(CONNECT_TIMEOUT))
            .set_program("db-read")
            .map_err(e)?;
        let c = oracledb::connect(cfg).map_err(e)?;
        c.execute("SET TRANSACTION READ ONLY", &[]).map_err(e)?;
        let st = c.statement(sql).map_err(e)?.prefetch_rows(1000).fetch_array_size(1000).build().map_err(e)?;
        let cur = st.query(&[]).map_err(e)?;
        let kinds: Vec<K> = cur
            .columns()
            .iter()
            .map(|m| match m.db_type().name() {
                "DB_TYPE_NUMBER" | "DB_TYPE_BINARY_INTEGER" => K::Num,
                "DB_TYPE_BINARY_FLOAT" => K::Float,
                "DB_TYPE_BINARY_DOUBLE" => K::Double,
                "DB_TYPE_BOOLEAN" => K::Bool,
                "DB_TYPE_DATE" | "DB_TYPE_TIMESTAMP" | "DB_TYPE_TIMESTAMP_LTZ" | "DB_TYPE_TIMESTAMP_TZ" => K::Stamp,
                "DB_TYPE_RAW" | "DB_TYPE_LONG_RAW" | "DB_TYPE_BLOB" => K::Binary,
                "DB_TYPE_INTERVAL_DS" => K::IntervalDs,
                "DB_TYPE_INTERVAL_YM" => K::IntervalYm,
                _ => K::Text,
            })
            .collect();
        let types: Vec<String> = cur.columns().iter().map(|m| m.db_type().name().to_string()).collect();
        sink.header(cur.columns().iter().map(|m| m.name().to_string()).collect())?;
        let mut cells = Vec::with_capacity(kinds.len());
        for row in cur {
            let row = row.map_err(e)?;
            cells.clear();
            for (i, k) in kinds.iter().enumerate() {
                let v = match k {
                    K::Num => row.get::<Option<OracleNumber>>(i).map(|v| v.map(|x| Cell::Num(x.to_string()))),
                    K::Float => row.get::<Option<f32>>(i).map(|v| v.filter(|x| x.is_finite()).map(|x| Cell::Num(x.to_string()))),
                    K::Double => row.get::<Option<f64>>(i).map(|v| v.filter(|x| x.is_finite()).map(|x| Cell::Num(x.to_string()))),
                    K::Bool => row.get::<Option<bool>>(i).map(|v| v.map(Cell::Bool)),
                    K::Stamp => row.get::<Option<OracleTimestamp>>(i).map(|v| v.map(|x| Cell::Text(stamp(&x)))),
                    K::Binary => row.get::<Option<Vec<u8>>>(i).map(|v| v.map(|x| Cell::Text(hex(&x)))),
                    K::IntervalDs => row.get::<Option<OracleIntervalDS>>(i).map(|v| v.map(|x| Cell::Text(x.to_string()))),
                    K::IntervalYm => row.get::<Option<OracleIntervalYM>>(i).map(|v| v.map(|x| Cell::Text(x.to_string()))),
                    K::Text => row.get::<Option<String>>(i).map(|v| v.map(Cell::Text)),
                };
                cells.push(v.map_err(|_| format!("列 {} の型 {} は読めません。SQL で TO_CHAR などで文字にする", i + 1, types[i]))?.unwrap_or(Cell::Null));
            }
            if !sink.row(&cells)? {
                break;
            }
        }
        Ok(())
    }
}
