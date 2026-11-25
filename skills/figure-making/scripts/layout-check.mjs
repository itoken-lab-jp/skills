#!/usr/bin/env node
// SVG・HTML の図やスライド、Mermaid の図をブラウザ（Chrome・Edge・Chromium）で描き、PNG にして、
// 文字の重なり・はみ出し・線が文字を通る所・小さい文字を数えて出す。Mermaid は構文エラーも出す。
// 使い方: node layout-check.mjs <図.svg | 図.html | 図.mmd | 文書.md> [--width 1280] [--height 720] [--out 図.png] [--min-font 12] [--pdf 図.pdf] [--mermaid <mermaid.min.js の場所か URL>] [--json]
//         node layout-check.mjs <スライド.pptx> [--min-font 14] [--pdf 確かめ用.pdf] [--json]
//   .pptx は、中身（XML）からスライドの外に出た部品・箱に入りきらない見込みの文字・下に伸びる表・小さい文字（pt）・日本語のフォントの指定もれを出し、
//   Windows に PowerPoint があれば PowerPoint に（窓を出さずに）、無ければ LibreOffice に PDF とスライドごとの PNG を書き出させ、
//   描いた結果の文字の行の位置（PowerPoint が返す値か、PDF を pdftotext で読んだ値）から、文字どうしの重なり・箱からあふれた文字・
//   スライドの外で切れた文字を実測で出す（見積もりの指摘は実測に置き換わる）。
//   全部を並べた一覧の画像も作って場所を出す（LibreOffice のときの PNG には pdftoppm が、一覧の画像には Chrome・Edge・Chromium が要る。無ければ、ある物だけを出す）。
//   PowerPoint を使わせないときは LAYOUT_CHECK_NO_POWERPOINT=1、描かずに中身からの指摘だけを出すときは LAYOUT_CHECK_NO_RENDER=1。
//   LibreOffice の場所は LAYOUT_CHECK_SOFFICE でも指定できる。
//   確かめ用の PNG は一時フォルダーに出し、場所を出力に書く（渡す PNG を作るときは --out）。
//   .md は、中の ```mermaid のブロックを1つずつ描く（PNG は <名前>-mermaid-1.png …）。
// 依存: Node 22 以上と、Chrome・Edge・Chromium のどれか（npm の依存は無い）。ブラウザの場所は LAYOUT_CHECK_BROWSER でも指定できる。
//   Mermaid を描くときだけ mermaid.js が要る。--mermaid か LAYOUT_CHECK_MERMAID、近くの node_modules/mermaid、の順に探し、
//   無ければ CDN（cdn.jsdelivr.net）から読む（図の中身は外に送らない。読むのはライブラリだけ）。
//   Linux のコンテナや CI でブラウザがサンドボックスを使えずに起動しないときは、LAYOUT_CHECK_NO_SANDBOX=1 を付ける（root では自動で付く）。
// 終了コード: 0 = 指摘なし、1 = 指摘あり（構文エラーを含む）、2 = 走らせられなかった（ブラウザが無い、ファイルが読めない）。
import { spawn, spawnSync } from 'node:child_process';
import { inflateRawSync } from 'node:zlib';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, mkdirSync, rmSync, readdirSync, copyFileSync } from 'node:fs';
import { join, resolve, dirname, extname, basename } from 'node:path';
import { tmpdir, homedir, platform } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// ---- ブラウザの中で走る検査（文字列にして送るので、外の変数を使わない） ----
function probe(opt) {
  const W = Math.max(document.documentElement.scrollWidth, document.documentElement.clientWidth);
  const H = Math.max(document.documentElement.scrollHeight, document.documentElement.clientHeight);
  const issues = [];
  const add = (kind, msg) => { if (!issues.some((i) => i.msg === msg) && issues.length < 60) issues.push({ kind, msg }); };
  const short = (s) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > 18 ? t.slice(0, 18) + '…' : t; };
  const visible = (el) => { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0; };
  const inter = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const inside = (p, r) => p.x > r.left && p.x < r.right && p.y > r.top && p.y < r.bottom;
  const shrink = (r, d) => ({ left: r.left + d, right: r.right - d, top: r.top + d, bottom: r.bottom - d });
  // わざと重ねて見せる所（悪い例の図など）は data-layout-ignore を付けると、重なりの検査から外れる
  const ignored = (el) => !!(el && el.closest && el.closest('[data-layout-ignore]'));
  const painted = (el) => {
    const s = getComputedStyle(el);
    const bg = s.backgroundColor;
    return (bg && bg !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(bg)) || parseFloat(s.borderTopWidth) > 0;
  };
  const at = (b) => `（x ${Math.round(b.left)}, y ${Math.round(b.top)}）`;

  // 文字の箱。行の高さでなく字面に近い高さ（font-size）にそろえ、行間の重なりを拾わない
  const texts = [];
  const glyphBox = (r, fontSize) => {
    const cy = (r.top + r.bottom) / 2;
    const h = Math.min(r.height, fontSize);
    return { left: r.left, right: r.right, top: cy - h / 2, bottom: cy + h / 2 };
  };
  const screenFont = (el) => {
    let px = parseFloat(getComputedStyle(el).fontSize);
    if (el instanceof SVGElement && el.getScreenCTM) { const m = el.getScreenCTM(); if (m) px *= Math.hypot(m.a, m.b); }
    return px;
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!n.textContent.trim() || !el || el.closest('svg text, script, style, noscript, title') || !visible(el)) continue;
    const fontSize = screenFont(el);
    const range = document.createRange();
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) {
      if (r.width > 1 && r.height > 1) texts.push({ text: short(n.textContent), el, box: glyphBox(r, fontSize), px: fontSize, svg: false });
    }
  }
  for (const t of document.querySelectorAll('svg text')) {
    if (!t.textContent.trim() || !visible(t)) continue;
    const fontSize = screenFont(t);
    // tspan で行を分けた text は、行ごとの箱にする（全体の箱だと行間の図形まで含む）
    const parts = t.querySelectorAll('tspan').length ? [...t.querySelectorAll('tspan')].filter((s) => s.textContent.trim()) : [t];
    for (const p of parts) {
      const r = p.getBoundingClientRect();
      // 回した文字は箱が縦長になるので、字面に縮めずそのまま使う
      const rotated = r.height > fontSize * 1.8 && r.height > r.width;
      if (r.width > 1 && r.height > 1) texts.push({ text: short(p.textContent), el: t, box: rotated ? r : glyphBox(r, fontSize), px: fontSize, svg: true, rotated });
    }
  }

  // 小さすぎる文字
  if (opt.minFont > 0) {
    const small = [];
    for (const t of texts) if (t.px < opt.minFont - 0.5 && !small.some((s) => s.text === t.text)) small.push(t);
    if (small.length) add('small', `${opt.minFont}px より小さい文字が ${small.length} か所：${small.slice(0, 6).map((s) => `「${s.text}」${s.px.toFixed(0)}px`).join('、')}${small.length > 6 ? ' ほか' : ''}`);
  }

  // 図・ページの外
  for (const t of texts) {
    const b = t.box;
    if (b.left < -1 || b.top < -1 || b.right > W + 1 || b.bottom > H + 1) add('outside', `文字が図の外に出ている：「${t.text}」${at(b)}`);
  }

  // 枠からのはみ出し（HTML）：いちばん近い「地や枠線のある箱」か、切り取る箱（overflow が visible でない）の外
  for (const t of texts) {
    if (t.svg) {
      const svg = t.el.closest('svg');
      const box = svg && svg.getBoundingClientRect();
      const b = t.box;
      if (box && (b.left < box.left - 1 || b.right > box.right + 1 || b.top < box.top - 1 || b.bottom > box.bottom + 1)) add('overflow', `文字が SVG の外に出ている（切れる）：「${t.text}」${at(b)}`);
      continue;
    }
    for (let a = t.el; a && a !== document.body; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.display === 'inline') continue;
      if (painted(a) || s.overflow !== 'visible') {
        const box = a.getBoundingClientRect();
        const b = t.box;
        if (b.left < box.left - 1 || b.right > box.right + 1 || b.top < box.top - 1 || b.bottom > box.bottom + 1) add('overflow', `文字が枠からはみ出している${s.overflow !== 'visible' ? '（切れて見えない）' : ''}：「${t.text}」${at(b)}`);
        break;
      }
    }
  }

  // 枠からのはみ出し（SVG）：文字の起点を含むいちばん小さい図形の箱の外
  const shapes = [...document.querySelectorAll('svg rect, svg ellipse, svg circle, svg polygon')]
    .filter((sh) => !sh.closest('defs, marker, clipPath, mask, symbol, pattern') && visible(sh))
    .map((sh) => ({ el: sh, r: sh.getBoundingClientRect() }))
    .filter((s) => s.r.width * s.r.height >= 50 && s.r.width * s.r.height <= W * H * 0.6);
  for (const t of texts) {
    if (!t.svg || t.rotated || ignored(t.el)) continue;
    const anc = getComputedStyle(t.el).textAnchor;
    const cy = (t.box.top + t.box.bottom) / 2;
    const c = anc === 'middle' ? { x: (t.box.left + t.box.right) / 2, y: cy } : anc === 'end' ? { x: t.box.right - 3, y: cy } : { x: t.box.left + 3, y: cy };
    let best = null, bestA = Infinity;
    for (const s of shapes) { const a = s.r.width * s.r.height; if (inside(c, s.r) && a < bestA) { best = s.r; bestA = a; } }
    if (!best) continue;
    const b = t.box;
    const over = Math.max(best.left - b.left, b.right - best.right, best.top - b.top, b.bottom - best.bottom);
    if (over > 1) add('overflow', `文字が図形の枠から ${Math.round(over)}px はみ出している：「${t.text}」${at(b)}`);
    else if (opt.pad > 0 && Math.min(b.left - best.left, best.right - b.right) < opt.pad) add('tight', `文字が図形の枠の左右に近い（余白 ${opt.pad}px 未満）：「${t.text}」${at(b)}`);
  }

  // 文字どうしの重なり
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i], b = texts[j];
      if ((a.el === b.el && !a.svg) || ignored(a.el) || ignored(b.el)) continue;
      if (inter(shrink(a.box, 1), shrink(b.box, 1)) > 4) add('overlap', `文字どうしが重なっている：「${a.text}」と「${b.text}」${at(a.box)}`);
    }
  }

  // 線（矢印・つなぎの線・図形の枠線）が文字を通っていないか
  // （Mermaid は線のラベルを地つきで線の上に置く作りなので、この検査はしない）
  const labels = texts.filter((t) => !ignored(t.el));
  for (const s of opt.noLine ? [] : document.querySelectorAll('svg path, svg line, svg polyline, svg polygon, svg rect, svg ellipse, svg circle')) {
    if (s.closest('defs, marker, clipPath, mask, symbol, pattern') || ignored(s) || !visible(s)) continue;
    const cs = getComputedStyle(s);
    if (cs.stroke === 'none' || parseFloat(cs.strokeWidth) <= 0) continue;
    let len = 0;
    try { len = s.getTotalLength(); } catch { continue; }
    const m = s.getScreenCTM();
    if (!m || !len) continue;
    const step = Math.max(1.5, len / 600);
    const hit = new Map();
    for (let d = 0; d <= len; d += step) {
      const p = s.getPointAtLength(d);
      const q = { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
      for (const l of labels) if (inside(q, shrink(l.box, 1))) hit.set(l.text, l.box);
    }
    for (const [text, box] of hit) add('line', `線が文字を通っている：「${text}」${at(box)}`);
  }

  // 図形どうしの重なり（SVG の箱が、入れ子でなく一部だけ重なる）
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const a = shapes[i], b = shapes[j];
      if (a.el.tagName !== 'rect' || b.el.tagName !== 'rect' || ignored(a.el) || ignored(b.el)) continue;
      const x = inter(a.r, b.r);
      if (x < 16) continue;
      const small = Math.min(a.r.width * a.r.height, b.r.width * b.r.height);
      if (x > small * 0.98) continue; // 入れ子（まとめの枠の中の箱、同じ位置の影）
      add('shape', `箱どうしが一部重なっている${at(a.r)} と ${at(b.r)}`);
    }
  }

  // 使われた日本語のフォント（□ や別の字形になっていないかの手がかり）
  const families = new Set();
  for (const t of texts.slice(0, 200)) families.add(getComputedStyle(t.el).fontFamily.split(',')[0].trim().replace(/["']/g, ''));
  return { width: W, height: H, texts: texts.length, fonts: [...families].slice(0, 6), issues };
}

// ---- ここから下は Node の側 ----
function findBrowser() {
  const cands = [];
  if (process.env.LAYOUT_CHECK_BROWSER) cands.push(process.env.LAYOUT_CHECK_BROWSER);
  const os = platform();
  if (os === 'win32') {
    for (const base of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)) {
      cands.push(join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'), join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    }
  } else if (os === 'darwin') {
    cands.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium');
  }
  for (const dir of (process.env.PATH || '').split(os === 'win32' ? ';' : ':')) {
    for (const n of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'microsoft-edge-stable', 'chrome']) cands.push(join(dir, n));
  }
  // Playwright が入れた Chromium
  for (const root of [process.env.PLAYWRIGHT_BROWSERS_PATH, join(homedir(), '.cache', 'ms-playwright'), join(homedir(), 'Library', 'Caches', 'ms-playwright'), join(process.env.LOCALAPPDATA || '', 'ms-playwright'), '/opt/pw-browsers'].filter(Boolean)) {
    if (!existsSync(root)) continue;
    for (const d of readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
      for (const rel of ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', 'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing']) cands.push(join(root, d, rel));
    }
  }
  return cands.find((c) => c && existsSync(c)) || null;
}

function parseArgs(argv) {
  const o = { width: 1280, height: 720, minFont: 12, minFontGiven: false, pad: 0, json: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a === '--width') o.width = Number(argv[++i]);
    else if (a === '--height') o.height = Number(argv[++i]);
    else if (a === '--min-font') { o.minFont = Number(argv[++i]); o.minFontGiven = true; }
    else if (a === '--pad') o.pad = Number(argv[++i]);
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--pdf') o.pdf = argv[++i];
    else if (a === '--mermaid') o.mermaid = argv[++i];
    else rest.push(a);
  }
  o.file = rest[0];
  return o;
}

const MERMAID_CDN = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';
function findMermaid(o, file) {
  const given = o.mermaid || process.env.LAYOUT_CHECK_MERMAID;
  if (given) return /^https?:/.test(given) ? given : pathToFileURL(resolve(given)).href;
  for (let d of [dirname(file), process.cwd()]) {
    for (let i = 0; i < 8; i++) {
      const c = join(d, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js');
      if (existsSync(c)) return pathToFileURL(c).href;
      const up = dirname(d);
      if (up === d) break;
      d = up;
    }
  }
  return MERMAID_CDN;
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

// ---- .pptx：中身（XML）から測り、LibreOffice で PDF と画像にする ----
function unzip(buf) {
  const files = new Map();
  const e = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (e < 0) throw new Error('zip として読めない（.pptx が壊れている）');
  const n = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip の目次が壊れている');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl);
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const data = buf.subarray(start, start + csize);
    if (/\.(xml|rels)$/.test(name)) files.set(name, (method === 0 ? data : inflateRawSync(data)).toString('utf8'));
    p += 46 + nl + xl + cl;
  }
  return files;
}
function findSoffice() {
  const cands = [];
  if (process.env.LAYOUT_CHECK_SOFFICE) cands.push(process.env.LAYOUT_CHECK_SOFFICE);
  const os = platform();
  if (os === 'win32') for (const base of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)']].filter(Boolean)) cands.push(join(base, 'LibreOffice', 'program', 'soffice.exe'));
  else if (os === 'darwin') cands.push('/Applications/LibreOffice.app/Contents/MacOS/soffice');
  for (const dir of (process.env.PATH || '').split(os === 'win32' ? ';' : ':')) for (const n of os === 'win32' ? ['soffice.exe'] : ['soffice', 'libreoffice']) cands.push(join(dir, n));
  return cands.find((c) => c && existsSync(c)) || null;
}
function checkPptx(file, o, fail) {
  const PT = 12700;
  const minFont = o.minFontGiven ? o.minFont : 14;
  let z;
  try { z = unzip(readFileSync(file)); } catch (e) { fail(`走らせられなかった: ${e.message}`); }
  const pres = z.get('ppt/presentation.xml'), rels = z.get('ppt/_rels/presentation.xml.rels');
  if (!pres || !rels) fail('走らせられなかった: ppt/presentation.xml が無い（.pptx が壊れている）');
  const attr = (tag, name) => (tag.match(new RegExp(`\\s${name}="([^"]*)"`)) || [])[1];
  const sz = pres.match(/<p:sldSz[^>]*>/)?.[0] || '';
  const W = Number(attr(sz, 'cx') || 12192000), H = Number(attr(sz, 'cy') || 6858000);
  const target = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attr(m[0], 'Id'), attr(m[0], 'Target')]));
  const slides = [...pres.matchAll(/<p:sldId\b[^>]*>/g)].map((m) => target.get(attr(m[0], 'r:id'))).filter(Boolean).map((t) => 'ppt/' + t.replace(/^\/ppt\//, '').replace(/^\.\//, ''));
  const dec = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const short = (s) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > 18 ? t.slice(0, 18) + '…' : t; };
  // 全角は文字の大きさと同じ幅、半角はその 0.55 倍で数える（見積もり）
  const widthPt = (s, size) => { let w = 0; for (const c of s) w += /[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uff60\uffe0-\uffe6]/.test(c) ? size : size * 0.55; return w; };
  const paras = (xml) => [...xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>|<a:p\s[^>]*>([\s\S]*?)<\/a:p>/g)].map((m) => {
    const body = m[1] ?? m[2];
    const text = [...body.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((t) => dec(t[1])).join('');
    // 文字のある run ごとの大きさ。収まりの見積もりには段落でいちばん大きいものを、小さい文字の検査にはいちばん小さいものを使う
    const runs = [...body.matchAll(/<a:r>([\s\S]*?)<\/a:r>/g)].map((r) => ({ text: dec([...r[1].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((t) => t[1]).join('')), size: Number(attr(r[1].match(/<a:rPr\b[^>]*>/)?.[0] || '', 'sz') || 0) / 100 })).filter((r) => r.text.trim() && r.size);
    return { text, size: runs.length ? Math.max(...runs.map((r) => r.size)) : null, runs };
  }).filter((p) => p.text.trim());
  const needH = (ps, wPt) => ps.reduce((h, p) => h + Math.max(1, Math.ceil(widthPt(p.text, p.size ?? 18) / Math.max(wPt, 1))) * (p.size ?? 18) * 1.2, 0);
  const xfrm = (xml) => { const off = xml.match(/<a:off\b[^>]*>/)?.[0], ext = xml.match(/<a:ext\b[^>]*\bcx="[^>]*>/)?.[0]; return off && ext ? { x: Number(attr(off, 'x')), y: Number(attr(off, 'y')), w: Number(attr(ext, 'cx')), h: Number(attr(ext, 'cy')) } : null; };
  const issues = [], perSlide = [], groupedSlides = [];
  const norm = (t) => t.normalize('NFKC').replace(/\s+/g, '');
  const boxes = new Map(), slideText = new Map(); // スライドごとの、文字のある図形の箱（pt）と、全部の文字。描いた結果と照らすのに使う
  const add = (slide, kind, msg, est) => { if (issues.length < 80 && !issues.some((i) => i.msg === `スライド ${slide}：${msg}`)) issues.push({ slide, kind, msg: `スライド ${slide}：${msg}`, ...(est ? { estimated: true } : {}) }); };
  slides.forEach((name, idx) => {
    const n = idx + 1, xml = z.get(name) || '';
    // まとめた図形（グループ）の中は、座標の基準が変わるので位置を見ない（文字の大きさは見る）。グループの外の図形は見る
    let top = xml, inGroups = '';
    for (let m; (m = top.match(/<p:grpSp>(?:(?!<p:grpSp>)[\s\S])*?<\/p:grpSp>/));) { inGroups += m[0].replace(/<\/?p:grpSp>/g, ''); top = top.replace(m[0], ''); }
    if (inGroups) groupedSlides.push(n);
    const fonts = new Set();
    let grouped = false;
    boxes.set(n, []);
    slideText.set(n, norm([...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((t) => dec(t[1])).join('')));
    for (const m of (top + '<!--grp-->' + inGroups).matchAll(/<p:(sp|pic|graphicFrame)>[\s\S]*?<\/p:\1>|<!--grp-->/g)) {
      if (m[0] === '<!--grp-->') { grouped = true; continue; }
      const el = m[0], b = xfrm(el);
      const tbl = el.includes('<a:tbl>');
      const ps = tbl ? [] : paras(el);
      const label = ps.length ? `「${short(ps.map((p) => p.text).join(' '))}」` : tbl ? '表' : m[1] === 'pic' ? '画像' : '図形';
      for (const p of paras(el)) for (const r of p.runs) { fonts.add(r.size); if (r.size < minFont) add(n, 'small', `小さい文字 ${r.size}pt：「${short(r.text)}」（${minFont}pt より小さい）`); }
      if (!b || grouped) continue;
      if (ps.length) {
        // 塗りか枠線のある図形だけ、文字が箱からあふれると見た目が崩れる（塗りの無い文字の箱は、あふれても見えない）
        const spPr = el.match(/<p:spPr[\s\S]*?<\/p:spPr>/)?.[0] || '';
        const filled = !/<p:cNvSpPr[^>]*txBox="1"/.test(el) ? !/^<p:spPr[^>]*>(?:(?!<a:ln)[\s\S])*<a:noFill\/>/.test(spPr) || /<a:ln\b[^>]*>\s*<a:solidFill/.test(spPr) : /<a:(solidFill|gradFill|pattFill)/.test(spPr);
        boxes.get(n).push({ x0: b.x / PT, y0: b.y / PT, x1: (b.x + b.w) / PT, y1: (b.y + b.h) / PT, text: norm(ps.map((p) => p.text).join('')), filled, label });
      }
      if (b.x < -PT || b.y < -PT || b.x + b.w > W + PT || b.y + b.h > H + PT) add(n, 'outside', `スライドの外に出ている：${label}（左 ${Math.round(b.x / PT)}pt、上 ${Math.round(b.y / PT)}pt、幅 ${Math.round(b.w / PT)}pt、高さ ${Math.round(b.h / PT)}pt。スライドは ${Math.round(W / PT)}×${Math.round(H / PT)}pt）`);
      if (tbl) {
        const cols = [...el.matchAll(/<a:gridCol\b[^>]*>/g)].map((c) => Number(attr(c[0], 'w')) / PT);
        let total = 0;
        for (const tr of el.matchAll(/<a:tr\b([^>]*)>([\s\S]*?)<\/a:tr>/g)) {
          let rh = Number(attr(' ' + tr[1], 'h') || 0) / PT;
          [...tr[2].matchAll(/<a:tc\b[^>]*>[\s\S]*?<\/a:tc>|<a:tc\b[^>]*\/>/g)].forEach((tc, ci) => { const cps = paras(tc[0]); if (cps.length) rh = Math.max(rh, needH(cps, (cols[ci] ?? 100) - 14.4) + 7.2); });
          total += rh;
        }
        if (b.y / PT + total > H / PT + 4) add(n, 'outside', `表がスライドの下に出る見込み（文字が折り返して行が伸びる。表の高さ 約${Math.round(total)}pt、置いた所から下端まで ${Math.round((H - b.y) / PT)}pt）`, true);
      } else if (ps.length && ps.every((p) => p.size) && b.h > 0) {
        const bp = el.match(/<a:bodyPr\b[^>]*>/)?.[0] || '';
        if (attr(bp, 'vert') && attr(bp, 'vert') !== 'horz') continue;
        const ins = (k) => Number(attr(bp, k) ?? 91440) / PT;
        const need = attr(bp, 'wrap') === 'none' ? ps.reduce((h, p) => h + p.size * 1.2, 0) : needH(ps, b.w / PT - ins('lIns') - ins('rIns'));
        if (need > (b.h / PT) * 1.15 + 6) add(n, 'overflow', `文字が箱に入りきらない見込み：${label}（要る高さ 約${Math.round(need)}pt、箱 ${Math.round(b.h / PT)}pt。PowerPoint の箱は、文字が増えても自動では広がらない）`, true);
        if (attr(bp, 'wrap') === 'none' && b.x / PT + Math.max(...ps.map((p) => widthPt(p.text, p.size))) > W / PT + 4) add(n, 'outside', `折り返さない文字がスライドの右に出る見込み：${label}`, true);
      }
    }
    // 日本語の文字は、東アジアの側（a:ea）のフォントで描かれる。a:ea が無いと、テーマの ea のフォントになる（テーマの ea が空のときだけ a:latin が使われる。2026-11 に PowerPoint の実機で確かめた）
    const noEa = [...xml.matchAll(/<a:r>([\s\S]*?)<\/a:r>/g)].find((r) => /<a:latin\b/.test(r[1]) && !/<a:ea\b/.test(r[1]) && /[\u3040-\u30ff\u4e00-\u9fff]/.test(r[1].replace(/<[^>]*>/g, '')));
    if (noEa) add(n, 'font', `日本語の文字に、欧文の側（a:latin）のフォントしか指定が無い：「${short(dec(noEa[1].replace(/<[^>]*>/g, '')))}」ほか。PowerPoint は日本語を東アジアの側（a:ea）のフォントで描き、a:ea が無いとテーマの東アジアのフォント（日本語版の Office のテーマなら游ゴシックなど）になることがある。a:ea にも同じ名前を入れる。テンプレートのテーマのフォントを使うなら、a:latin の指定を外す。`);
    perSlide.push({ slide: n, fontsPt: [...fonts].sort((a, b) => b - a) });
  });
  // 描く
  const outDir = join(tmpdir(), 'layout-check', createHash('sha1').update(file).digest('hex').slice(0, 8));
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  let pdf = null, pngs = [], note = null, by = null, pptErr = '';
  const made = join(outDir, basename(file).replace(/\.[^.]+$/, '') + '.pdf');
  const countPages = (f) => (readFileSync(f).toString('latin1').match(/\/Type\s*\/Page\b(?!s)/g) || []).length;
  const listPngs = () => readdirSync(outDir).filter((f) => /^slide-\d+\.png$/.test(f)).sort((a, b) => parseInt(a.slice(6)) - parseInt(b.slice(6))).map((f) => join(outDir, f));
  // Windows に PowerPoint があれば、PowerPoint 自身に書き出させる（窓は出さない）。これが一番確か
  const noRender = !!process.env.LAYOUT_CHECK_NO_RENDER; // 描かずに、中身からの指摘だけを出す（試験用）
  if (platform() === 'win32' && !process.env.LAYOUT_CHECK_NO_POWERPOINT && !noRender) {
    const ps1 = join(outDir, 'export.ps1');
    writeFileSync(ps1, '﻿' + [
      'param([string]$File, [string]$Pdf, [string]$Dir)',
      "$ErrorActionPreference = 'Stop'",
      '# すでに PowerPoint が動いていれば、その PowerPoint につながる。その場合は、使っている人の PowerPoint を終了させない',
      '$wasRunning = @(Get-Process POWERPNT -ErrorAction SilentlyContinue).Count -gt 0',
      '$out = New-Object System.Collections.ArrayList',
      '$script:cell = 0',
      '# 表のセルの行の位置は、セルの左上からの値で返る（2026-11-15 に Windows の PowerPoint で確かめた）ので、セルの位置を足す',
      'function Add-Frame($sl, $shape, $id, $filled, $rel) {',
      '  try { $dx = 0; $dy = 0; if ($rel) { $dx = $shape.Left; $dy = $shape.Top }; foreach ($ln in $shape.TextFrame.TextRange.Lines()) { $t = $ln.Text.Trim(); if ($t) { [void]$out.Add(@{ s = $sl; id = $id; x = $ln.BoundLeft + $dx; y = $ln.BoundTop + $dy; w = $ln.BoundWidth; h = $ln.BoundHeight; text = $t; sx = $shape.Left; sy = $shape.Top; sw = $shape.Width; sh = $shape.Height; filled = [bool]$filled }) } } } catch {}',
      '}',
      'function Add-Lines($sl, $shape) {',
      '  try {',
      '    if ($shape.Type -eq 6) { foreach ($g in $shape.GroupItems) { Add-Lines $sl $g }; return }',
      '    if ($shape.HasTable -eq -1) { foreach ($row in $shape.Table.Rows) { foreach ($c in $row.Cells) { $script:cell++; Add-Frame $sl $c.Shape ("cell" + $script:cell) $false $true } }; return }',
      '    if ($shape.HasTextFrame -eq -1 -and $shape.TextFrame.HasText -eq -1) { Add-Frame $sl $shape ("" + $shape.Id) (($shape.Fill.Visible -eq -1) -or ($shape.Line.Visible -eq -1)) $false }',
      '  } catch {}',
      '}',
      '$app = New-Object -ComObject PowerPoint.Application',
      'try {',
      '  $pres = $app.Presentations.Open($File, -1, 0, 0)  # ReadOnly, Untitled なし, 窓なし',
      '  try {',
      '    $pres.SaveAs($Pdf, 32)  # ppSaveAsPDF',
      '    $w = 1280; $h = [int][math]::Round(1280 * $pres.PageSetup.SlideHeight / $pres.PageSetup.SlideWidth)',
      '    foreach ($s in $pres.Slides) { $s.Export((Join-Path $Dir ("slide-" + $s.SlideIndex + ".png")), "PNG", $w, $h) }',
      '    # 文字の行ごとの、描かれた位置と大きさ（pt）。重なりとあふれを、見積もりでなく実測で出すのに使う',
      '    foreach ($s in $pres.Slides) { foreach ($shape in $s.Shapes) { Add-Lines $s.SlideIndex $shape } }',
      '    $json = if ($out.Count) { ConvertTo-Json -InputObject @($out) -Depth 3 -Compress } else { "[]" }',
      '    [IO.File]::WriteAllText((Join-Path $Dir "lines.json"), $json, (New-Object Text.UTF8Encoding($false)))',
      '  } finally { $pres.Close(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($pres) }',
      '} finally { if (-not $wasRunning) { $app.Quit() }; [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app); [GC]::Collect(); [GC]::WaitForPendingFinalizers() }',
    ].join('\r\n'));
    const pr = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1, file, made, outDir], { encoding: 'utf8', timeout: 180000 });
    rmSync(ps1, { force: true });
    if (existsSync(made)) { by = 'PowerPoint'; pdf = { path: made, pages: countPages(made) }; pngs = listPngs(); }
    else pptErr = ((pr.stderr || pr.error?.message || '').trim().split(/\r?\n/)[0] || '').slice(0, 200);
  }
  const soffice = by || noRender ? null : findSoffice();
  if (by) { /* 描けた */ }
  else if (noRender) note = '描かない設定（LAYOUT_CHECK_NO_RENDER）なので、描いていない（指摘は中身からの見積もりだけ）。';
  else if (!soffice) note = `${platform() !== 'win32' ? 'LibreOffice が見つからない' : process.env.LAYOUT_CHECK_NO_POWERPOINT ? 'PowerPoint を使わない設定（LAYOUT_CHECK_NO_POWERPOINT）で、LibreOffice も見つからない' : `PowerPoint で描けず（${pptErr || '理由は不明'}）、LibreOffice も見つからない`}ので、描いていない（指摘は中身からの見積もりだけ）。LibreOffice を入れるか、場所を LAYOUT_CHECK_SOFFICE に入れる。${platform() !== 'win32' ? 'PowerPoint がある PC では、PowerPoint で PDF に書き出して見る。' : ''}`;
  else {
    const prof = mkdtempSync(join(tmpdir(), 'layout-check-lo-'));
    const r = spawnSync(soffice, ['--headless', `-env:UserInstallation=${pathToFileURL(prof).href}`, '--convert-to', 'pdf', '--outdir', outDir, file], { encoding: 'utf8', timeout: 240000 });
    rmSync(prof, { recursive: true, force: true });
    if (!existsSync(made)) note = `LibreOffice で PDF にできなかった: ${(r.stderr || r.error?.message || '').slice(0, 300)}`;
    else {
      by = 'LibreOffice';
      pdf = { path: made, pages: countPages(made) };
      const pp = spawnSync('pdftoppm', ['-png', '-r', '80', made, join(outDir, 'slide')], { encoding: 'utf8', timeout: 120000 });
      if (!pp.error && pp.status === 0) pngs = listPngs();
    }
  }
  if (pdf) {
    if (o.pdf) { copyFileSync(made, resolve(o.pdf)); pdf.path = resolve(o.pdf); }
    if (pdf.pages && pdf.pages !== slides.length) issues.push({ slide: 0, kind: 'pages', msg: `PDF が ${pdf.pages} ページで、スライドの ${slides.length} 枚と合わない` });
  }
  // 描いた結果から、文字の行の位置を取る。PowerPoint で描いたときは PowerPoint が返した値、ほかは PDF の文字の位置（pdftotext が要る）
  let lines = null, measuredBy = null;
  const lj = join(outDir, 'lines.json');
  if (by === 'PowerPoint' && existsSync(lj)) {
    try {
      lines = JSON.parse(readFileSync(lj, 'utf8').replace(/^\ufeff/, '')).map((l) => ({ slide: l.s, id: l.id, x0: l.x, y0: l.y, x1: l.x + l.w, y1: l.y + l.h, text: l.text, shape: { x0: l.sx, y0: l.sy, x1: l.sx + l.sw, y1: l.sy + l.sh, filled: l.filled } }));
      measuredBy = 'PowerPoint';
    } catch { lines = null; }
    rmSync(lj, { force: true });
  }
  if (!lines && pdf) {
    const bb = join(outDir, 'bbox.html');
    const r = spawnSync('pdftotext', ['-bbox-layout', made, bb], { encoding: 'utf8', timeout: 120000 });
    if (!r.error && r.status === 0 && existsSync(bb)) {
      lines = [];
      readFileSync(bb, 'utf8').split('<page ').slice(1).forEach((pg, i) => {
        const k = (W / PT) / Number(attr(' ' + pg.slice(0, 200), 'width') || W / PT); // PDF の用紙とスライドの pt の比
        const all = [];
        for (const m of pg.matchAll(/<line xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="([\d.-]+)">([\s\S]*?)<\/line>/g)) {
          const text = dec([...m[5].matchAll(/>([^<]*)<\/word>/g)].map((w) => w[1]).join(' '));
          if (!text.trim()) continue;
          const l = { slide: i + 1, x0: m[1] * k, y0: m[2] * k, x1: m[3] * k, y1: m[4] * k, text };
          // どの図形の文字かは、文字の中身と近さで当てる
          const cands = (boxes.get(i + 1) || []).filter((b) => norm(text).length >= 2 && b.text.includes(norm(text)));
          const d = (b) => Math.hypot((b.x0 + b.x1) / 2 - (l.x0 + l.x1) / 2, (b.y0 + b.y1) / 2 - (l.y0 + l.y1) / 2);
          if (cands.length) { l.shape = cands.sort((a, b) => d(a) - d(b))[0]; l.id = (boxes.get(i + 1) || []).indexOf(l.shape); }
          all.push(l); lines.push(l);
        }
        // 中身にある文字が PDF に無ければ、スライドの外で切れている
        const lost = (slideText.get(i + 1) || '').length - norm(all.map((l) => l.text).join('')).length;
        if (lost >= 3) add(i + 1, 'outside', `文字の一部が描かれていない（およそ ${lost} 字）。スライドの外に出て切れている。文字を減らすか、箱を上に動かすか、スライドを分ける。`);
      });
      measuredBy = 'PDF';
      rmSync(bb, { force: true });
    }
  }
  if (lines) {
    // 見積もりの指摘は、実測に置き換える
    for (let i = issues.length - 1; i >= 0; i--) if (issues[i].estimated) issues.splice(i, 1);
    const sw = W / PT, sh = H / PT, r0 = (v) => Math.round(v);
    for (const n of new Set(lines.map((l) => l.slide))) {
      const L = lines.filter((l) => l.slide === n);
      let over = 0;
      const spilled = new Set(), outs = new Set(); // あふれと、スライドの外は、箱（表ならセル）ごとに1件だけ出す
      const more = (l, test) => { const k = l.id === undefined ? 0 : L.filter((m) => m.id === l.id && m !== l && test(m)).length; return k ? `ほか ${k} 行` : ''; };
      const isOut = (l) => l.x0 < -2 || l.y0 < -2 || l.x1 > sw + 2 || l.y1 > sh + 2;
      const spills = (l) => { const b = l.shape; return b && b.filled && (l.y1 - 3 > b.y1 + 2 || l.y0 + 3 < b.y0 - 2 || l.x1 - 1 > b.x1 + 2 || l.x0 + 1 < b.x0 - 2); };
      for (const l of L) {
        const key = l.id === undefined ? l : l.id;
        if (isOut(l) && !outs.has(key)) { outs.add(key); add(n, 'outside', `文字がスライドの外に出ている：「${short(l.text)}」${more(l, isOut)}（文字の右端 ${r0(l.x1)}pt・下端 ${r0(l.y1)}pt。スライドは ${r0(sw)}×${r0(sh)}pt）`); }
        const b = l.shape;
        if (spills(l) && !spilled.has(key)) { spilled.add(key); add(n, 'overflow', `文字が箱からあふれている：「${short(l.text)}」${more(l, spills)}（箱は 左 ${r0(b.x0)}・上 ${r0(b.y0)}・右 ${r0(b.x1)}・下 ${r0(b.y1)}pt、この行は 左 ${r0(l.x0)}・上 ${r0(l.y0)}・右 ${r0(l.x1)}・下 ${r0(l.y1)}pt）。箱を広げるか、文字を減らす。`); }
      }
      for (let i = 0; i < L.length && over < 8; i++) for (let j = i + 1; j < L.length && over < 8; j++) {
        const a = L[i], b = L[j];
        if (a.id !== undefined && a.id === b.id) continue; // 同じ箱の中の行どうしは、行間で少し重なるのが普通
        const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
        if (ox > 2 && oy > 0.35 * Math.min(a.y1 - a.y0, b.y1 - b.y0)) { over++; add(n, 'overlap', `文字どうしが重なっている：「${short(a.text)}」と「${short(b.text)}」（左 ${r0(Math.max(a.x0, b.x0))}pt、上 ${r0(Math.max(a.y0, b.y0))}pt のあたり）`); }
      }
    }
    issues.sort((a, b) => a.slide - b.slide);
  }
  // 2枚以上なら、1回で見られるように、番号つきで並べた一覧の画像も作る（ブラウザがあるとき）
  let sheet = null;
  const browser = pngs.length > 1 ? findBrowser() : null;
  if (browser) {
    const cols = pngs.length > 12 ? 3 : 2, cw = cols === 3 ? 520 : 760, ch = Math.round(cw * H / W), rows = Math.ceil(pngs.length / cols);
    const html = join(outDir, 'sheet.html'), out = join(outDir, 'sheet.png');
    writeFileSync(html, `<!doctype html><meta charset="utf-8"><body style="margin:8px;background:#888;display:grid;grid-template-columns:repeat(${cols},${cw}px);gap:8px;font:16px sans-serif">${pngs.map((f, i) => `<div><div style="color:#fff;height:22px">${i + 1}</div><img src="${pathToFileURL(f).href}" style="width:${cw}px;height:${ch}px;display:block"></div>`).join('')}</body>`);
    // この検査自身に HTML として描かせる（ブラウザの起動のしかたを1か所にするため。指摘は使わない）
    spawnSync(process.execPath, [fileURLToPath(import.meta.url), html, '--out', out, '--width', String(16 + cols * (cw + 8)), '--height', String(16 + rows * (ch + 30)), '--json'], { encoding: 'utf8', timeout: 120000 });
    rmSync(html, { force: true });
    if (existsSync(out)) sheet = out;
  }
  const ratio = W / H;
  const report = { file, slides: slides.length, slideSizeIn: [Math.round(W / 9144) / 100, Math.round(H / 9144) / 100], pdf, pngs, sheet, renderedBy: by, measuredBy, fonts: perSlide, groupedSlides, issues, note };
  if (o.json) console.log(JSON.stringify(report, null, 1));
  else {
    console.log(`スライド ${slides.length} 枚、${report.slideSizeIn[0]}×${report.slideSizeIn[1]} インチ（${Math.abs(ratio - 16 / 9) < 0.01 ? '16:9' : Math.abs(ratio - 4 / 3) < 0.01 ? '4:3' : `比 ${ratio.toFixed(2)}`}）`);
    for (const s of perSlide) if (s.fontsPt.length) console.log(`スライド ${s.slide} の文字の大きさ: ${s.fontsPt.join('・')}pt`);
    if (pdf) console.log(`描いた PDF: ${pdf.path}（${pdf.pages} ページ。${by === 'PowerPoint' ? 'PowerPoint で描いた' : 'LibreOffice で描いたので、PowerPoint とはフォントと折り返しが少し違うことがある'}）`);
    if (sheet) console.log(`全部のスライドを並べた一覧の画像: ${sheet}（まずこれを1回開いて見る）`);
    if (pngs.length) console.log(`${sheet ? '1枚ずつの画像（一覧で気になったスライドだけ開く）' : '描いた画像'}: ${pngs.length === 1 ? pngs[0] : `${pngs[0]} から ${basename(pngs[pngs.length - 1])} まで ${pngs.length} 枚`}`);
    else if (pdf) console.log('スライドごとの PNG は作っていない（pdftoppm が無い）。PDF を開いて見る。');
    if (note) console.log(note);
    if (groupedSlides.length && measuredBy !== 'PowerPoint') console.log(`スライド ${groupedSlides.join('・')} には、まとめた図形（グループ）がある。グループの中の図形は、位置とあふれを見ていない。画像で見る。`);
    if (pdf && !sheet && pngs.length > 1) console.log('一覧の画像は作っていない（Chrome・Edge・Chromium が見つからない）。1枚ずつの画像を開いて見る。');
    if (issues.length) { console.log(`指摘 ${issues.length} 件:`); for (const i of issues) console.log(`- ${i.msg}`); }
    else console.log(`指摘なし（スライドの外に出た部品・${lines ? '文字どうしの重なり・箱からあふれた文字' : '入りきらない文字'}・小さい文字は見つからなかった）。`);
    if (lines) console.log(`文字の重なり・あふれ・スライドの外は、描いた結果の文字の位置（${measuredBy === 'PowerPoint' ? 'PowerPoint が返した値' : 'PDF の文字の位置'}）から測った。図形や線が文字にかかる所、語の途中の折り返し、余白は測れないので、${sheet ? '一覧の画像' : '描いた画像（か PDF）'}で見る。`);
    else console.log(`文字の収まりは文字数からの見積もりで、重なりは測っていない${pdf ? '（PDF の文字の位置を読む pdftotext が無い）' : ''}。${sheet ? '一覧の画像' : pdf ? '描いた画像（か PDF）' : '描ける PC で描いて、画像'}を開いて、重なり・あふれ・語の途中の折り返し・余白を目で見る。`);
  }
  process.exit(issues.length ? 1 : 0);
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const fail = (msg) => { console.error(msg); process.exit(2); };
  if (!o.file) fail('使い方: node layout-check.mjs <図.svg | 図.html | 図.mmd | 文書.md | スライド.pptx> [--width 1280] [--height 720] [--out 図.png] [--min-font 12] [--pdf 図.pdf] [--mermaid <mermaid.min.js>] [--json]');
  const file = resolve(o.file);
  if (!existsSync(file)) fail(`ファイルが無い: ${file}`);
  if (extname(file).toLowerCase() === '.pptx') return checkPptx(file, o, fail);
  if (typeof WebSocket === 'undefined') fail('Node 22 以上が要る（WebSocket を使う）。');
  const browser = findBrowser();
  if (!browser) fail('Chrome・Edge・Chromium が見つからない。場所を環境変数 LAYOUT_CHECK_BROWSER に入れるか、ブラウザを入れる。');
  const ext = extname(file).toLowerCase();
  const kind = ext === '.svg' ? 'svg' : ['.mmd', '.mermaid', '.md', '.markdown'].includes(ext) ? 'mermaid' : 'html';
  const base = file.replace(/\.[^.]+$/, '');
  // 確かめ用の PNG は、図の横に残さないよう一時フォルダーに出す（渡す PNG を作るときは --out）
  // 同じ名前の図を別のフォルダーで同時に描いても混ざらないよう、元の場所ごとにフォルダーを分ける
  const outDir = join(tmpdir(), 'layout-check', createHash('sha1').update(file).digest('hex').slice(0, 8));
  mkdirSync(outDir, { recursive: true });
  const defaultOut = join(outDir, basename(base) + '.png');

  // 描くもの（1ファイルに Mermaid のブロックがいくつもあれば、その数だけ）
  const jobs = [];
  const temps = [];
  const tempHtml = (html) => { const w = join(dirname(file), `.layout-check-${process.pid}-${temps.length}.html`); writeFileSync(w, html); temps.push(w); return pathToFileURL(w).href; };
  if (kind === 'svg') {
    // SVG は HTML に入れて描く（文字の位置を DOM で測るため）。大きさは width・height、無ければ viewBox
    const svg = readFileSync(file, 'utf8').replace(/<\?xml[^>]*\?>/, '').replace(/<!DOCTYPE[^>]*>/i, '');
    const tag = svg.match(/<svg[^>]*>/)?.[0] || '';
    const vb = tag.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/);
    const num = (name) => { const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*["']([\\d.]+)(px)?["']`)); return m ? Number(m[1]) : null; };
    const width = Math.ceil(num('width') || (vb ? Number(vb[1]) : o.width));
    const height = Math.ceil(num('height') || (vb ? Number(vb[2]) : o.height));
    jobs.push({ name: file, width, height, out: resolve(o.out || defaultOut), url: tempHtml(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}body>svg{display:block;width:${width}px;height:${height}px}</style></head><body>${svg}</body></html>`) });
  } else if (kind === 'mermaid') {
    const src = readFileSync(file, 'utf8');
    const blocks = ['.md', '.markdown'].includes(ext) ? [...src.matchAll(/```mermaid[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1]) : [src];
    if (!blocks.length) fail(`Mermaid のブロック（\`\`\`mermaid）が無い: ${file}`);
    const lib = findMermaid(o, file);
    blocks.forEach((code, i) => {
      const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}#out{padding:16px}</style></head><body><div id="out"></div><pre id="src" style="display:none">${esc(code)}</pre><script src="${lib}"></script></body></html>`;
      jobs.push({
        name: blocks.length > 1 || ext === '.md' ? `${file} の Mermaid のブロック ${i + 1}` : file, mermaid: true, lib, width: o.width, height: o.height,
        out: resolve(o.out && blocks.length === 1 ? o.out : join(outDir, `${basename(base)}-mermaid-${i + 1}.png`)), url: tempHtml(html),
      });
    });
  } else jobs.push({ name: file, width: o.width, height: o.height, out: resolve(o.out || defaultOut), url: pathToFileURL(file).href, html: true });

  const profile = mkdtempSync(join(tmpdir(), 'layout-check-'));
  const args = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'];
  if (platform() === 'linux' && (process.getuid?.() === 0 || process.env.LAYOUT_CHECK_NO_SANDBOX)) args.unshift('--no-sandbox');
  const child = spawn(browser, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  const cleanup = () => {
    for (const t of temps) rmSync(t, { force: true });
    try { child.kill(); } catch {}
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
  };
  try {
    // ブラウザが開けた接続先を待つ
    let wsUrl = null;
    for (let i = 0; i < 150 && !wsUrl; i++) {
      const m = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) wsUrl = m[1]; else await new Promise((r) => setTimeout(r, 100));
    }
    if (!wsUrl) throw new Error(`ブラウザを起動できなかった: ${browser}\n${stderr.slice(0, 400)}${/sandbox/i.test(stderr) ? '\nLinux でサンドボックスを使えない環境（コンテナ・CI）では、環境変数 LAYOUT_CHECK_NO_SANDBOX=1 を付けて走らせる。' : ''}`);
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ブラウザにつなげなかった')); });
    let seq = 0;
    const pending = new Map();
    const waiters = [];
    ws.onmessage = (ev) => {
      const d = JSON.parse(ev.data);
      if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
      else if (d.method) for (const w of waiters.filter((w) => w.method === d.method && w.sessionId === d.sessionId)) { waiters.splice(waiters.indexOf(w), 1); w.res(d.params); }
    };
    const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params, sessionId })); });
    const once = (method, sessionId, ms = 30000) => new Promise((res, rej) => { waiters.push({ method, sessionId, res }); setTimeout(() => rej(new Error(`${method} を待って時間切れ`)), ms); });

    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const S = (m, p) => send(m, p, sessionId);
    await S('Page.enable');
    await S('Runtime.enable');

    const reports = [];
    for (const job of jobs) {
      await S('Emulation.setDeviceMetricsOverride', { width: job.width, height: job.height, deviceScaleFactor: 1, mobile: false });
      const loaded = once('Page.loadEventFired', sessionId);
      await S('Page.navigate', { url: job.url });
      await loaded;
      const report = { file: job.name, png: null, viewport: [job.width, job.height], issues: [] };
      reports.push(report);
      if (job.mermaid) {
        const expr = `(async () => {
          if (typeof mermaid === 'undefined') return { ok: false, noLib: true };
          mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
          try { const { svg } = await mermaid.render('layoutCheckGraph', document.getElementById('src').textContent); document.getElementById('out').innerHTML = svg; return { ok: true }; }
          catch (e) { return { ok: false, error: String(e && e.message || e) }; }
        })()`;
        const r = (await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
        if (r.noLib) throw new Error(`mermaid.js を読めなかった: ${job.lib}\n手元に置いて場所を渡す: npm install --no-save mermaid のあと --mermaid node_modules/mermaid/dist/mermaid.min.js`);
        if (!r.ok) { report.issues.push({ kind: 'syntax', msg: `Mermaid の構文エラーで描けない：${r.error.replace(/\s*\n\s*/g, ' / ').slice(0, 500)}` }); continue; }
      }
      await S('Runtime.evaluate', { expression: 'document.fonts && document.fonts.ready ? document.fonts.ready.then(() => 1) : 1', awaitPromise: true });
      await new Promise((r) => setTimeout(r, 200));
      const ev = await S('Runtime.evaluate', { expression: `(${probe.toString()})(${JSON.stringify({ minFont: o.minFont, pad: o.pad, noLine: !!job.mermaid })})`, returnByValue: true });
      if (ev.exceptionDetails) throw new Error('検査の途中で失敗: ' + (ev.exceptionDetails.exception?.description || ev.exceptionDetails.text));
      const res = ev.result.value;
      let clip = { x: 0, y: 0, width: res.width, height: res.height, scale: 1 };
      if (job.mermaid) {
        const b = (await S('Runtime.evaluate', { expression: '(() => { const g = document.querySelector("#out svg"); const r = g.getBoundingClientRect(); const vb = g.viewBox && g.viewBox.baseVal; return { x: Math.floor(r.left), y: Math.floor(r.top), w: Math.ceil(r.width), h: Math.ceil(r.height), natural: vb ? Math.round(vb.width) : Math.ceil(r.width) }; })()', returnByValue: true })).result.value;
        clip = { x: Math.max(0, b.x - 8), y: Math.max(0, b.y - 8), width: b.w + 16, height: b.h + 16, scale: 1 };
        if (b.natural > job.width - 32) report.issues.push({ kind: 'wide', msg: `図の元の幅 ${b.natural}px が、見る幅 ${job.width}px に入らず、縮んで文字が小さくなる。向きを変える（LR ↔ TD）、ラベルを短くする、図を分ける、のどれかにする。` });
      }
      const shot = await S('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip });
      writeFileSync(job.out, Buffer.from(shot.data, 'base64'));
      Object.assign(report, { png: job.out, width: clip.width, height: clip.height, texts: res.texts, fonts: res.fonts });
      report.issues.push(...res.issues);
      if (o.pdf && job.html) {
        const p = await S('Page.printToPDF', { preferCSSPageSize: true, printBackground: true });
        const buf = Buffer.from(p.data, 'base64');
        writeFileSync(resolve(o.pdf), buf);
        const s = buf.toString('latin1');
        const pages = (s.match(/\/Type\s*\/Page\b(?!s)/g) || []).length;
        const mb = s.match(/\/MediaBox\s*\[\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)/);
        report.pdf = { path: resolve(o.pdf), pages, pageSizePt: mb ? [Number(mb[1]), Number(mb[2])] : null };
      }
    }
    const total = reports.reduce((n, r) => n + r.issues.length, 0);
    if (o.json) console.log(JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 1));
    else {
      for (const r of reports) {
        if (reports.length > 1 || r.file !== file) console.log(`## ${r.file}`);
        if (r.png) console.log(`描いた画像: ${r.png}（${r.width}×${r.height}、文字 ${r.texts} か所、フォント: ${r.fonts.join('、') || '不明'}）`);
        if (r.png && kind === 'html' && r.height > o.height + 1 && r.height < o.height * 1.9) console.log(`注意: 中身の高さ ${r.height}px が、指定の高さ ${o.height}px を超えている（1枚のスライドなら、はみ出している）。`);
        if (r.pdf) console.log(`PDF: ${r.pdf.path}（${r.pdf.pages} ページ${r.pdf.pageSizePt ? `、用紙 ${r.pdf.pageSizePt[0]}×${r.pdf.pageSizePt[1]}pt` : ''}）`);
        if (r.issues.length) { console.log(`指摘 ${r.issues.length} 件:`); for (const i of r.issues) console.log(`- ${i.msg}`); }
        else console.log('指摘なし（重なり・はみ出し・線が文字を通る所は見つからなかった）。');
      }
      console.log('機械で分かるのはここまで。画像を開いて、線のからまり・余白の偏り・伝わるかを目で見る。');
    }
    ws.close();
    cleanup();
    process.exit(total ? 1 : 0);
  } catch (e) {
    cleanup();
    fail(`走らせられなかった: ${e.message}`);
  }
}
main();
