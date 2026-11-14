// エージェントが DB を読むための道具。使い方は skills/db-read/SKILL.md。
//   db-read conns
//   db-read tables <接続名> [--schema 名前]
//   db-read columns <接続名> <表>
//   db-read query <接続名> (<SQL> | --file 問い合わせ.sql) [--max-rows 200] [--format csv|jsonl] [--bom] [--out ファイル]
// 接続の設定は PC ごとの ~/.config/db-read/db.toml（環境変数 DB_READ_CONFIG で替えられる）。
// 終了コード：0 成功、1 読めない（設定・接続・SQL の誤り）、2 使い方の誤り。
mod config;
mod db;
mod guard;
mod out;

use std::collections::HashMap;
use std::process::exit;

const VERSION: &str = env!("CARGO_PKG_VERSION");
const SOURCE_HASH: &str = env!("SOURCE_HASH");

fn usage_error(msg: &str) -> ! {
    eprintln!("db-read: {msg}\n使い方は `db-read --help`");
    exit(2)
}

pub fn fail(msg: impl std::fmt::Display) -> ! {
    eprintln!("db-read: {msg}");
    exit(1)
}

const HELP: &str = "db-read：DB（PostgreSQL・MySQL・SQL Server・Oracle）を読むだけの問い合わせをする

  db-read conns
      設定ファイルにある接続の名前と種類と行き先を出す（パスワードは出さない）
  db-read tables <接続名> [--schema 名前]
      表とビューの一覧（schema・name・type）。--schema を省くと、接続の既定のスキーマ（Oracle はログインのユーザー）
  db-read columns <接続名> <表>
      列の一覧（name・type・nullable）。<表> は スキーマ.表 でもよい
  db-read query <接続名> (<SQL> | --file 問い合わせ.sql) [--max-rows 200] [--format csv|jsonl] [--bom]
      SELECT（と WITH・SHOW・DESCRIBE・EXPLAIN）を1文だけ走らせて結果を出す（既定は CSV）。
      書き換える文は走らせない。標準出力には既定で 200 行まで（--max-rows 0 で全部）、--out には全部を書く
  共通：--out ファイル で UTF-8 のファイルに書く（Windows の PowerShell で文字化けを避ける）。
        --config 設定.toml で設定ファイルを替える（既定は環境変数 DB_READ_CONFIG か ~/.config/db-read/db.toml）
  db-read --version";

struct Args {
    pos: Vec<String>,
    opts: HashMap<String, String>,
    flags: Vec<String>,
}

fn parse_args() -> Args {
    let mut it = std::env::args().skip(1);
    let mut pos = Vec::new();
    let mut opts = HashMap::new();
    let mut flags = Vec::new();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--help" | "-h" => {
                println!("{HELP}");
                exit(0)
            }
            "--version" | "-V" => {
                println!("db-read {VERSION} src:{SOURCE_HASH}");
                exit(0)
            }
            "--schema" | "--file" | "--max-rows" | "--format" | "--out" | "--config" => {
                let v = it.next().unwrap_or_else(|| usage_error(&format!("{a} に値がありません")));
                opts.insert(a[2..].to_string(), v);
            }
            "--bom" => flags.push(a[2..].to_string()),
            _ if a.starts_with("--") => usage_error(&format!("知らないオプション {a}")),
            _ => pos.push(a),
        }
    }
    if pos.is_empty() {
        usage_error("サブコマンドを指定してください");
    }
    Args { pos, opts, flags }
}

fn main() {
    let args = parse_args();
    let cmd = args.pos[0].as_str();
    let want = |n: usize, what: &str| {
        if args.pos.len() != n {
            usage_error(&format!("{cmd} には {what} を指定してください"));
        }
    };
    let cfg_path = config::path(args.opts.get("config"));
    if cmd == "conns" {
        want(1, "引数なし");
        let conns = config::load(&cfg_path).unwrap_or_else(|e| fail(e));
        for (name, c) in &conns {
            println!("{}", serde_json::json!({"name": name, "kind": c.kind.name(), "target": c.describe()}));
        }
        return;
    }
    let format = match args.opts.get("format").map(String::as_str) {
        None | Some("csv") => out::Format::Csv,
        Some("jsonl") => out::Format::Jsonl,
        Some(f) => usage_error(&format!("--format は csv か jsonl です（{f}）")),
    };
    let max_rows = match args.opts.get("max-rows") {
        Some(s) => match s.parse::<u64>() {
            Ok(0) => None,
            Ok(n) => Some(n),
            Err(_) => usage_error(&format!("--max-rows は 0 以上の整数です（{s}）")),
        },
        // 標準出力は文脈に入るので既定で絞る。ファイルには全部書く
        None if args.opts.contains_key("out") => None,
        None => Some(200),
    };
    let request = match cmd {
        "tables" => {
            want(2, "接続名");
            db::Request::Tables(args.opts.get("schema").cloned())
        }
        "columns" => {
            want(3, "接続名と表");
            db::Request::Columns(args.pos[2].clone())
        }
        "query" => {
            let sql = match (args.pos.len(), args.opts.get("file")) {
                (3, None) => args.pos[2].clone(),
                (2, Some(f)) => std::fs::read_to_string(f).unwrap_or_else(|e| fail(format!("{f} を読めません：{e}"))),
                _ => usage_error("query には 接続名 と、SQL か --file のどちらか1つを指定してください"),
            };
            let sql = guard::read_only(&sql).unwrap_or_else(|e| fail(e));
            db::Request::Query(sql)
        }
        _ => usage_error(&format!("知らないサブコマンド {cmd}")),
    };
    let conns = config::load(&cfg_path).unwrap_or_else(|e| fail(e));
    let name = &args.pos[1];
    let conn = conns.get(name).unwrap_or_else(|| {
        let names: Vec<&str> = conns.keys().map(String::as_str).collect();
        fail(format!("接続 {name} が {} にありません（あるのは {}）", cfg_path.display(), names.join("・")))
    });
    if let (db::Request::Query(sql), config::Kind::Sqlserver) = (&request, conn.kind) {
        guard::sqlserver(sql).unwrap_or_else(|e| fail(e));
    }
    let mut sink = out::Sink::new(args.opts.get("out").map(String::as_str), format, max_rows, args.flags.iter().any(|f| f == "bom"))
        .unwrap_or_else(|e| fail(e));
    if let Err(e) = db::run(conn, &request, &mut sink) {
        // --out の一時ファイルを消して終わる（標準出力に途中まで出した分は残る）
        sink.abort();
        fail(e);
    }
    sink.finish().unwrap_or_else(|e| fail(e));
}
