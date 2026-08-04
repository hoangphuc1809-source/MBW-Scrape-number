// Debug: vi sao specFields=0. Kiem tra: nut "Xem tat ca thong so" co ton tai
// khong, click co tac dung khong, selector .flex.gap-2.border-b con dung
// khong tren cau truc trang hien tai.
const fs = require('fs');
const puppeteer = require('puppeteer');

const WS_ENDPOINT = process.env.BRIGHTDATA_BROWSER_WS;
const URL = 'https://fptshop.com.vn/may-tinh-xach-tay/macbook-neo-13-inch-8gb-256gb';

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
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await sleep(1500);

    // 1. Tim moi button/span/a co text lien quan "thong so"
    const btnCandidates = await page.evaluate(() => {
      return [...document.querySelectorAll('span, button, a, div')]
        .filter(el => /thông số|thong so|xem tất cả|specification/i.test(el.textContent || '') && el.children.length <= 2)
        .map(el => ({ tag: el.tagName, text: (el.textContent || '').trim().slice(0, 60), cls: el.className }))
        .slice(0, 15);
    });
    record(`Cac phan tu co text lien quan "thong so": ${JSON.stringify(btnCandidates, null, 1)}`);

    // 2. Thu click nut đung text cu
    const clicked = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('span, button, a')]
        .find(b => b.innerText?.trim() === 'Xem tất cả thông số');
      if (btn) { btn.click(); return true; }
      return false;
    }).catch(() => false);
    record(`Click nut "Xem tất cả thông số" (exact match): ${clicked}`);
    await sleep(1000);

    // 3. Kiem tra selector cu .flex.gap-2.border-b con ton tai bao nhieu
    const oldSelectorCount = await page.evaluate(() =>
      document.querySelectorAll('.flex.gap-2.border-b').length
    );
    record(`So phan tu khop selector cu .flex.gap-2.border-b: ${oldSelectorCount}`);

    // 4. Tim cac khu vuc co ve la bang thong so (heuristic: nhieu div con giong nhau, chua tu khoa CPU/RAM)
    const specAreaGuess = await page.evaluate(() => {
      const body = document.body.innerText || '';
      const idx = body.search(/CPU|Bộ nhớ RAM|Ổ cứng|Loại CPU/i);
      return idx >= 0 ? body.slice(Math.max(0, idx - 50), idx + 400) : '(khong tim thay tu khoa CPU/RAM trong body text)';
    });
    record(`Doan text quanh tu khoa CPU/RAM: ${specAreaGuess}`);

    // 5. Dump toan bo class list cua cac div co chua text "CPU" de tim selector moi
    const cpuRowInfo = await page.evaluate(() => {
      const els = [...document.querySelectorAll('*')].filter(el =>
        el.children.length === 0 && /^(Loại CPU|Công nghệ CPU|CPU)$/i.test((el.textContent||'').trim())
      );
      return els.slice(0, 5).map(el => {
        const parent = el.parentElement;
        const grandparent = parent?.parentElement;
        return {
          selfClass: el.className,
          parentClass: parent?.className,
          parentTag: parent?.tagName,
          grandparentClass: grandparent?.className,
        };
      });
    });
    record(`Cau truc DOM quanh label "CPU": ${JSON.stringify(cpuRowInfo, null, 1)}`);

  } catch (e) {
    record(`LOI: ${e.message}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  fs.mkdirSync('scrape-output', { recursive: true });
  fs.writeFileSync('scrape-output/specdebug_log.txt', log.join('\n\n'));
})();
