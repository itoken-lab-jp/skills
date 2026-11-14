// 結果の書き出し。CSV（既定）か JSON Lines。標準出力は既定で先頭の 200 行で止め、続きがあれば標準エラーで知らせる。
use std::fs::File;
use std::io::{self, BufWriter, Write};

#[derive(Clone, Copy, PartialEq)]
pub enum Format {
    Csv,
    Jsonl,
}

// 1つのセル。数は DB が返した文字のまま（桁を落とさない）
pub enum Cell {
    Null,
    Num(String),
    Text(String),
    Bool(bool),
}

pub struct Sink {
    w: Box<dyn Write>,
    // --out のとき（一時ファイル, 書き先）。一時ファイルに書き、finish で名前を変える
    file: Option<(String, String)>,
    format: Format,
    max_rows: Option<u64>,
    cols: Vec<String>,
    keys: Vec<String>,
    rows: u64,
    truncated: bool,
    started: bool,
    rec: Vec<String>,
}

// 同じ名前の列は2つ目から _2 を付ける（ほかの名前とぶつかれば _3 へ進める）
fn unique(cols: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for c in cols {
        let mut name = c.clone();
        let mut n = 2;
        while out.contains(&name) || (name != *c && cols.contains(&name)) {
            name = format!("{c}_{n}");
            n += 1;
        }
        out.push(name);
    }
    out
}

impl Sink {
    pub fn new(out: Option<&str>, format: Format, max_rows: Option<u64>, bom: bool) -> Result<Sink, String> {
        // 読めなかったときに、前の結果を空にしたり途中までのファイルを残したりしないよう、一時ファイルに書く
        let file = out.map(|p| (format!("{p}.db-read-tmp"), p.to_string()));
        let mut w: Box<dyn Write> = match &file {
            Some((tmp, p)) => Box::new(BufWriter::with_capacity(1 << 16, File::create(tmp).map_err(|e| format!("{p} に書けません：{e}"))?)),
            None => Box::new(BufWriter::with_capacity(1 << 16, io::stdout())),
        };
        if bom {
            w.write_all(b"\xEF\xBB\xBF").map_err(|e| e.to_string())?;
        }
        Ok(Sink { w, file, format, max_rows, cols: vec![], keys: vec![], rows: 0, truncated: false, started: false, rec: vec![] })
    }

    pub fn header(&mut self, cols: Vec<String>) -> Result<(), String> {
        self.keys = unique(&cols);
        self.cols = cols;
        self.started = true;
        if self.format == Format::Csv {
            let keys = self.keys.clone();
            self.write_csv(keys.iter().map(String::as_str))?;
        }
        Ok(())
    }

    fn write_csv<'a>(&mut self, fields: impl Iterator<Item = &'a str>) -> Result<(), String> {
        let mut first = true;
        for f in fields {
            if !first {
                self.w.write_all(b",").map_err(|e| e.to_string())?;
            }
            first = false;
            if f.contains([',', '"', '\n', '\r']) {
                self.w.write_all(b"\"").map_err(|e| e.to_string())?;
                self.w.write_all(f.replace('"', "\"\"").as_bytes()).map_err(|e| e.to_string())?;
                self.w.write_all(b"\"").map_err(|e| e.to_string())?;
            } else {
                self.w.write_all(f.as_bytes()).map_err(|e| e.to_string())?;
            }
        }
        self.w.write_all(b"\n").map_err(|e| e.to_string())
    }

    // 書いたら true、上限に届いて書かなかったら false（呼ぶ側は読むのをやめる）
    pub fn row(&mut self, cells: &[Cell]) -> Result<bool, String> {
        if cells.len() != self.keys.len() {
            return Err("結果の表が2つ以上ある（列の数が見出しと違う行が来た）。文は1つにする".into());
        }
        if Some(self.rows) == self.max_rows {
            self.truncated = true;
            return Ok(false);
        }
        self.rows += 1;
        match self.format {
            Format::Csv => {
                let mut rec = std::mem::take(&mut self.rec);
                rec.clear();
                rec.extend(cells.iter().map(|c| match c {
                    Cell::Null => String::new(),
                    Cell::Num(s) | Cell::Text(s) => s.clone(),
                    Cell::Bool(b) => b.to_string(),
                }));
                let r = self.write_csv(rec.iter().map(String::as_str));
                self.rec = rec;
                r
            }
            Format::Jsonl => {
                let mut line = String::with_capacity(128);
                line.push('{');
                for (i, c) in cells.iter().enumerate() {
                    if i > 0 {
                        line.push(',');
                    }
                    line.push_str(&serde_json::to_string(&self.keys[i]).unwrap());
                    line.push(':');
                    match c {
                        Cell::Null => line.push_str("null"),
                        Cell::Num(s) => line.push_str(s),
                        Cell::Text(s) => line.push_str(&serde_json::to_string(s).unwrap()),
                        Cell::Bool(b) => line.push_str(if *b { "true" } else { "false" }),
                    }
                }
                line.push_str("}\n");
                self.w.write_all(line.as_bytes()).map_err(|e| e.to_string())
            }
        }?;
        Ok(true)
    }

    pub fn rows(&self) -> u64 {
        self.rows
    }

    // 読めなかったとき。一時ファイルを消し、--out の書き先には触らない
    pub fn abort(self) {
        if let Some((tmp, _)) = &self.file {
            drop(self.w);
            let _ = std::fs::remove_file(tmp);
        }
    }

    pub fn finish(mut self) -> Result<(), String> {
        let flushed = self.w.flush().map_err(|e| e.to_string());
        if let Some((tmp, p)) = self.file.take() {
            drop(std::mem::replace(&mut self.w, Box::new(io::sink())));
            if let Err(e) = flushed.and_then(|_| std::fs::rename(&tmp, &p).map_err(|e| format!("{p} に書けません：{e}"))) {
                let _ = std::fs::remove_file(&tmp);
                return Err(e);
            }
        } else {
            flushed?;
        }
        if self.truncated {
            eprintln!(
                "db-read: 注意：{} 行で止めた（続きがある）。全部は --out ファイル で書くか、--max-rows 0 を付ける",
                self.rows
            );
        } else if self.started && self.rows == 0 {
            eprintln!("db-read: 注意：0 行だった");
        }
        if self.keys != self.cols {
            eprintln!("db-read: 注意：同じ名前の列があったので、2つ目から _2 などを付けた");
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::unique;

    #[test]
    fn renames_duplicates() {
        let v = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(unique(&v(&["id", "id", "id_2"])), v(&["id", "id_3", "id_2"]));
        assert_eq!(unique(&v(&["a", "b"])), v(&["a", "b"]));
    }
}
