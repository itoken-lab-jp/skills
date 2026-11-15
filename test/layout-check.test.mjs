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

  // .pptx：ブラウザも LibreOffice も要らない所（中身からの見積もり）だけを試す。圧縮しない zip を手で組む
  const zip = (files) => {
    const locals = [], central = [];
    let off = 0;
    for (const [name, text] of Object.entries(files)) {
      const n = Buffer.from(name), d = Buffer.from(text);
      const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt32LE(d.length, 18); h.writeUInt32LE(d.length, 22); h.writeUInt16LE(n.length, 26);
      const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt32LE(d.length, 20); c.writeUInt32LE(d.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
      locals.push(h, n, d); central.push(c, n); off += 30 + n.length + d.length;
    }
    const cd = Buffer.concat(central), e = Buffer.alloc(22);
    e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(central.length / 2, 8); e.writeUInt16LE(central.length / 2, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
    return Buffer.concat([...locals, cd, e]);
  };
  const PT = 12700;
  // 手で組んだ最小の zip は PowerPoint でも LibreOffice でも描けない。入っている PC で、試験のたびに起こさない
  const noPpt = { ...process.env, LAYOUT_CHECK_NO_RENDER: '1' };
  const box = (x, y, w, h, text, sz, font = '<a:latin typeface="Meiryo"/><a:ea typeface="Meiryo"/>') => `<p:sp><p:nvSpPr><p:cNvPr id="2" name="t"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x * PT}" y="${y * PT}"/><a:ext cx="${w * PT}" cy="${h * PT}"/></a:xfrm></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:p><a:r><a:rPr lang="ja-JP" sz="${sz * 100}">${font}</a:rPr><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
  const table = (y, rows, cellText) => `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="3" name="tbl"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${40 * PT}" y="${y * PT}"/><a:ext cx="${400 * PT}" cy="${rows * 30 * PT}"/></p:xfrm><a:graphic><a:graphicData><a:tbl><a:tblGrid><a:gridCol w="${200 * PT}"/><a:gridCol w="${200 * PT}"/></a:tblGrid>${Array.from({ length: rows }, () => `<a:tr h="${30 * PT}"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="1600"><a:ea typeface="Meiryo"/></a:rPr><a:t>${cellText}</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:bodyPr/><a:p><a:endParaRPr/></a:p></a:txBody></a:tc></a:tr>`).join('')}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
  const pptx = (name, ...slides) => {
    const files = {
      'ppt/presentation.xml': `<p:presentation><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${960 * PT}" cy="${540 * PT}"/></p:presentation>`,
      'ppt/_rels/presentation.xml.rels': `<Relationships>${slides.map((_, i) => `<Relationship Id="rId${i + 1}" Type="slide" Target="slides/slide${i + 1}.xml"/>`).join('')}</Relationships>`,
    };
    slides.forEach((body, i) => { files[`ppt/slides/slide${i + 1}.xml`] = `<p:sld><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/>${body}</p:spTree></p:cSld></p:sld>`; });
    const f = path.join(tmp, name);
    fs.writeFileSync(f, zip(files));
    const r = spawnSync(process.execPath, [script, f, '--json'], { encoding: 'utf8', timeout: 300000, env: noPpt });
    let report = null;
    try { report = JSON.parse(r.stdout); } catch { /* 走らなかったとき */ }
    return { status: r.status, report, stderr: r.stderr, issues: report ? report.issues : [] };
  };

  it('.pptx：崩れの無いスライドでは指摘が無く、枚数と大きさを出す', () => {
    const r = pptx('ok.pptx', box(40, 40, 600, 60, '売上は達成、ただし A 社を除くと前年割れ', 28), box(40, 140, 600, 40, '解約は3社、理由は返事の遅さ', 18) + table(220, 3, '短い'));
    assert.equal(r.status, 0, JSON.stringify(r.issues) + r.stderr);
    assert.equal(r.report.slides, 2);
    assert.deepEqual(r.report.slideSizeIn, [13.33, 7.5]);
    assert.deepEqual(r.report.fonts[0].fontsPt, [28]);
    // 人が読む出力（--json なし）も通る
    const t = spawnSync(process.execPath, [script, path.join(tmp, 'ok.pptx')], { encoding: 'utf8', timeout: 300000, env: noPpt });
    assert.equal(t.status, 0, t.stderr);
    assert.match(t.stdout, /スライド 2 枚、13\.33×7\.5 インチ（16:9）/);
    assert.match(t.stdout, /指摘なし/);
  });

  it('.pptx：スライドの外・入りきらない文字・小さい文字・下に伸びる表・a:ea の指定もれを、スライドの番号つきで拾う', () => {
    const r = pptx('bad.pptx',
      box(800, 40, 300, 60, '外に出る', 20),
      box(40, 40, 200, 40, '第3四半期の売上は目標を達成したが、一回きりの大型の案件を除くと前年の同じ時期を下回っている', 24) + box(40, 400, 300, 30, '注記', 10),
      table(300, 6, 'セルの中で何度も折り返すくらい長い説明の文をここに書いておく。まだ続く説明の文。'),
      box(40, 40, 600, 60, '日本語のフォント', 24, '<a:latin typeface="Yu Gothic"/>'));
    assert.equal(r.status, 1);
    const kinds = (n) => r.issues.filter((i) => i.slide === n).map((i) => i.kind);
    assert.deepEqual(kinds(1), ['outside']);
    assert.deepEqual(kinds(2).sort(), ['overflow', 'small']);
    assert.deepEqual(kinds(3), ['outside']);
    assert.deepEqual(kinds(4), ['font']);
  });

  it('.pptx：グループの外の図形は位置を見て、同じ段落の中の小さい文字も拾う', () => {
    const group = `<p:grpSp><p:nvGrpSpPr/><p:grpSpPr/>${box(5000, 5000, 100, 40, 'グループの中', 16)}</p:grpSp>`;
    const mixed = box(40, 40, 600, 60, '本文', 18).replace('</a:r>', '</a:r><a:r><a:rPr lang="ja-JP" sz="900"><a:ea typeface="Meiryo"/></a:rPr><a:t>同じ段落の注記</a:t></a:r>');
    const r = pptx('group.pptx', group + box(800, 40, 300, 60, '外に出る', 20), mixed);
    assert.deepEqual(r.issues.map((i) => [i.slide, i.kind]), [[1, 'outside'], [2, 'small']]);
    assert.deepEqual(r.report.groupedSlides, [1]);
  });

  it('.pptx：--min-font で小さい文字の線を変えられ、壊れたファイルは終了コード 2', () => {
    const f = path.join(tmp, 'small.pptx');
    assert.deepEqual(pptx('small.pptx', box(40, 40, 600, 60, '本文', 18) + box(40, 400, 300, 30, '注記', 10)).issues.map((i) => i.kind), ['small']);
    const r = spawnSync(process.execPath, [script, f, '--json', '--min-font', '10'], { encoding: 'utf8', timeout: 300000, env: noPpt });
    assert.ok(!JSON.parse(r.stdout).issues.some((i) => i.kind === 'small'));
    fs.writeFileSync(path.join(tmp, 'broken.pptx'), 'not a zip');
    assert.equal(spawnSync(process.execPath, [script, path.join(tmp, 'broken.pptx')], { encoding: 'utf8' }).status, 2);
  });

  // 描いた結果からの実測は、LibreOffice（か Windows の PowerPoint）と pdftotext が要る。無い PC では飛ばす
  const fixture = path.join(root, 'test/fixtures/layout-check-broken.pptx');
  const drawn = spawnSync(process.execPath, [script, fixture, '--json'], { encoding: 'utf8', timeout: 300000 });
  let dr = null;
  try { dr = JSON.parse(drawn.stdout); } catch { /* 走らなかったとき */ }
  it('.pptx：描いた結果から、文字どうしの重なり・切れた文字・箱からあふれた文字を拾い、崩れの無いスライドでは拾わない', { skip: dr && dr.measuredBy ? false : '描いて文字の位置を取る道具（LibreOffice と pdftotext、または PowerPoint）が無い' }, () => {
    assert.equal(drawn.status, 1);
    const kinds = (n) => [...new Set(dr.issues.filter((i) => i.slide === n).map((i) => i.kind))].sort();
    assert.deepEqual(kinds(1), ['outside', 'overlap']);
    assert.deepEqual(kinds(2), ['overflow']);
    assert.deepEqual(kinds(3), []);
    assert.equal(dr.issues.filter((i) => i.slide === 2).length, 1, 'あふれは箱ごとに1件');
    assert.match(dr.issues.find((i) => i.slide === 2).msg, /ほか 1 行/, '上と下の両方にあふれていることが分かる');
    assert.equal(dr.issues.filter((i) => i.slide === 1 && i.kind === 'outside').length, 1, 'スライドの外は箱ごとに1件');
    assert.equal(dr.measuredBy, dr.renderedBy === 'PowerPoint' ? 'PowerPoint' : 'PDF');
    assert.ok(!dr.issues.some((i) => i.estimated), '見積もりの指摘は実測に置き換わる');
    assert.equal(dr.pdf.pages, 3);
  });

  it('ファイルが無いときは終了コード 2', () => {
    const r = spawnSync(process.execPath, [script, path.join(tmp, 'none.svg')], { encoding: 'utf8' });
    assert.equal(r.status, 2);
  });
});
