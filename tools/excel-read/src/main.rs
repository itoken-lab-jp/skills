// エージェントが Excel を読むための道具。使い方は skills/excel-read/SKILL.md。
//   excel-read sheets <file>
//   excel-read dump <file> [--sheet 名前] [--range A1:H50] [--max-rows 200] [--format jsonl|grid] [--out ファイル]
//   excel-read table <file> [--config 設定.json] [--sheet 名前] [--range A3:H] [--header-rows 1] [--table テーブル名]
//                    [--fill-merged all|text|none] [--keep-empty-rows] [--format csv|json|jsonl] [--bom] [--out ファイル]
//   excel-read queries <file> [--out ファイル]
//   excel-read vba <file> [--out ファイル]
// 終了コード：0 成功、1 読めない（ファイル・シート・設定）、2 使い方の誤り。
mod pkg;

use calamine::{open_workbook_auto, Data, DataType, Dimensions, Range, Reader, SheetType, SheetVisible, Sheets, Xlsx, XlsxError};
use chrono::{Datelike, Timelike};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{self, BufReader, BufWriter, Write};
use std::process::exit;

const VERSION: &str = env!("CARGO_PKG_VERSION");
const SOURCE_HASH: &str = env!("SOURCE_HASH");

fn usage_error(msg: &str) -> ! {
    eprintln!("excel-read: {msg}\n使い方は `excel-read --help`");
    exit(2)
}

fn fail(msg: String) -> ! {
    eprintln!("excel-read: {msg}");
    exit(1)
}

const HELP: &str = "excel-read：Excel（.xlsx・.xlsm・.xls・.xlsb・.ods）を読む

  excel-read sheets <file>
      シートの一覧（名前・表示か隠しか・使っている範囲・結合セルの数・Excel のテーブル）を JSON Lines で出す
  excel-read dump <file> [--sheet 名前] [--range A1:H50] [--max-rows 200] [--format jsonl|grid]
      セルをそのまま出す。jsonl は1セル1行（番地 a・値 v・式 f・結合の範囲 m）、
      grid は行ごとにタブ区切り（結合で覆われたセルは ^左上の番地）。表の構造を読み取るのに使う
  excel-read table <file> [--config 設定.json] [--sheet 名前] [--range A3:H] [--header-rows 1]
                  [--table テーブル名] [--fill-merged all|text|none] [--visible-only] [--keep-empty-rows]
                  [--format csv|json|jsonl] [--bom]
      見出しの行を1行にまとめ、結合セルを埋めた表を出す（既定は CSV）。--table は Excel のテーブルを名前で読む。
      --fill-merged はデータの結合の埋め方（all 全部・text 文字だけ・none 埋めない。見出しはいつも埋める）。
      --visible-only は隠した行を捨てる（.xlsx・.xlsm）
  excel-read queries <file>
      Power Query の M のコード（Formulas/Section1.m）をそのまま出す（.xlsx・.xlsm・.xlsb）
  excel-read vba <file>
      VBA のモジュールの名前とコードを出す（.xlsm・.xls・.xlsb）
  共通：--out ファイル で UTF-8 のファイルに書く（Windows の PowerShell で文字化けを避ける）
  excel-read --version";

struct Args {
    cmd: String,
    file: String,
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
                println!("excel-read {VERSION} src:{SOURCE_HASH}");
                exit(0)
            }
            "--sheet" | "--range" | "--table" | "--max-rows" | "--format" | "--out" | "--config" | "--header-rows" | "--fill-merged" => {
                let v = it.next().unwrap_or_else(|| usage_error(&format!("{a} に値がありません")));
                opts.insert(a[2..].to_string(), v);
            }
            "--keep-empty-rows" | "--bom" | "--visible-only" => flags.push(a[2..].to_string()),
            _ if a.starts_with("--") => usage_error(&format!("知らないオプション {a}")),
            _ => pos.push(a),
        }
    }
    if pos.len() != 2 {
        usage_error("サブコマンドとファイルを1つずつ指定してください");
    }
    let file = pos.pop().unwrap();
    let cmd = pos.pop().unwrap();
    // --out に読むファイルと同じものを渡すと、書く前に File::create が中身を消す
    if let Some(out) = opts.get("out") {
        let same = match (std::fs::canonicalize(&file), std::fs::canonicalize(out)) {
            (Ok(a), Ok(b)) => a == b,
            _ => false,
        };
        if same {
            usage_error("--out に読むファイルと同じファイルは指定できません（中身が消えます）");
        }
    }
    Args { cmd, file, opts, flags }
}

// ---- 番地 -------------------------------------------------------------------------------------------

fn col_name(mut c: u32) -> String {
    let mut s = Vec::new();
    c += 1;
    while c > 0 {
        let r = (c - 1) % 26;
        s.push(b'A' + r as u8);
        c = (c - 1) / 26;
    }
    s.reverse();
    String::from_utf8(s).unwrap()
}

fn addr(r: u32, c: u32) -> String {
    format!("{}{}", col_name(c), r + 1)
}

fn dims_str(d: &Dimensions) -> String {
    format!("{}:{}", addr(d.start.0, d.start.1), addr(d.end.0, d.end.1))
}

// "B3" → (Some(2), Some(1))、"B" → (None, Some(1))、"3" → (Some(2), None)
fn parse_ref(s: &str) -> Option<(Option<u32>, Option<u32>)> {
    let s = s.trim().replace('$', "").to_ascii_uppercase();
    let letters: String = s.chars().take_while(|c| c.is_ascii_uppercase()).collect();
    let digits = &s[letters.len()..];
    // Excel の端は XFD 列・1048576 行。それより大きいものは読めない番地として扱う
    if !digits.chars().all(|c| c.is_ascii_digit()) || (letters.is_empty() && digits.is_empty()) || letters.len() > 3 || digits.len() > 7 {
        return None;
    }
    let col = if letters.is_empty() {
        None
    } else {
        let c = letters.bytes().fold(0u32, |acc, b| acc * 26 + (b - b'A' + 1) as u32) - 1;
        if c > 16383 {
            return None;
        }
        Some(c)
    };
    let row = if digits.is_empty() {
        None
    } else {
        let n: u32 = digits.parse().ok()?;
        if n == 0 || n > 1_048_576 {
            return None;
        }
        Some(n - 1)
    };
    Some((row, col))
}

// 指定の範囲を、使っている範囲で埋めて (行の始め, 列の始め, 行の終わり, 列の終わり) にする
fn resolve_range(spec: Option<&String>, used: (u32, u32, u32, u32)) -> (u32, u32, u32, u32) {
    let Some(spec) = spec else { return used };
    let (a, b) = match spec.split_once(':') {
        Some((a, b)) => (a, Some(b)),
        None => (spec.as_str(), None),
    };
    let bad = || usage_error(&format!("範囲 {spec} を読めません（例：A1:H50、A3:H、A:H、A3）"));
    let (r0, c0) = parse_ref(a).unwrap_or_else(|| bad());
    let (r1, c1) = match b {
        Some(b) => parse_ref(b).unwrap_or_else(|| bad()),
        None => (None, None),
    };
    let r = (r0.unwrap_or(used.0), c0.unwrap_or(used.1), r1.unwrap_or(used.2), c1.unwrap_or(used.3));
    if r.0 > r.2 || r.1 > r.3 {
        bad();
    }
    r
}

// ---- 読み込み ---------------------------------------------------------------------------------------

struct SheetData {
    name: String,
    // 値のあるセルの範囲 (行の始め, 列の始め, 行の終わり, 列の終わり)。空のシートは None
    used: Option<(u32, u32, u32, u32)>,
    // 丸ごと読んだ値と式。.xlsx を順に読めるときは None で、each_row が読みながら出す
    mem: Option<(Range<Data>, Option<Range<String>>)>,
    merges: Vec<Dimensions>,
    // 結合セルを読めなかったときの理由
    merges_err: Option<String>,
    // 結合の左上のセルの値（埋めるのに使う）
    anchors: HashMap<(u32, u32), Data>,
    // 隠した行と列・フィルター・表示形式（.xlsx・.xlsm だけ）
    layout: Option<pkg::Layout>,
}

fn open(file: &str) -> Sheets<BufReader<File>> {
    open_workbook_auto(file).unwrap_or_else(|e| fail(format!("{file} を開けません：{e}")))
}

const MERGES_UNSUPPORTED: &str = "この形式では読めない";

fn merges_of(wb: &mut Sheets<BufReader<File>>, name: &str) -> Result<Vec<Dimensions>, String> {
    match wb {
        Sheets::Xlsx(x) => x.merge_cells_by_sheet_name(name).map_err(|e| format!("読めない：{e}")),
        Sheets::Xls(x) => x.merge_cells_by_sheet_name(name).map_err(|e| format!("読めない：{e}")),
        _ => Err(MERGES_UNSUPPORTED.into()),
    }
}

// .xlsx を1回たどって、値のあるセルの範囲と結合の左上の値を集める。セルが番地の順に並んでいなければ ordered は false
struct Scan {
    used: Option<(u32, u32, u32, u32)>,
    ordered: bool,
    anchors: HashMap<(u32, u32), Data>,
}

fn prescan(x: &mut Xlsx<BufReader<File>>, name: &str, want: &HashSet<(u32, u32)>) -> Result<Scan, XlsxError> {
    let mut scan = Scan { used: None, ordered: true, anchors: HashMap::new() };
    let mut rd = match x.worksheet_cells_reader(name) {
        Ok(rd) => rd,
        // グラフのシートなどは空として扱う（calamine の worksheet_range と同じ）
        Err(XlsxError::NotAWorksheet(_)) => return Ok(scan),
        Err(e) => return Err(e),
    };
    let mut prev: Option<(u32, u32)> = None;
    while let Some(cell) = rd.next_cell()? {
        let pos = cell.get_position();
        if prev.is_some_and(|p| pos <= p) {
            scan.ordered = false;
        }
        prev = Some(pos);
        if cell.get_value().is_empty() {
            continue;
        }
        scan.used = Some(match scan.used {
            None => (pos.0, pos.1, pos.0, pos.1),
            Some(u) => (u.0.min(pos.0), u.1.min(pos.1), u.2.max(pos.0), u.3.max(pos.1)),
        });
        if want.contains(&pos) {
            scan.anchors.insert(pos, Data::from(cell.get_value().clone()));
        }
    }
    Ok(scan)
}

fn load_sheet(file: &str, wb: &mut Sheets<BufReader<File>>, sheet: Option<&String>, with_formulas: bool) -> SheetData {
    let names = wb.sheet_names();
    let name = match sheet {
        Some(s) => {
            if !names.contains(s) {
                fail(format!("シート「{s}」がありません。ある：{}", names.join("、")))
            }
            s.clone()
        }
        // 省いたときは、表示されている最初のワークシート
        None => wb
            .sheets_metadata()
            .iter()
            .find(|m| m.visible == SheetVisible::Visible && m.typ == SheetType::WorkSheet)
            .map(|m| m.name.clone())
            .or_else(|| names.first().cloned())
            .unwrap_or_else(|| fail("シートがありません".into())),
    };
    let (merges, merges_err) = match merges_of(wb, &name) {
        Ok(m) => (m, None),
        Err(e) => (Vec::new(), Some(e)),
    };
    let want: HashSet<(u32, u32)> = merges.iter().map(|d| d.start).collect();
    // .xlsx はシートを丸ごと読まず、行ごとに読みながら出す（大きいシートでもメモリが増えない）。
    // 隠した行・表示形式（layout）とセルの下読みはどちらもシートを1回なめるので、並べて走らせる
    let (layout, scan) = match wb {
        // musl はスレッドが1本の間だけメモリ確保に鍵をかけないので、並べるとかえって遅い（Linux 版は順に読む）
        Sheets::Xlsx(x) if cfg!(target_env = "musl") => (pkg::layout(file, &name).ok(), Some(prescan(x, &name, &want))),
        Sheets::Xlsx(x) => std::thread::scope(|t| {
            let l = t.spawn(|| pkg::layout(file, &name).ok());
            let scan = prescan(x, &name, &want);
            (l.join().unwrap_or(None), Some(scan))
        }),
        _ => (None, None),
    };
    if let Some(scan) = scan {
        let scan = scan.unwrap_or_else(|e| fail(format!("シート「{name}」を読めません：{e}")));
        if scan.ordered {
            return SheetData { name, used: scan.used, mem: None, merges, merges_err, anchors: scan.anchors, layout };
        }
    }
    let values = wb.worksheet_range(&name).unwrap_or_else(|e| fail(format!("シート「{name}」を読めません：{e}")));
    let formulas = if with_formulas { wb.worksheet_formula(&name).ok() } else { None };
    let anchors = want.iter().filter_map(|&p| Some((p, values.get_value(p)?.clone()))).filter(|(_, v)| !v.is_empty()).collect();
    let used = used_of(&values);
    SheetData { name, used, mem: Some((values, formulas)), merges, merges_err, anchors, layout }
}

fn used_of(values: &Range<Data>) -> Option<(u32, u32, u32, u32)> {
    let (s, e) = (values.start()?, values.end()?);
    Some((s.0, s.1, e.0, e.1))
}

// 1つのセルの値と式。範囲の行を出すときに、範囲の列の数だけ並べる（値も式も無いセルは None）
struct RowCell {
    v: Data,
    f: Option<String>,
}

// 範囲の行を上から1行ずつ f に渡す。セルの無い行も空の行として渡す。f が false を返したら止める
fn each_row(
    wb: &mut Sheets<BufReader<File>>,
    sh: &SheetData,
    (r0, c0, r1, c1): (u32, u32, u32, u32),
    with_formulas: bool,
    mut f: impl FnMut(u32, &[Option<RowCell>]) -> bool,
) {
    let ncols = (c1 - c0 + 1) as usize;
    let mut row: Vec<Option<RowCell>> = (0..ncols).map(|_| None).collect();
    if let Some((values, formulas)) = &sh.mem {
        for r in r0..=r1 {
            for (i, c) in (c0..=c1).enumerate() {
                let v = values.get_value((r, c)).cloned().unwrap_or(Data::Empty);
                let fm = formulas.as_ref().and_then(|fs| fs.get_value((r, c))).filter(|s| !s.is_empty()).cloned();
                row[i] = if v.is_empty() && fm.is_none() { None } else { Some(RowCell { v, f: fm }) };
            }
            if !f(r, &row) {
                return;
            }
        }
        return;
    }
    let Sheets::Xlsx(x) = wb else { unreachable!("丸ごと読まないのは .xlsx だけ") };
    let mut rd = match x.worksheet_cells_reader(&sh.name) {
        Ok(rd) => rd,
        Err(XlsxError::NotAWorksheet(_)) => return,
        Err(e) => fail(format!("シート「{}」を読めません：{e}", sh.name)),
    };
    // cur は row に入っている行。次の行のセルが来たら、cur から手前までを渡す
    let mut cur = r0;
    let mut flush = |upto: u32, row: &mut Vec<Option<RowCell>>, cur: &mut u32| -> bool {
        while *cur < upto && *cur <= r1 {
            if !f(*cur, row) {
                return false;
            }
            row.iter_mut().for_each(|c| *c = None);
            *cur += 1;
        }
        true
    };
    loop {
        let next = if with_formulas {
            rd.next_cell_with_formula().map(|c| c.map(|c| (c.pos, Data::from(c.value), c.formula)))
        } else {
            rd.next_cell().map(|c| c.map(|c| (c.get_position(), Data::from(c.get_value().clone()), None)))
        };
        let Some(((r, c), v, fm)) = next.unwrap_or_else(|e| fail(format!("シート「{}」を読めません：{e}", sh.name))) else { break };
        if r < r0 || c < c0 || c > c1 {
            continue;
        }
        if r > r1 {
            break;
        }
        if !flush(r, &mut row, &mut cur) {
            return;
        }
        let fm = fm.filter(|s| !s.is_empty());
        if !v.is_empty() || fm.is_some() {
            row[(c - c0) as usize] = Some(RowCell { v, f: fm });
        }
    }
    flush(r1 + 1, &mut row, &mut cur);
}

// 結合で覆われたセル（左上を除く）→ 左上の番地
fn covered_map(merges: &[Dimensions]) -> HashMap<(u32, u32), (u32, u32)> {
    let mut m = HashMap::new();
    for d in merges {
        for r in d.start.0..=d.end.0 {
            for c in d.start.1..=d.end.1 {
                if (r, c) != d.start {
                    m.insert((r, c), d.start);
                }
            }
        }
    }
    m
}

// ---- 値の書き方 -------------------------------------------------------------------------------------

fn num(f: f64) -> Value {
    if f.fract() == 0.0 && f.abs() < 9.0e15 {
        json!(f as i64)
    } else {
        json!(f)
    }
}

fn to_json(d: &Data) -> Value {
    match d {
        Data::Empty => Value::Null,
        Data::Int(i) => json!(i),
        Data::Float(f) => num(*f),
        // 空の文字（"" を返す式など）は空のセルと同じに扱う
        Data::String(s) if s.is_empty() => Value::Null,
        Data::String(s) => json!(s),
        Data::Bool(b) => json!(b),
        Data::DateTime(dt) => {
            if dt.is_duration() {
                match dt.as_duration() {
                    Some(du) => {
                        let s = du.num_seconds();
                        let (sign, s) = if s < 0 { ("-", -s) } else { ("", s) };
                        json!(format!("{sign}{:02}:{:02}:{:02}", s / 3600, (s / 60) % 60, s % 60))
                    }
                    None => num(dt.as_f64()),
                }
            } else {
                match dt.as_datetime() {
                    Some(t) => {
                        let (d, h) = (t.date(), t.time());
                        let day = format!("{:04}-{:02}-{:02}", d.year(), d.month(), d.day());
                        let time = format!("{:02}:{:02}:{:02}", h.hour(), h.minute(), h.second());
                        if dt.as_f64() < 1.0 {
                            json!(time) // 時刻だけ（日付の部分が 1899-12-30 か 31）
                        } else if time == "00:00:00" {
                            json!(day)
                        } else {
                            json!(format!("{day}T{time}"))
                        }
                    }
                    None => num(dt.as_f64()),
                }
            }
        }
        Data::DateTimeIso(s) | Data::DurationIso(s) => json!(s),
        Data::Error(e) => json!(format!("{e}")),
    }
}

fn to_text(v: &Value) -> String {
    match v {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

fn csv_field(s: &str) -> String {
    if s.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

fn output(out: Option<&String>) -> Box<dyn Write> {
    match out {
        Some(p) => Box::new(BufWriter::new(File::create(p).unwrap_or_else(|e| fail(format!("{p} に書けません：{e}"))))),
        None => Box::new(BufWriter::new(io::stdout().lock())),
    }
}

fn finish(mut w: Box<dyn Write>) {
    if let Err(e) = w.flush() {
        if e.kind() != io::ErrorKind::BrokenPipe {
            fail(format!("書き出しに失敗しました：{e}"))
        }
    }
}

// 書き出しの途中で受け手が閉じた（head など）ときは静かに終わる
macro_rules! out {
    ($w:expr, $($arg:tt)*) => {
        if let Err(e) = writeln!($w, $($arg)*) {
            if e.kind() == io::ErrorKind::BrokenPipe { exit(0) }
            fail(format!("書き出しに失敗しました：{e}"))
        }
    };
}

// out! の改行を付けないもの
macro_rules! put {
    ($w:expr, $($arg:tt)*) => {
        if let Err(e) = write!($w, $($arg)*) {
            if e.kind() == io::ErrorKind::BrokenPipe { exit(0) }
            fail(format!("書き出しに失敗しました：{e}"))
        }
    };
}

fn table_of(file: &str, wb: &Sheets<BufReader<File>>, name: &str) -> pkg::TableMeta {
    if !matches!(wb, Sheets::Xlsx(_)) {
        fail("テーブル（table）は .xlsx・.xlsm だけで読める".into())
    }
    let all = pkg::tables(file).unwrap_or_else(|e| fail(format!("テーブルを読めません：{e}")));
    let names: Vec<String> = all.iter().map(|t| t.name.clone()).collect();
    all.into_iter().find(|t| t.name == name).unwrap_or_else(|| {
        let have = if names.is_empty() { "（無い）".to_string() } else { names.join("、") };
        fail(format!("テーブル「{name}」がありません。ある：{have}"))
    })
}

// ---- sheets ------------------------------------------------------------------------------------------

fn cmd_sheets(a: &Args) {
    let mut wb = open(&a.file);
    // Excel のテーブルは .xlsx・.xlsm だけ。読めなければ tables は null
    let tables = if matches!(wb, Sheets::Xlsx(_)) { pkg::tables(&a.file).ok() } else { None };
    let mut w = output(a.opts.get("out"));
    for meta in wb.sheets_metadata().to_vec() {
        let name = meta.name;
        let mut line = Map::new();
        line.insert("sheet".into(), json!(name));
        let state = match meta.visible {
            SheetVisible::Visible => "visible",
            SheetVisible::Hidden => "hidden",
            SheetVisible::VeryHidden => "very_hidden",
        };
        line.insert("state".into(), json!(state));
        if meta.typ != SheetType::WorkSheet {
            let kind = match meta.typ {
                SheetType::ChartSheet => "chart",
                SheetType::DialogSheet => "dialog",
                SheetType::MacroSheet => "macro",
                _ => "vba",
            };
            line.insert("kind".into(), json!(kind));
        }
        // .xlsx は丸ごと読まずに、セルを1回たどって範囲だけを数える
        let used = match &mut wb {
            Sheets::Xlsx(x) => prescan(x, &name, &HashSet::new()).map(|s| s.used).map_err(|e| e.to_string()),
            other => other.worksheet_range(&name).map(|r| used_of(&r)).map_err(|e| e.to_string()),
        };
        match used {
            Ok(u) => {
                line.insert("used".into(), json!(u.map(|u| format!("{}:{}", addr(u.0, u.1), addr(u.2, u.3)))));
            }
            Err(e) => {
                line.insert("error".into(), json!(e));
            }
        }
        match merges_of(&mut wb, &name) {
            Ok(m) => {
                line.insert("merges".into(), json!(m.len()));
            }
            Err(e) => {
                line.insert("merges".into(), Value::Null);
                line.insert("merges_note".into(), json!(e));
            }
        }
        let t: Option<Vec<Value>> = tables.as_ref().map(|all| {
            all.iter()
                .filter(|t| t.sheet == name)
                .map(|t| json!({"name": t.name, "data": t.data.map(|d| format!("{}:{}", addr(d.0, d.1), addr(d.2, d.3)))}))
                .collect()
        });
        line.insert("tables".into(), json!(t));
        // 隠した行と列・オートフィルター。読めない形式では null
        let l = if tables.is_some() { pkg::layout(&a.file, &name).ok() } else { None };
        line.insert("hidden_rows".into(), json!(l.as_ref().map(|l| l.hidden_rows.len())));
        line.insert("hidden_cols".into(), json!(l.as_ref().map(|l| l.hidden_cols.len())));
        line.insert("filter".into(), json!(l.as_ref().and_then(|l| l.filter.clone())));
        out!(w, "{}", Value::Object(line));
    }
    finish(w);
}

// ---- dump --------------------------------------------------------------------------------------------

fn cmd_dump(a: &Args) {
    let format = a.opts.get("format").map(String::as_str).unwrap_or("jsonl");
    if format != "jsonl" && format != "grid" {
        usage_error("dump の --format は jsonl か grid");
    }
    let max_rows: u32 = a.opts.get("max-rows").map_or(200, |s| s.parse().unwrap_or_else(|_| usage_error("--max-rows は数")));
    let mut wb = open(&a.file);
    let sh = load_sheet(&a.file, &mut wb, a.opts.get("sheet"), true);
    let mut w = output(a.opts.get("out"));
    let Some(used) = sh.used else {
        out!(w, "{}", json!({"sheet": sh.name, "used": null, "note": "空のシート"}));
        return finish(w);
    };
    let (r0, c0, r1_all, c1) = resolve_range(a.opts.get("range"), used);
    let r1 = r1_all.min(r0.saturating_add(max_rows.max(1)) - 1);
    let in_range = |d: &Dimensions| d.start.0 <= r1 && d.end.0 >= r0 && d.start.1 <= c1 && d.end.1 >= c0;
    let merges: Vec<String> = sh.merges.iter().filter(|d| in_range(d)).map(dims_str).collect();
    let anchors: HashMap<(u32, u32), String> = sh.merges.iter().map(|d| (d.start, dims_str(d))).collect();
    let covered = covered_map(&sh.merges);
    let mut head = Map::new();
    head.insert("sheet".into(), json!(sh.name));
    head.insert("used".into(), json!(format!("{}:{}", addr(used.0, used.1), addr(used.2, used.3))));
    head.insert("range".into(), json!(format!("{}:{}", addr(r0, c0), addr(r1, c1))));
    head.insert("merges".into(), match &sh.merges_err {
        None => json!(merges),
        Some(e) => json!(e),
    });
    if let Some(l) = &sh.layout {
        let mut rows: Vec<u32> = l.hidden_rows.iter().copied().filter(|r| (r0..=r1).contains(r)).collect();
        rows.sort();
        let mut cols: Vec<u32> = l.hidden_cols.iter().copied().filter(|c| (c0..=c1).contains(c)).collect();
        cols.sort();
        head.insert("hidden_rows".into(), json!(rows.iter().map(|r| r + 1).collect::<Vec<_>>()));
        head.insert("hidden_cols".into(), json!(cols.into_iter().map(col_name).collect::<Vec<_>>()));
        head.insert("filter".into(), json!(l.filter));
    }
    // 式の [1] などが指す外のブック
    if let Ok(links) = pkg::external_links(&a.file) {
        if !links.is_empty() {
            let m: Map<String, Value> = links.into_iter().map(|(i, t)| (format!("[{i}]"), json!(t))).collect();
            head.insert("links".into(), Value::Object(m));
        }
    }
    let nf_of = |r: u32, c: u32| sh.layout.as_ref().and_then(|l| l.formats.get(r, c));
    if format == "grid" {
        out!(w, "# {}", Value::Object(head));
        let cols: Vec<String> = (c0..=c1).map(col_name).collect();
        out!(w, "\t{}", cols.join("\t"));
        each_row(&mut wb, &sh, (r0, c0, r1, c1), false, |r, row| {
            let cells: Vec<String> = (c0..=c1)
                .zip(row)
                .map(|(c, cell)| {
                    if let Some(&(ar, ac)) = covered.get(&(r, c)) {
                        return format!("^{}", addr(ar, ac));
                    }
                    let v = cell.as_ref().map(|x| to_json(&x.v)).unwrap_or(Value::Null);
                    to_text(&v).replace('\\', "\\\\").replace('\t', "\\t").replace('\n', "\\n").replace('\r', "")
                })
                .collect();
            out!(w, "{}\t{}", r + 1, cells.join("\t"));
            true
        });
    } else {
        out!(w, "{}", Value::Object(head));
        each_row(&mut wb, &sh, (r0, c0, r1, c1), true, |r, row| {
            for (c, cell) in (c0..=c1).zip(row) {
                let v = cell.as_ref().map(|x| to_json(&x.v)).unwrap_or(Value::Null);
                let f = cell.as_ref().and_then(|x| x.f.as_ref());
                let m = anchors.get(&(r, c));
                if v.is_null() && f.is_none() && m.is_none() {
                    continue;
                }
                let nf = if v.is_null() { None } else { nf_of(r, c) };
                let mut cell = Map::new();
                cell.insert("a".into(), json!(addr(r, c)));
                cell.insert("v".into(), v);
                if let Some(nf) = nf {
                    cell.insert("nf".into(), json!(nf));
                }
                if let Some(f) = f {
                    cell.insert("f".into(), json!(f));
                }
                if let Some(m) = m {
                    cell.insert("m".into(), json!(m));
                }
                out!(w, "{}", Value::Object(cell));
            }
            true
        });
    }
    if r1 < r1_all {
        let next = json!({"truncated": true, "next": format!("{}:{}", addr(r1 + 1, c0), addr(r1_all, c1)), "hint": "続きは --range で指定するか --max-rows を増やす"});
        if format == "grid" {
            out!(w, "# {next}");
        } else {
            out!(w, "{next}");
        }
    }
    finish(w);
}

// ---- table -------------------------------------------------------------------------------------------

struct Matcher {
    col: u32,
    kind: String,
    text: String,
}

fn parse_matchers(v: Option<&Value>, key: &str) -> Vec<Matcher> {
    let Some(v) = v else { return Vec::new() };
    let list = match v {
        Value::Array(a) => a.clone(),
        Value::Object(_) => vec![v.clone()],
        _ => fail(format!("設定の {key} は配列か {{\"column\":\"A\",\"contains\":\"小計\"}} の形")),
    };
    list.iter()
        .map(|m| {
            let col = m.get("column").and_then(Value::as_str).and_then(|s| parse_ref(s)).and_then(|(_, c)| c);
            let col = col.unwrap_or_else(|| fail(format!("設定の {key} に column（列の文字。例 \"A\"）がありません")));
            let kinds: Vec<&str> = ["contains", "equals", "starts_with", "empty"].into_iter().filter(|k| m.get(*k).is_some()).collect();
            let [kind] = kinds[..] else {
                fail(format!("設定の {key} の1つの条件には contains・equals・starts_with・empty のどれか1つだけを書きます"))
            };
            let text = match &m[kind] {
                Value::String(s) => squash(s),
                Value::Bool(true) if kind == "empty" => String::new(),
                _ => fail(format!("設定の {key} の {kind} の値が読めません")),
            };
            Matcher { col, kind: kind.into(), text }
        })
        .collect()
}

// 比べる前に空白（全角の空白も）を全部除く。「小　計」も「小計」に当たる
fn squash(s: &str) -> String {
    s.chars().filter(|c| !c.is_whitespace()).collect()
}

fn matches(ms: &[Matcher], cell: &dyn Fn(u32) -> String) -> bool {
    ms.iter().any(|m| {
        let s = squash(&cell(m.col));
        let s = s.as_str();
        match m.kind.as_str() {
            "contains" => s.contains(m.text.as_str()),
            "equals" => s == m.text,
            "starts_with" => s.starts_with(m.text.as_str()),
            _ => s.is_empty(),
        }
    })
}

fn cmd_table(a: &Args) {
    let cfg: Value = match a.opts.get("config") {
        Some(p) => {
            let text = std::fs::read_to_string(p).unwrap_or_else(|e| fail(format!("設定 {p} を読めません：{e}")));
            serde_json::from_str(text.trim_start_matches('\u{feff}')).unwrap_or_else(|e| fail(format!("設定 {p} の JSON が壊れています：{e}")))
        }
        None => json!({}),
    };
    if !cfg.is_object() {
        fail("設定は JSON のオブジェクトにしてください".into());
    }
    let known = [
        "sheet", "range", "table", "header_rows", "header_join", "fill_merged", "skip_empty_rows", "skip_hidden_rows", "drop_rows", "stop_when", "columns", "format", "note",
    ];
    for k in cfg.as_object().unwrap().keys() {
        if !known.contains(&k.as_str()) {
            fail(format!("設定に知らないキー {k} があります（使えるのは {}）", known.join("・")));
        }
    }
    let s = |k: &str| a.opts.get(&k.replace('_', "-")).cloned().or_else(|| cfg.get(k).and_then(Value::as_str).map(String::from));
    let sheet = s("sheet");
    let range = s("range");
    let table_name = s("table");
    let mut wb = open(&a.file);
    // Excel のテーブル（名前の付いた表）を名前で読むときは、シート・データの範囲・列の名前をテーブルから取る
    let table = table_name.as_ref().map(|t| {
        if sheet.is_some() || range.is_some() || a.opts.contains_key("header-rows") || cfg.get("header_rows").is_some() {
            usage_error("テーブル（table）を指定したときは sheet・range・header_rows を書かない");
        }
        table_of(&a.file, &wb, t)
    });
    let sheet = table.as_ref().map(|t| t.sheet.clone()).or(sheet);
    let format = s("format").unwrap_or_else(|| "csv".into());
    if !["csv", "json", "jsonl"].contains(&format.as_str()) {
        usage_error("table の --format は csv・json・jsonl");
    }
    let header_rows: u32 = if table.is_some() { 0 } else { match a.opts.get("header-rows") {
        Some(v) => v.parse().unwrap_or_else(|_| usage_error("--header-rows は数")),
        None => cfg.get("header_rows").map_or(1, |v| {
            v.as_u64().filter(|n| *n <= 1_048_576).unwrap_or_else(|| fail("設定の header_rows は 0 から 1048576 の数".into())) as u32
        }),
    } };
    let join = cfg.get("header_join").and_then(Value::as_str).unwrap_or("/").to_string();
    let flag_or = |flag: &str, key: &str, default: bool| {
        if a.flags.iter().any(|f| f == flag) {
            return !default;
        }
        cfg.get(key).map_or(default, |v| v.as_bool().unwrap_or_else(|| fail(format!("設定の {key} は true か false"))))
    };
    // データの結合の埋め方。見出しはいつも埋める
    let fill = match a.opts.get("fill-merged") {
        Some(v) => v.clone(),
        None => match cfg.get("fill_merged") {
            None | Some(Value::Bool(true)) => "all".into(),
            Some(Value::Bool(false)) => "none".into(),
            Some(Value::String(v)) => v.clone(),
            _ => fail("設定の fill_merged は \"all\"・\"text\"・\"none\"（true・false も可）".into()),
        },
    };
    if !["all", "text", "none"].contains(&fill.as_str()) {
        usage_error("fill_merged（--fill-merged）は all・text・none");
    }
    let skip_empty = flag_or("keep-empty-rows", "skip_empty_rows", true);
    let bom = a.flags.iter().any(|f| f == "bom");
    let visible_only = flag_or("visible-only", "skip_hidden_rows", false);
    let drop = parse_matchers(cfg.get("drop_rows"), "drop_rows");
    let stop = parse_matchers(cfg.get("stop_when"), "stop_when");

    let sh = load_sheet(&a.file, &mut wb, sheet.as_ref(), false);
    if bom && format != "csv" {
        usage_error("--bom は CSV だけ");
    }
    let (r0, c0, r1, c1) = match &table {
        Some(pkg::TableMeta { data: Some(d), .. }) => *d,
        Some(pkg::TableMeta { data: None, columns: cols, .. }) => {
            // データの行が無いテーブルは見出しだけを出す
            let mut w = output(a.opts.get("out"));
            if bom {
                let _ = write!(w, "\u{feff}");
            }
            if format == "csv" {
                out!(w, "{}", cols.iter().map(|n| csv_field(n)).collect::<Vec<_>>().join(","));
            } else if format == "json" {
                out!(w, "[]");
            }
            return finish(w);
        }
        None => {
            let Some(used) = sh.used else { fail(format!("シート「{}」は空です", sh.name)) };
            resolve_range(range.as_ref(), used)
        }
    };
    let data_start = r0.saturating_add(header_rows);
    let covered = covered_map(&sh.merges);
    let anchor = |p: (u32, u32)| sh.anchors.get(&p);
    let is_num = |d: Option<&Data>| matches!(d, Some(Data::Int(_) | Data::Float(_)));
    if let Some(e) = &sh.merges_err {
        eprintln!("excel-read: 注意：結合セルを{e}ので、埋めずに出した");
    }
    // 数の入った結合をデータの部分で埋めると、同じ数が重なる。気づけるように知らせる
    if fill == "all" {
        let numeric: Vec<String> = sh
            .merges
            .iter()
            .filter(|d| d.end.0 >= data_start && d.start.0 <= r1 && d.start.1 <= c1 && d.end.1 >= c0 && d.start != d.end)
            .filter(|d| is_num(anchor(d.start)))
            .map(dims_str)
            .collect();
        if let Some(first) = numeric.first() {
            eprintln!(
                "excel-read: 注意：数の入った結合セル {} か所を埋めた（例 {first}）。金額や数量なら重なっている。--fill-merged text で数を埋めずに出せる",
                numeric.len()
            );
        }
    }
    // 条件の列が範囲の外なら、いつまでも当たらないので止める
    for m in drop.iter().chain(stop.iter()) {
        if m.col < c0 || m.col > c1 {
            fail(format!("drop_rows・stop_when の列 {} は範囲（{}〜{} 列）の外です", col_name(m.col), col_name(c0), col_name(c1)));
        }
    }
    let hidden_rows = sh.layout.as_ref().map(|l| &l.hidden_rows);
    let hidden_in = |r: u32| hidden_rows.is_some_and(|h| h.contains(&r));
    if visible_only && sh.layout.is_none() {
        eprintln!("excel-read: 注意：この形式では隠した行を読めないので、--visible-only は効いていない");
    }
    if let Some(l) = &sh.layout {
        let n = l.hidden_rows.iter().filter(|r| (data_start..=r1).contains(*r)).count();
        if n > 0 && !visible_only {
            eprintln!("excel-read: 注意：隠した行 {n} 行も出した。見えている行だけにするなら --visible-only");
        }
        let hc: Vec<String> = (c0..=c1).filter(|c| l.hidden_cols.contains(c)).map(col_name).collect();
        if !hc.is_empty() {
            eprintln!("excel-read: 注意：隠した列 {} も出した", hc.join("・"));
        }
    }

    let ncols = (c1 - c0 + 1) as usize;
    // 列の名前を自分で付けたとき・テーブルのときは、見出しの行を読む前に決まる
    let given: Option<Vec<String>> = if let Some(cols) = cfg.get("columns") {
        let cols: Vec<String> = cols
            .as_array()
            .unwrap_or_else(|| fail("設定の columns は文字の配列".into()))
            .iter()
            .map(|v| v.as_str().map(String::from).unwrap_or_else(|| fail("設定の columns は文字の配列".into())))
            .collect();
        if cols.len() != ncols {
            fail(format!("設定の columns は {} 個ですが、範囲の列は {ncols} 個です", cols.len()));
        }
        Some(cols)
    } else {
        table.as_ref().map(|t| t.columns.clone())
    };
    // セルの値。結合で覆われたセルは、見出しではいつも、データでは fill の通りに左上の値を使う
    let value = |r: u32, c: u32, own: Option<&RowCell>| -> Value {
        let top = covered.get(&(r, c)).copied().filter(|&top| {
            r < data_start || fill == "all" || (fill == "text" && matches!(anchor(top), Some(Data::String(_))))
        });
        match top {
            Some(top) => anchor(top).map(to_json).unwrap_or(Value::Null),
            None => own.map(|x| to_json(&x.v)).unwrap_or(Value::Null),
        }
    };

    let mut w = output(a.opts.get("out"));
    // 見出しの行（列ごとに、上から空でない文字）と、そこにあった数のセル
    let mut heads: Vec<Vec<String>> = vec![Vec::new(); ncols];
    let mut header_numbers: Vec<String> = Vec::new();
    let mut names: Option<Vec<String>> = None;
    let mut rows_json = 0usize;
    let mut count = 0usize;
    // 列ごとの表示形式（数のセルの、標準でないもの）。単位が表示形式にしか無い列に気づけるように知らせる
    let mut formats: Vec<Vec<String>> = vec![Vec::new(); ncols];
    // 見出しを決めて、CSV なら1行目に書く。データの最初の行の前か、行が尽きたときに1回だけ
    let start = |w: &mut Box<dyn Write>, heads: &mut Vec<Vec<String>>, header_numbers: &Vec<String>| -> Vec<String> {
        let mut names: Vec<String> = match &given {
            Some(g) => g.clone(),
            None => (c0..=c1).zip(heads.iter()).map(|(c, parts)| if parts.is_empty() { col_name(c) } else { parts.join(&join) }).collect(),
        };
        if let Some(first) = header_numbers.first() {
            eprintln!(
                "excel-read: 注意：見出しの行に数のセルが {} か所あり、列の名前につないだ（例 {first}）。合計などの行なら、header_rows を見直すか columns で名前を付ける",
                header_numbers.len()
            );
        }
        // 同じ名前は2つ目から _2・_3 を付ける。付けた名前がほかの見出しとぶつかるなら番号を進める
        let mut taken = HashSet::new();
        let originals: HashSet<String> = names.iter().cloned().collect();
        for n in names.iter_mut() {
            if taken.insert(n.clone()) {
                continue;
            }
            let mut k = 2;
            while taken.contains(&format!("{n}_{k}")) || originals.contains(&format!("{n}_{k}")) {
                k += 1;
            }
            *n = format!("{n}_{k}");
            taken.insert(n.clone());
        }
        if bom {
            put!(w, "\u{feff}");
        }
        if format == "csv" {
            out!(w, "{}", names.iter().map(|n| csv_field(n)).collect::<Vec<_>>().join(","));
        }
        names
    };
    each_row(&mut wb, &sh, (r0, c0, r1, c1), false, |r, row| {
        if r < data_start {
            // 見出しの行：列ごとに空でない文字を（続けて同じものは1つにして）つなぐ
            if given.is_none() {
                for (i, c) in (c0..=c1).enumerate() {
                    if is_num(row[i].as_ref().map(|x| &x.v)) && !covered.contains_key(&(r, c)) {
                        header_numbers.push(addr(r, c));
                    }
                    let t = to_text(&value(r, c, row[i].as_ref())).trim().replace(['\n', '\r'], "");
                    if !t.is_empty() && heads[i].last() != Some(&t) {
                        heads[i].push(t);
                    }
                }
            }
            return true;
        }
        if names.is_none() {
            names = Some(start(&mut w, &mut heads, &header_numbers));
        }
        let names = names.as_ref().unwrap();
        let vals: Vec<Value> = (c0..=c1).zip(row).map(|(c, own)| value(r, c, own.as_ref())).collect();
        let text_at = |c: u32| to_text(&vals[(c - c0) as usize]);
        if matches(&stop, &text_at) {
            return false;
        }
        if visible_only && hidden_in(r) {
            return true;
        }
        if skip_empty && vals.iter().all(|v| to_text(v).trim().is_empty()) {
            return true;
        }
        if matches(&drop, &text_at) {
            return true;
        }
        count += 1;
        if let Some(l) = &sh.layout {
            for (i, c) in (c0..=c1).enumerate() {
                if !is_num(row[i].as_ref().map(|x| &x.v)) {
                    continue;
                }
                if let Some(f) = l.formats.get(r, c).filter(|f| !PLAIN_FORMATS.contains(f)) {
                    if formats[i].len() < 3 && !formats[i].iter().any(|x| x == f) {
                        formats[i].push(f.to_string());
                    }
                }
            }
        }
        match format.as_str() {
            "csv" => out!(w, "{}", vals.iter().map(|v| csv_field(&to_text(v))).collect::<Vec<_>>().join(",")),
            _ => {
                let obj = Value::Object(names.iter().cloned().zip(vals).collect());
                if format == "jsonl" {
                    out!(w, "{}", obj);
                } else {
                    // serde_json の to_string_pretty で配列にしたときと同じ形を、1件ずつ書く
                    put!(w, "{}", if rows_json == 0 { "[\n" } else { ",\n" });
                    let pretty = serde_json::to_string_pretty(&obj).unwrap();
                    put!(w, "{}", pretty.lines().map(|l| format!("  {l}")).collect::<Vec<_>>().join("\n"));
                    rows_json += 1;
                }
            }
        }
        true
    });
    let names = match names {
        Some(n) => n,
        None => start(&mut w, &mut heads, &header_numbers),
    };
    if format == "json" {
        out!(w, "{}", if rows_json == 0 { "[]" } else { "\n]" });
    }
    finish(w);
    let noted: Vec<String> =
        names.iter().zip(&formats).filter(|(_, f)| !f.is_empty()).map(|(n, f)| format!("{n}（{}）", f.join(" ／ "))).collect();
    if !noted.is_empty() {
        eprintln!("excel-read: 表示形式のある列：{}。値は生の数で、千円・%・通貨などの単位は付いていない", noted.join("、"));
    }
    if count == 0 {
        eprintln!("excel-read: 注意：データの行が 0 行だった。range・header_rows・stop_when を見直す");
    }
}

// 単位や桁を変えない表示形式。これらは知らせない
const PLAIN_FORMATS: [&str; 6] = ["0", "0.00", "#,##0", "#,##0.00", "#,##0_ ", "#,##0_);[Red]\\(#,##0\\)"];

// ---- queries・vba ------------------------------------------------------------------------------------

fn cmd_queries(a: &Args) {
    let ext = a.file.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    if ext == "xls" || ext == "ods" {
        fail("Power Query は .xlsx・.xlsm・.xlsb にだけある".into());
    }
    match pkg::power_query(&a.file) {
        Ok(Some(m)) => {
            let mut w = output(a.opts.get("out"));
            out!(w, "{}", m.replace("\r\n", "\n").trim_end());
            finish(w);
        }
        Ok(None) => eprintln!("excel-read: Power Query はありません"),
        Err(e) => fail(format!("Power Query を読めません：{e}")),
    }
}

fn cmd_vba(a: &Args) {
    let mut wb = open(&a.file);
    let vba = match wb.vba_project() {
        Ok(Some(v)) => v,
        Ok(None) => return eprintln!("excel-read: VBA はありません"),
        Err(e) => fail(format!("VBA を読めません：{e}")),
    };
    let mut w = output(a.opts.get("out"));
    let mut names: Vec<String> = vba.get_module_names().into_iter().map(String::from).collect();
    names.sort();
    for n in names {
        out!(w, "' ===== {n} =====");
        match vba.get_module(&n) {
            Ok(code) => out!(w, "{}", code.replace("\r\n", "\n").trim_end()),
            Err(e) => out!(w, "' （読めない：{e}）"),
        }
        out!(w, "");
    }
    finish(w);
}

fn main() {
    let a = parse_args();
    match a.cmd.as_str() {
        "sheets" => cmd_sheets(&a),
        "dump" => cmd_dump(&a),
        "table" => cmd_table(&a),
        "queries" => cmd_queries(&a),
        "vba" => cmd_vba(&a),
        other => usage_error(&format!("知らないサブコマンド {other}（sheets・dump・table・queries・vba）")),
    }
}
