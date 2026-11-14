// 読むだけの文かを確かめる。最初の語が SELECT・WITH・SHOW・DESCRIBE・DESC・EXPLAIN で、文が1つだけのものを通す。
// これは誤操作よけで、本当の守りは db.rs で DB の側を読み取り専用にすること（WITH の中の書き換えなどはそちらで止まる）と、
// 読むだけの権限のユーザーでつなぐこと。

const ALLOWED: [&str; 6] = ["SELECT", "WITH", "SHOW", "DESCRIBE", "DESC", "EXPLAIN"];

// SQL Server は文の間に ; が要らないので、SELECT の後ろに別の文を続けられる（SELECT 1 COMMIT DELETE FROM t）。
// 文字列・コメントの外にこの語があれば断る
// OPENQUERY などはリンクサーバーやほかのデータソースに文を送れる（送った先の書き換えは、この接続の読み取り専用で止まらない）
const SQLSERVER_DENIED: [&str; 30] = [
    "COMMIT", "ROLLBACK", "SAVE", "BEGIN", "EXEC", "EXECUTE", "INSERT", "UPDATE", "DELETE", "MERGE", "DROP", "ALTER", "CREATE",
    "TRUNCATE", "GRANT", "REVOKE", "DENY", "DECLARE", "SET", "INTO", "USE", "KILL", "SHUTDOWN", "BACKUP", "RESTORE", "DBCC", "WAITFOR",
    "OPENQUERY", "OPENROWSET", "OPENDATASOURCE",
];

// 文字列・引用した名前・コメントの外にある部分だけを、位置付きで返す
fn code_spans(sql: &str) -> Vec<(usize, char)> {
    let chars: Vec<(usize, char)> = sql.char_indices().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i].1;
        let next = chars.get(i + 1).map(|x| x.1);
        if c == '-' && next == Some('-') {
            while i < chars.len() && chars[i].1 != '\n' {
                i += 1;
            }
            out.push((sql.len(), ' '));
            continue;
        }
        if c == '/' && next == Some('*') {
            i += 2;
            while i < chars.len() && !(chars[i].1 == '*' && chars.get(i + 1).map(|x| x.1) == Some('/')) {
                i += 1;
            }
            i += 2;
            out.push((sql.len(), ' '));
            continue;
        }
        if c == '\'' || c == '"' || c == '`' || c == '[' {
            let close = if c == '[' { ']' } else { c };
            i += 1;
            while i < chars.len() {
                if chars[i].1 == close {
                    // '' のように重ねたものは閉じではない
                    if chars.get(i + 1).map(|x| x.1) == Some(close) && close != ']' {
                        i += 2;
                        continue;
                    }
                    break;
                }
                i += 1;
            }
            i += 1;
            out.push((sql.len(), 'x'));
            continue;
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

// 通すときは、末尾の ; を除いた文を返す（Oracle は末尾の ; を誤りにする）
pub fn read_only(sql: &str) -> Result<String, String> {
    let spans = code_spans(sql);
    let semis: Vec<usize> = spans.iter().filter(|(_, c)| *c == ';').map(|(p, _)| *p).collect();
    let mut body = sql;
    if let Some(&last) = semis.last() {
        let rest_is_blank = spans.iter().filter(|(p, _)| *p > last && *p < sql.len()).all(|(_, c)| c.is_whitespace());
        if semis.len() > 1 || !rest_is_blank {
            return Err("文は1つだけにしてください（; で区切った2つ目以降は走らせない）".into());
        }
        body = &sql[..last];
    }
    let first: String = spans
        .iter()
        .map(|(_, c)| *c)
        .skip_while(|c| c.is_whitespace() || *c == '(')
        .take_while(|c| c.is_alphabetic())
        .collect::<String>()
        .to_uppercase();
    if first.is_empty() {
        return Err("SQL が空です".into());
    }
    if !ALLOWED.contains(&first.as_str()) {
        return Err(format!("{first} の文は走らせません（読むだけの道具。通すのは {}）", ALLOWED.join("・")));
    }
    Ok(body.trim().to_string())
}

// SQL Server だけの見分け。read_only を通した文に使う
pub fn sqlserver(sql: &str) -> Result<(), String> {
    // code_spans は、[名前] の中の ]] （] を重ねた書き方）と、入れ子のコメント /* /* */ */ を T-SQL と同じには読まない。
    // 読み違えると、その後ろの COMMIT や DELETE を文字列やコメントの中と見て通してしまうので、どちらも含む文は断る
    if sql.contains("]]") {
        return Err("]] を含む文は走らせません（[名前] の中の ]] を読み違えて、後ろの文を見落とすおそれがあるため）".into());
    }
    let mut rest = sql;
    while let Some(open) = rest.find("/*") {
        let inner = &rest[open + 2..];
        let close = inner.find("*/").unwrap_or(inner.len());
        if inner[..close].contains("/*") {
            return Err("入れ子のコメント（/* の中の /*）を含む文は走らせません（コメントの終わりを読み違えるおそれがあるため）".into());
        }
        rest = &inner[(close + 2).min(inner.len())..];
    }
    let code: String = code_spans(sql).into_iter().map(|(_, c)| c).collect();
    for word in code.split(|c: char| !(c.is_alphanumeric() || c == '_' || c == '@' || c == '#')) {
        let w = word.to_uppercase();
        if SQLSERVER_DENIED.contains(&w.as_str()) {
            return Err(format!("{w} を含む文は走らせません（SQL Server は ; の無い2つ目の文を続けられるため。読むだけの道具）"));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{read_only, sqlserver};

    #[test]
    fn sqlserver_rejects_trailing_statements() {
        assert!(sqlserver("SELECT 1 COMMIT DELETE FROM t").is_err());
        assert!(sqlserver("select * into t2 from t").is_err());
        assert!(sqlserver("SELECT last_update, [update], 'commit' FROM t -- delete").is_ok());
        assert!(sqlserver("SELECT @set, #begin FROM t").is_ok());
        assert!(sqlserver("SELECT * FROM OPENQUERY(srv, 'select 1')").is_err());
    }

    #[test]
    fn sqlserver_rejects_what_code_spans_misreads() {
        // T-SQL は [a]] ' ] を1つの名前と読むが、code_spans は ' から先を文字列と見て COMMIT と DELETE を隠す
        assert!(sqlserver("SELECT 1 AS [a]] ' ] COMMIT DELETE FROM t -- '").is_err());
        // T-SQL のコメントは入れ子になる。code_spans は最初の */ で終わったと見て、' から先を文字列と見る
        assert!(sqlserver("SELECT 1 /* /* */ ' */ COMMIT DELETE FROM t -- '").is_err());
        assert!(sqlserver("SELECT [a b], 1 /* c */ FROM t /* d */").is_ok());
    }

    #[test]
    fn passes_reads() {
        assert_eq!(read_only("select 1;").unwrap(), "select 1");
        assert_eq!(read_only("  -- c\n /* x; */ WITH a AS (SELECT ';') SELECT * FROM a ;  -- end").unwrap(), "-- c\n /* x; */ WITH a AS (SELECT ';') SELECT * FROM a");
        assert!(read_only("(select 1) union (select 2)").is_ok());
        assert!(read_only("SELECT 'it''s; fine'").is_ok());
    }

    #[test]
    fn rejects_writes_and_batches() {
        assert!(read_only("delete from t").is_err());
        assert!(read_only("select 1; drop table t").is_err());
        assert!(read_only("/* select */ update t set a=1").is_err());
        assert!(read_only("-- select\ninsert into t values (1)").is_err());
        assert!(read_only("").is_err());
        assert!(read_only("BEGIN select 1; END;").is_err());
    }
}
