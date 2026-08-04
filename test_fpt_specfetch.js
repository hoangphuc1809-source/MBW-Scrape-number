// Test chi phi phan fetch specs (mo detail page tung SP) qua Browser API,
// tren mau 5 SP truoc khi chay full ~362 SP. Dung lai nguyen logic
// fetchSpecsFPT/safeGoto/mapSpecsFPT tu multi_dealer_scraper.js (copy khong
// doi), chi doi cach ket noi browser.
const fs = require('fs');
const puppeteer = require('puppeteer');

const WS_ENDPOINT = process.env.BRIGHTDATA_BROWSER_WS;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function safeGoto(page, url) {
  for (let i = 0; i <= 2; i++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
      return true;
    } catch (e) {
      if (i === 2) return false;
      await sleep(2000);
    }
  }
}

async function fetchSpecsFPT(page, url) {
  const ok = await safeGoto(page, url);
  if (!ok) return { error: 'goto failed' };
  await sleep(1200);
  const stockStatus = await page.evaluate(() => {
    const body = document.body.innerText || '';
    if (/hàng sắp về/i.test(body)) return 'Hàng sắp về';
    if (/ngừng kinh doanh|ngừng bán|stop.*sell/i.test(body)) return 'Ngừng KD';
    if (/hết hàng/i.test(body)) return 'Hết hàng';
    const priceEl = document.querySelector('[class*="b1-semibold"],[class*="price"]');
    if (priceEl && /liên hệ/i.test(priceEl.innerText || '')) return 'Liên hệ';
    return 'Còn hàng';
  }).catch(() => 'Còn hàng');

  const clicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('span, button, a')]
      .find(b => b.innerText?.trim() === 'Xem tất cả thông số');
    if (btn) { btn.click(); return true; }
    return false;
  }).catch(() => false);
  if (clicked) await sleep(700);

  const raw = await page.evaluate(() => {
    const specs = {};
    document.querySelectorAll('.flex.gap-2.border-b').forEach(row => {
      const ch = [...row.children];
      if (ch.length >= 2) {
        const label = ch[0].innerText?.trim();
        const value = ch[1].innerText?.trim().replace(/\n+/g, ' ');
        if (label && value) specs[label] = value;
      }
    });
    return specs;
  }).catch(() => ({}));

  return { stockStatus, specFieldCount: Object.keys(raw).length, raw };
}

const SAMPLE_URLS = [
  'https://fptshop.com.vn/may-tinh-xach-tay/acer-aspire-go-14-ag14-72p-563l-core-5-120u',
  'https://fptshop.com.vn/may-tinh-xach-tay/hp-250r-g9-core-5-120u-c40lkat',
  'https://fptshop.com.vn/may-tinh-xach-tay/asus-vivobook-x1404va-eb355w-core-7-150u',
  'https://fptshop.com.vn/may-tinh-xach-tay/dell-15-dc15250-i5-1334u-71092479',
  'https://fptshop.com.vn/may-tinh-xach-tay/macbook-neo-13-inch-8gb-256gb',
];

(async () => {
  const log = [];
  const record = (msg) => { console.log(msg); log.push(msg); };
  const results = [];

  let browser;
  try {
    record('Dang ket noi Bright Data Browser API...');
    browser = await puppeteer.connect({ browserWSEndpoint: WS_ENDPOINT });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(60000);

    for (const url of SAMPLE_URLS) {
      const t0 = Date.now();
      const spec = await fetchSpecsFPT(page, url);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      record(`${url} → ${elapsed}s, stockStatus=${spec.stockStatus}, specFields=${spec.specFieldCount}`);
      results.push({ url, elapsed, ...spec });
    }
  } catch (e) {
    record(`LOI: ${e.message}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  fs.mkdirSync('scrape-output', { recursive: true });
  fs.writeFileSync('scrape-output/specfetch_log.txt', log.join('\n'));
  fs.writeFileSync('scrape-output/specfetch_results.json', JSON.stringify(results, null, 2));
})();
