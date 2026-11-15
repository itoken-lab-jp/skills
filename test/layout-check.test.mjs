// skills/figure-making/scripts/layout-check.mjs の試験。崩れを拾うかと、崩れの無い図で何も拾わないか。
//   node --test test/layout-check.test.mjs
// Chrome・Edge・Chromium のどれかが要る。無い PC では飛ばす（CI では飛ばさずに落とす）。
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const script = path.join(root, 'skills/figure-making/scripts/layout-check.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-check-test-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const run = (name, body, args = []) => {
  const f = path.join(tmp, name);
  fs.writeFileSync(f, body);
  // CI の Linux は、ブラウザのサンドボックスを使えないことがある
  const env = { ...process.env, ...(process.env.CI && process.platform === 'linux' ? { LAYOUT_CHECK_NO_SANDBOX: '1' } : {}) };
  const r = spawnSync(process.execPath, [script, f, '--json', ...args], { encoding: 'utf8', timeout: 120000, env });
  let report = null;
  try { report = JSON.parse(r.stdout); } catch { /* 走らなかったとき */ }
  return { status: r.status, report, stderr: r.stderr, kinds: report && report.issues ? report.issues.map((i) => i.kind) : [] };
};
const svg = (inner, w = 600, h = 300) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="sans-serif">${inner}</svg>`;

// ブラウザがあるかを、崩れの無い図を1枚描いて確かめる
const probe = run('probe.svg', svg('<rect x="20" y="20" width="200" height="60" fill="#eef" stroke="#33a"/><text x="120" y="56" font-size="16" text-anchor="middle">OK</text>'));
const noBrowser = probe.status === 2 && /見つからない/.test(probe.stderr);
if (noBrowser && process.env.CI) throw new Error('CI にブラウザが無い: ' + probe.stderr);
const opt = { skip: noBrowser ? 'Chrome・Edge・Chromium が無い' : false };

describe('layout-check', () => {
  it('崩れの無い図では指摘が無く、PNG を作り、終了コードは 0', opt, () => {
    assert.equal(probe.status, 0, probe.stderr);
    assert.deepEqual(probe.report.issues, []);
    assert.equal(probe.report.width, 600);
    assert.equal(probe.report.height, 300);
    const png = fs.readFileSync(probe.report.png);
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), 600);
    assert.equal(png.readUInt32BE(20), 300);
    assert.deepEqual(fs.readdirSync(tmp).filter((f) => f.startsWith('.layout-check-')), [], '描くための一時ファイルを残さない');
  });

  it('箱からはみ出す文字を拾い、終了コードは 1', opt, () => {
    const r = run('overflow.svg', svg('<rect x="20" y="20" width="120" height="50" fill="#eef" stroke="#33a"/><text x="30" y="50" font-size="16">ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789</text>'));
    assert.equal(r.status, 1);
    assert.ok(r.kinds.includes('overflow'), JSON.stringify(r.report.issues));
  });

  it('文字どうしの重なりを拾う', opt, () => {
    const r = run('overlap.svg', svg('<text x="30" y="50" font-size="16">ABCDEFGH</text><text x="60" y="54" font-size="16">IJKLMNOP</text>'));
    assert.ok(r.kinds.includes('overlap'), JSON.stringify(r.report.issues));
  });

  it('文字を通る線を拾い、線の横に置いたラベルは拾わない', opt, () => {
    const bad = run('line-bad.svg', svg('<line x1="0" y1="100" x2="600" y2="100" stroke="#000"/><text x="200" y="105" font-size="14">LABEL</text>'));
    assert.ok(bad.kinds.includes('line'), JSON.stringify(bad.report.issues));
    const good = run('line-good.svg', svg('<line x1="0" y1="100" x2="600" y2="100" stroke="#000"/><text x="200" y="90" font-size="14">LABEL</text>'));
    assert.deepEqual(good.report.issues, []);
  });

  it('図の外に出た文字と、小さい文字を拾う', opt, () => {
    const r = run('outside.svg', svg('<text x="560" y="50" font-size="16">ABCDEFGHIJ</text><text x="30" y="200" font-size="9">small</text>'));
    assert.ok(r.kinds.includes('outside'), JSON.stringify(r.report.issues));
    assert.ok(r.kinds.includes('small'), JSON.stringify(r.report.issues));
  });

  it('data-layout-ignore を付けた所の重なりは拾わない', opt, () => {
    const r = run('ignore.svg', svg('<g data-layout-ignore><text x="30" y="50" font-size="16">ABCDEFGH</text><text x="60" y="54" font-size="16">IJKLMNOP</text></g>'));
    assert.deepEqual(r.report.issues, []);
  });

  it('HTML のスライドで、枠に切られた文字を拾う', opt, () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('<br>');
    const r = run('slide.html', `<!doctype html><html lang="ja"><body style="margin:0"><div style="width:1280px;height:720px;overflow:hidden;background:#fff"><p style="font-size:40px;margin:0">${lines}</p></div></body></html>`);
    assert.equal(r.status, 1);
    assert.ok(r.kinds.includes('overflow'), JSON.stringify(r.report.issues));
  });

  it('スライドを PDF にして、ページ数と用紙を出す', opt, () => {
    const slide = (t) => `<section style="width:1280px;height:720px;break-after:page;overflow:hidden"><h1 style="font-size:48px;margin:0;padding:40px">${t}</h1></section>`;
    const html = `<!doctype html><html lang="ja"><head><style>@page{size:1280px 720px;margin:0}body{margin:0}</style></head><body>${slide('one')}${slide('two')}${slide('three')}</body></html>`;
    const r = run('deck.html', html, ['--pdf', path.join(tmp, 'deck.pdf')]);
    assert.equal(r.status, 0, JSON.stringify(r.report?.issues) + r.stderr);
    assert.equal(r.report.pdf.pages, 3);
    assert.deepEqual(r.report.pdf.pageSizePt, [960, 540]);
  });

  // Mermaid は mermaid.js を CDN から読む。ネットワークが無い PC では飛ばす（CI では飛ばさずに落とす）
  const mm = run('ok.mmd', 'flowchart TD\n  a1["決済する (Stripe: PaymentIntent)"] -->|"失敗 (3回まで)"| a2["#quot;在庫なし#quot; を返す"]\n');
  const noLib = mm.status === 2 && /mermaid\.js を読めなかった/.test(mm.stderr);
  if (noLib && process.env.CI) throw new Error('CI で mermaid.js を読めない: ' + mm.stderr);
  const mopt = { skip: noBrowser ? opt.skip : noLib ? 'mermaid.js を読めない（ネットワークが無い）' : false };

  it('Mermaid：記号を逃がした図は描けて、線の上のラベルを重なりに数えない', mopt, () => {
    assert.equal(mm.status, 0, JSON.stringify(mm.report?.issues) + mm.stderr);
    assert.equal(fs.readFileSync(mm.report.png).subarray(1, 4).toString(), 'PNG');
  });

  it('Mermaid：Markdown の中のブロックを1つずつ描き、構文エラーを拾う', mopt, () => {
    const md = '# x\n\n```mermaid\nsequenceDiagram\n  A->>B: Cookie（HttpOnly; Secure）\n```\n\n```mermaid\nsequenceDiagram\n  A->>B: Cookie（HttpOnly#59; Secure）\n```\n';
    const r = run('doc.md', md);
    assert.equal(r.status, 1);
    assert.equal(r.report.length, 2);
    assert.deepEqual(r.report[0].issues.map((i) => i.kind), ['syntax']);
    assert.deepEqual(r.report[1].issues, []);
    assert.deepEqual(fs.readdirSync(tmp).filter((f) => f.endsWith('.png') && f.startsWith('doc')), [], '文書の横に画像を残さない');
  });

  it('ファイルが無いときは終了コード 2', () => {
    const r = spawnSync(process.execPath, [script, path.join(tmp, 'none.svg')], { encoding: 'utf8' });
    assert.equal(r.status, 2);
  });
});
