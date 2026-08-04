// Pilot test: dung Bright Data Browser API (Scraping Browser) thay vi Chrome
// local/self-hosted. Logic scrape listing (click "Xem them", scroll) COPY
// NGUYEN VEN tu scrapeFPT() trong multi_dealer_scraper.js - khong doi gi ca,
// chi doi cach ket noi browser (puppeteer.connect thay vi puppeteer.launch).
// Neu pilot nay dat so luong SP tuong duong production (~150-165) thi coi
// nhu xac nhan Browser API dung duoc, buoc sau moi tich hop vao production
// that (bao gom ca fetch specs tung SP - se ton bandwidth hon nhieu).
const fs = require('fs');
const puppeteer = require('puppeteer');

const WS_ENDPOINT = process.env.BRIGHTDATA_BROWSER_WS;
const FPT_ALL_URL = 'https://fptshop.com.vn/may-tinh-xach-tay';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function scrapeListingOnly(page) {
  await page.goto(FPT_ALL_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('div.cardInfo', { timeout: 15000 }).catch(() => {});
  await sleep(2000);

  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await sleep(2000);
  }

  let clicks = 0;
  while (true) {
    const clicked = await page.evaluate(() => {
      const allBtns = [...document.querySelectorAll('button, a')];
      const loadMoreBtn = allBtns.find(el =>
        /xem\s*thêm\s+\d+/i.test(el.textContent || '') && el.offsetParent !== null
      );
      if (loadMoreBtn) { loadMoreBtn.scrollIntoView({block:'center'}); loadMoreBtn.click(); return true; }
      const fallbackBtn = allBtns.find(el => {
        if (!/xem\s*thêm/i.test(el.textContent || '')) return false;
        if ((el.textContent || '').trim().length > 80) return false;
        if (el.closest('div.cardInfo')) return false;
        if (!el.offsetParent) return false;
        return true;
      });
      if (fallbackBtn) { fallbackBtn.scrollIntoView({block:'center'}); fallbackBtn.click(); return true; }
      return false;
    }).catch(() => false);
    if (!clicked) break;
    clicks++;
    await sleep(2000);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await sleep(1500);
    if (clicks > 50) break;
  }

  const products = await page.evaluate((BASE) => {
    const out = [];
    const seen = new Set();
    document.querySelectorAll('div.cardInfo').forEach(card => {
      const linkEl = card.querySelector('a[href*="may-tinh-xach-tay/"]');
      if (!linkEl) return;
      const href = linkEl.getAttribute('href') || '';
      const link = href.startsWith('http') ? href : BASE + href;
      if (!href || seen.has(link)) return;
      seen.add(link);
      const name = card.querySelector('h3, h2')?.textContent?.trim() || '';
      if (!name || name.length < 5) return;
      out.push({ name, link });
    });
    return out;
  }, 'https://fptshop.com.vn');

  return { products, clicks };
}

(async () => {
  const log = [];
  const record = (msg) => { console.log(msg); log.push(msg); };

  if (!WS_ENDPOINT) {
    record('LOI: thieu BRIGHTDATA_BROWSER_WS');
    fs.mkdirSync('scrape-output', { recursive: true });
    fs.writeFileSync('scrape-output/browserapi_log.txt', log.join('\n'));
    process.exit(1);
  }

  const t0 = Date.now();
  let browser;
  try {
    record(`Dang ket noi Bright Data Browser API...`);
    browser = await puppeteer.connect({ browserWSEndpoint: WS_ENDPOINT });
    record(`Da ket noi. Dang mo page va scrape ${FPT_ALL_URL} ...`);
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(60000);

    // Chan tai anh/font/media/stylesheet — chi can HTML/JS de lay data, khong
    // can render hinh anh that. Giam bang thong manh (Browser API tinh tien
    // theo GB) ma khong anh huong ket qua scrape (chi lay text/link).
    let blockedBytes = 0, allowedBytes = 0;
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      if (['image', 'font', 'media'].includes(type)) {
        blockedBytes++; // dem so request bi chan (khong co size truoc khi tai)
        req.abort();
      } else {
        allowedBytes++;
        req.continue();
      }
    });

    const { products, clicks } = await scrapeListingOnly(page);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    record(`Xong sau ${elapsed}s. So lan click "Xem them": ${clicks}. So SP lay duoc: ${products.length}`);
    record(`Requests: chan ${blockedBytes} (image/font/media), cho phep ${allowedBytes}`);
    record(`5 SP dau: ${JSON.stringify(products.slice(0, 5), null, 0)}`);

    fs.mkdirSync('scrape-output', { recursive: true });
    fs.writeFileSync('scrape-output/browserapi_products.json', JSON.stringify(products, null, 2));
  } catch (e) {
    record(`LOI: ${e.message}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  fs.mkdirSync('scrape-output', { recursive: true });
  fs.writeFileSync('scrape-output/browserapi_log.txt', log.join('\n'));
})();
