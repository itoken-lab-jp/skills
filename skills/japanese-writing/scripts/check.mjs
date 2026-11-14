// 日本語の文章の確認箇所を、行番号を付けて出力する。出力は修正の候補であり、修正するかどうかは文脈で判断する。
// 使い方は ../SKILL.md の「検査スクリプトで確認する」。
//   node check.mjs <文章.md|.txt> [...] [--article] [--max-length 100]
//   --article    読み物（記事・ブログ・README の説明文）向けの flat・ending・aiword も出す。業務の文書では出さない
//   終了コード：0 は読めた（確認箇所の件数に関わらず）。1 は読めないファイル・UTF-8 でない文字（文字化け）・使い方の誤り。
//
// もとは、記事の口調を整えるために作った検査（2026-10-03）。記事の見比べで、決まり文句の一覧は負けた文にほとんど当たらず、
// 残った臭さは組み方の層にあった（repeat・flat・ending・hidden）。語と書き方の型（aiword・format）は textlint の 2 つのプリセットを
// ai-words.mjs に書き直したもの（表示は THIRD_PARTY_NOTICES.md）。2026-11-10 に、一人の口調の決まりを外し、業務の文書の作法
// （style・keigo・kana）を足した。足した分は、textlint-rule-preset-ja-technical-writing・textlint-rule-preset-smarthr のルールの
// 考え方と、文化庁「公用文作成の考え方」（2022）から、正規表現で自分で書いた（形態素解析は使わない。誤って当たるところがある）。
//
//   repeat   同じ言い方を何度も書いている（10 字以上の同じ並びが 2 回以上。題名・見出し・本文をまたいでも数える）
//   hidden   受け身の「〜が行われ」「〜が実施され」「〜がなされ」で、誰がするのかが読めない
//   tone     何かを悪く言う言葉（厄介・最悪 など）と、弱気な言い方（「かもしれません」）。敬語の詫び・クッション言葉は拾わない
//   style    文の長さ（既定で 100 字を超える）、読点が 4 つ以上、漢字が 7 字以上続く、です・ます と である の混在、二重否定、
//            ら抜き、逆接の「が、」の重なり、冗長な言い方（「〜を行う」「〜を実施する」）、全角の英数字、半角のカナ、感嘆符
//   keigo    二重敬語（「おっしゃられる」「拝見させていただく」など）、謙譲語を相手の動作に使う形（「ご〜してください」「ご〜できます」）、
//            「させていただく」の重ね（3 回以上）
//   kana     公用文でひらがなにする語を漢字で書いている（補助動詞の「〜て下さい・頂く・置く」、「致します」「出来る」、形式名詞の「〜する事」、
//            文の頭の接続詞「但し・尚・従って」など）
//   format   Markdown の型（箇条書きの「**名前**：説明」、箇条書きの絵文字、見出しの太字、「〜します：」）
//   shape    文章の形。人が書いた 8 種類の文章 71 本と AI の文を測って、AI だけが外れていた型（出どころは references/sources.md）。
//            理由を後ろの文に分ける（「〜ためです。」）、「〜のは、〜です」、和語の動詞を名詞にした形（「結果の確かめ」）。20 文以上の文章では、箇条書きの行の割合、
//            文頭の接続詞・指示語の少なさ、否定で終わる文の割合、「だけ・のみ」の割合、理由の「ので」と「ため」の数、短い文の読点、「〜ました。」の割合を、文章全体の数字で出す。8 段落以上の文章では「〜は」で始まる段落の割合も出す
//   --article のときだけ：
//   flat     同じ長さの文が並ぶ（5 文以上の段で、文の長さのばらつきが小さい。2026-10 の記事の比較では強く出たが、2026-11-14 の実測では人と AI を分けなかった。記事向けの目安として残す）
//   ending   同じ文末が 3 文続く
//   aiword   AI の文に多い語（「効く」「切り分ける」など約 50 語）、誇張（「パラダイムシフト」）、技術文の決まり文句
//
// 文の切り方：日本語の箇条書き（・●■①（1）1) など）と Markdown の箇条書きは 1 項目を 1 文、■◆【】で始まる行は見出しとして扱う。
// 句点で終わらずに折り返した行は、次の行とつないで 1 文にする。「」『』の中では文を切らない。
// 「」『』の中（引用・画面の言葉・例）と、> で始まる引用の行は、repeat・format のほかでは見ない。
// 閾値は経験の目安で、較正していない。誤って当たったら、理由を書いて残してよい。
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { formatPatterns, wordPatterns } from './ai-words.mjs';

/** 本文だけを、元の行番号つきで取り出す（front matter・HTML コメント・コード・画像・URL を外す） */
export function bodyLines(text) {
  const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  // front matter は、閉じの --- があるときだけ外す（閉じが無ければ本文として読む）
  let inFront = lines[0] === '---' && lines.indexOf('---', 1) > 0;
  let fence = null;
  let inComment = false;
  lines.forEach((raw, i) => {
    if (inFront) {
      if (i > 0 && raw === '---') inFront = false;
      return;
    }
    const f = raw.match(/^\s*(```|~~~)/);
    if (f && (!fence || f[1] === fence)) {
      fence = fence ? null : f[1];
      return;
    }
    if (fence) return;
    let line = raw;
    if (inComment) {
      const end = line.indexOf('-->');
      if (end < 0) return;
      line = line.slice(end + 3);
      inComment = false;
    }
    line = line.replace(/<!--[\s\S]*?-->/g, '');
    const start = line.indexOf('<!--');
    if (start >= 0) {
      line = line.slice(0, start);
      inComment = true;
    }
    line = line
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/https?:\/\/[\x21-\x7E]+/g, ' ')
      .replace(/`[^`]*`/g, '')
      .replace(/\{\{[^}]*\}\}/g, '');
    out.push({ no: i + 1, text: line });
  });
  return out;
}

const LIST = /^(?:(?:[-*+]|\d+[.)])\s+|[・●○◦▪■□◆◇▶►※][\s　]*|[①-⑳][\s　]*|[（(]\d+[）)][\s　]*)/;
const MD_LIST = /^(?:[-*+]|\d+[.)])\s+/;
const HEADING = /^(#{1,6}\s|[■◆□◇]\s*\S[^。]*$|【[^】]*】\s*$)/;
const END = /[。？！?!]$/;

/** 「」『』の外にある文末記号で切る */
function splitSentences(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  const chars = [...s];
  chars.forEach((ch, i) => {
    cur += ch;
    if (ch === '「' || ch === '『') depth++;
    else if ((ch === '」' || ch === '』') && depth > 0) depth--;
    else if (depth === 0 && /[。？！]/.test(ch)) {
      out.push(cur);
      cur = '';
    } else if (depth === 0 && /[?!]/.test(ch) && !/[A-Za-z0-9]/.test(chars[i + 1] ?? '') && !/[A-Za-z]/.test(chars[i - 1] ?? '')) {
      out.push(cur);
      cur = '';
    }
  });
  if (cur) out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

/** 行を「段」（空行・見出し・区切り・表で切れるまとまり）に分け、段ごとに文を出す */
export function sentencesByBlock(lines) {
  const blocks = [];
  let cur = [];
  let carry = null; // 句点で終わらずに折り返した地の文
  const flushCarry = () => {
    if (carry) for (const s of splitSentences(carry.text)) cur.push({ no: carry.no, text: s, list: false, quote: carry.quote });
    carry = null;
  };
  const flush = () => {
    flushCarry();
    if (cur.length) blocks.push(cur);
    cur = [];
  };
  for (const { no, text } of lines) {
    const t = text.trim();
    if (!t || HEADING.test(t) || /^(---|\*\*\*)$/.test(t) || /^\|/.test(t)) {
      flush();
      continue;
    }
    const quote = /^>/.test(t);
    const body = t.replace(/^>\s?/, '').replace(/\*\*/g, '');
    if (LIST.test(body)) {
      flushCarry();
      for (const s of splitSentences(body.replace(LIST, ''))) cur.push({ no, text: s, list: true, quote });
      continue;
    }
    const joined = carry ? { no: carry.no, text: carry.text + body, quote: carry.quote || quote } : { no, text: body, quote };
    carry = null;
    if (END.test(joined.text) || /[」』）)]$/.test(joined.text)) {
      for (const s of splitSentences(joined.text)) cur.push({ no: joined.no, text: s, list: false, quote: joined.quote });
    } else {
      const parts = splitSentences(joined.text);
      const last = parts.pop();
      for (const s of parts) cur.push({ no: joined.no, text: s, list: false, quote: joined.quote });
      carry = { no: joined.no, text: last ?? '', quote: joined.quote };
    }
  }
  flush();
  return blocks;
}

/** 「」『』の中（引用・画面の言葉・例）を空にする。作法の検査は、人の言葉と例に当てない */
const unquoted = (s) => s.replace(/「[^」]*」/g, '「」').replace(/『[^』]*』/g, '『』');
const len = (s) => [...s.replace(/\s/g, '')].length;
const head = (s) => s.slice(0, 40);
/** 自分の地の文（> の引用を除く） */
const own = (blocks) => blocks.flat().filter((s) => !s.quote);

/** 同じ長さの文が並ぶ段（5 文以上で、長さの変動係数が 0.3 未満） */
export function flatBlocks(blocks, { min = 5, cv = 0.3 } = {}) {
  const found = [];
  for (const all of blocks) {
    // 長さと文末は地の文だけで見る（箇条書きは並べるための形）
    const b = all.filter((x) => !x.list && !x.quote);
    if (b.length < min) continue;
    const ls = b.map((s) => len(s.text));
    const mean = ls.reduce((a, x) => a + x, 0) / ls.length;
    const sd = Math.sqrt(ls.reduce((a, x) => a + (x - mean) ** 2, 0) / ls.length);
    const v = mean ? sd / mean : 0;
    if (v < cv) found.push({ no: b[0].no, kind: 'flat', msg: `${b.length} 文の段で、文の長さが均一である（ばらつき ${v.toFixed(2)}。平均 ${Math.round(mean)} 字）` });
  }
  return found;
}

/** 文末（最後の 2 字。「ます」「です」など） */
const endingOf = (s) => s.replace(/[。？！?!」』）)\s]+$/, '').slice(-2);

/** 同じ文末が 3 文続く所（段の中だけ） */
export function sameEndings(blocks, { run = 3 } = {}) {
  const found = [];
  for (const all of blocks) {
    const b = all.filter((x) => !x.list && !x.quote);
    let n = 1;
    for (let i = 1; i < b.length; i++) {
      const e = endingOf(b[i].text);
      if (e && e === endingOf(b[i - 1].text)) n++;
      else n = 1;
      if (n === run) found.push({ no: b[i - run + 1].no, kind: 'ending', msg: `「〜${e}」が ${run} 文続く` });
    }
  }
  return found;
}

/** 同じ並び（記号と空白を除いて 10 字以上）が 2 回以上出る所。いちばん長い並びにまとめ、その中の短い並びは数えない */
export function repeats(lines, { n = 10 } = {}) {
  const text = [];
  for (const { no, text: t } of lines) {
    if (/^\s*\|/.test(t)) continue; // 表の行（同じ見出しの語が並ぶのは表の形）
    for (const ch of t.replace(/\*\*/g, '')) {
      if (/[\s、。・「」『』（）()：:／/,.!?！？#>*|-]/.test(ch)) continue;
      text.push({ ch, no });
    }
    text.push({ ch: '\n', no });
  }
  const s = text.map((x) => x.ch).join('');
  const grams = new Map();
  for (let i = 0; i + n <= s.length; i++) {
    const k = s.slice(i, i + n);
    if (!k.includes('\n')) (grams.get(k) ?? grams.set(k, []).get(k)).push(i);
  }
  const covered = new Uint8Array(s.length);
  const found = [];
  for (let i = 0; i + n <= s.length; i++) {
    if (covered[i]) continue;
    const cands = (grams.get(s.slice(i, i + n)) ?? []).filter((j) => j > i);
    let best = 0;
    for (const j of cands) {
      let l = 0;
      while (j + l < s.length && s[i + l] === s[j + l] && s[i + l] !== '\n' && i + l < j) l++;
      if (l > best) best = l;
    }
    if (best < n) continue;
    const phrase = s.slice(i, i + best);
    const pos = [];
    for (let k = s.indexOf(phrase); k >= 0; k = s.indexOf(phrase, k + best)) pos.push(k);
    pos.forEach((k) => covered.fill(1, k, k + best));
    // 名前だけの繰り返しは数えない（見たいのは説明の繰り返し）
    if ((phrase.match(/[ぁ-ん]/g) ?? []).length < 4) continue;
    const at = pos.map((k) => text[k].no);
    found.push({ no: at[0], kind: 'repeat', msg: `「${phrase}」が ${pos.length} 回（${[...new Set(at)].join('・')} 行）` });
  }
  return found;
}

/** 誰がするのかが読めない形、数で見る言い方、悪く言う・弱気な言い方 */
export function wordsAndAgents(blocks) {
  const found = [];
  const all = own(blocks);
  const count = (re) => all.filter((s) => re.test(unquoted(s.text)));
  const hit = (list, kind, msg) => list.forEach((s) => found.push({ no: s.no, kind, msg: `${msg}：${head(s.text)}` }));
  hit(count(/が行われ|が実施され|がなされ/), 'hidden', '受け身のため、動作の主体が分からない（主体が決まっていない場合と、書く必要が無い場合は、変更しない）');
  // 事実の否定（「〜はありません」）、安心させる否定（入れ直す必要はありません）、書き手のぼかし（と思います）、
  // 敬語の詫びとクッション言葉（申し訳ございません・ご不便・ご面倒・残念ながら・お役に立てれば・拙い）は拾わない（場面の作法を壊さない）
  hit(count(/厄介|やっかい|イマイチ|いまいち|ダメ|最悪|がっかり|めんどくさ/), 'tone', '対象を悪く書いていないか');
  hit(count(/かもしれません|かもしれない|自信が(無|な)/), 'tone', '推測の表現（確認した事実は断定する。確認していない場合は、不明な点を書く）');
  return found;
}

/** です・ます か である か（地の文の文末だけ。体言止め・箇条書きは数えない） */
const styleOf = (s) => {
  const t = s.replace(/[。？！?!」』）)\s]+$/, '');
  if (/[）)」』]$/.test(s.trim())) return null; // 括弧で終わる行（「対象：取引先（株式会社〇〇）」）は決めない
  if (/(です|ます|でした|ました|ません|でしょう|ましょう|ください|ございます)か?$/.test(t)) return 'desu';
  if (/(ありがとう|よろしく|おめでとう|お疲れさま)$/.test(t)) return null;
  if (/(である|であった|だ|だった|ではない|ない|であろう|だろう|た|[うくすつぬむぶぐる])$/.test(t)) return 'dearu';
  return null;
};

/** 業務の文書の作法（textlint-rule-preset-ja-technical-writing・smarthr の考え方を、正規表現で書いたもの） */
export function stylePatterns(blocks, { maxLength = 100 } = {}) {
  const found = [];
  const all = own(blocks);
  const add = (s, msg) => found.push({ no: s.no, kind: 'style', msg: `${msg}：${head(s.text)}` });
  for (const s of all) {
    const t = unquoted(s.text);
    if (len(s.text) > maxLength) add(s, `1 文が ${len(s.text)} 字（${maxLength} 字を超える。2 文に分けることを検討する）`);
    const ten = (t.match(/、/g) ?? []).length;
    if (ten >= 4 && !s.list) add(s, `読点が ${ten} つ（語順を変えて減らすか、2 文に分ける）`);
    for (const kanji of t.matchAll(/[一-龯々〆ヵヶ]{7,}/g)) add(s, `漢字が ${kanji[0].length} 字続く「${kanji[0]}」（固有名詞・役職・法令名を除き、ひらがなを挟む）`);
    if (/ないこと(は|も)(ない|ありません)|なくはない|なくもない|ないわけでは(ない|ありません)|ないとは(言え|いえ|限ら|かぎら)(ない|ません)|ないでもない/.test(t)) add(s, '二重否定（断定できる場合は断定する。確認できていない場合は、不明な点を書く）');
    if (/(?<![一-龯])(見|来|寝|着|居|出|得)れ(る|ます|ない|ません|た|て)|[一-龯][ぁ-ん]?[えけげせぜてでねべぺめ]れ(る|ます|ない|ません|た)|[一-龯][きぎじちにびみりい]れ(る|ます|ない|ません|た)/.test(t)) add(s, 'ら抜き言葉ではないか（見れる → 見られる）');
    // 逆接の「が、」は述語のあとに来る（「見積もりが、」のような主語の「が、」と、クッション言葉は数えない）
    const ga = t.replace(/(恐れ入ります|恐縮です|お手数をおかけします|お手数です|申し訳ありません|申し訳ございません|失礼です|お忙しいところ[^、。]*)が、/g, '');
    if ((ga.match(/(ます|です|した|でした|ません|る|た|い|だ)が、/g) ?? []).length >= 2) add(s, '逆接の「が、」が重なる（2 文に分ける）');
    if (/(を|の)(行[いうえわ]|行った|実施(し|す|さ|い))/.test(t)) add(s, '「〜を行う・〜を実施する」（動詞で書く。「変更を行う」→「変更する」。「会議を行う」のように動詞にできない名詞は変更しない）');
    if (/であると(言|い)え|という(こと|もの)になります|ことになります/.test(t)) add(s, '冗長な言い方（「〜と言える」「〜ことになります」）');
    if (/[Ａ-Ｚａ-ｚ０-９]/.test(t)) add(s, '全角の英数字（半角にする）');
    if (/[｡-ﾟ]/.test(t)) add(s, '半角のカナ（全角にする）');
    if (/！|(?<![A-Za-z])!/.test(t)) add(s, '感嘆符（業務の文書では使わないことが多い）');
  }
  // です・ます と である の混在（少ないほうを指す。地の文だけ）
  const prose = all.filter((s) => !s.list);
  const desu = prose.filter((s) => styleOf(s.text) === 'desu');
  const dearu = prose.filter((s) => styleOf(s.text) === 'dearu');
  if (desu.length && dearu.length) {
    const [few, many, fewName, manyName] = desu.length < dearu.length ? [desu, dearu, 'です・ます', 'である'] : [dearu, desu, 'である', 'です・ます'];
    for (const s of few) add(s, `「${fewName}」の文（ほかは「${manyName}」が ${many.length} 文。文体を統一する）`);
  }
  return found;
}

/** 敬語の重なりと取り違え */
export function keigoPatterns(blocks) {
  const found = [];
  const all = own(blocks);
  const add = (s, msg) => found.push({ no: s.no, kind: 'keigo', msg: `${msg}：${head(s.text)}` });
  for (const s of all) {
    const t = unquoted(s.text);
    if (/おっしゃられ|ご覧になられ|お見えになられ|召し上がられ|お越しになられ|お帰りになられ|ご[一-龯]{2,4}になられ|拝見させて(いただ|頂)|伺わせて(いただ|頂)|拝読させて(いただ|頂)|お伺いさせて(いただ|頂)|お伺いいたし|拝見され|申され|参られ|伺われ/.test(t)) add(s, '二重敬語ではないか（おっしゃられる → おっしゃる、ご利用になられる → ご利用になる）');
    if (/ご[一-龯]{2}(して|し)(ください|下さい)|ご[一-龯]{2}(でき|出来)(ます|る|ません)|お[一-龯ぁ-ん]{1,3}して(ください|下さい)|拝見して(ください|下さい)|伺って(ください|下さい)/.test(t)) add(s, '謙譲語を相手の動作に使っていないか（ご確認してください → ご確認ください、ご利用できます → ご利用いただけます）');
  }
  const sasete = all.filter((s) => /させて(いただ|頂)/.test(unquoted(s.text)));
  if (sasete.length >= 3) for (const s of sasete) add(s, `「〜させていただく」が ${sasete.length} 文（重ねない。「〜いたします」で足りる箇所は置き換える）`);
  return found;
}

/** 公用文でひらがなにする語（文化庁「公用文作成の考え方」の例から、よく出るものだけ） */
export function kanaPatterns(blocks) {
  const found = [];
  const add = (s, msg) => found.push({ no: s.no, kind: 'kana', msg: `${msg}：${head(s.text)}` });
  for (const s of own(blocks)) {
    const t = unquoted(s.text);
    if (/[てで](下さ|頂|戴|居|貰|欲し|置[くかきけこい]|来[るてた])|て行[くかきけこ]|[^一-龯をて]下さい|[ごお][一-龯ぁ-ゑ]{1,6}(下さ|頂)/.test(t)) add(s, '補助動詞はひらがな（〜てください・〜ていただく・〜ておく）');
    if (/致し(ます|まし|ません|たし)|出来(る|ます|ない|ません|た|れば)|御座い/.test(t)) add(s, 'ひらがなで書くことが多い語（いたします・できる・ございます）');
    if (/[るたうくすつぬむぶぐだ]事[がはをにもで]|[るた]為[、にの]|(?<!な)[るた]様に/.test(t)) add(s, '形式名詞はひらがな（〜すること・〜のため・〜ように）');
    if (/^(但し|尚、|従って、|故に|且つ|然し|然も)/.test(t)) add(s, '文の頭の接続詞はひらがな（ただし・なお・したがって）');
    if (/殆ど|(?<!の)是非|宜しく|予め|敢えて|筈|迄/.test(t)) add(s, 'ひらがなで書くことが多い語（ほとんど・ぜひ・よろしく・あらかじめ・はず・まで）');
  }
  return found;
}

const CONNECT = /^(?:しかし|また|そして|ただし|ただ|一方|つまり|だから|そこで|さらに|なお|ところが|では|でも|たとえば|例えば|そのため|したがって|ところで|けれども|それでも|むしろ|要するに|あわせて|その結果|このため|まず|次に|最後に|すると|それで|加えて|なぜなら|とはいえ|だが|これ|それ|この|その|こう|そう|ここ|そこ)/;
const pct = (a, b) => `${Math.round((a / b) * 100)}%`;

/** 文章の形：理由の後置と「〜のは、〜です」は 1 か所ずつ、割合は 20 文以上の文章で全体の数字を 1 行ずつ */
export function shapePatterns(lines, blocks, { min = 20, article = false } = {}) {
  const found = [];
  const prose = [];
  for (const all of blocks) {
    // 1 か所ずつ出す型は、箇条書きの中の文も見る。割合は地の文だけで数える
    const every = all.filter((x) => !x.quote).map((x) => ({ no: x.no, list: x.list, text: unquoted(x.text) }));
    const b = every.filter((x) => !x.list);
    every.forEach((x, i) => {
      const renyo = x.text.match(/の(確かめ|直し|比べ|測り|調べ|決め|選び|集め|探し|整え|そろえ|揃え|外し|戻し|削り|消し|残し|伝え|並べ|分け|減らし|増やし)(?=[はがをにでも、。])/);
      if (renyo) {
        found.push({ no: x.no, kind: 'shape', msg: `「〜の${renyo[1]}」は和語の動詞を名詞にした形。文書で使う語（確認・修正・比較・測定・調査・決定・選択）か、目的語と動詞の文（「結果を確かめる」）にする：${head(x.text)}` });
      }
      if (/(?:だけ|のみ)で、[^。]*(?:ない|ません)(?:ので|ため|から)/.test(x.text)) {
        found.push({ no: x.no, kind: 'shape', msg: `「〜だけで、〜ないので」と、限定と否定で説明している。行う内容を肯定の形で書く：${head(x.text)}` });
      }
      if (i > 0 && /(?:ため|から)(?:です|である|だ|でした)。$/.test(x.text) && !/^(?:これは|それは|なぜなら)/.test(x.text)) {
        found.push({ no: x.no, kind: 'shape', msg: `理由を後ろの文に分けている。前の文と 1 文にまとめる（〜のため、〜）：${head(x.text)}` });
      }
      if (/^[^、。]{2,30}(?:(?:の|こと)は、|(?<!も)のは)[^。]{2,70}(?:です|である|だ|でした)。$/.test(x.text) && !/(?:ない|ません)。$/.test(x.text)) {
        found.push({ no: x.no, kind: 'shape', msg: `「〜のは、〜です」の形。主語を示し、動詞の文にする：${head(x.text)}` });
      }
      // 読み手の受け取り方と効果の見込みを言い切った文。所感は確かめていないため和らげる（S003 の記事で、筆者が「伝わります」を「伝わりやすくなります」に直した）
      const felt = x.text.match(/(伝わります|伝わる|迷いません|迷わない|読みやすくなります|読みやすくなる|読みやすいです|読みやすい|楽になります|楽になる|防げます|防げる|(?<!不)自然になります|(?<!不)自然になる|(?<!不)自然です)。$/);
      if (felt) {
        found.push({ no: x.no, kind: 'shape', msg: `「${felt[1]}」と、読み手の受け取り方か効果の見込みを言い切っている。確かめた事実でなければ「〜やすくなります」「〜はずです」と和らげる：${head(x.text)}` });
      }
    });
    prose.push(...b);
  }
  // 段落の書き出し：人の白書・報告・リリース・技術ブログ・解説は「〜は」で始まる段落が 9〜18%。この Skill の旧版を読ませて書かせた説明文は 35〜43%（Skill なしの AI は 25%）。文書ごとでは人の 62 本中 8 本、AI の 12 本中 7 本が 4 割を超える
  const firsts = blocks.map((all) => all.filter((x) => !x.list && !x.quote)[0]).filter((x) => x && len(x.text) >= 15);
  const waFirst = firsts.filter((x) => /^[^、。]{2,28}?(?<![でにとの])は[、\p{L}\p{N}「]/u.test(unquoted(x.text)) && !CONNECT.test(x.text));
  if (firsts.length >= 8 && waFirst.length / firsts.length > 0.4) {
    found.push({ no: waFirst[0].no, kind: 'shape', msg: `段落の ${pct(waFirst.length, firsts.length)} が「〜は」で始まる（人の文書は多くが 3 割以下）。目的語は「を」で書き、範囲は「〜では」、時点は日付、前の段落との関係は接続詞で始める（${waFirst.slice(0, 5).map((x) => x.no).join('・')} 行など）` });
  }
  const body = lines.map((l) => l.text.trim().replace(/^>\s?/, '').replace(/\*\*/g, '')).filter((t) => t && !HEADING.test(t) && !/^(---|\*\*\*|\|.*)$/.test(t));
  const bullets = body.filter((t) => LIST.test(t)).length;
  const top = lines.find((l) => l.text.trim())?.no ?? 1;
  if (body.length >= min && bullets / body.length > 0.3) {
    found.push({ no: top, kind: 'shape', msg: `行の ${pct(bullets, body.length)} が箇条書き（人の解説・報告は 2〜19%、手順書・ヘルプは 4 割ほど）。説明・理由・経緯を箇条書きにしていないか` });
  }
  const n = prose.length;
  if (n >= min) {
    const c = prose.filter((x) => CONNECT.test(x.text)).length;
    if (c / n < 0.05) found.push({ no: top, kind: 'shape', msg: `接続詞か指示語で始まる文が ${pct(c, n)}（人の解説・報告は 1〜3 割）。逆接・因果の接続詞と「これは」「その結果」で前の文を受けていない` });
    const neg = prose.filter((x) => /(?:ない|ません|ず)。$/.test(x.text)).length;
    if (neg / n > 0.1) found.push({ no: top, kind: 'shape', msg: `否定で終わる文が ${pct(neg, n)}（人の文章は 0〜8%）。しないこと・できないことを、読み手が誤解しやすい箇所に限って書く` });
    const only = prose.filter((x) => /(?:だけ|のみ)(?!でなく|ではなく)/.test(x.text)).length;
    if (only / n > 0.1) found.push({ no: top, kind: 'shape', msg: `「だけ・のみ」のある文が ${pct(only, n)}（人の文章は 1〜8%）。限定は必要な箇所にとどめ、資料では「のみ」を使う` });
    // 「主題は、短い述語。」：解説・報告・リリース・技術ブログは 1〜2%、お知らせ・ヘルプは 3〜4%。この Skill の旧版を読ませて書かせた説明文は 6〜8%（Skill なしの AI は 2%）
    const tail = prose.filter((x) => /は、[^、。]{1,12}。$/.test(x.text));
    if (tail.length / n > 0.04) found.push({ no: tail[0].no, kind: 'shape', msg: `「〜は、」の後ろが 12 字以下で終わる文が ${pct(tail.length, n)}（人の文書は 1〜4%）。短い文の読点を省くか、前後の文とつなぐ（${tail.slice(0, 5).map((x) => x.no).join('・')} 行など）` });
    // 「〜ました。」：障害報告・技術ブログは 14〜15%、リリースは 6%。AI の作業報告は 37〜50%
    const did = prose.filter((x) => /(?:まし|でし)た。$/.test(x.text)).length;
    if (did / n > 0.3) found.push({ no: top, kind: 'shape', msg: `「〜ました。」で終わる文が ${pct(did, n)}（人の報告は 6〜15%）。したことの一覧は表か箇条書きにまとめ、本文は現在の状態と分かったことを現在形で書く` });
    // 理由の「ので」：白書・障害報告・解説は千字あたり 0〜0.2 回で「ため」が 0.6〜1.4 回。AI の説明文は「ので」が 1 回を超えた
    const node = prose.filter((x) => /ので[、。]/.test(x.text)).length;
    const tame = prose.filter((x) => /ため[、。に]/.test(x.text)).length;
    if (!article && node >= 3 && node > tame) found.push({ no: top, kind: 'shape', msg: `理由の「ので」が ${node} 文、「ため」が ${tame} 文。説明資料・報告・手順書では「〜ため」を使う（チャットと記事は「ので」でよい）` });
  }
  return found;
}

export function check(text, { maxLength = 100, article = false } = {}) {
  const lines = bodyLines(text);
  const blocks = sentencesByBlock(lines);
  return [
    ...repeats(lines),
    ...wordsAndAgents(blocks),
    ...stylePatterns(blocks, { maxLength }),
    ...keigoPatterns(blocks),
    ...kanaPatterns(blocks),
    ...formatPatterns(lines),
    ...shapePatterns(lines, blocks, { article }),
    ...(article ? [...flatBlocks(blocks), ...sameEndings(blocks), ...wordPatterns(own(blocks))] : []),
  ].sort((a, b) => a.no - b.no);
}

/** 確認箇所を 1 行ずつの文字列にする */
export const describe = (found) => found.map((f) => `${f.no}: [${f.kind}] ${f.msg}`);

/** UTF-8 として読めない文字（U+FFFD）か NUL があれば、文字化けとみなす（Shift_JIS・UTF-16 のファイル） */
export const garbled = (text) => /�|\u0000/.test(text);

function isMain() {
  if (!process.argv[1]) return false;
  const norm = (p) => {
    const r = fs.realpathSync(p);
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  try {
    return norm(process.argv[1]) === norm(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  const args = process.argv.slice(2);
  const files = [];
  let maxLength = 100;
  let article = false;
  let bad = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--max-length') {
      maxLength = Number(args[++i]);
      if (!Number.isInteger(maxLength) || maxLength < 1) {
        console.error('--max-length には 1 以上の整数を渡す');
        bad = true;
      }
    } else if (args[i] === '--article') article = true;
    else if (args[i].startsWith('--')) {
      console.error(`不明な指定：${args[i]}`);
      bad = true;
    } else files.push(args[i]);
  }
  if (!files.length && !bad) {
    console.error('使い方：node check.mjs <文章.md|.txt> [...] [--article] [--max-length 100]');
    bad = true;
  }
  if (bad) process.exitCode = 1;
  else {
    for (const f of files) {
      let text;
      try {
        text = fs.readFileSync(f, 'utf8');
      } catch (e) {
        console.error(`読めない：${f}（${e.code ?? e.message}）`);
        process.exitCode = 1;
        continue;
      }
      if (garbled(text)) {
        console.error(`文字化け：${f}（UTF-8 でない。UTF-8 で保存し直して渡す）`);
        process.exitCode = 1;
        continue;
      }
      const found = check(text, { maxLength, article });
      console.log(`== ${f}：確認箇所 ${found.length} 件`);
      for (const line of describe(found)) console.log(`  ${line}`);
    }
  }
}
