// skills/excel-read/scripts の exe の試験。exe がソース（tools/excel-read）から作り直してあるかを指紋で確かめ、
// この機械の exe でダミーの帳票（tools/excel-read/fixtures）を読む。
//   node --test test/excel-read.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = path.join(root, 'tools/excel-read');
const bin = path.join(root, 'skills/excel-read/scripts');
const fixtures = path.join(src, 'fixtures');
const builds = { 'windows-x64': 'excel-read.exe', 'mac-arm64': 'excel-read', 'linux-x64': 'excel-read' };
const here = { 'win32-x64': 'windows-x64', 'darwin-arm64': 'mac-arm64', 'linux-x64': 'linux-x64' }[`${process.platform}-${process.arch}`];
const exe = here && path.join(bin, here, builds[here]);

const temps = [];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });

// tools/excel-read/build.rs と同じ計算（FNV-1a 64。改行は LF にそろえる）
function sourceHash() {
  const files = ['Cargo.toml', 'Cargo.lock', 'build.rs', ...fs.readdirSync(path.join(src, 'src')).sort().map((f) => `src/${f}`)];
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

const run = (...args) => {
  const r = spawnSync(exe, args, { encoding: 'utf8' });
  if (r.error) throw r.error;
  return r;
};
const ok = (...args) => {
  const r = run(...args);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
};
const lines = (text) => text.trim().split('\n').map((l) => JSON.parse(l));
const report = path.join(fixtures, 'report.xlsx');

test('3つの exe がどれも今のソースから作ってある（直したら tools/excel-read/build-all.sh）', () => {
  const hash = sourceHash();
  for (const [dir, name] of Object.entries(builds)) {
    const file = path.join(bin, dir, name);
    assert.ok(fs.existsSync(file), `${file} が無い`);
    assert.ok(fs.readFileSync(file).includes(Buffer.from(hash)), `${dir} の exe がソースと食い違う（指紋 ${hash} を含まない）`);
  }
});

test('第三者の表示が今の Cargo.lock と、exe を作った Rust の版から作ってある（直したら tools/excel-read/make-notices.py）', () => {
  const notices = fs.readFileSync(path.join(root, 'skills/excel-read/THIRD_PARTY_NOTICES.md'), 'utf8');
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
  assert.equal(ok('--version').trim(), `excel-read 0.1.0 src:${sourceHash()}`);
});

test('sheets：シートと使っている範囲と結合セルの数', { skip: !exe }, () => {
  assert.deepEqual(lines(ok('sheets', report)), [
    { sheet: '月次報告', state: 'visible', used: 'A1:F16', merges: 7, tables: [], hidden_rows: 0, hidden_cols: 0, filter: null },
    { sheet: '一覧', state: 'visible', used: 'A1:F3', merges: 0, tables: [], hidden_rows: 0, hidden_cols: 0, filter: null },
  ]);
});

test('dump：値・式（共有の式も）・結合の範囲を番地付きで出す', { skip: !exe }, () => {
  const [head, ...cells] = lines(ok('dump', report, '--range', 'A4:E7'));
  assert.deepEqual(head, { sheet: '月次報告', used: 'A1:F16', range: 'A4:E7', merges: ['A4:A5', 'B4:B5', 'C4:E4', 'A6:A8'], hidden_rows: [], hidden_cols: [], filter: null });
  const at = Object.fromEntries(cells.map((c) => [c.a, c]));
  assert.deepEqual(at.C4, { a: 'C4', v: '売上', m: 'C4:E4' });
  assert.equal(at.D4, undefined, '結合で覆われたセルは出さない');
  assert.deepEqual(at.E6, { a: 'E6', v: 20, f: 'D6-C6' });
  assert.deepEqual(at.E7, { a: 'E7', v: -20, f: 'D7-C7' }, '共有の式を広げて読む');
});

test('行とセルが逆の順に並んだシートも、順に並んだシートと同じに読む', { skip: !exe }, () => {
  // .xlsx は行ごとに読みながら出すが、順に並んでいなければ丸ごと読む道に切り替わる
  const unordered = path.join(fixtures, 'unordered.xlsx');
  const same = (...args) => assert.equal(ok(...args, unordered), ok(...args, report), args.join(' '));
  same('sheets');
  same('dump', '--sheet', '一覧');
  same('dump', '--format', 'grid');
  same('table', '--config', path.join(fixtures, 'report.table.json'));
  same('table', '--sheet', '一覧', '--format', 'json');
  // 隠した行と列・フィルター・表示形式も、逆順で同じに読む
  const tables = path.join(fixtures, 'tables.xlsx');
  const unorderedTables = path.join(fixtures, 'unordered-tables.xlsx');
  for (const args of [['sheets'], ['dump', '--sheet', '見え方'], ['table', '--sheet', '見え方', '--visible-only']]) {
    const [u, o] = [run(...args, unorderedTables), run(...args, tables)];
    assert.deepEqual([u.status, u.stdout, u.stderr], [o.status, o.stdout, o.stderr], args.join(' '));
  }
});

test('dump --format grid：結合で覆われたセルは ^左上', { skip: !exe }, () => {
  const out = ok('dump', report, '--format', 'grid', '--range', 'A4:F6').split('\n');
  assert.equal(out[1], '\tA\tB\tC\tD\tE\tF');
  assert.equal(out[2], '4\t部門\t担当\t売上\t^C4\t^C4\t備考');
  assert.equal(out[3], '5\t^A4\t^B4\t計画\t実績\t差額\t^F4');
  assert.equal(out[4], '6\t営業1部\t佐藤\t100\t120\t20\t');
});

test('dump：--max-rows で止め、続きの範囲を出す', { skip: !exe }, () => {
  const out = lines(ok('dump', report, '--max-rows', '2'));
  assert.deepEqual(out.at(-1), { truncated: true, next: 'A3:F16', hint: '続きは --range で指定するか --max-rows を増やす' });
});

test('table：設定ファイルで見出し2行をまとめ、結合を埋め、小計の行を捨てる', { skip: !exe }, () => {
  const out = ok('table', report, '--config', path.join(fixtures, 'report.table.json'));
  assert.equal(out, [
    '部門,担当,売上/計画,売上/実績,売上/差額,備考',
    '営業1部,佐藤,100,120,20,',
    '営業1部,鈴木,200,180,-20,大口の失注',
    '営業1部,高橋,150,150,0,',
    '営業2部,田中,300,330,30,',
    '営業2部,伊藤,250,260,10,',
    '',
  ].join('\n'));
});

test('sheets：.xls はテーブルを持たないので tables は null', { skip: !exe }, () => {
  assert.deepEqual(lines(ok('sheets', path.join(fixtures, 'report.xls')))[0], { sheet: '月次報告', state: 'visible', used: 'A1:F16', merges: 7, tables: null, hidden_rows: null, hidden_cols: null, filter: null });
});

test('table：.xls も同じ設定で読める', { skip: !exe }, () => {
  const out = ok('table', path.join(fixtures, 'report.xls'), '--config', path.join(fixtures, 'report.table.json'));
  assert.equal(out.split('\n')[2], '営業1部,鈴木,200,180,-20,大口の失注');
});

test('table：日付・時刻・真偽・誤り、CSV の引用、JSON の型', { skip: !exe }, () => {
  const csv = ok('table', report, '--sheet', '一覧');
  assert.equal(csv.split('\n').slice(0, 2).join('\n'), '日付,時刻,件名,金額,確定,比率\n2026-10-01,09:30:00,"見積, ""A社""",1234.5,true,#DIV/0!');
  const rows = JSON.parse(ok('table', report, '--sheet', '一覧', '--format', 'json'));
  assert.deepEqual(rows[1], { 日付: '2026-10-02T14:05:00', 時刻: null, 件名: '改行\nあり', 金額: 0.1, 確定: false, 比率: rows[1].比率 });
  assert.ok(Math.abs(rows[1].比率 - 0.1 / 1234.5) < 1e-12);
});

test('--out：UTF-8 のファイルに書き、標準出力には出さない', { skip: !exe }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'excel-read-')); temps.push(dir);
  const file = path.join(dir, '出力.csv');
  assert.equal(ok('table', report, '--config', path.join(fixtures, 'report.table.json'), '--out', file), '');
  assert.equal(fs.readFileSync(file, 'utf8').split('\n')[0], '部門,担当,売上/計画,売上/実績,売上/差額,備考');
  // 読むファイルと同じパスは、書く前に止めて中身を残す
  const copy = path.join(dir, 'report.xlsx');
  fs.copyFileSync(report, copy);
  const same = run('table', copy, '--out', copy);
  assert.equal(same.status, 2); assert.match(same.stderr, /同じファイルは指定できません/);
  assert.deepEqual(fs.readFileSync(copy), fs.readFileSync(report));
});

test('誤り：読めないものは 1、使い方の誤りは 2、どちらも理由を出す', { skip: !exe }, () => {
  const missing = run('dump', path.join(fixtures, 'nothing.xlsx'));
  assert.equal(missing.status, 1); assert.match(missing.stderr, /開けません/);
  const sheet = run('dump', report, '--sheet', '無い');
  assert.equal(sheet.status, 1); assert.match(sheet.stderr, /ある：月次報告、一覧/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'excel-read-')); temps.push(dir);
  const cfg = path.join(dir, 'bad.json'); fs.writeFileSync(cfg, '{"heder_rows": 2}');
  const key = run('table', report, '--config', cfg);
  assert.equal(key.status, 1); assert.match(key.stderr, /知らないキー heder_rows/);
  const both = path.join(dir, 'both.json'); fs.writeFileSync(both, JSON.stringify({ drop_rows: { column: 'A', equals: 'x', contains: 'y' } }));
  const two = run('table', report, '--config', both);
  assert.equal(two.status, 1); assert.match(two.stderr, /どれか1つだけ/);
  const range = run('dump', report, '--range', 'Z9:A1');
  assert.equal(range.status, 2); assert.match(range.stderr, /範囲 Z9:A1 を読めません/);
  assert.equal(run('foo', report).status, 2);
});

test('table：stop_when の行の手前で終える', { skip: !exe }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'excel-read-')); temps.push(dir);
  const cfg = path.join(dir, 'stop.json');
  fs.writeFileSync(cfg, JSON.stringify({ sheet: '月次報告', range: 'A4:F', header_rows: 2, drop_rows: [{ column: 'B', equals: '小計' }], stop_when: { column: 'A', starts_with: '合計' } }));
  const out = ok('table', report, '--config', cfg).trim().split('\n');
  assert.equal(out.length, 6);
  assert.equal(out.at(-1), '営業2部,伊藤,250,260,10,');
});

test('table：重複した見出しの番号は、ほかの見出しとぶつからない', { skip: !exe }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'excel-read-')); temps.push(dir);
  const cfg = path.join(dir, 'dup.json');
  fs.writeFileSync(cfg, JSON.stringify({ sheet: '月次報告', range: 'A6:F8', header_rows: 0, columns: ['金額', '金額', '金額_2', 'x', 'y', 'z'] }));
  const rows = lines(ok('table', report, '--config', cfg, '--format', 'jsonl'));
  assert.deepEqual(Object.keys(rows[0]), ['金額', '金額_3', '金額_2', 'x', 'y', 'z']);
});

test('範囲と見出しの行数：Excel の端を超える番地は使い方の誤り、見出しは範囲の外を読まない', { skip: !exe }, () => {
  assert.equal(run('dump', report, '--range', 'AAAAAAAA1:B2').status, 2);
  assert.equal(run('dump', report, '--range', 'XFE1').status, 2);
  assert.equal(run('dump', report, '--range', 'A1048577').status, 2);
  assert.equal(ok('table', report, '--range', 'A1:B3', '--header-rows', '4000'), '2026年10月 部門別売上報告/作成日,2026年10月 部門別売上報告/2026-10-30\n');
});

test('Excel のテーブル：sheets が名前とデータの範囲を出し、table --table が名前で読む', { skip: !exe }, () => {
  const book = path.join(fixtures, 'tables.xlsx');
  assert.deepEqual(lines(ok('sheets', book))[1], { sheet: '台帳', state: 'visible', used: 'B1:J6', merges: 0, tables: [{ name: '売上表', data: 'B4:D6' }, { name: '在庫表', data: 'F4:G5' }, { name: '集計表', data: 'I4:J5' }], hidden_rows: 0, hidden_cols: 0, filter: null });
  assert.equal(ok('table', book, '--table', '売上表'), '品目,数量,単価\nりんご,3,120\nみかん,5,80\nぶどう,1,450\n');
  assert.deepEqual(lines(ok('table', book, '--table', '在庫表', '--format', 'jsonl')), [{ 倉庫: '東', 在庫: 10 }, { 倉庫: '西', 在庫: 4 }]);
  assert.equal(ok('table', book, '--table', '集計表'), '月,件数\n9月,2\n10月,3\n', '集計の行はデータに入れない');
  const missing = run('table', book, '--table', '無い');
  assert.equal(missing.status, 1); assert.match(missing.stderr, /ある：売上表、在庫表、集計表/);
  assert.equal(run('table', book, '--table', '売上表', '--sheet', '台帳').status, 2);
  assert.equal(run('table', path.join(fixtures, 'report.xls'), '--table', '売上表').status, 1);
});

test('隠したシート：sheets が state で示し、--sheet を省くと表示されている最初のシートを読む', { skip: !exe }, () => {
  const book = path.join(fixtures, 'tables.xlsx');
  assert.deepEqual(lines(ok('sheets', book))[0], { sheet: '設定', state: 'hidden', used: 'A1:A1', merges: 0, tables: [], hidden_rows: 0, hidden_cols: 0, filter: null });
  assert.equal(lines(ok('dump', book))[0].sheet, '台帳');
});

test('table --fill-merged：見出しはいつも埋め、データは all・text・none の通り。数を埋めたら知らせる', { skip: !exe }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'excel-read-')); temps.push(dir);
  const cfg = path.join(dir, 'fill.json');
  fs.writeFileSync(cfg, JSON.stringify({ sheet: '月次報告', range: 'A4:F8', header_rows: 2 }));
  const none = ok('table', report, '--config', cfg, '--fill-merged', 'none').split('\n');
  assert.equal(none[0], '部門,担当,売上/計画,売上/実績,売上/差額,備考', '見出しは none でも埋める');
  assert.equal(none[2], ',鈴木,200,180,-20,大口の失注');
  assert.equal(ok('table', report, '--config', cfg, '--fill-merged', 'text').split('\n')[2], '営業1部,鈴木,200,180,-20,大口の失注');
  assert.equal(run('table', report, '--config', cfg, '--fill-merged', 'some').status, 2);
});

test('table：数の入った結合を埋めたら標準エラーで知らせ、text では数を埋めない', { skip: !exe }, () => {
  const book = path.join(fixtures, 'tables.xlsx');
  const all = run('table', book, '--sheet', '結合');
  assert.equal(all.status, 0, all.stderr);
  assert.equal(all.stdout, '品目,金額\n送料,300\n梱包,300\n');
  assert.match(all.stderr, /数の入った結合セル 1 か所を埋めた（例 B2:B3）/);
  const text = run('table', book, '--sheet', '結合', '--fill-merged', 'text');
  assert.equal(text.stdout, '品目,金額\n送料,300\n梱包,\n'); assert.equal(text.stderr, '');
  assert.doesNotMatch(run('table', report, '--config', path.join(fixtures, 'report.table.json')).stderr, /数の入った結合/, '文字の結合では知らせない');
});

test('table：条件は空白（全角も）を除いて比べる。範囲の $ は無視する', { skip: !exe }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'excel-read-')); temps.push(dir);
  const cfg = path.join(dir, 'space.json');
  fs.writeFileSync(cfg, JSON.stringify({ sheet: '月次報告', range: '$A$4:$F$12', header_rows: 2, drop_rows: { column: 'B', equals: '小　計' } }));
  assert.equal(ok('table', report, '--config', cfg).trim().split('\n').length, 6);
});

test('table --bom：CSV の先頭に BOM を付ける（Excel で開く CSV 向け）', { skip: !exe }, () => {
  assert.ok(ok('table', report, '--sheet', '一覧', '--bom').startsWith('\ufeff日付,'));
  assert.equal(run('table', report, '--sheet', '一覧', '--bom', '--format', 'json').status, 2);
});

test('queries：Power Query の M のコードを出す。無ければ空で、理由を標準エラーに出す', { skip: !exe }, () => {
  const out = ok('queries', path.join(fixtures, 'queries.xlsx'));
  assert.match(out, /^section Section1;\n/);
  assert.match(out, /shared 売上 = let\n    ソース = Excel\.CurrentWorkbook\(\)\{\[Name="売上表"\]\}\[Content\],/);
  const none = run('queries', report);
  assert.equal(none.status, 0); assert.equal(none.stdout, ''); assert.match(none.stderr, /Power Query はありません/);
  assert.equal(run('queries', path.join(fixtures, 'report.xls')).status, 1);
});

test('vba：モジュールごとに名前とコードを出す（Excel で保存したブック）', { skip: !exe }, () => {
  const out = ok('vba', path.join(fixtures, 'vba.xlsm'));
  const names = [...out.matchAll(/^' ===== (.+) =====$/gm)].map((m) => m[1]);
  assert.deepEqual(names, ['Sheet1', 'Sheet2', 'Sheet3', 'ThisWorkbook', 'testVBA']);
  assert.match(out, /' ===== testVBA =====\nAttribute VB_Name = "testVBA"\nPublic Sub test\(\)\n    MsgBox "Hello from vba!"\nEnd Sub\n/);
  assert.match(out, /' ===== ThisWorkbook =====\nAttribute VB_Name = "ThisWorkbook"\nAttribute VB_Base = /, 'ブックとシートのモジュールのコードも出す');
});

test('vba：VBA の無いブックは空で、理由を標準エラーに出す', { skip: !exe }, () => {
  const none = run('vba', report);
  assert.equal(none.status, 0); assert.equal(none.stdout, ''); assert.match(none.stderr, /VBA はありません/);
});

test('見え方：隠した行と列・フィルター・表示形式を出し、table は隠した行を知らせ、--visible-only で捨てる', { skip: !exe }, () => {
  const book = path.join(fixtures, 'tables.xlsx');
  assert.deepEqual(lines(ok('sheets', book)).find((l) => l.sheet === '見え方'), { sheet: '見え方', state: 'visible', used: 'A1:E4', merges: 0, tables: [], hidden_rows: 1, hidden_cols: 1, filter: 'A1:E4' });
  const [head, ...cells] = lines(ok('dump', book, '--sheet', '見え方', '--range', 'A1:E3'));
  assert.deepEqual([head.hidden_rows, head.hidden_cols, head.filter], [[3], ['E'], 'A1:E4']);
  const at = Object.fromEntries(cells.map((c) => [c.a, c]));
  assert.deepEqual(at.B2, { a: 'B2', v: 12000, nf: '#,##0,"千円"' });
  assert.deepEqual(at.C2, { a: 'C2', v: 0.25, nf: '0%' });
  assert.deepEqual(at.A2, { a: 'A2', v: 'A' }, '標準の表示形式は nf を付けない');
  const all = run('table', book, '--sheet', '見え方');
  assert.equal(all.stdout.trim().split('\n').length, 4);
  assert.match(all.stderr, /隠した行 1 行も出した/);
  assert.match(all.stderr, /隠した列 E も出した/);
  assert.match(all.stderr, /表示形式のある列：金額（#,##0,"千円"）、比率（0%）、重さ（0.000"g"）/);
  const vis = run('table', book, '--sheet', '見え方', '--visible-only');
  assert.equal(vis.stdout, '品目,金額,比率,重さ,メモ\nA,12000,0.25,1.5,x\nC,500,0.25,0.25,z\n');
  assert.doesNotMatch(vis.stderr, /隠した行/);
});

test('dump：外部リンクの番号と参照先のブックを links に出す', { skip: !exe }, () => {
  const [head] = lines(ok('dump', path.join(fixtures, 'queries.xlsx'), '--range', 'A1:A1'));
  assert.deepEqual(head.links, { '[1]': 'file:///C:/共有/前年の台帳.xlsx' });
  assert.equal(lines(ok('dump', report, '--range', 'A1:A1'))[0].links, undefined);
});

test('table：0 行の結果、範囲の外の列を指す条件、見出しの数のセルを知らせる', { skip: !exe }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'excel-read-')); temps.push(dir);
  const zero = run('table', report, '--range', 'A4:F5', '--header-rows', '2');
  assert.equal(zero.status, 0); assert.match(zero.stderr, /データの行が 0 行/);
  // JSON は1件ずつ書くので、0 行と、最初のデータの行で止めたときも閉じた配列になる
  assert.equal(ok('table', report, '--range', 'A4:F5', '--header-rows', '2', '--format', 'json'), '[]\n');
  const first = path.join(dir, 'first.json'); fs.writeFileSync(first, JSON.stringify({ sheet: '月次報告', range: 'A4:F', header_rows: 2, stop_when: { column: 'B', equals: '佐藤' } }));
  assert.equal(ok('table', report, '--config', first, '--format', 'json'), '[]\n');
  const cfg = path.join(dir, 'zz.json'); fs.writeFileSync(cfg, JSON.stringify({ sheet: '月次報告', range: 'A4:F', header_rows: 2, stop_when: { column: 'ZZ', empty: true } }));
  const out = run('table', report, '--config', cfg);
  assert.equal(out.status, 1); assert.match(out.stderr, /列 ZZ は範囲（A〜F 列）の外/);
  const num = run('table', report, '--range', 'A5:F8', '--header-rows', '2');
  assert.match(num.stderr, /見出しの行に数のセルが 3 か所/);
});
