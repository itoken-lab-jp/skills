// tools/release-notes.mjs の試験。次のタグの名前、前の版からの変更の集め方、--strict で説明の無い変更を止めるか。
//   node --test test/release-notes.test.mjs
// 原本（tools/export-public/repo/tools/）と、公開リポジトリ（tools/）のどちらでも走る。
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const script = ['tools/export-public/repo/tools/release-notes.mjs', 'tools/release-notes.mjs']
  .map((p) => path.join(repoRoot, p)).find((p) => fs.existsSync(p));
const { run, changelogOf } = await import(pathToFileURL(script).href);

const temps = [];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function fakeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-notes-'));
  temps.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'config', 'tag.gpgsign', 'false');
  return dir;
}
function write(dir, files) {
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    if (body === null) { fs.rmSync(abs, { recursive: true, force: true }); continue; }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
}
function commit(dir, files, tag) {
  write(dir, files);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'c');
  if (tag) git(dir, 'tag', '-a', tag, '-m', tag);
}
const doc = (...entries) => `# x\n\n## 入れ方\n\nnpx\n\n## 変更履歴\n\n${entries.map((e) => `- ${e}`).join('\n')}\n`;

function call(args) {
  const out = [];
  const errs = [];
  const code = run(args, { log: (s) => out.push(s), err: (s) => errs.push(s) });
  return { code, out: out.join('\n'), err: errs.join('\n') };
}

describe('次のタグ', () => {
  it('版が無ければ日付そのまま、同じ日にあれば .2、.3 と進む', () => {
    const dir = fakeRepo();
    commit(dir, { 'skills/a/SKILL.md': 'a' });
    assert.equal(call(['--repo', dir, '--next', '--date', '2026-11-14']).out, 'v2026.11.14');
    git(dir, 'tag', 'v2026.11.14');
    assert.equal(call(['--repo', dir, '--next', '--date', '2026-11-14']).out, 'v2026.11.14.2');
    git(dir, 'tag', 'v2026.11.14.2');
    assert.equal(call(['--repo', dir, '--next', '--date', '2026-11-14']).out, 'v2026.11.14.3');
    assert.equal(call(['--repo', dir, '--next', '--date', '2026-11-15']).out, 'v2026.11.15');
  });
  it('日付の形が違えば使い方の誤り', () => {
    const dir = fakeRepo();
    commit(dir, {});
    assert.equal(call(['--repo', dir, '--next', '--date', '2026/11/14']).code, 2);
  });
});

describe('変更の一覧', () => {
  it('前の版が無ければ最初の版として、全部の Skill を出す', () => {
    const dir = fakeRepo();
    commit(dir, { 'skills/b/SKILL.md': 'b', 'skills/a/SKILL.md': 'a', 'skills/a/scripts/x.sh': 'x' });
    const r = call(['--repo', dir]);
    assert.equal(r.code, 0);
    assert.match(r.out, /最初の版です。次の 2 本/);
    assert.match(r.out, /\[a\]\(https:\/\/github\.com\/itoken-lab-jp\/skills\/blob\/main\/docs\/a\.md\)・\[b\]/);
  });

  it('足した・変えた・外した Skill と、移行が要る変更を分けて出す。移行は先頭', () => {
    const dir = fakeRepo();
    commit(dir, {
      'skills/a/SKILL.md': 'a1', 'skills/b/SKILL.md': 'b1', 'skills/gone/SKILL.md': 'g',
      'docs/a.md': doc('2026-11-01：最初'), 'docs/b.md': doc(),
    }, 'v2026.11.01');
    commit(dir, {
      'skills/a/SKILL.md': 'a2', 'docs/a.md': doc('2026-11-01：最初', '2026-11-14：手順を短くした'),
      'skills/b/SKILL.md': 'b2', 'docs/b.md': doc('2026-11-14：【移行が要る】設定を ~/.config へ移す'),
      'skills/gone': null, 'skills/new/SKILL.md': 'n',
    }, 'v2026.11.14');
    const r = call(['--repo', dir, '--to', 'v2026.11.14', '--strict']);
    assert.equal(r.code, 0, r.err);
    const i = (s) => r.out.indexOf(s);
    assert.ok(i('## 移行が要る変更') >= 0 && i('## 移行が要る変更') < i('## 足した Skill'));
    assert.ok(i('## 足した Skill') < i('## 変えた Skill') && i('## 変えた Skill') < i('## 外した Skill'));
    assert.match(r.out, /\[b\]\(https:\/\/github\.com\/itoken-lab-jp\/skills\/blob\/v2026\.11\.14\/docs\/b\.md\)：設定を ~\/\.config へ移す/);
    assert.match(r.out, /\[a\]\([^)]*\)：手順を短くした/);
    assert.doesNotMatch(r.out, /最初$/m, '前の版にあった行は出さない');
    assert.match(r.out, /- \[new\]/);
    assert.match(r.out, /- gone/);
    assert.match(r.out, /itoken-lab-jp\/skills@v2026\.11\.14 -g/);
  });

  it('--to が版のタグなら、その前の版から比べる（同じコミットに付いた別のタグは飛ばす）', () => {
    const dir = fakeRepo();
    commit(dir, { 'skills/a/SKILL.md': 'a1', 'docs/a.md': doc() }, 'v2026.11.01');
    commit(dir, { 'skills/a/SKILL.md': 'a2', 'docs/a.md': doc('2026-11-14：二つ目') }, 'v2026.11.14');
    git(dir, 'tag', 'v2026.11.14.2');
    const r = call(['--repo', dir, '--to', 'v2026.11.14.2']);
    assert.match(r.out, /：二つ目/);
  });

  it('中身が変わったのに変更履歴が増えていなければ、--strict で 1。付けなければ一覧に出すだけ', () => {
    const dir = fakeRepo();
    commit(dir, { 'skills/a/SKILL.md': 'a1', 'docs/a.md': doc() }, 'v2026.11.01');
    commit(dir, { 'skills/a/SKILL.md': 'a2' });
    const loose = call(['--repo', dir]);
    assert.equal(loose.code, 0);
    assert.match(loose.out, /## 説明の無い変更\n\n- \[a\]/);
    const strict = call(['--repo', dir, '--strict']);
    assert.equal(strict.code, 1);
    assert.match(strict.err, /a（docs/);
  });

  it('--strict は、skills・docs に未コミットの変更があれば走らない（書き出したままでは古い HEAD と比べてしまう）', () => {
    const dir = fakeRepo();
    commit(dir, { 'skills/a/SKILL.md': 'a1', 'docs/a.md': doc() }, 'v2026.11.01');
    write(dir, { 'skills/a/SKILL.md': 'a2' });
    const r = call(['--repo', dir, '--strict']);
    assert.equal(r.code, 2);
    assert.match(r.err, /コミットしてから/);
  });

  it('Skill の中身が変わっていなければ、そう書く', () => {
    const dir = fakeRepo();
    commit(dir, { 'skills/a/SKILL.md': 'a1', 'README.md': '1' }, 'v2026.11.01');
    commit(dir, { 'README.md': '2' });
    const r = call(['--repo', dir, '--strict']);
    assert.equal(r.code, 0);
    assert.match(r.out, /Skill の中身の変更はありません/);
  });

  it('無い ref と知らない引数は使い方の誤り', () => {
    const dir = fakeRepo();
    commit(dir, {});
    assert.equal(call(['--repo', dir, '--to', 'v9999.01.01']).code, 2);
    assert.equal(call(['--repo', dir, '--from', 'nope']).code, 2);
    assert.equal(call(['--repo', dir, '--from']).code, 2);
    assert.equal(call(['--repo', dir, '--bogus']).code, 2);
    assert.equal(call(['--next', '--repo']).code, 2);
  });
});

describe('変更履歴の読み方', () => {
  it('「## 変更履歴」の下の「- 」の行だけを、次の見出しまで読む', () => {
    const text = '# t\n\n- 前の節\n\n## 変更履歴\n\n- 2026-11-14：一つ目\n  続き\n- 2026-11-15：二つ目\n\n### 小見出し\n- 三つ目\n\n## 次\n- 外\n';
    assert.deepEqual(changelogOf(text), ['2026-11-14：一つ目', '2026-11-15：二つ目', '三つ目']);
    assert.deepEqual(changelogOf('# t\n- x\n'), []);
    assert.deepEqual(changelogOf(null), []);
  });
});
