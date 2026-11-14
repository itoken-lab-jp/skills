// skills/japanese-writing/scripts/check.mjs の試験。見るところを拾うかと、拾ってはいけないところを拾わないか。
//   node --test test/japanese-writing.test.mjs
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const script = path.join(root, 'skills/japanese-writing/scripts/check.mjs');
const { check } = await import(pathToFileURL(script).href);

const kinds = (t, o) => check(t, o).map((x) => x.kind);
const msgs = (t, kind, o) => check(t, o).filter((x) => x.kind === kind).map((x) => x.msg);
const article = { article: true };

describe('組み方の層', () => {
  it('同じ説明を何度も書いたところを拾う', () => {
    const t = '**ドーナツ グラフの中央に値を表示できるようになりました**\n\n今回のアップデートでは、書式で中央の値をオンにすると、ドーナツ グラフの中央に値を表示できるようになりました。\n';
    assert.ok(check(t).some((x) => x.kind === 'repeat' && x.msg.includes('中央に値を表示できるようになりました')));
  });

  it('名前だけの繰り返し（ひらがなが少ない）と、表の行は拾わない', () => {
    assert.deepEqual(kinds('OneDriveとSharePointの話。\n\nあとでOneDriveとSharePointの話。\n').filter((k) => k === 'repeat'), []);
    const table = '| 項目 | 内容 |\n|---|---|\n| 申請の締め切りについて | 毎月の申請の締め切りについての決まり |\n| 申請の締め切りについて | 別の決まり |\n';
    assert.deepEqual(kinds(table).filter((k) => k === 'repeat'), []);
  });

  it('--article のときだけ、同じ長さの文の並びと同じ文末の 3 連続と AI の文に多い語を拾う', () => {
    const prose = '値の書式を変えられます。表示単位も変えられます。背景の色も変えられます。文字の大きさも選べます。画像も上に置けます。\n';
    assert.ok(kinds(prose, article).includes('flat'));
    assert.ok(kinds(prose, article).includes('ending'));
    assert.deepEqual(kinds(prose).filter((x) => ['flat', 'ending'].includes(x)), []);
    assert.ok(kinds('要件を切り分けました。\n', article).includes('aiword'));
    assert.deepEqual(kinds('受入検査で部品の事故を照合しました。\n').filter((x) => x === 'aiword'), []);
    const list = '- 値の書式を変えられます\n- 表示単位も変えられます\n- 背景の色も変えられます\n- 文字の大きさも選べます\n- 画像も上に置けます\n';
    assert.deepEqual(kinds(list, article).filter((x) => x === 'flat' || x === 'ending'), []);
  });

  it('AI の文に多い語（--article）は活用した形でも拾い、元の辞書の誤検知よけを守る', () => {
    const k = msgs('書式を変えたのに効かない。\n\n要件を見張って、切り分けました。\n', 'aiword', article);
    assert.ok(k.some((m) => m.includes('「効く」')));
    assert.ok(k.some((m) => m.includes('「見張る」')));
    const n = msgs('専門の話です。\n\nタイトルは既定でオフになりました。\n\n落とし穴があります。\n\n有効かどうかを確認します。\n', 'aiword', article);
    assert.equal(n.filter((m) => m.includes('「門」') || m.includes('「既定では」') || m.includes('「穴」') || m.includes('「効く」')).length, 0);
    assert.equal(n.filter((m) => m.includes('「落とし穴」')).length, 1);
  });

  it('Markdown の型を拾う。手順書の「**注意**」は拾わない', () => {
    const m = msgs('- **速度**：3倍になった\n- ✅ 完了した\n\n## **大事**な所\n\n次の手順で行います：\n\n**ポイント**：先に保存する\n\n**注意**：電源を切らない\n', 'format');
    assert.ok(m.some((x) => x.includes('**名前**：説明')));
    assert.ok(m.some((x) => x.includes('絵文字')));
    assert.ok(m.some((x) => x.includes('見出しの中の太字')));
    assert.ok(m.some((x) => x.includes('コロンで次につなぐ')));
    assert.equal(m.filter((x) => x.includes('札')).length, 1);
  });

  it('誰がするかが読めない受け身を拾い、「〜ことができる」は拾わない', () => {
    const k = kinds('移行が行われました。\n\n設定を変更することができます。\n');
    assert.ok(k.includes('hidden'));
    assert.deepEqual(kinds('設定を変更することができます。\n'), []); // 「〜ことができる」は拾わない（短い可能形に寄せると、付け足しの情報まで言い切りになる）
  });

  it('悪く言うところと弱気なところを拾う。事実の否定・安心させる否定・敬語の詫びとクッション言葉は拾わない', () => {
    const k = kinds('厄介なのは、テストで見つからないことです。\n\n足りなくなるかもしれません。\n');
    assert.equal(k.filter((x) => x === 'tone').length, 2);
    const t = [
      '「万」「億」はありません。', '受け取った人が入れ直す必要はありません。', 'これでいいと思います。',
      'ご不便をおかけし申し訳ございません。', 'ご面倒をおかけしますが、よろしくお願いいたします。', '残念ながら今回は見送ります。',
      'お役に立てれば幸いです。', '拙い説明で恐縮ですが、ご確認ください。', '致命的な障害は起きていません。',
    ].join('\n\n');
    assert.deepEqual(kinds(t).filter((x) => x === 'tone'), []);
  });

  it('front matter・HTML コメント・コード・画像は見ない。閉じの無い front matter は本文として読む', () => {
    const t = '---\ntitle: 同じ題名を何度も書いた題名\n---\n<!-- 同じ題名を何度も書いた題名 -->\n```\n同じ題名を何度も書いた題名\n```\n~~~\n見れる\n~~~\n![同じ題名を何度も書いた題名](a.png)\n本文です。\n';
    assert.deepEqual(check(t), []);
    assert.ok(kinds('---\n資料が見れるようになりました。\n').includes('style'));
  });

  it('BOM と CRLF の文でも行番号がずれない', () => {
    const found = check('﻿一行目です。\r\n\r\n見れるようになりました。\r\n');
    assert.ok(found.some((x) => x.kind === 'style' && x.no === 3));
  });

  it('URL のすぐ後ろに続く文も見る', () => {
    assert.ok(kinds('申請はhttps://example.co.jp/からして、資料が見れるようにしてください。\n').includes('style'));
  });
});

describe('文の切り方', () => {
  it('日本語の箇条書き（・①（1））は 1 項目を 1 文とし、です・ます の混在に数えない', () => {
    const t = '手続きは次のとおりです。必ずお読みください。\n\n・申請書を提出する\n・上長の承認を得る\n① 書類をそろえる\n（1）提出する\n';
    assert.deepEqual(msgs(t, 'style'), []);
  });

  it('■ や【】で始まる行は見出しとして扱う', () => {
    assert.deepEqual(msgs('■ 原因\n\n前日の作業で設定を入れ忘れました。\n\n【経過】\n\n9時に気づきました。\n', 'style'), []);
  });

  it('句点で終わらずに折り返した行は、次の行とつなぐ', () => {
    const t = '来週の会議で使う\n資料をお送りします。\nご確認ください。\n';
    assert.deepEqual(msgs(t, 'style'), []);
    const long = `${'あ'.repeat(60)}\n${'い'.repeat(60)}。\n`;
    assert.ok(msgs(long, 'style').some((m) => m.includes('121 字')));
  });

  it('「」の中の句点・？・！では文を切らず、中身に作法の検査を当てない', () => {
    const t = '画面に「保存しますか？」と出たら、「はい」を押します。\n\n「入力して下さい。」と表示されます。\n\n「保存しました！」と出ます。\n';
    assert.deepEqual(kinds(t).filter((k) => ['style', 'keigo', 'kana'].includes(k)), []);
  });

  it('> の引用の行は自分の文として見ない', () => {
    assert.deepEqual(kinds('> 資料が見れませんでした。部長がおっしゃられた件です。\n\n承知しました。\n').filter((k) => ['style', 'keigo'].includes(k)), []);
  });

  it('英字の中の ! ? では文を切らない', () => {
    assert.deepEqual(msgs('Yahoo!のニュースで知りました。\n', 'style'), []);
  });
});

describe('業務の文書の作法（style）', () => {
  it('長い文と読点の多い文を拾う。長さは --max-length で変えられる', () => {
    const long = `${'あ'.repeat(101)}。\n`;
    assert.ok(msgs(long, 'style').some((m) => m.includes('102 字')));
    assert.deepEqual(msgs(long, 'style', { maxLength: 120 }), []);
    assert.ok(msgs('今月は、売上が、前年より、少し、下がりました。\n', 'style').some((m) => m.includes('読点が 4 つ')));
    assert.deepEqual(msgs('今月は、売上が、前年より下がりました。\n', 'style'), []);
  });

  it('漢字が 7 字以上続くところを拾い、6 字までは拾わない', () => {
    assert.ok(msgs('業務効率化推進施策を検討します。\n', 'style').some((m) => m.includes('業務効率化推進施策')));
    assert.deepEqual(msgs('業務効率化の施策を検討します。\n', 'style'), []);
  });

  it('です・ます と である の混在は、少ないほうを指す', () => {
    const m = msgs('この機能は便利です。設定は簡単です。誰でも使えます。ただし注意が要る。\n', 'style');
    assert.equal(m.length, 1);
    assert.ok(m[0].includes('「である」の文'));
    assert.deepEqual(msgs('この機能は便利です。設定は簡単です。\n\n- 注意が要る\n\nいつもありがとう。\n', 'style'), []);
  });

  it('二重否定（常体と です・ます）・ら抜き・「が、」の重なり・冗長な言い方を拾う', () => {
    assert.ok(msgs('使えないことはない。\n', 'style').some((m) => m.includes('二重否定')));
    assert.ok(msgs('影響がないとは言えません。\n', 'style').some((m) => m.includes('二重否定')));
    for (const t of ['資料が見れるようになりました。', '明日は来れますか。', '手順を決めれる人がいません。', '朝6時に起きれますか。', '駅で降りれません。', '会議に出れます。']) {
      assert.ok(msgs(`${t}\n`, 'style').some((m) => m.includes('ら抜き')), t);
    }
    assert.ok(msgs('予算はあるが、人が足りないが、進める。\n', 'style').some((m) => m.includes('「が、」')));
    assert.ok(msgs('設定の変更を行いました。\n', 'style').some((m) => m.includes('〜を行う')));
    assert.ok(msgs('移行作業を実施いたしました。\n', 'style').some((m) => m.includes('〜を実施する')));
  });

  it('ら抜きでない「〜れる」と、逆接 1 回の「が、」は拾わない', () => {
    for (const t of ['資料を入れる。', '照れることもある。', '水が流れる。', '許可が取れる。', '画面が見られる。', '検討しましたが、今回は見送ります。',
      '恐れ入りますが、確認しましたが、まだ届いていません。', '今回の見積もりが、予算に収まるかを見ます。']) {
      assert.deepEqual(msgs(`${t}\n`, 'style'), [], t);
    }
  });

  it('全角の英数字・半角のカナ・感嘆符を拾う', () => {
    const m = msgs('ＡＢＣの件です。\n\nﾃｽﾄです。\n\nできました！\n', 'style');
    assert.ok(m.some((x) => x.includes('全角の英数字')));
    assert.ok(m.some((x) => x.includes('半角のカナ')));
    assert.ok(m.some((x) => x.includes('感嘆符')));
  });
});

describe('敬語（keigo）と、ひらがなにする語（kana）', () => {
  it('二重敬語を拾い、正しい敬語は拾わない', () => {
    for (const t of ['部長がおっしゃられた件です。', '資料を拝見させていただきました。', '社長がお越しになられました。', '新しい機能をご利用になられる方へ。']) {
      assert.ok(kinds(`${t}\n`).includes('keigo'), t);
    }
    const ok = '部長がおっしゃった件です。\n\n資料を拝見しました。\n\n社長がお越しになりました。\n\nお元気になられましたか。\n\nお客様が会員になられた場合です。\n';
    assert.deepEqual(kinds(ok).filter((k) => k === 'keigo'), []);
  });

  it('謙譲語を相手の動作に使った形を拾う', () => {
    assert.ok(kinds('資料をご確認してください。\n').includes('keigo'));
    assert.ok(kinds('どなたでもご利用できます。\n').includes('keigo'));
    assert.deepEqual(kinds('資料をご確認ください。\n\nどなたでもご利用いただけます。\n').filter((k) => k === 'keigo'), []);
  });

  it('「させていただく」は 3 文以上で拾い、2 文まで・相手の動作の「〜せていただく」は拾わない', () => {
    assert.equal(kinds('送付させていただきます。\n\n確認させていただきます。\n\n対応させていただきます。\n').filter((k) => k === 'keigo').length, 3);
    assert.deepEqual(kinds('送付させていただきます。\n\n確認させていただきます。\n\nお知らせいただき、見せていただきました。\n').filter((k) => k === 'keigo'), []);
  });

  it('補助動詞・致します・形式名詞・文の頭の接続詞・副詞を漢字で書いたところを拾う', () => {
    const m = msgs('資料を見て下さい。\n\nご確認頂く事があります。\n\n但し、期限は守る。\n\n是非ご参加ください。\n\nよろしくお願い致します。\n', 'kana');
    assert.ok(m.some((x) => x.includes('補助動詞')));
    assert.ok(m.some((x) => x.includes('形式名詞')));
    assert.ok(m.some((x) => x.includes('接続詞')));
    assert.ok(m.some((x) => x.includes('ぜひ')));
    assert.ok(m.some((x) => x.includes('いたします')));
  });

  it('ひらがなで書いたところと、名詞や本動詞の漢字は拾わない', () => {
    const t = [
      '資料を見てください。', 'ご確認いただくことがあります。', 'ただし、期限は守る。', '大事な仕事の事例です。', '開始時刻は同時に決めます。',
      '本社及び支社に送ります。', '許しを受けて行うときだけ使う。', 'ファイルを開いて見る。', '2日に分けて行った。', 'すべて置換する。',
      'ご連絡を下さい。', '導入の是非を検討する。', 'どなた様にもお送りします。',
    ].join('\n\n');
    assert.deepEqual(msgs(t, 'kana'), []);
  });
});

describe('コマンド', () => {
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'japanese-writing-'));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('見るところがあっても終了コード 0 で、行番号つきで出す', () => {
    const f = path.join(dir, 'a.md');
    fs.writeFileSync(f, '# 題\n\n資料が見れるようになりました。\n');
    const r = run(f);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /a\.md：確認箇所 1 件/);
    assert.match(r.stdout, /3: \[style\] ら抜き/);
  });

  it('--article で記事向けの種類も出す', () => {
    const f = path.join(dir, 'b.md');
    fs.writeFileSync(f, '要件を切り分けました。\n');
    assert.doesNotMatch(run(f).stdout, /aiword/);
    assert.match(run('--article', f).stdout, /aiword/);
  });

  it('UTF-8 でないファイル（Shift_JIS・UTF-16）は文字化けとして終了コード 1', () => {
    const sjis = path.join(dir, 'sjis.txt');
    fs.writeFileSync(sjis, Buffer.from([0x8e, 0x91, 0x97, 0xbf, 0x82, 0xaa, 0x8c, 0xa9, 0x82, 0xea, 0x82, 0xdc, 0x82, 0xb7, 0x81, 0x42])); // 「資料が見れます。」
    const utf16 = path.join(dir, 'utf16.txt');
    fs.writeFileSync(utf16, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('資料が見れます。', 'utf16le')]));
    for (const f of [sjis, utf16]) {
      const r = run(f);
      assert.equal(r.status, 1, f);
      assert.match(r.stderr, /文字化け/);
    }
  });

  it('読めないファイル・知らない指定・引数なしは終了コード 1', () => {
    assert.equal(run(path.join(dir, 'none.md')).status, 1);
    assert.equal(run('--json', path.join(dir, 'a.md')).status, 1);
    assert.equal(run('--max-length', 'x', path.join(dir, 'a.md')).status, 1);
    assert.equal(run().status, 1);
  });
});

describe('文章の形', () => {
  const shape = (t) => msgs(t, 'shape');
  const fill = (n, s = '担当者が月末に申請を確かめます。') => Array.from({ length: n }, () => s).join('\n\n') + '\n';

  it('理由を後ろの文に分けた形と「〜のは、〜です」を拾う。段の最初の文・否定・「」の中は拾わない', () => {
    assert.ok(shape('設定は毎朝6時に配ります。夜のうちに直した分を朝の作業に間に合わせるためです。\n').some((m) => m.startsWith('理由を後ろ')));
    assert.deepEqual(shape('止めたのは、費用が合わないためです。\n').filter((m) => m.startsWith('理由を後ろ')), []);
    assert.deepEqual(shape('設定は毎朝6時に配るので、夜のうちに直した分が朝の作業に間に合います。\n'), []);
    assert.ok(shape('この検査で分かるのは、書き方の癖だけです。\n').some((m) => m.startsWith('「〜のは')));
    assert.ok(shape('渡せるのは UTF-8 のテキストです。\n').some((m) => m.startsWith('「〜のは')));
    assert.deepEqual(shape('古いものは月末に消す決まりです。\n'), []);
    assert.ok(shape('結果の確かめを月末に行います。\n').some((m) => m.startsWith('「〜の確かめ」')));
    assert.deepEqual(shape('結果の確認を月末に行います。\n'), []);
    assert.deepEqual(shape('手順の見直しを月末に行います。\n'), []);
    assert.ok(shape('- 検査できるのは、UTF-8 のテキストファイルです。\n').some((m) => m.startsWith('「〜のは')));
    assert.ok(shape('このスクリプトは文字の並びを照合するだけで、文の意味を読んでいないので、問題のない文が該当することがあります。\n').some((m) => m.startsWith('「〜だけで')));
    assert.deepEqual(shape('このスクリプトは正規表現で検出しているため、問題のない文が該当することがあります。\n'), []);
    assert.deepEqual(shape('この検査では、書き方の癖だけが分かります。\n'), []);
    assert.deepEqual(shape('大事なのは、ここではありません。\n').filter((m) => m.startsWith('「〜のは')), []);
    assert.deepEqual(shape('先方は「困るのは、納期が遅れることです。」と書いています。\n'), []);
  });

  it('読み手の受け取り方と効果の見込みを言い切った文を拾い、和らげた文・事実の文・「」の中は拾わない', () => {
    const felt = (t) => shape(t).filter((m) => m.includes('言い切っている'));
    assert.equal(felt('「帳票の Excel の読み方」と書けば伝わります。\n').length, 1);
    assert.equal(felt('入れれば、毎日の仕事が楽になります。\n').length, 1);
    assert.equal(felt('見出しに対象を書けば、読み手は迷いません。\n').length, 1);
    assert.deepEqual(felt('「帳票の Excel の読み方」と書けば伝わりやすくなります。\n'), []);
    assert.deepEqual(felt('毎日の仕事が楽になるはずです。\n'), []);
    assert.deepEqual(felt('3回とも、正しい単位で金額を報告しました。\n'), []);
    assert.deepEqual(felt('先方は「これで伝わります。」と書いています。\n'), []);
    assert.deepEqual(felt('「これで伝わります。」\n'), []);
    assert.equal(felt('見出しに対象を書けば、読み手に伝わる。\n').length, 1);
    assert.equal(felt('入れれば、毎日の仕事が楽になる。\n').length, 1);
    assert.deepEqual(felt('この訳は不自然です。\n'), []);
  });

  it('20 行以上で箇条書きが 3 割を超えると拾い、短い文章と箇条書きの少ない文章は拾わない', () => {
    const list = Array.from({ length: 10 }, (_, i) => `- 項目${i}を確かめる`).join('\n') + '\n';
    assert.ok(shape(fill(12) + '\n' + list).some((m) => m.includes('が箇条書き')));
    assert.deepEqual(shape(fill(30) + '\n' + list).filter((m) => m.includes('が箇条書き')), []);
    assert.deepEqual(shape(fill(3) + '\n' + list).filter((m) => m.includes('が箇条書き')), []);
  });

  it('20 文以上で、接続詞・指示語で始まる文が無いと拾い、あれば拾わない', () => {
    assert.ok(shape(fill(20)).some((m) => m.startsWith('接続詞か指示語')));
    assert.deepEqual(shape(fill(17) + '\nしかし、今月は遅れました。\n\nそのため、手順を見直します。\n\nこの手順は来月から使います。\n').filter((m) => m.startsWith('接続詞か指示語')), []);
    assert.deepEqual(shape(fill(10)).filter((m) => m.startsWith('接続詞か指示語')), []);
  });

  it('8 段落以上で、「〜は」で始まる段落が 4 割を超えると拾う', () => {
    const wa = Array.from({ length: 8 }, (_, i) => `手順書${i}の読み取り手順は、11月に追加しました。対象は社内の全員です。`).join('\n\n') + '\n';
    assert.ok(shape(wa).some((m) => m.startsWith('段落の')));
    const wo = Array.from({ length: 8 }, (_, i) => `11月に、手順書${i}の読み取り手順を追加しました。対象は社内の全員です。`).join('\n\n') + '\n';
    assert.deepEqual(shape(wo).filter((m) => m.startsWith('段落の')), []);
  });

  it('20 文以上で、否定で終わる文と「だけ・のみ」が 1 割を超えると拾う。「だけでなく」は数えない', () => {
    assert.ok(shape(fill(17) + '\n' + fill(4, '更新はしません。')).some((m) => m.startsWith('否定で終わる文')));
    assert.deepEqual(shape(fill(20) + '\n' + fill(1, '更新はしません。')).filter((m) => m.startsWith('否定で終わる文')), []);
    assert.ok(shape(fill(17) + '\n' + fill(4, '見るのは担当者だけにします。')).some((m) => m.startsWith('「だけ・のみ」')));
    assert.deepEqual(shape(fill(17) + '\n' + fill(4, '担当者だけでなく上長も確かめます。')).filter((m) => m.startsWith('「だけ・のみ」')), []);
    assert.ok(shape(fill(18) + '\n' + fill(2, '出力された箇所は、修正の候補です。')).some((m) => m.startsWith('「〜は、」の後ろ')));
    assert.deepEqual(shape(fill(18) + '\n' + fill(2, '出力された箇所は修正の候補です。')).filter((m) => m.startsWith('「〜は、」の後ろ')), []);
    assert.ok(shape(fill(12) + '\n' + fill(8, '担当者が月末に申請を確かめました。')).some((m) => m.startsWith('「〜ました。」')));
    assert.deepEqual(shape(fill(18) + '\n' + fill(3, '担当者が月末に申請を確かめました。')).filter((m) => m.startsWith('「〜ました。」')), []);
    const node = fill(17) + '\n' + fill(3, '期限が近いので、先に申請します。');
    assert.ok(shape(node).some((m) => m.startsWith('理由の「ので」')));
    assert.deepEqual(msgs(node, 'shape', article).filter((m) => m.startsWith('理由の「ので」')), []);
    assert.deepEqual(shape(fill(17) + '\n' + fill(3, '期限が近いため、先に申請します。')).filter((m) => m.startsWith('理由の「ので」')), []);
  });
});
