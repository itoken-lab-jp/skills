#!/usr/bin/env node
// Skill の形の検査。Agent Skills の仕様（agentskills.io/specification）と、どのツールでも読める形に合わせる。
//   node check-skills.mjs <フォルダー> [<フォルダー>...] [--max-chars 6500] [--max-lines 500] [--json]
// フォルダーは、Skill を並べたフォルダー（中に <名前>/SKILL.md）か、Skill 1つのフォルダー（中に SKILL.md）。
// 見つけた問題を「パス：中身」で1行ずつ出し、1つでもあれば終了コード 1。依存は Node（18 以上）だけ。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULTS = { maxChars: 6500, maxLines: 500, maxDescription: 1024 };
const KEYS = ['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'];

const read = (p) => fs.readFileSync(p, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
// シンボリックリンクはリンクの先で判定する（skills.sh などはエージェントごとの置き場をリンクにする）
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const mdFiles = (dir) => fs.readdirSync(dir).flatMap((name) => {
  const p = path.join(dir, name);
  if (isDir(p)) return name === 'node_modules' || name.startsWith('.') ? [] : mdFiles(p);
  return name.endsWith('.md') ? [p] : [];
});
// コードブロックとインラインのコードの中のリンクの形は、リンクでないので外す
const stripCode = (t) => t.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '').replace(/`[^`\n]*`/g, '');
const linksOf = (t) => [...stripCode(t).matchAll(/\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g)].map((m) => m[1])
  .filter((x) => !/^([a-z][a-z0-9+.-]*:|#)/i.test(x));

// Skill 1つを調べ、問題の一覧（{ file, msg }）を返す。dir は Skill のフォルダー。
export function checkSkill(dir, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const name = path.basename(path.resolve(dir));
  const out = [];
  const add = (file, msg) => out.push({ file, msg });
  const file = path.join(dir, 'SKILL.md');
  if (!fs.existsSync(file)) { add(dir, 'SKILL.md が無い'); return out; }
  const body = read(file);
  const m = body.match(/^---\n([\s\S]*?)\n---(\n|$)/);
  if (!m) { add(file, '先頭に frontmatter（--- で囲んだ name と description）が無い'); return out; }

  const raw = {};
  let last = null;
  for (const line of m[1].split('\n')) {
    if (/^[^\s#]/.test(line)) {
      const i = line.indexOf(':');
      last = (i < 0 ? line : line.slice(0, i)).trim();
      raw[last] = i < 0 ? '' : line.slice(i + 1).trim();
    } else if (last === 'description' && line.trim() && !/^\s*#/.test(line)) {
      add(file, 'description に続きの行がある。1 行で書く（ツールによって読み方が違う）');
      last = null;
    }
  }
  const fm = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v.replace(/^(["'])(.*)\1$/, '$2')]));
  for (const k of Object.keys(fm)) if (!KEYS.includes(k)) add(file, `仕様に無い欄 ${k}（ツールによって無視される・読み込みを断られる）`);
  if (fm.name !== name) add(file, `name（${fm.name ?? '無し'}）がフォルダー名 ${name} と違う`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) add(file, 'name は小文字・数字・ハイフンだけ（先頭と末尾と連続のハイフンも不可）');
  if (name.length > 64) add(file, 'name は 64 字まで');
  if (/anthropic|claude/.test(name)) add(file, 'name に anthropic・claude を含めない（Claude に上げられない）');
  const desc = fm.description ?? '';
  if (!desc || /^[|>]/.test(desc)) add(file, 'description が無いか、1 行で書いていない');
  else {
    const n = [...desc].length;
    if (n > o.maxDescription) add(file, `description が ${n} 字。${o.maxDescription} 字までにする`);
    if (/[<>]/.test(desc)) add(file, 'description に < か > がある（Claude に上げられない）');
    if (!/^["']/.test(raw.description) && /:(\s|$)|\s#|^[[{&*!%@`]/.test(desc)) {
      add(file, 'description に半角の「: 」か「 #」がある（YAML として読めない・後ろが消える）。全角の「：」にするか、引用符で囲む');
    }
  }

  const lines = body.split('\n').length;
  if (lines > o.maxLines) add(file, `SKILL.md が ${lines} 行。${o.maxLines} 行までにし、細かい話は references/ に分ける`);
  const chars = [...body.slice(m[0].length)].length;
  if (chars > o.maxChars) add(file, `本文が ${chars} 字。${o.maxChars} 字までにし、細部・長い例・経緯は references/ に分ける`);
  const readme = fs.readdirSync(dir).find((f) => /^readme(\.|$)/i.test(f));
  if (readme) add(path.join(dir, readme), 'Skill のフォルダーに README を置かない。説明は SKILL.md か references/ に置く');

  // 相対リンクは Skill のフォルダーの中の実在するファイルを指す（Skill はフォルダーごと配られる）
  const fromSkill = new Set();
  const nested = [];
  for (const md of mdFiles(dir)) {
    for (const target of linksOf(read(md))) {
      let rel;
      try { rel = decodeURI(target.split('#')[0]); } catch { add(md, `リンク先 ${target} が読めない（% の後ろが16進の2桁でない）`); continue; }
      const to = path.resolve(path.dirname(md), rel);
      if (path.relative(path.resolve(dir), to).startsWith('..')) { add(md, `リンク先 ${target} が Skill のフォルダーの外（配った先では切れる）`); continue; }
      if (!fs.existsSync(to)) { add(md, `リンク先 ${target} が無い`); continue; }
      if (md === file) fromSkill.add(to);
      else if (to.endsWith('.md') && to !== path.resolve(file)) nested.push([md, target, to]);
    }
  }
  // references は SKILL.md から1段：SKILL.md が指さず、ほかの文書からしかたどれない文書は、読まれないことが多い
  for (const [md, target, to] of nested) {
    if (!fromSkill.has(to)) add(md, `${target} は SKILL.md から直接指されていない（references は SKILL.md から1段にする）`);
  }
  return out;
}

// フォルダーから Skill のフォルダーを集める（Skill 1つのフォルダーか、Skill を並べたフォルダー）
export function findSkills(dir) {
  if (fs.existsSync(path.join(dir, 'SKILL.md'))) return [dir];
  return fs.readdirSync(dir)
    .filter((name) => !name.startsWith('.'))
    .map((name) => path.join(dir, name))
    .filter(isDir)
    .filter((p) => fs.existsSync(path.join(p, 'SKILL.md')) || fs.readdirSync(p).some((f) => /\.md$/i.test(f)));
}

function main(argv) {
  const dirs = [];
  const opts = {};
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') json = true;
    else if (a === '--max-chars' || a === '--max-lines') {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v) || v <= 0) return usage(`${a} には正の整数を渡す`);
      opts[a === '--max-chars' ? 'maxChars' : 'maxLines'] = v;
    } else if (a === '-h' || a === '--help') return usage();
    else if (a.startsWith('-')) return usage(`知らないオプション ${a}`);
    else dirs.push(a);
  }
  if (!dirs.length) return usage('調べるフォルダーを渡す');
  const results = [];
  let count = 0;
  for (const d of dirs) {
    if (!fs.existsSync(d) || !fs.statSync(d).isDirectory()) return usage(`フォルダー ${d} が無い`);
    const skills = findSkills(d);
    if (!skills.length) return usage(`${d} に Skill（SKILL.md のあるフォルダー）が無い`);
    for (const s of skills) {
      count++;
      for (const p of checkSkill(s, opts)) results.push({ skill: path.basename(path.resolve(s)), file: path.relative(process.cwd(), p.file) || '.', msg: p.msg });
    }
  }
  if (json) console.log(JSON.stringify({ skills: count, problems: results }, null, 2));
  else {
    for (const r of results) console.log(`${r.file}：${r.msg}`);
    console.log(results.length ? `${count} 本のうち ${new Set(results.map((r) => r.skill)).size} 本に ${results.length} 件の問題` : `${count} 本、問題なし`);
  }
  return results.length ? 1 : 0;
}

function usage(err) {
  if (err) console.error(`エラー：${err}`);
  console.error('使い方：node check-skills.mjs <Skill を並べたフォルダー | Skill のフォルダー>... [--max-chars 6500] [--max-lines 500] [--json]');
  return 2;
}

// 直接起動されたときだけ走らせる。import.meta.url はリンクを解いた実体のパスなので、argv[1] も実体にして比べる（リンク越しの起動で黙って 0 で終わらないように）
const self = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
if (process.argv[1] && self(process.argv[1]) === self(fileURLToPath(import.meta.url))) process.exitCode = main(process.argv.slice(2));
