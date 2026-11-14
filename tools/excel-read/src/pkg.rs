// .xlsx・.xlsm の中の XML を直接読む所。calamine が返さないもの（テーブルの見出しと集計の行の数、
// 隠した行と列・フィルター・表示形式・外部リンクの先、Power Query の M のコード）をここで読む。
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{Cursor, Read, Seek};
use zip::ZipArchive;

pub struct TableMeta {
    pub name: String,
    pub sheet: String,
    // 見出しと集計の行を除いたデータの範囲（0 始まり、行の始め・列の始め・行の終わり・列の終わり）。行が無ければ None
    pub data: Option<(u32, u32, u32, u32)>,
    pub columns: Vec<String>,
}

fn read_part<R: Read + Seek>(z: &mut ZipArchive<R>, name: &str) -> Option<Vec<u8>> {
    let mut f = z.by_name(name).ok()?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).ok()?;
    Some(buf)
}

fn unescape(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    let mut out = String::new();
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        let tail = &rest[i..];
        let Some(j) = tail.find(';') else {
            out.push_str(tail);
            return out;
        };
        let ent = &tail[1..j];
        let ch = match ent {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            _ if ent.starts_with("#x") => u32::from_str_radix(&ent[2..], 16).ok().and_then(char::from_u32),
            _ if ent.starts_with('#') => ent[1..].parse().ok().and_then(char::from_u32),
            _ => None,
        };
        match ch {
            Some(c) => out.push(c),
            None => out.push_str(&tail[..=j]),
        }
        rest = &tail[j + 1..];
    }
    out.push_str(rest);
    out
}

fn attrs_of(mut a: &str) -> HashMap<String, String> {
    let mut attrs = HashMap::new();
    while let Some(eq) = a.find('=') {
        let key = a[..eq].trim();
        let key = key.rsplit(':').next().unwrap_or(key).to_string();
        let v = a[eq + 1..].trim_start();
        let Some(q) = v.chars().next().filter(|c| *c == '"' || *c == '\'') else { break };
        let Some(close) = v[1..].find(q) else { break };
        attrs.insert(key, unescape(&v[1..1 + close]));
        a = &v[close + 2..];
    }
    attrs
}

// タグの終わりの > の位置。属性の値の中の > （XML では書いてよい。表示形式の [>1000] など）では切らない
fn tag_end(s: &str) -> usize {
    let mut quote: Option<char> = None;
    for (i, c) in s.char_indices() {
        match (quote, c) {
            (None, '"' | '\'') => quote = Some(c),
            (Some(q), _) if c == q => quote = None,
            (None, '>') => return i,
            _ => {}
        }
    }
    s.len()
}

// 開きタグを出てくる順にたどり、名前（名前空間の接頭辞を除く）が tags にあるものの属性を f に渡す
fn scan(xml: &str, tags: &[&str], mut f: impl FnMut(&str, HashMap<String, String>)) {
    let mut rest = xml;
    while let Some(i) = rest.find('<') {
        rest = &rest[i + 1..];
        let end = tag_end(rest);
        let body = rest[..end].trim_end_matches('/');
        let mut parts = body.splitn(2, |c: char| c.is_whitespace());
        let name = parts.next().unwrap_or("");
        let local = name.rsplit(':').next().unwrap_or(name);
        if tags.contains(&local) {
            f(local, attrs_of(parts.next().unwrap_or("")));
        }
        rest = &rest[end..];
    }
}

// 名前が tag の要素の属性を、出てくる順に返す
fn elements(xml: &str, tag: &str) -> Vec<HashMap<String, String>> {
    let mut found = Vec::new();
    scan(xml, &[tag], |_, a| found.push(a));
    found
}

// rels の Target を、rels の持ち主の場所から解いて zip の中のパスにする
fn resolve(base_dir: &str, target: &str) -> String {
    if let Some(t) = target.strip_prefix('/') {
        return t.to_string();
    }
    let mut parts: Vec<&str> = base_dir.split('/').filter(|p| !p.is_empty()).collect();
    for p in target.split('/') {
        match p {
            ".." => {
                parts.pop();
            }
            "." | "" => {}
            _ => parts.push(p),
        }
    }
    parts.join("/")
}

// rels の (Id, Target) をファイルに書いてある順に返す
fn rels(z: &mut ZipArchive<File>, part: &str) -> Vec<(String, String)> {
    let (dir, file) = part.rsplit_once('/').unwrap_or(("", part));
    let path = if dir.is_empty() { format!("_rels/{file}.rels") } else { format!("{dir}/_rels/{file}.rels") };
    let Some(xml) = read_part(z, &path) else { return Vec::new() };
    let xml = String::from_utf8_lossy(&xml).into_owned();
    elements(&xml, "Relationship")
        .into_iter()
        .filter_map(|a| Some((a.get("Id")?.clone(), resolve(dir, a.get("Target")?))))
        .collect()
}

fn parse_cell(s: &str) -> Option<(u32, u32)> {
    let s = s.replace('$', "");
    let letters: String = s.chars().take_while(|c| c.is_ascii_alphabetic()).collect();
    let row: u32 = s[letters.len()..].parse().ok()?;
    let col = letters.to_ascii_uppercase().bytes().fold(0u32, |acc, b| acc * 26 + (b - b'A' + 1) as u32);
    Some((row.checked_sub(1)?, col.checked_sub(1)?))
}

fn open_zip(file: &str) -> Result<ZipArchive<File>, String> {
    let f = File::open(file).map_err(|e| e.to_string())?;
    ZipArchive::new(f).map_err(|e| e.to_string())
}

fn text_part(z: &mut ZipArchive<File>, name: &str) -> Option<String> {
    read_part(z, name).map(|b| String::from_utf8_lossy(&b).into_owned())
}

// (シートの名前, シートの XML のパス) をブックの順に
fn sheet_parts(z: &mut ZipArchive<File>) -> Result<Vec<(String, String)>, String> {
    let wb_xml = text_part(z, "xl/workbook.xml").ok_or("xl/workbook.xml が無い")?;
    let wb_rels = rels(z, "xl/workbook.xml");
    Ok(elements(&wb_xml, "sheet")
        .into_iter()
        .filter_map(|s| {
            let (name, id) = (s.get("name")?, s.get("id")?);
            let (_, part) = wb_rels.iter().find(|(i, _)| i == id)?;
            Some((name.clone(), part.clone()))
        })
        .collect())
}

pub fn tables(file: &str) -> Result<Vec<TableMeta>, String> {
    let mut z = open_zip(file)?;
    let mut out = Vec::new();
    for (name, part) in sheet_parts(&mut z)? {
        let name = &name;
        for (_, target) in rels(&mut z, &part).into_iter().filter(|(_, t)| t.contains("/tables/")) {
            let Some(xml) = read_part(&mut z, &target) else { continue };
            let xml = String::from_utf8_lossy(&xml).into_owned();
            let Some(t) = elements(&xml, "table").into_iter().next() else { continue };
            let tname = t.get("displayName").or(t.get("name")).cloned().unwrap_or_default();
            let Some((a, b)) = t.get("ref").and_then(|r| r.split_once(':')) else { continue };
            let (Some(s), Some(e)) = (parse_cell(a), parse_cell(b)) else { continue };
            let header: u32 = t.get("headerRowCount").and_then(|v| v.parse().ok()).unwrap_or(1);
            let totals: u32 = t.get("totalsRowCount").and_then(|v| v.parse().ok()).unwrap_or(0);
            let (r0, r1) = (s.0 + header, e.0.checked_sub(totals));
            let data = r1.filter(|r1| r0 <= *r1).map(|r1| (r0, s.1, r1, e.1));
            let columns = elements(&xml, "tableColumn").into_iter().filter_map(|c| c.get("name").cloned()).collect();
            out.push(TableMeta { name: tname, sheet: name.clone(), data, columns });
        }
    }
    Ok(out)
}

fn base64(s: &str) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    let (mut acc, mut bits) = (0u32, 0u32);
    for c in s.bytes() {
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' => break,
            b' ' | b'\n' | b'\r' | b'\t' => continue,
            _ => return None,
        };
        acc = (acc << 6) | v as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
            acc &= (1 << bits) - 1;
        }
    }
    Some(out)
}

// customXml の中身は UTF-8 か UTF-16（BOM 付き）で書かれている
fn decode_xml(b: &[u8]) -> String {
    if b.starts_with(&[0xff, 0xfe]) || (b.len() > 1 && b[1] == 0 && b[0] == b'<') {
        let start = if b.starts_with(&[0xff, 0xfe]) { 2 } else { 0 };
        let u: Vec<u16> = b[start..].chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        return String::from_utf16_lossy(&u);
    }
    String::from_utf8_lossy(b.strip_prefix(&[0xef, 0xbb, 0xbf][..]).unwrap_or(b)).into_owned()
}

// Power Query の M のコード（Formulas/Section1.m）。DataMashup の形は MS-QDEFF の 2.2：
// 版（4 バイト）・中のパッケージの長さ（4 バイト、リトルエンディアン）・中のパッケージ（zip）・……
pub fn power_query(file: &str) -> Result<Option<String>, String> {
    let mut z = open_zip(file)?;
    let names: Vec<String> = z
        .file_names()
        .filter_map(|n| n.ok().map(|n| n.to_string()))
        .filter(|n| n.starts_with("customXml/item") && !n.contains("Props"))
        .collect();
    for n in names {
        let Some(bytes) = read_part(&mut z, &n) else { continue };
        let xml = decode_xml(&bytes);
        let Some(open) = xml.find("<DataMashup") else { continue };
        let gt = tag_end(&xml[open..]);
        if gt == xml.len() - open { continue }
        let body = &xml[open + gt + 1..];
        let Some(end) = body.find("</DataMashup>") else { continue };
        let raw = base64(body[..end].trim()).ok_or("Power Query の中身（base64）を読めない")?;
        if raw.len() < 8 {
            return Err("Power Query の中身が短すぎる".into());
        }
        let len = u32::from_le_bytes([raw[4], raw[5], raw[6], raw[7]]) as usize;
        let inner = raw.get(8..8 + len).ok_or("Power Query の中のパッケージの長さが合わない")?;
        let mut pz = ZipArchive::new(Cursor::new(inner.to_vec())).map_err(|e| format!("Power Query の中のパッケージを開けない：{e}"))?;
        let m = read_part(&mut pz, "Formulas/Section1.m").ok_or("Power Query の中に Formulas/Section1.m が無い")?;
        return Ok(Some(String::from_utf8_lossy(m.strip_prefix(&[0xef, 0xbb, 0xbf][..]).unwrap_or(&m)).into_owned()));
    }
    Ok(None)
}

// シートの見え方：隠した行と列、オートフィルターの範囲、数の表示形式（標準のもの以外）
pub struct Layout {
    pub hidden_rows: HashSet<u32>,
    pub hidden_cols: HashSet<u32>,
    pub filter: Option<String>,
    pub formats: Formats,
}

// セルの表示形式。列ごとに、同じ形式が続く行をひとまとめにして持つ（10万行でも列の数ほどで済む）
pub struct Formats {
    xfs: Vec<Option<String>>,
    // 列 → (始めの行, 終わりの行, cellXfs の番号) を行の順に
    runs: HashMap<u32, Vec<(u32, u32, u32)>>,
}

impl Formats {
    fn add(&mut self, r: u32, c: u32, xf: u32) {
        let runs = self.runs.entry(c).or_default();
        match runs.last_mut() {
            Some(last) if last.2 == xf && last.1 + 1 == r => last.1 = r,
            _ => runs.push((r, r, xf)),
        }
    }

    // "#,##0,\"千円\"" など。標準と文字列 @ は None
    pub fn get(&self, r: u32, c: u32) -> Option<&str> {
        let runs = self.runs.get(&c)?;
        let i = runs.partition_point(|run| run.1 < r);
        let run = runs.get(i).filter(|run| run.0 <= r)?;
        self.xfs.get(run.2 as usize)?.as_deref()
    }
}

// 組み込みの表示形式（ECMA-376 Part 1 の 18.8.30）。日本語版で使う 27〜36・50〜58 は日付・時刻の和暦の形
fn builtin_format(id: u32) -> Option<String> {
    let f = match id {
        0 | 49 => return None,
        1 => "0",
        2 => "0.00",
        3 => "#,##0",
        4 => "#,##0.00",
        9 => "0%",
        10 => "0.00%",
        11 => "0.00E+00",
        12 => "# ?/?",
        13 => "# ??/??",
        14 => "yyyy/m/d",
        15 => "d-mmm-yy",
        16 => "d-mmm",
        17 => "mmm-yy",
        18 => "h:mm AM/PM",
        19 => "h:mm:ss AM/PM",
        20 => "h:mm",
        21 => "h:mm:ss",
        22 => "yyyy/m/d h:mm",
        37 => "#,##0 ;(#,##0)",
        38 => "#,##0 ;[Red](#,##0)",
        39 => "#,##0.00;(#,##0.00)",
        40 => "#,##0.00;[Red](#,##0.00)",
        45 => "mm:ss",
        46 => "[h]:mm:ss",
        47 => "mmss.0",
        48 => "##0.0E+0",
        _ => return Some(format!("組み込み {id}")),
    };
    Some(f.to_string())
}

// cellXfs の番号 → 表示形式（標準なら None）
fn xf_formats(z: &mut ZipArchive<File>) -> Vec<Option<String>> {
    let Some(xml) = text_part(z, "xl/styles.xml") else { return Vec::new() };
    let mut custom = HashMap::new();
    for a in elements(&xml, "numFmt") {
        if let (Some(id), Some(code)) = (a.get("numFmtId").and_then(|v| v.parse::<u32>().ok()), a.get("formatCode")) {
            custom.insert(id, code.clone());
        }
    }
    // cellXfs の中の xf だけを数える（cellStyleXfs の xf は数えない）
    let Some(start) = xml.find("<cellXfs") else { return Vec::new() };
    let body = &xml[start..xml[start..].find("</cellXfs>").map_or(xml.len(), |e| start + e)];
    elements(body, "xf")
        .into_iter()
        .map(|a| {
            let id: u32 = a.get("numFmtId").and_then(|v| v.parse().ok()).unwrap_or(0);
            match custom.get(&id) {
                Some(c) if c == "General" || c == "@" => None,
                Some(c) => Some(c.clone()),
                None => builtin_format(id),
            }
        })
        .collect()
}

pub fn layout(file: &str, sheet: &str) -> Result<Layout, String> {
    use quick_xml::events::Event;
    let mut z = open_zip(file)?;
    let part = sheet_parts(&mut z)?.into_iter().find(|(n, _)| n == sheet).map(|(_, p)| p).ok_or("シートが見つからない")?;
    let xfs = xf_formats(&mut z);
    let mut l = Layout { hidden_rows: HashSet::new(), hidden_cols: HashSet::new(), filter: None, formats: Formats { xfs, runs: HashMap::new() } };
    // 大きいシートでも丸ごと読まずに、XML を順にたどる
    let entry = z.by_name(&part).map_err(|_| "シートの XML が無い")?;
    let mut xml = quick_xml::Reader::from_reader(std::io::BufReader::new(entry));
    let mut buf = Vec::new();
    // 番地を省いた row・c は、前の行の次・前の c の右隣
    let (mut row, mut col): (Option<u32>, u32) = (None, 0);
    loop {
        let e = match xml.read_event_into(&mut buf) {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => e,
            Ok(Event::Eof) => break,
            Ok(_) => {
                buf.clear();
                continue;
            }
            Err(e) => return Err(format!("シートの XML を読めない：{e}")),
        };
        // 属性は1回だけたどる（10万行のシートでは c がセルの数だけある）
        // 値は借りたまま使う（セルごとに文字列を作ると、musl などの遅いメモリ確保で目立って遅くなる）
        let mut get: [Option<std::borrow::Cow<str>>; 4] = [None, None, None, None];
        let keys: &[&str] = match e.local_name().as_ref() {
            "row" => &["r", "hidden"],
            "col" => &["min", "max", "hidden"],
            "c" => &["r", "s"],
            "autoFilter" => &["ref"],
            _ => {
                buf.clear();
                continue;
            }
        };
        for at in e.attributes().flatten() {
            if let Some(i) = keys.iter().position(|k| at.key.local_name().as_ref() == *k) {
                get[i] = Some(at.value);
            }
        }
        let on = |v: &Option<std::borrow::Cow<str>>| v.as_deref().is_some_and(|v| v == "1" || v == "true");
        let num = |v: &Option<std::borrow::Cow<str>>| v.as_deref().and_then(|v| v.parse::<u32>().ok());
        match e.local_name().as_ref() {
            "row" => {
                let r = num(&get[0]).and_then(|r| r.checked_sub(1)).unwrap_or_else(|| row.map_or(0, |p| p + 1));
                row = Some(r);
                col = 0;
                if on(&get[1]) {
                    l.hidden_rows.insert(r);
                }
            }
            "col" => {
                if on(&get[2]) {
                    if let (Some(min), Some(max)) = (num(&get[0]), num(&get[1])) {
                        // 全部の列を隠す指定（max=16384）もあるので、Excel の端で止める
                        for c in min.max(1)..=max.min(16384) {
                            l.hidden_cols.insert(c - 1);
                        }
                    }
                }
            }
            "c" => {
                let mut r = row.unwrap_or(0);
                if let Some((pr, pc)) = get[0].as_deref().and_then(parse_cell) {
                    r = pr;
                    col = pc;
                }
                if let Some(xf) = num(&get[1]) {
                    if l.formats.xfs.get(xf as usize).is_some_and(|f| f.is_some()) {
                        l.formats.add(r, col, xf);
                    }
                }
                col += 1;
            }
            "autoFilter" if l.filter.is_none() => l.filter = get[0].as_ref().map(|r| r.replace('$', "")),
            _ => {}
        }
        buf.clear();
    }
    // get は行の順に並んでいる前提。セルが行の順に並んでいない XML もあるので並べ直す
    for runs in l.formats.runs.values_mut() {
        runs.sort_by_key(|run| run.0);
    }
    Ok(l)
}

// 外部リンクの番号（式の [1] の 1）→ 参照先のブック
pub fn external_links(file: &str) -> Result<Vec<(usize, String)>, String> {
    let mut z = open_zip(file)?;
    let wb_xml = text_part(&mut z, "xl/workbook.xml").ok_or("xl/workbook.xml が無い")?;
    let wb_rels = rels(&mut z, "xl/workbook.xml");
    let mut out = Vec::new();
    for (i, e) in elements(&wb_xml, "externalReference").into_iter().enumerate() {
        let Some((_, part)) = e.get("id").and_then(|id| wb_rels.iter().find(|(r, _)| r == id)) else { continue };
        // externalLink の rels の Target は外のファイルのパス（解かずにそのまま使う）
        let (dir, f) = part.rsplit_once('/').unwrap_or(("", part));
        let Some(xml) = text_part(&mut z, &format!("{dir}/_rels/{f}.rels")) else { continue };
        if let Some(t) = elements(&xml, "Relationship").into_iter().find_map(|a| a.get("Target").cloned()) {
            out.push((i + 1, t));
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::{elements, tag_end};

    #[test]
    fn attribute_values_may_hold_gt() {
        assert_eq!(tag_end(r#"numFmt formatCode="[>1000]#,##0" numFmtId="164"/>rest"#), 48);
        let xml = r#"<numFmts><numFmt numFmtId="164" formatCode="[>1000]#,##0;0"/><numFmt numFmtId="165" formatCode='a>b'/></numFmts>"#;
        let found = elements(xml, "numFmt");
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].get("formatCode").map(String::as_str), Some("[>1000]#,##0;0"));
        assert_eq!(found[1].get("numFmtId").map(String::as_str), Some("165"));
        assert_eq!(found[1].get("formatCode").map(String::as_str), Some("a>b"));
    }
}
