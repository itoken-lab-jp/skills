// skills/db-read/scripts の exe の試験。exe がソース（tools/db-read）から作り直してあるかを指紋で確かめ、
// この機械の exe で、DB につながずに分かること（使い方・読むだけの文の見分け・設定の誤り）を確かめる。
// 環境変数 DB_READ_IT_CONFIG に接続の設定（tools/db-read/fixtures/ci.toml の形）があれば、本物の DB にもつなぐ
// （CI の .github/workflows/db-read.yml。DB には tools/db-read/fixtures の SQL を流し込んでおく）。
// DB_READ_IT_TLS_CONFIG（tools/db-read/fixtures/tls/tls.toml）があれば、自分の CA を使う MySQL・PostgreSQL
// （tools/db-read/fixtures/tls/start.sh で立てる）に、証明書の確かめ方を変えてつなぐ。
//   node --test test/db-read.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = path.join(root, 'tools/db-read');
const bin = path.join(root, 'skills/db-read/scripts');
const builds = { 'windows-x64': 'db-read.exe', 'mac-arm64': 'db-read', 'linux-x64': 'db-read' };
const here = { 'win32-x64': 'windows-x64', 'darwin-arm64': 'mac-arm64', 'linux-x64': 'linux-x64' }[`${process.platform}-${process.arch}`];
const exe = here && path.join(bin, here, builds[here]);
const it = process.env.DB_READ_IT_CONFIG;
const itTls = process.env.DB_READ_IT_TLS_CONFIG;

const temps = [];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const tempDir = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'db-read-'));
  temps.push(d);
  return d;
};

// tools/db-read/build.rs と同じ計算（FNV-1a 64。改行は LF にそろえる）
function sourceHash() {
  const files = ['Cargo.toml', 'Cargo.lock', 'build.rs', ...fs.readdirSync(path.join(src, 'src')).sort().map((f) => `src/${f}`), 'vendor/mysql/src/io/tls/rustls_io.rs'];
  let h = 0xcbf29ce484222325n;
  const feed = (buf) => { for (const b of buf) { h ^= BigInt(b); h = (h * 0x100000001b3n) & 0xffffffffffffffffn; } };
  for (const f of files) {
    feed(Buffer.from(f));
    feed([0]);
    feed(Buffer.from(fs.readFileSync(path.join(src, f), 'utf8').replace(/\r\n/g, '\n')));
    feed([0]);
  }
  return h.toString(16).padStart(16, '0');
}

const run = (args, env = {}) => {
  const r = spawnSync(exe, args, { encoding: 'utf8', env: { ...process.env, ...env } });
  if (r.error) throw r.error;
  return r;
};
const ok = (args, env) => {
  const r = run(args, env);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
};

test('3つの exe がどれも今のソースから作ってある（直したら tools/db-read/build-all.sh と Actions の db-read の mac-build）', () => {
  const hash = sourceHash();
  for (const [dir, name] of Object.entries(builds)) {
    const file = path.join(bin, dir, name);
    assert.ok(fs.existsSync(file), `${file} が無い`);
    assert.ok(fs.readFileSync(file).includes(Buffer.from(hash)), `${dir} の exe がソースと食い違う（指紋 ${hash} を含まない）`);
  }
});

test('第三者の表示が今の Cargo.lock と、exe を作った Rust の版から作ってある（直したら tools/db-read/make-notices.py）', () => {
  const notices = fs.readFileSync(path.join(root, 'skills/db-read/THIRD_PARTY_NOTICES.md'), 'utf8');
  const lock = crypto.createHash('sha256').update(fs.readFileSync(path.join(src, 'Cargo.lock'), 'utf8').replace(/\r\n/g, '\n')).digest('hex');
  assert.match(notices, new RegExp(`Cargo\\.lock sha256: ${lock}`), 'Cargo.lock を変えたのに表示を作り直していない');
  const rust = notices.match(/## Rust の標準ライブラリ（rustc (\S+)[^\n]*\n\nhttps:\/\/github\.com\/rust-lang\/rust\/tree\/([0-9a-f]{40})/);
  assert.ok(rust, '表示に Rust の標準ライブラリの節が無い');
  for (const [dir, name] of Object.entries(builds)) {
    assert.ok(fs.readFileSync(path.join(bin, dir, name)).includes(Buffer.from(`rustc/${rust[2]}`)), `${dir} の exe は Rust ${rust[1]}（${rust[2]}）で作っていない（表示と食い違う）`);
  }
  for (const part of ['## musl ', '## mingw-w64 ']) assert.ok(notices.includes(part), `表示に「${part.slice(3)}」の節が無い`);
});

test('この機械の exe が動き、指紋を名乗る', { skip: !exe && `${process.platform}-${process.arch} 向けの exe は作っていない` }, () => {
  assert.equal(ok(['--version']).trim(), `db-read 0.1.0 src:${sourceHash()}`);
});

test('使い方の誤りは終了コード 2', { skip: !exe }, () => {
  for (const args of [[], ['query'], ['query', 'x'], ['query', 'x', 'select 1', '--file', 'a.sql'], ['tables', 'x', '--bogus'], ['query', 'x', 'select 1', '--format', 'xml'], ['nope', 'x']]) {
    assert.equal(run(args).status, 2, args.join(' '));
  }
});

test('書き換える文・2つ以上の文は、DB につなぐ前に断る', { skip: !exe }, () => {
  const env = { DB_READ_CONFIG: path.join(tempDir(), 'none.toml') };
  for (const sql of ['delete from t', 'UPDATE t SET a = 1', 'drop table t', 'select 1; delete from t', '/* select */ insert into t values (1)', 'BEGIN NULL; END;', 'exec sp_who']) {
    const r = run(['query', 'x', sql], env);
    assert.equal(r.status, 1, sql);
    assert.match(r.stderr, /走らせません|1つだけ/, sql);
    assert.doesNotMatch(r.stderr, /none\.toml/, '設定を読む前に断る');
  }
});

test('設定の既定の置き場は ~/.config/db-read/db.toml（DB_READ_CONFIG が無いとき）', { skip: !exe }, () => {
  const home = tempDir();
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.DB_READ_CONFIG;
  const r1 = spawnSync(exe, ['conns'], { encoding: 'utf8', env });
  assert.equal(r1.status, 1, r1.stderr);
  assert.ok(r1.stderr.includes(path.join(home, '.config', 'db-read', 'db.toml')), r1.stderr);
  fs.mkdirSync(path.join(home, '.config', 'db-read'), { recursive: true });
  fs.writeFileSync(path.join(home, '.config', 'db-read', 'db.toml'), '[home]\nkind = "postgres"\nhost = "h"\nuser = "u"\npassword_env = "P"\n');
  const r2 = spawnSync(exe, ['conns'], { encoding: 'utf8', env });
  assert.equal(r2.status, 0, r2.stderr);
  assert.match(r2.stdout, /home/);
});

test('設定の誤り：ファイルが無い・パスワードの環境変数が無い・知らない鍵・接続名が無い', { skip: !exe }, () => {
  const dir = tempDir();
  const cfg = (text) => {
    const f = path.join(dir, `${Math.random()}.toml`);
    fs.writeFileSync(f, text);
    return { DB_READ_CONFIG: f };
  };
  const fail = (args, env, pattern) => {
    const r = run(args, env);
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, pattern);
  };
  fail(['conns'], { DB_READ_CONFIG: path.join(dir, 'none.toml') }, /読めません/);
  fail(['conns'], cfg('[a]\nkind = "postgres"\nuser = "u"\n'), /password_env/);
  fail(['conns'], cfg('[a]\nkind = "postgres"\npassword = "x"\n'), /unknown field/);
  fail(['conns'], cfg('[a]\nkind = "db2"\npassword_env = "X"\n'), /kind|variant/);
  fail(['conns'], cfg('[a]\nkind = "mysql"\nauth = "windows"\n'), /sqlserver だけ/);
  fail(['conns'], cfg('[a]\nkind = "oracle"\npassword_env = "X"\ntrust_cert = true\n'), /trust_cert は sqlserver・postgres・mysql だけ/);
  fail(['conns'], cfg('[a]\nkind = "sqlserver"\npassword_env = "X"\nca_cert = "ca.pem"\n'), /ca_cert は postgres・mysql だけ/);
  fail(['conns'], cfg('[a]\nkind = "mysql"\npassword_env = "X"\nca_cert = "ca.pem"\ntrust_cert = true\n'), /一緒に書かない/);
  fail(['conns'], cfg('[a]\nkind = "mysql"\npassword_env = "X"\nverify_host = false\n'), /verify_host は ca_cert と一緒/);
  fail(['conns'], cfg('[a]\nkind = "postgres"\npassword_env = "X"\ntls = false\ntrust_cert = true\n'), /tls = false のときは/);
  fail(['conns'], cfg('[a]\nkind = "oracle"\npassword_env = "X"\nconnect_string = "db01/ORCL"\ntls = true\n'), /tls を書かない/);
  // ca_cert のファイルが読めない・証明書が無いときは、DB につなぐ前に断る
  fs.writeFileSync(path.join(dir, 'empty.pem'), 'not a pem\n');
  for (const kind of ['postgres', 'mysql']) {
    fail(['query', 'a', 'select 1'], { ...cfg(`[a]\nkind = "${kind}"\nhost = "127.0.0.1"\nport = 1\nuser = "u"\npassword_env = "P"\nca_cert = "no-such.pem"\n`), P: 'p' }, /ca_cert .*no-such\.pem を読めません/);
  }
  fail(['query', 'a', 'select 1'], { ...cfg('[a]\nkind = "postgres"\nhost = "127.0.0.1"\nport = 1\nuser = "u"\npassword_env = "P"\nca_cert = "empty.pem"\n'), P: 'p' }, /証明書（-----BEGIN CERTIFICATE-----）がありません/);
  const good = cfg('[sales]\nkind = "oracle"\nhost = "db01"\ndatabase = "ORCL"\nuser = "u"\npassword_env = "DB_READ_TEST_NO_SUCH_VAR"\n');
  fail(['query', 'other', 'select 1'], good, /接続 other が.*あるのは sales/);
  fail(['query', 'sales', 'select 1 from dual'], good, /環境変数 DB_READ_TEST_NO_SUCH_VAR にパスワードがありません/);
  // conns はパスワードの環境変数を読まずに、名前と行き先だけを出す
  assert.equal(ok(['conns'], good).trim(), '{"kind":"oracle","name":"sales","target":"db01:1521/ORCL"}');
});

test('つながらない行き先は終了コード 1 で、行き先を名乗る', { skip: !exe }, () => {
  const f = path.join(tempDir(), 'db.toml');
  fs.writeFileSync(f, '[x]\nkind = "postgres"\nhost = "127.0.0.1"\nport = 1\nuser = "u"\npassword_env = "P"\n');
  const r = run(['query', 'x', 'select 1'], { DB_READ_CONFIG: f, P: 'p' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /postgres（127\.0\.0\.1:1）/);
  // 読めなかったときは、--out の書き先の前の中身を残し、一時ファイルも残さない
  const out = path.join(path.dirname(f), 'prev.csv');
  fs.writeFileSync(out, 'prev\n');
  assert.equal(run(['query', 'x', 'select 1', '--out', out], { DB_READ_CONFIG: f, P: 'p' }).status, 1);
  assert.equal(fs.readFileSync(out, 'utf8'), 'prev\n');
  assert.deepEqual(fs.readdirSync(path.dirname(f)).filter((n) => n.includes('db-read-tmp')), []);
});

// ---- 本物の DB（CI の db-read.yml） -------------------------------------------------------------------

const kinds = ['pg', 'my', 'ms', 'ora'];
const typeLine = (k) => {
  const up = (s) => (k === 'ora' ? s.toUpperCase() : s);
  const b = k === 'my' ? '1' : 'true';
  const dt = k === 'ora' ? '2026-10-30T00:00:00' : '2026-10-30';
  const ts = k === 'my' ? '2026-10-30T14:05:06.123000' : '2026-10-30T14:05:06.123';
  const row1 = `{"${up('id')}":1,"${up('i')}":9007199254740993,"${up('n')}":12345678901234567890.125,"${up('f')}":0.1,"${up('b')}":${b},"${up('dt')}":"${dt}","${up('ts')}":"${ts}","${up('s')}":"a,\\"b\\"\\n日本","${up('bin')}":"0x00FF"}`;
  const row2 = `{${['id', 'i', 'n', 'f', 'b', 'dt', 'ts', 's', 'bin'].map((c, i) => `"${up(c)}":${i === 0 ? 2 : 'null'}`).join(',')}}`;
  return `${row1}\n${row2}\n`;
};

for (const k of kinds) {
  const env = { DB_READ_CONFIG: it };
  test(`${k}：型ごとの値の出方（大きな整数・小数の桁・日時・改行と引用符・バイト列・NULL）`, { skip: !(exe && it) && 'DB_READ_IT_CONFIG が無い' }, () => {
    assert.equal(ok(['query', k, 'SELECT * FROM types ORDER BY id', '--format', 'jsonl'], env), typeLine(k));
    const csv = ok(['query', k, 'SELECT * FROM types ORDER BY id;'], env);
    assert.match(csv, /^id,i,n,f,b,dt,ts,s,bin\n1,9007199254740993,12345678901234567890\.125,0\.1,/i);
    assert.ok(csv.includes('"a,""b""\n日本",0x00FF\n'), csv);
  });

  test(`${k}：標準出力は既定で 200 行で止めて知らせ、--out には全部書く`, { skip: !(exe && it) && 'DB_READ_IT_CONFIG が無い' }, () => {
    const r = run(['query', k, 'SELECT id, grp FROM nums ORDER BY id'], env);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim().split('\n').length, 201);
    assert.match(r.stderr, /200 行で止めた/);
    const out = path.join(tempDir(), 'all.csv');
    const w = run(['query', k, 'SELECT id, grp FROM nums ORDER BY id', '--out', out, '--bom'], env);
    assert.equal(w.status, 0, w.stderr);
    assert.equal(w.stdout, '');
    assert.equal(w.stderr, '');
    const text = fs.readFileSync(out, 'utf8');
    assert.ok(text.startsWith('﻿'));
    assert.equal(text.trim().split('\n').length, 1001);
    const z = run(['query', k, 'SELECT id FROM nums WHERE id < 0'], env);
    assert.match(z.stderr, /0 行だった/);
  });

  test(`${k}：tables と columns`, { skip: !(exe && it) && 'DB_READ_IT_CONFIG が無い' }, () => {
    assert.match(ok(['tables', k], env), /,(types|TYPES),/);
    const cols = ok(['columns', k, 'types'], env).trim().split('\n');
    assert.equal(cols.length, 10, cols.join('\n'));
    assert.match(cols[1], /^(id|ID),/);
    const r = run(['columns', k, 'no_such_table'], env);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /見つかりません/);
  });

  test(`${k}：SQL の誤りは終了コード 1 で DB の言葉を出す`, { skip: !(exe && it) && 'DB_READ_IT_CONFIG が無い' }, () => {
    const r = run(['query', k, 'SELECT * FROM no_such_table'], env);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no_such_table|NO_SUCH_TABLE|42P01|1146|208|ORA-00942/i);
  });
}

test('pg・my・ora：guard を通った書き換えは、DB の側の読み取り専用で止まる', { skip: !(exe && it) && 'DB_READ_IT_CONFIG が無い' }, () => {
  const env = { DB_READ_CONFIG: it };
  const cases = [
    ['pg', 'WITH d AS (DELETE FROM types RETURNING 1) SELECT * FROM d', /read-only/],
    ['my', 'WITH x AS (SELECT 1) DELETE FROM types', /READ ONLY/],
    ['ora', 'SELECT * FROM types FOR UPDATE', /ORA-01456/],
  ];
  for (const [k, sql, pattern] of cases) {
    const r = run(['query', k, sql], env);
    assert.equal(r.status, 1, `${k}: ${sql}`);
    assert.match(r.stderr, pattern);
    assert.match(ok(['query', k, 'SELECT COUNT(*) AS n FROM types'], env), /^n\n2\n$/i);
  }
});

test('負の小数の桁と符号が4つの DB で崩れない', { skip: !(exe && it) && 'DB_READ_IT_CONFIG が無い' }, () => {
  const env = { DB_READ_CONFIG: it };
  for (const k of kinds) {
    const t = k === 'ora' ? 'number' : k === 'pg' ? 'numeric' : 'decimal';
    const sql = `SELECT CAST(-0.5 AS ${t}(10,3)) AS a, CAST(-1.25 AS ${t}(10,2)) AS b, CAST(-12345678901234567890.125 AS ${t}(30,3)) AS c${k === 'ora' ? ' FROM dual' : ''}`;
    // Oracle の NUMBER は末尾の 0 を持たない
    const a = k === 'ora' ? '-0.5' : '-0.500';
    assert.equal(ok(['query', k, sql], env).split('\n')[1], `${a},-1.25,-12345678901234567890.125`, k);
  }
});

test('ms：; の無い2つ目の文（COMMIT・DELETE・INTO）は、DB につなぐ前に断る', { skip: !(exe && it) && 'DB_READ_IT_CONFIG が無い' }, () => {
  const env = { DB_READ_CONFIG: it };
  for (const sql of ['WITH x AS (SELECT 1 AS a) DELETE FROM types', 'SELECT 1 AS a COMMIT DELETE FROM types', 'SELECT * INTO types_copy FROM types']) {
    const r = run(['query', 'ms', sql], env);
    assert.equal(r.status, 1, sql);
    assert.match(r.stderr, /を含む文は走らせません/, sql);
  }
  assert.equal(ok(['query', 'ms', "SELECT COUNT(*) AS n, OBJECT_ID('types_copy') AS copy, 'commit' AS [delete] FROM types"], env), 'n,copy,delete\n2,,commit\n');
});

test('結果の表が2つ以上ある文は、終了コード 1 で断る', { skip: !(exe && it) && 'DB_READ_IT_CONFIG が無い' }, () => {
  const env = { DB_READ_CONFIG: it };
  for (const format of ['csv', 'jsonl']) {
    const r = run(['query', 'ms', 'SELECT 1 AS a SELECT 1 AS a, 2 AS b', '--format', format], env);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr, /結果の表が2つ以上ある/);
  }
});

test('my：文字列の \\\' や # のコメントで ; を隠した2つ目の文は走らせない', { skip: !(exe && it) && 'DB_READ_IT_CONFIG が無い' }, () => {
  const env = { DB_READ_CONFIG: it };
  const tricks = [
    "SELECT 'a\\' , '; SET SESSION TRANSACTION READ WRITE; DELETE FROM types; SELECT '1'",
    "SELECT 1 # '\n; SET SESSION TRANSACTION READ WRITE; DELETE FROM types; SELECT '1'",
  ];
  for (const sql of tricks) {
    const r = run(['query', 'my', sql], env);
    assert.equal(r.status, 1, `${sql}\n${r.stdout}`);
  }
  assert.equal(ok(['query', 'my', 'SELECT COUNT(*) AS n FROM types'], env), 'n\n2\n');
});

// ---- 自分の CA を使う DB（fixtures/tls/start.sh。サーバーの証明書は localhost の名前だけで IP を持たない） ----------

const tlsCases = [
  // [接続名の後ろ, つながるか, 落ちるときの言葉]
  ['ca', true],
  ['ca_ip', false, /not valid for name "127\.0\.0\.1"/],
  ['ca_ip_chain', true],
  ['other_ca', false, /UnknownIssuer/],
  ['os', false, /UnknownIssuer/],
  ['trust', true],
];
for (const [db, sql] of [
  ['my', "SELECT VARIABLE_VALUE AS cipher FROM performance_schema.session_status WHERE VARIABLE_NAME = 'Ssl_cipher'"],
  ['pg', 'SELECT ssl AS cipher FROM pg_stat_ssl WHERE pid = pg_backend_pid()'],
]) {
  test(`${db}：ca_cert・verify_host・trust_cert で、自分の CA の DB に暗号化してつなぐ／確かめで落とす`, { skip: !(exe && itTls) && 'DB_READ_IT_TLS_CONFIG が無い' }, () => {
    const env = { DB_READ_CONFIG: itTls };
    for (const [name, good, pattern] of tlsCases) {
      const r = run(['query', `${db}_${name}`, sql], env);
      if (good) {
        assert.equal(r.status, 0, `${db}_${name}: ${r.stderr}`);
        // 暗号化している（MySQL は暗号の名前、PostgreSQL は true）
        assert.match(r.stdout, /^cipher\n(TLS_\w+|true)\n$/, `${db}_${name}`);
      } else {
        assert.equal(r.status, 1, `${db}_${name}: ${r.stdout}`);
        assert.match(r.stderr, pattern, `${db}_${name}`);
      }
    }
  });
}
