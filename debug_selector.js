// Chi 1 session Browser API, dump DOM SAU KHI click "Xem tat ca thong so" de
// tim dung selector hien tai (selector cu .flex.gap-2.border-b da khong con
// dung). Muc tieu: xac dinh cau truc dung 1 lan, tranh chay lai nhieu lan
// tốn budget.
const fs = require('fs');
const puppeteer = require('puppeteer');

const WS_ENDPOINT = process.env.BRIGHTDATA_BROWSER_WS;
const URL = 'https://fptshop.com.vn/may-tinh-xach-tay/acer-aspire-go-14-ag14-72p-563l-core-5-120u';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const log = [];
  const record = (m) => { console.log(m); log.push(m); };
  let browser;
  try {
    browser = await puppeteer.connect({ browserWSEndpoint: WS_ENDPOINT });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(60000);
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(1500);

    const clicked = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('span, button, a')]
        .find(b => b.innerText?.trim() === 'Xem tất cả thông số');
      if (btn) { btn.click(); return true; }
      return false;
    });
    record(`Da click nut: ${clicked}`);
    await sleep(1500);

    // Tim container chua "Dung lượng RAM" SAU khi click, dump cau truc quanh no
    const info = await page.evaluate(() => {
      const all = [...document.querySelectorAll('*')];
      const target = all.find(el =>
        el.children.length === 0 && /Dung lượng RAM/.test(el.textContent || '') && el.textContent.trim() === 'Dung lượng RAM'
      );
      if (!target) return { found: false, bodyTextSnippet: (document.body.innerText || '').slice(0, 500) };
      // Di len 4 cap cha de tim container lap lai (row pattern)
      let row = target;
      const chain = [];
      for (let i = 0; i < 5 && row; i++) {
        chain.push({ tag: row.tagName, className: row.className, outerHTMLSnippet: row.outerHTML.slice(0, 300) });
        row = row.parentElement;
      }
      // Dem so phan tu co cung class voi cha truc tiep cua target (de doan selector lap)
      const parent = target.parentElement;
      const grandParent = parent ? parent.parentElement : null;
      let siblingCount = 0, siblingClass = '';
      if (grandParent) {
        siblingClass = parent.className;
        siblingCount = [...grandParent.children].filter(c => c.className === parent.className).length;
      }
      return { found: true, chain, siblingClass, siblingCount };
    });
    fs.mkdirSync('scrape-output', { recursive: true });
    fs.writeFileSync('scrape-output/selector_debug.json', JSON.stringify(info, null, 2));
    record(`Ket qua: ${JSON.stringify(info).slice(0, 2000)}`);
  } catch (e) {
    record(`LOI: ${e.message}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  fs.mkdirSync('scrape-output', { recursive: true });
  fs.writeFileSync('scrape-output/selector_debug_log.txt', log.join('\n'));
})();
