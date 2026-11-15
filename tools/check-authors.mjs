#!/usr/bin/env node
// 公開リポジトリのコミットの作者（author と committer）のメールが、決めたものだけかを確かめる。
// GitHub はコミットのメールで投稿者のアカウントを決める。推測で書いたメール（ID の無い noreply@users.noreply.github.com など）は、
// そのメールを登録している他人のアカウントに結びつき、Contributors に知らない人として出る（2026-11-14 の b6f49f5 で起きた）。
// 本人の私用のメールが公開の履歴に出るのも防ぐ。
//
//   node tools/check-authors.mjs [--repo <dir>] [--range <A..B>]
//     --range：確かめるコミットの範囲。省くと origin/main..HEAD（まだ push していないコミット）。origin/main が無ければ HEAD までの全部。
//
// 終了コード：0 問題なし、1 決めていないメールのコミットがあった、2 使い方の誤り・git の失敗。

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// 作者として認めるメール。足すときは、そのメールが GitHub のどのアカウントに結びつくかを確かめてから。
export const ALLOWED = [
  'noreply@anthropic.com', // クラウドの Claude のセッション（GitHub の claude アカウント）
  '169575491+itoken33@users.noreply.github.com', // 作者本人（itoken33。ID 付きの noreply は本人にだけ結びつく）
  'noreply@github.com', // GitHub の画面・API でのマージの committer（web-flow）
  '41898282+github-actions[bot]@users.noreply.github.com', // GitHub Actions
];

const git = (repo, args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const hasRef = (repo, ref) => { try { git(repo, ['rev-parse', '--verify', '-q', `${ref}^{commit}`]); return true; } catch { return false; } };

export function run(args, io = { log: console.log, err: console.error }) {
  let repo = '.';
  let range = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--repo') repo = args[++i];
    else if (a === '--range') range = args[++i];
    else { io.err(`知らない引数：${a}`); return 2; }
    if (args[i] === undefined) { io.err(`${a} に値が無い`); return 2; }
  }
  if (!range) range = hasRef(repo, 'origin/main') ? 'origin/main..HEAD' : 'HEAD';
  let lines;
  try {
    lines = git(repo, ['log', '--format=%h%x09%ae%x09%ce%x09%s', range]).split('\n').filter(Boolean);
  } catch (e) {
    io.err(`git log ${range} に失敗：${String(e.stderr ?? e.message).trim()}`);
    return 2;
  }
  const bad = [];
  for (const line of lines) {
    const [sha, author, committer, subject] = line.split('\t');
    const wrong = [['author', author], ['committer', committer]].filter(([, m]) => !ALLOWED.includes(m.toLowerCase()));
    if (wrong.length) bad.push(`${sha} ${wrong.map(([k, m]) => `${k}=${m}`).join(' ')}  ${subject}`);
  }
  if (bad.length) {
    io.err(`決めていないメールのコミットが ${bad.length} 件ある（${range}）：`);
    for (const b of bad) io.err(`  ${b}`);
    io.err(`認めるメール：${ALLOWED.join('、')}`);
    io.err('作者のメールを推測で書かない。直すなら push の前に、上のどれかを user.email にして git rebase --exec "git commit --amend --no-edit --reset-author" で作り直す。');
    return 1;
  }
  io.log(`作者のメールは問題なし（${range}、${lines.length} 件）`);
  return 0;
}

// 直接起動か。argv[1] は symlink を解かないので、実体のパスどうしで比べる（解かないと一致せず、検査せずに 0 で終わる）
const real = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
if (process.argv[1] && real(fileURLToPath(import.meta.url)) === real(process.argv[1])) {
  process.exitCode = run(process.argv.slice(2));
}
