// skills/skill-authoring/scripts/check-skills.mjs の試験。正しい Skill を通し、壊した Skill で失敗するか。
//   node --test test/check-skills.test.mjs
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const script = path.join(root, 'skills/skill-authoring/scripts/check-skills.mjs');
const { checkSkill } = await import(pathToFileURL(script).href);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-skills-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
let n = 0;
// files は { 相対パス: 中身 }。SKILL.md を渡さなければ、正しい形のものを置く
function skill(name, files = {}, parent = path.join(tmp, `set${n++}`)) {
  const dir = path.join(parent, name);
  const all = { 'SKILL.md': `---\nname: ${name}\ndescription: 例の Skill。〜を頼まれたら読む。\n---\n\n# 例\n\n本文。\n`, ...files };
  for (const [rel, body] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  return dir;
}
const msgs = (dir, o) => checkSkill(dir, o).map((p) => p.msg);
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
const fm = (name, desc, extra = '') => `---\nname: ${name}\ndescription: ${desc}\n${extra}---\n`;

describe('通るもの', () => {
  it('正しい形の Skill と、SKILL.md から指した references・コードの中のリンクの形', () => {
    const dir = skill('good-one', {
      'SKILL.md': `${fm('good-one', '"引用符で囲めば: も使える"', 'license: MIT\n')}\n細部は [a](references/a.md) と [b](references/b.md)。外は [x](https://example.com)、節は [s](#節)。\n\n\`[no](nowhere.md)\`\n\n\`\`\`\n[no](nowhere.md)\n\`\`\`\n`,
      'references/a.md': '[b](b.md) も見る。\n',
      'references/b.md': '本文。\n',
    });
    assert.deepEqual(msgs(dir), []);
  });

  it('CRLF と BOM の SKILL.md も読める', () => {
    const dir = skill('crlf-bom', { 'SKILL.md': `﻿${fm('crlf-bom', '例。')}\n本文。\n`.replace(/\n/g, '\r\n') });
    assert.deepEqual(msgs(dir), []);
  });

  it('原本の Skill は全部通る（コマンドで、Skill を並べたフォルダーを渡す）', () => {
    const r = run(path.join(root, 'skills'));
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /問題なし/);
  });
});

describe('落ちるもの', () => {
  it('本文が長すぎる・行が多すぎる（上限はオプションで変えられる）', () => {
    const dir = skill('too-long', { 'SKILL.md': `${fm('too-long', '例。')}${'あ'.repeat(6501)}\n` });
    assert.ok(msgs(dir).some((m) => /本文が 6502 字/.test(m)));
    assert.deepEqual(msgs(dir, { maxChars: 7000 }), []);
    const lines = skill('many-lines', { 'SKILL.md': `${fm('many-lines', '例。')}${'行\n'.repeat(500)}` });
    assert.ok(msgs(lines).some((m) => m.includes('500 行まで')));
  });

  it('リンク切れ・フォルダーの外へのリンク', () => {
    const dir = skill('broken-link', { 'SKILL.md': `${fm('broken-link', '例。')}\n[a](references/none.md) [b](../other/SKILL.md)\n` });
    const m = msgs(dir);
    assert.ok(m.some((x) => x.includes('references/none.md が無い')), m.join('\n'));
    assert.ok(m.some((x) => x.includes('フォルダーの外')), m.join('\n'));
  });

  it('references から先にしかつながらない文書（SKILL.md から2段）', () => {
    const dir = skill('deep-ref', {
      'SKILL.md': `${fm('deep-ref', '例。')}\n[a](references/a.md)\n`,
      'references/a.md': '[b](b.md)\n',
      'references/b.md': '奥。\n',
    });
    assert.deepEqual(msgs(dir), ['b.md は SKILL.md から直接指されていない（references は SKILL.md から1段にする）']);
  });

  it('frontmatter の形：無い・name の違い・仕様に無い欄・description の長さと記号と続きの行', () => {
    assert.match(msgs(skill('no-fm', { 'SKILL.md': '# 見出しだけ\n' }))[0], /frontmatter/);
    assert.ok(msgs(skill('name-diff', { 'SKILL.md': fm('other', '例。') })).some((m) => m.includes('フォルダー名')));
    assert.ok(msgs(skill('Bad_Name', { 'SKILL.md': fm('Bad_Name', '例。') })).some((m) => m.includes('小文字')));
    assert.ok(msgs(skill('my-claude', { 'SKILL.md': fm('my-claude', '例。') })).some((m) => m.includes('anthropic')));
    assert.ok(msgs(skill('extra-key', { 'SKILL.md': fm('extra-key', '例。', 'version: 1\n') })).some((m) => m.includes('仕様に無い欄 version')));
    assert.ok(msgs(skill('long-desc', { 'SKILL.md': fm('long-desc', 'あ'.repeat(1025)) })).some((m) => m.includes('1025 字')));
    assert.ok(msgs(skill('angle', { 'SKILL.md': fm('angle', '<tag> を使う') })).some((m) => m.includes('< か >')));
    assert.ok(msgs(skill('colon', { 'SKILL.md': fm('colon', '使い方: こう') })).some((m) => m.includes('「: 」')));
    assert.ok(msgs(skill('folded', { 'SKILL.md': fm('folded', '>') })).some((m) => m.includes('1 行で書いていない')));
    assert.ok(msgs(skill('cont', { 'SKILL.md': '---\nname: cont\ndescription: 一行目\n  二行目\n---\n' })).some((m) => m.includes('続きの行')));
  });

  it('README を置いた・SKILL.md が無い', () => {
    assert.ok(msgs(skill('with-readme', { 'README.md': '説明\n' })).some((m) => m.includes('README')));
    const parent = path.join(tmp, 'no-skill-md');
    fs.mkdirSync(path.join(parent, 'empty'), { recursive: true });
    fs.writeFileSync(path.join(parent, 'empty', 'notes.md'), 'メモ\n');
    const r = run(parent);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /SKILL\.md が無い/);
  });
});

describe('コマンド', () => {
  it('問題があれば終了コード 1 で、パスと中身を出す。--json でも出す', () => {
    const parent = path.join(tmp, 'cli');
    skill('ok-skill', {}, parent);
    skill('ng-skill', { 'SKILL.md': `${fm('ng-skill', '例。')}\n[x](missing.md)\n` }, parent);
    const r = run(parent);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /ng-skill[\\/]SKILL\.md：リンク先 missing\.md が無い/);
    assert.match(r.stdout, /2 本のうち 1 本に 1 件の問題/);
    const j = run(parent, '--json');
    assert.equal(j.status, 1);
    const out = JSON.parse(j.stdout);
    assert.equal(out.skills, 2);
    assert.deepEqual(out.problems.map((p) => p.skill), ['ng-skill']);
  });

  it('--max-lines をコマンドから渡すと、行の上限が変わる', () => {
    const dir = skill('lines-cli', { 'SKILL.md': `${fm('lines-cli', '例。')}${'行\n'.repeat(10)}` });
    assert.equal(run(dir).status, 0);
    const r = run(dir, '--max-lines', '5');
    assert.equal(r.status, 1);
    assert.match(r.stdout, /5 行までにし/);
  });

  it('シンボリックリンク越しに起動しても、リンクで置いた Skill も調べる', (t) => {
    const parent = path.join(tmp, 'links');
    const real = path.join(tmp, 'links-real');
    skill('linked-ng', { 'SKILL.md': `${fm('linked-ng', '例。')}\n[x](missing.md)\n` }, real);
    fs.mkdirSync(parent, { recursive: true });
    try {
      fs.symlinkSync(path.join(real, 'linked-ng'), path.join(parent, 'linked-ng'), 'junction');
      fs.symlinkSync(path.dirname(script), path.join(tmp, 'scripts-link'), 'junction');
    } catch (e) { t.skip(`リンクを作れない：${e.code}`); return; }
    const r = spawnSync(process.execPath, [path.join(tmp, 'scripts-link', 'check-skills.mjs'), parent], { encoding: 'utf8' });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /リンク先 missing\.md が無い/);
  });

  it('不正な % のリンクで落ちず、問題として出す', () => {
    assert.ok(msgs(skill('bad-pct', { 'SKILL.md': `${fm('bad-pct', '例。')}\n[x](100%.md)\n` })).some((m) => m.includes('読めない')));
  });

  it('Skill 1つのフォルダーも渡せる。渡し方の誤りは終了コード 2', () => {
    assert.equal(run(skill('single-ok')).status, 0);
    assert.equal(run().status, 2);
    assert.equal(run(path.join(tmp, 'nothing-here')).status, 2);
    assert.equal(run(tmp, '--max-chars', 'x').status, 2);
  });
});
