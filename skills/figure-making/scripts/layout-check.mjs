#!/usr/bin/env node
// SVG・HTML の図やスライド、Mermaid の図をブラウザ（Chrome・Edge・Chromium）で描き、PNG にして、
// 文字の重なり・はみ出し・線が文字を通る所・小さい文字を数えて出す。Mermaid は構文エラーも出す。
// 使い方: node layout-check.mjs <図.svg | 図.html | 図.mmd | 文書.md> [--width 1280] [--height 720] [--out 図.png] [--min-font 12] [--pdf 図.pdf] [--mermaid <mermaid.min.js の場所か URL>] [--json]
//   確かめ用の PNG は一時フォルダーに出し、場所を出力に書く（渡す PNG を作るときは --out）。
//   .md は、中の ```mermaid のブロックを1つずつ描く（PNG は <名前>-mermaid-1.png …）。
// 依存: Node 22 以上と、Chrome・Edge・Chromium のどれか（npm の依存は無い）。ブラウザの場所は LAYOUT_CHECK_BROWSER でも指定できる。
//   Mermaid を描くときだけ mermaid.js が要る。--mermaid か LAYOUT_CHECK_MERMAID、近くの node_modules/mermaid、の順に探し、
//   無ければ CDN（cdn.jsdelivr.net）から読む（図の中身は外に送らない。読むのはライブラリだけ）。
//   Linux のコンテナや CI でブラウザがサンドボックスを使えずに起動しないときは、LAYOUT_CHECK_NO_SANDBOX=1 を付ける（root では自動で付く）。
// 終了コード: 0 = 指摘なし、1 = 指摘あり（構文エラーを含む）、2 = 走らせられなかった（ブラウザが無い、ファイルが読めない）。
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { join, resolve, dirname, extname, basename } from 'node:path';
import { tmpdir, homedir, platform } from 'node:os';
import { pathToFileURL } from 'node:url';
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
  const o = { width: 1280, height: 720, minFont: 12, pad: 0, json: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a === '--width') o.width = Number(argv[++i]);
    else if (a === '--height') o.height = Number(argv[++i]);
    else if (a === '--min-font') o.minFont = Number(argv[++i]);
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

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const fail = (msg) => { console.error(msg); process.exit(2); };
  if (!o.file) fail('使い方: node layout-check.mjs <図.svg | 図.html | 図.mmd | 文書.md> [--width 1280] [--height 720] [--out 図.png] [--min-font 12] [--pdf 図.pdf] [--mermaid <mermaid.min.js>] [--json]');
  const file = resolve(o.file);
  if (!existsSync(file)) fail(`ファイルが無い: ${file}`);
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
