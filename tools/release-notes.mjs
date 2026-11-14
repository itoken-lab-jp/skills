#!/usr/bin/env node
// 版（タグ）の名前と、GitHub の Release に載せる変更の一覧を作る。
// 版はリポジトリ全体に1つの日付のタグ（v2026.11.14。同じ日の2つ目からは v2026.11.14.2）。
// 変更の説明の原本は docs/<Skill>.md の末尾の「## 変更履歴」で、1行に1つ「- 2026-11-14：何が変わったか」と書く。
// 入れ直しや設定の移しが要る変更は、本文を「【移行が要る】」で始める。Release の先頭に出す。
// 前の版から増えた行を新しい変更として出すので、過去の行は直さない（直した行は新しい変更として出る）。
//
//   node tools/release-notes.mjs --next                  次に打つタグの名前を出す（日本時間の今日）
//   node tools/release-notes.mjs [--to <ref>] [--from <タグ>] [--strict]
//                                                        --from から --to（既定 HEAD）までの変更を Markdown で出す。
//                                                        --from の既定は --to より前の最新の v タグ。無ければ最初の版として出す
//                                                        --strict：中身が変わったのに変更履歴の行が増えていない Skill があれば終了コード 1。
//                                                        コミットした中身だけを見るので、skills・docs に未コミットの変更があれば使い方の誤り
//   --repo <フォルダー>                                  リポジトリの場所（既定は今のフォルダー。試験で使う）
//   --date <YYYY-MM-DD>                                  --next の日付（既定は日本時間の今日。試験で使う）
// 終了コード：0 問題なし、1 --strict で説明の無い変更があった、2 使い方の誤り・git の失敗。

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_URL = 'itoken-lab-jp/skills';
const TAG = /^v(\d{4})\.(\d{2})\.(\d{2})(?:\.(\d+))?$/;
const MIGRATION = '【移行が要る】';

const git = (repo, args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const tryGit = (repo, args) => { try { return git(repo, args); } catch { return null; } };

// タグを古い順に並べる（日付、同じ日は番号。番号なしは1つ目）
const tagKey = (t) => { const m = t.match(TAG); return [m[1], m[2], m[3], String(m[4] ?? 1).padStart(4, '0')].join('.'); };
export function versionTags(repo) {
  return git(repo, ['tag', '--list', 'v*']).split('\n').filter((t) => TAG.test(t)).sort((a, b) => tagKey(a).localeCompare(tagKey(b)));
}

export function today() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
}

export function nextTag(repo, date = today()) {
  const base = `v${date.replaceAll('-', '.')}`;
  const tags = new Set(versionTags(repo));
  if (!tags.has(base)) return base;
  let n = 2;
  while (tags.has(`${base}.${n}`)) n++;
  return `${base}.${n}`;
}

// ref の時点の Skill の名前（skills/<名前>/SKILL.md があるもの）
function skillsAt(repo, ref) {
  const out = tryGit(repo, ['ls-tree', '--name-only', '-r', ref, '--', 'skills']) ?? '';
  return [...new Set(out.split('\n').map((f) => f.match(/^skills\/([^/]+)\/SKILL\.md$/)?.[1]).filter(Boolean))].sort();
}

// docs/<名前>.md の「## 変更履歴」の行（「- 」で始まるもの）
export function changelogOf(text) {
  if (text == null) return [];
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+変更履歴\s*$/.test(l));
  if (start < 0) return [];
  const out = [];
  for (const l of lines.slice(start + 1)) {
    if (/^#{1,2}\s/.test(l)) break;
    if (/^-\s+\S/.test(l)) out.push(l.replace(/^-\s+/, '').trim());
  }
  return out;
}
const docAt = (repo, ref, name) => tryGit(repo, ['show', `${ref}:docs/${name}.md`]);

export function collect(repo, from, to) {
  const now = skillsAt(repo, to);
  if (!from) return { first: true, added: now, removed: [], changed: [], undocumented: [] };
  const before = skillsAt(repo, from);
  const added = now.filter((n) => !before.includes(n));
  const removed = before.filter((n) => !now.includes(n));
  const changed = [];
  const undocumented = [];
  for (const name of now.filter((n) => before.includes(n))) {
    const diff = git(repo, ['diff', '--name-only', from, to, '--', `skills/${name}`]).trim();
    const old = new Set(changelogOf(docAt(repo, from, name)));
    const entries = changelogOf(docAt(repo, to, name)).filter((e) => !old.has(e));
    if (entries.length) changed.push({ name, entries });
    else if (diff) undocumented.push(name);
  }
  return { first: false, added, removed, changed, undocumented };
}

// 「2026-11-14：本文」の日付を外す（Release は版ごとなので日付は要らない）
const body = (e) => e.replace(/^\d{4}-\d{2}-\d{2}\s*[：:]\s*/, '');
// Release の本文では相対のリンクが効かないので、版（無ければ main）の docs を指す
export function render(c, tag) {
  const link = (name) => `[${name}](https://github.com/${REPO_URL}/blob/${tag ?? 'main'}/docs/${name}.md)`;
  const out = [];
  if (c.first) {
    out.push(`最初の版です。次の ${c.added.length} 本の Skill が入っています。`, '', c.added.map(link).join('・'));
  } else {
    const migrations = c.changed.flatMap(({ name, entries }) => entries.filter((e) => body(e).startsWith(MIGRATION)).map((e) => `- ${link(name)}：${body(e).slice(MIGRATION.length).trim()}`));
    if (migrations.length) out.push('## 移行が要る変更', '', 'この版に上げるときは、入れ直しのあとで次のことをしてください。', '', ...migrations, '');
    if (c.added.length) out.push('## 足した Skill', '', ...c.added.map((n) => `- ${link(n)}`), '');
    const plain = c.changed.flatMap(({ name, entries }) => entries.filter((e) => !body(e).startsWith(MIGRATION)).map((e) => `- ${link(name)}：${body(e)}`));
    if (plain.length) out.push('## 変えた Skill', '', ...plain, '');
    if (c.undocumented.length) out.push('## 説明の無い変更', '', ...c.undocumented.map((n) => `- ${link(n)}`), '');
    if (c.removed.length) out.push('## 外した Skill', '', ...c.removed.map((n) => `- ${n}`), '');
    if (!out.length) out.push('Skill の中身の変更はありません（README・docs などの変更だけです）。', '');
  }
  if (out.at(-1) !== '') out.push('');
  out.push('## この版に固定して入れる', '', '```', `npx skills add ${REPO_URL}@${tag ?? '<この版のタグ>'} -g --skill <名前>`, '```', '',
    '版を付けずに入れたものは、`npx skills update -g`（リポジトリごとに入れたものは `-p`）で、その時点の main の最新に上がります。版を付けて入れたものは、その版のまま上がりません。別の版にするときは、版を変えて入れ直します。');
  return out.join('\n') + '\n';
}

export function run(argv, { log = console.log, err = console.error } = {}) {
  let repo = process.cwd();
  let to = 'HEAD';
  let from;
  let next = false;
  let strict = false;
  let date;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--next') next = true;
    else if (a === '--strict') strict = true;
    else if (a === '--to') to = argv[++i] ?? '';
    else if (a === '--from') from = argv[++i] ?? '';
    else if (a === '--repo') { const v = argv[++i]; if (!v) { err('--repo には値を付ける'); return 2; } repo = path.resolve(v); }
    else if (a === '--date') date = argv[++i] ?? '';
    else { err(`知らない引数：${a}`); return 2; }
  }
  if (!to || from === '' || date === '') { err('--to・--from・--date には値を付ける'); return 2; }
  try {
    if (next) {
      if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) { err('--date は YYYY-MM-DD で書く'); return 2; }
      log(nextTag(repo, date));
      return 0;
    }
    if (tryGit(repo, ['rev-parse', '--verify', '--quiet', `${to}^{commit}`]) == null) { err(`--to の ${to} が無い`); return 2; }
    if (from === undefined) {
      // --to より前の最新の版（--to 自身が版のタグなら、それより前）
      const reachable = new Set(git(repo, ['tag', '--merged', to, '--list', 'v*']).split('\n').filter(Boolean));
      const toSha = git(repo, ['rev-parse', `${to}^{commit}`]).trim();
      const prev = versionTags(repo).filter((t) => reachable.has(t) && t !== to && git(repo, ['rev-parse', `${t}^{commit}`]).trim() !== toSha);
      from = prev.at(-1);
    } else if (tryGit(repo, ['rev-parse', '--verify', '--quiet', `${from}^{commit}`]) == null) { err(`--from の ${from} が無い`); return 2; }
    if (strict && to === 'HEAD' && git(repo, ['status', '--porcelain', '--', 'skills', 'docs']).trim()) {
      err('skills・docs に未コミットの変更がある。--strict はコミットした中身だけを見るので、コミットしてから走らせる');
      return 2;
    }
    const c = collect(repo, from, to);
    const tag = TAG.test(to) ? to : undefined;
    log(render(c, tag).trimEnd());
    if (strict && c.undocumented.length) {
      err(`変更履歴の行が増えていない Skill：${c.undocumented.join('、')}（docs/<名前>.md の「## 変更履歴」に1行足す）`);
      return 1;
    }
    return 0;
  } catch (e) {
    err(`git の失敗：${e.stderr?.toString().trim() || e.message}`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = run(process.argv.slice(2));
}
