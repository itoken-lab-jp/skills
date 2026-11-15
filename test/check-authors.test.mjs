// tools/check-authors.mjs の試験。決めていないメールのコミットを止め、決めたメールなら通すか。
//   node --test test/check-authors.test.mjs
// 原本（tools/export-public/repo/tools/）と、公開リポジトリ（tools/）のどちらでも走る。
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const script = ['tools/export-public/repo/tools/check-authors.mjs', 'tools/check-authors.mjs']
  .map((p) => path.join(repoRoot, p)).find((p) => fs.existsSync(p));
const { run } = await import(pathToFileURL(script).href);

const temps = [];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function fakeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-authors-'));
  temps.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'commit.gpgsign', 'false');
  return dir;
}
function commit(dir, name, email) {
  git(dir, '-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-q', '--allow-empty', '-m', `by ${email}`);
}
function call(args) {
  const out = [];
  const errs = [];
  const code = run(args, { log: (s) => out.push(s), err: (s) => errs.push(s) });
  return { code, out: out.join('\n'), err: errs.join('\n') };
}

describe('作者のメール', () => {
  it('決めたメールだけなら通す', () => {
    const dir = fakeRepo();
    commit(dir, 'Claude', 'noreply@anthropic.com');
    commit(dir, 'itoken33', '169575491+itoken33@users.noreply.github.com');
    const r = call(['--repo', dir]);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /2 件/);
  });

  it('ID の無い noreply（他人のアカウントに結びつく）を止める', () => {
    const dir = fakeRepo();
    commit(dir, 'Claude', 'noreply@anthropic.com');
    commit(dir, 'itoken33', 'noreply@users.noreply.github.com');
    const r = call(['--repo', dir]);
    assert.equal(r.code, 1);
    assert.match(r.err, /author=noreply@users\.noreply\.github\.com/);
    assert.match(r.err, /committer=noreply@users\.noreply\.github\.com/);
  });

  it('私用のメールも止める', () => {
    const dir = fakeRepo();
    commit(dir, 'someone', 'someone@example.com');
    assert.equal(call(['--repo', dir]).code, 1);
  });

  it('origin/main があれば、まだ push していないコミットだけを見る', () => {
    const remote = fakeRepo();
    commit(remote, 'x', 'old@example.com'); // 公開済みの古いコミットは問わない
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-authors-clone-'));
    temps.push(dir);
    execFileSync('git', ['clone', '-q', remote, dir]);
    git(dir, 'config', 'commit.gpgsign', 'false');
    commit(dir, 'Claude', 'noreply@anthropic.com');
    assert.equal(call(['--repo', dir]).code, 0);
    commit(dir, 'x', 'new@example.com');
    const r = call(['--repo', dir]);
    assert.equal(r.code, 1);
    assert.doesNotMatch(r.err, /old@example\.com/);
  });

  it('--range で範囲を指定でき、git の失敗と使い方の誤りは 2 で返す', () => {
    const dir = fakeRepo();
    commit(dir, 'x', 'bad@example.com');
    commit(dir, 'Claude', 'noreply@anthropic.com');
    assert.equal(call(['--repo', dir, '--range', 'HEAD~1..HEAD']).code, 0);
    assert.equal(call(['--repo', dir, '--range', 'nope..HEAD']).code, 2);
    assert.equal(call(['--repo', dir, '--what']).code, 2);
    assert.equal(call(['--repo', dir, '--range']).code, 2);
  });
});
