# 画面を測る例（Playwright）

Node と Playwright がある所で、ページを2つの幅で開いて撮り、下限の項目を測る例。ファイル名や URL は置き換える。Playwright が無ければ、ブラウザの開発者ツールで同じことを見る（コンソールに `page.evaluate` の中身を貼る）。

```js
// check-ui.mjs  使い方：node check-ui.mjs <URL かファイルのパス>
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
const target = process.argv[2];
const url = /^https?:/.test(target) ? target : pathToFileURL(target).href;
const browser = await chromium.launch();
for (const [name, width, height] of [['phone', 390, 844], ['desktop', 1440, 900]]) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(url);
  await page.screenshot({ path: `shot-${name}.png`, fullPage: true });
  const r = await page.evaluate(() => {
    const rgb = s => (s.match(/[\d.]+/g) || []).map(Number);
    const lum = ([r, g, b]) => [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
      .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
    const bgOf = el => { for (; el; el = el.parentElement) { const c = rgb(getComputedStyle(el).backgroundColor); if (c.length === 3 || c[3] > 0) return c; } return [255, 255, 255]; };
    const low = [], small = [];
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      const text = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) || el.matches('input[type=submit], input[type=button]');
      const label = el.textContent.trim() || el.value || '';
      if (text && cs.visibility !== 'hidden' && el.getClientRects().length) {
        const a = lum(rgb(cs.color)), b = lum(bgOf(el));
        const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        const px = parseFloat(cs.fontSize), big = px >= 24 || (px >= 18.66 && +cs.fontWeight >= 700);
        if (ratio < (big ? 3 : 4.5)) low.push(`${el.tagName} "${label.slice(0, 15)}" ${ratio.toFixed(2)}`);
        if (px < 14) low.push(`${el.tagName} "${label.slice(0, 15)}" ${px}px`);
      }
      // 文の途中のリンクだけを除く（「連絡先：」のように短い文に1つで置いたリンクは測る）
      const box = el.closest('p, li');
      const inText = el.matches('a') && box && box.textContent.trim().length > el.textContent.trim().length + 10;
      if (el.matches('a, button, input, select, textarea, [role=button]') && !inText) {
        const b = el.getBoundingClientRect();
        if (b.width && (b.height < 44 || b.width < 44)) small.push(`${el.tagName} ${Math.round(b.width)}x${Math.round(b.height)}`);
      }
    }
    return {
      overflowX: document.documentElement.scrollWidth - innerWidth,
      bodyFont: getComputedStyle(document.body).fontSize,
      lang: document.documentElement.lang,
      lowContrastOrSmallText: low, smallTargets: small,
    };
  });
  console.log(name, JSON.stringify(r, null, 1));
  await page.close();
}
await browser.close();
```

- `overflowX` が 1 以上なら横にはみ出している。どの要素かは、幅の広い要素を順に探す（`[...document.querySelectorAll('*')].filter(e => e.getBoundingClientRect().right > innerWidth)`）。
- 色の比は、背景が画像・グラデーション・半透明の色だと正しく測れない（半透明の地は下の色と重ねずに比を出す）。placeholder の文字も測っていない（`::placeholder` の色は開発者ツールで見る）。どちらも撮った画像で見る。
- フォーカスは Tab を押して撮る（`await page.keyboard.press('Tab'); await page.screenshot(...)`）。
- 小さい押せる所は、文の途中のリンク（`p`・`li` の中で、前後に10字を超える文があるもの）を除いている。チェックボックスやラジオは、ラベルまで含めた押せる広さで見る。
