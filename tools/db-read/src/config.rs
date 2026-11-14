// 接続の設定（PC ごとの ~/.config/db-read/db.toml）。パスワードはファイルに書かず、環境変数の名前を書く。
//   [sales]
//   kind = "oracle"            # postgres・mysql・sqlserver・oracle
//   host = "db01"
//   port = 1521                # 省略で種類ごとの既定
//   database = "ORCLPDB1"      # Oracle はサービス名
//   user = "reader"
//   password_env = "DB_SALES_PASSWORD"
//   tls = true                 # 暗号化する（sqlserver は既定で true。ca_cert か trust_cert を書くと true。ほかは false）
//   ca_cert = "server-ca.pem"  # この CA でサーバーの証明書を確かめる（postgres・mysql。相対パスは設定のファイルから）
//   verify_host = false        # ca_cert のとき、証明書のホスト名を照らさず鎖だけ確かめる（MySQL の VERIFY_CA）
//   trust_cert = true          # サーバーの証明書を確かめず、暗号化だけする（sqlserver・postgres・mysql）
//   auth = "windows"           # sqlserver を Windows の認証でつなぐ（Windows だけ。user と password_env は要らない）
//   connect_string = "..."     # Oracle の接続文字列をそのまま使う（host・port・database の代わり）
use serde::Deserialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Deserialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Postgres,
    Mysql,
    Sqlserver,
    Oracle,
}

impl Kind {
    pub fn name(self) -> &'static str {
        match self {
            Kind::Postgres => "postgres",
            Kind::Mysql => "mysql",
            Kind::Sqlserver => "sqlserver",
            Kind::Oracle => "oracle",
        }
    }
    fn default_port(self) -> u16 {
        match self {
            Kind::Postgres => 5432,
            Kind::Mysql => 3306,
            Kind::Sqlserver => 1433,
            Kind::Oracle => 1521,
        }
    }
}

#[derive(Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct Conn {
    pub kind: Kind,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub database: Option<String>,
    pub user: Option<String>,
    pub password_env: Option<String>,
    pub tls: Option<bool>,
    #[serde(default)]
    pub trust_cert: bool,
    pub ca_cert: Option<PathBuf>,
    pub verify_host: Option<bool>,
    pub auth: Option<String>,
    pub connect_string: Option<String>,
}

impl Conn {
    pub fn host(&self) -> &str {
        self.host.as_deref().unwrap_or("localhost")
    }
    pub fn port(&self) -> u16 {
        self.port.unwrap_or(self.kind.default_port())
    }
    pub fn tls(&self) -> bool {
        self.tls.unwrap_or(self.kind == Kind::Sqlserver || self.trust_cert || self.ca_cert.is_some())
    }
    pub fn verify_host(&self) -> bool {
        self.verify_host.unwrap_or(true)
    }
    pub fn windows_auth(&self) -> bool {
        self.auth.as_deref() == Some("windows")
    }
    pub fn user(&self) -> Result<&str, String> {
        self.user.as_deref().ok_or_else(|| "設定に user がありません".to_string())
    }
    pub fn password(&self) -> Result<String, String> {
        let var = self.password_env.as_deref().ok_or("設定に password_env（パスワードを入れた環境変数の名前）がありません")?;
        match std::env::var(var) {
            Ok(p) if !p.is_empty() => Ok(p),
            _ => Err(format!("環境変数 {var} にパスワードがありません")),
        }
    }
    // 行き先の説明（パスワードは含めない）
    pub fn describe(&self) -> String {
        if let Some(cs) = &self.connect_string {
            return cs.clone();
        }
        let db = self.database.as_deref().map(|d| format!("/{d}")).unwrap_or_default();
        format!("{}:{}{db}", self.host(), self.port())
    }
}

pub fn path(arg: Option<&String>) -> PathBuf {
    if let Some(p) = arg {
        return PathBuf::from(p);
    }
    if let Ok(p) = std::env::var("DB_READ_CONFIG") {
        return PathBuf::from(p);
    }
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).unwrap_or_default();
    Path::new(&home).join(".config").join("db-read").join("db.toml")
}

pub fn load(path: &Path) -> Result<BTreeMap<String, Conn>, String> {
    let text = std::fs::read_to_string(path).map_err(|e| {
        format!("接続の設定 {} を読めません（{e}）。書き方は skills/db-read/SKILL.md", path.display())
    })?;
    let mut conns: BTreeMap<String, Conn> = toml::from_str(&text).map_err(|e| format!("接続の設定 {} の誤り：{e}", path.display()))?;
    for (name, c) in conns.iter_mut() {
        if c.password_env.is_none() && !c.windows_auth() {
            return Err(format!("接続 {name} に password_env がありません（パスワードはファイルに書かず、環境変数の名前を書く）"));
        }
        if c.windows_auth() && c.kind != Kind::Sqlserver {
            return Err(format!("接続 {name}：auth = \"windows\" は sqlserver だけです"));
        }
        if c.connect_string.is_some() && c.kind != Kind::Oracle {
            return Err(format!("接続 {name}：connect_string は oracle だけです"));
        }
        // 効かない設定を黙って受けない
        if c.trust_cert && c.kind == Kind::Oracle {
            return Err(format!("接続 {name}：trust_cert は sqlserver・postgres・mysql だけです"));
        }
        if c.ca_cert.is_some() && !matches!(c.kind, Kind::Postgres | Kind::Mysql) {
            return Err(format!("接続 {name}：ca_cert は postgres・mysql だけです"));
        }
        if c.ca_cert.is_some() && c.trust_cert {
            return Err(format!("接続 {name}：ca_cert と trust_cert は一緒に書かない（ca_cert は確かめる、trust_cert は確かめない）"));
        }
        if c.verify_host.is_some() && c.ca_cert.is_none() {
            return Err(format!("接続 {name}：verify_host は ca_cert と一緒のときだけ書く"));
        }
        if c.tls == Some(false) && (c.trust_cert || c.ca_cert.is_some()) {
            return Err(format!("接続 {name}：tls = false のときは ca_cert・trust_cert を書かない"));
        }
        // 相対パスは設定のファイルの置き場から
        if let Some(ca) = &c.ca_cert {
            if ca.is_relative() {
                c.ca_cert = Some(path.parent().unwrap_or(Path::new(".")).join(ca));
            }
        }
        if c.connect_string.is_some() && c.tls.is_some() {
            return Err(format!("接続 {name}：connect_string のときは tls を書かない（tcps:// は接続文字列に書く）"));
        }
    }
    Ok(conns)
}
