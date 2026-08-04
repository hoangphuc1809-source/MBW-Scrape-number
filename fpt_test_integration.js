// Tich hop FPT_TEST: scrape listing FPT qua Bright Data Browser API (khong
// can self-hosted), ghi vao tab rieng "FPT_TEST" trong spreadsheet Retail
// Price Tracking - KHONG dung production ("RAW DATA" tab). Chi lay
// listing (ten, gia, hang, tinh trang, link) - PHAN SPECS (CPU/RAM/...)
// tam thoi bo qua vi selector cu da loi thoi (can dieu tra rieng, khong
// chan viec xac nhan ha tang Browser API hoat dong on dinh).
const fs = require('fs');
const puppeteer = require('puppeteer');
const { google } = require('googleapis');

const WS_ENDPOINT = process.env.BRIGHTDATA_BROWSER_WS;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const CREDS_PATH = '/tmp/gcreds.json';
const FPT_ALL_URL = 'https://fptshop.com.vn/may-tinh-xach-tay';
const TEST_SHEET_NAME = 'FPT_TEST';

const HEADERS = ['Ngày','Giờ','STT','Dealer','Tên Model','Hãng','Giá gốc (₫)','Giá KM (₫)','Giảm (%)','Tình trạng','Link sản phẩm','Nguồn'];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function scrapeListing(page) {
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
      const loadMoreBtn = allBtns.find(el => /xem\s*thêm\s+\d+/i.test(el.textContent || '') && el.offsetParent !== null);
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
    function detectBrand(name) {
      const n = (name || '').toLowerCase();
      if (n.includes('msi')) return 'MSI';
      if (n.includes('asus') || n.includes('vivobook') || n.includes('zenbook') || n.includes('rog') || n.includes('tuf')) return 'Asus';
      if (n.includes('acer') || n.includes('aspire') || n.includes('predator') || n.includes('nitro') || n.includes('swift')) return 'Acer';
      if (n.includes('dell') || n.includes('inspiron') || n.includes('xps') || n.includes('alienware') || n.includes('latitude') || n.includes('vostro')) return 'Dell';
      if (n.includes('hp ') || n.includes('pavilion') || n.includes('envy') || n.includes('spectre') || n.includes('omen') || n.includes('elitebook') || n.includes('probook') || n.includes('victus')) return 'HP';
      if (n.includes('lenovo') || n.includes('ideapad') || n.includes('thinkpad') || n.includes('legion') || n.includes('yoga') || n.includes('loq')) return 'Lenovo';
      if (n.includes('samsung') || n.includes('galaxy book')) return 'Samsung';
      if (n.includes('macbook') || n.includes('apple')) return 'MacBook';
      if (n.includes('gigabyte') || n.includes('aorus')) return 'Gigabyte';
      if (n.includes('lg ') || n.includes('gram')) return 'LG';
      if (n.includes('huawei') || n.includes('matebook')) return 'Huawei';
      if (n.includes('microsoft') || n.includes('surface')) return 'Microsoft';
      return 'Other';
    }
    document.querySelectorAll('div.cardInfo').forEach(card => {
      const linkEl = card.querySelector('a[href*="may-tinh-xach-tay/"]');
      if (!linkEl) return;
      const href = linkEl.getAttribute('href') || '';
      const link = href.startsWith('http') ? href : BASE + href;
      if (!href || seen.has(link)) return;
      seen.add(link);
      const name = card.querySelector('h3, h2')?.textContent?.trim() || '';
      const salePrice = parseInt((card.querySelector('p.b1-semibold,[class*="b1-semibold"]')?.textContent||'').replace(/\D/g,'')) || 0;
      const origPrice = parseInt((card.querySelector('span[class*="line-through"]')?.textContent||'').replace(/\D/g,'')) || 0;
      const discount = card.querySelector('[class*="discount"],[class*="percent"]')?.innerText?.trim() || '';
      if (!name || name.length < 5) return;
      const fptStatus = (() => {
        const cardText = (card.innerText || '').toLowerCase();
        if (/hàng sắp về/.test(cardText)) return 'Hàng sắp về';
        if (/ngừng/.test(cardText)) return 'Ngừng KD';
        if (!salePrice && !origPrice) return 'Chưa rõ';
        return 'Còn hàng';
      })();
      out.push({ name, brand: detectBrand(name), origPrice, salePrice, discount, link, stockStatus: fptStatus });
    });
    return out;
  }, 'https://fptshop.com.vn');

  return { products, clicks };
}

async function ensureTestSheetExists(sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const exists = meta.data.sheets.some(s => s.properties.title === TEST_SHEET_NAME);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: TEST_SHEET_NAME } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${TEST_SHEET_NAME}!A1:${String.fromCharCode(64 + HEADERS.length)}1`,
      valueInputOption: 'RAW',
      requestBody: { values: [HEADERS] },
    });
    return true;
  }
  return false;
}

(async () => {
  const log = [];
  const record = (m) => { console.log(m); log.push(m); };
  let browser;
  const runInfo = { startedAt: new Date().toISOString() };

  try {
    if (!WS_ENDPOINT) throw new Error('Thieu BRIGHTDATA_BROWSER_WS');
    if (!SPREADSHEET_ID) throw new Error('Thieu SPREADSHEET_ID');
    if (!process.env.GOOGLE_CREDENTIALS) throw new Error('Thieu GOOGLE_CREDENTIALS');

    record('Dang ket noi Bright Data Browser API...');
    browser = await puppeteer.connect({ browserWSEndpoint: WS_ENDPOINT });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(60000);

    const t0 = Date.now();
    const { products, clicks } = await scrapeListing(page);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    record(`Scrape xong sau ${elapsed}s. Click "Xem them": ${clicks}. So SP: ${products.length}`);
    runInfo.productCount = products.length;
    runInfo.clicks = clicks;
    runInfo.elapsedSec = elapsed;

    // Luu ngay ra file TRUOC khi thu ghi Sheet - neu ghi Sheet loi thi van
    // con data de ghi lai sau ma KHONG can scrape lai (ton tien).
    fs.mkdirSync('scrape-output', { recursive: true });
    fs.writeFileSync('scrape-output/fpttest_products.json', JSON.stringify(products, null, 2));
    record(`Da luu ${products.length} SP ra file (phong khi ghi Sheet loi)`);

    await browser.close().catch(() => {});
    browser = null; // dong browser truoc khi ghi Sheet - khong can giu ket noi (tiet kiem)

    // Ghi vao Google Sheet, retry toi 3 lan neu loi tam thoi
    fs.writeFileSync(CREDS_PATH, process.env.GOOGLE_CREDENTIALS);
    const auth = new google.auth.GoogleAuth({ keyFile: CREDS_PATH, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
    const sheets = google.sheets({ version: 'v4', auth });

    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const created = await ensureTestSheetExists(sheets);
        record(`Tab FPT_TEST ${created ? 'moi tao' : 'da ton tai'} (lan thu ${attempt})`);

        const now = new Date();
        const dateStr = now.toLocaleDateString('vi-VN');
        const timeStr = now.toLocaleTimeString('vi-VN');
        const rows = products.map((p, i) => [
          dateStr, timeStr, i + 1, 'FPT Retail', p.name, p.brand,
          p.origPrice, p.salePrice, p.discount, p.stockStatus, p.link, 'BrightData-BrowserAPI',
        ]);

        await sheets.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID,
          range: `${TEST_SHEET_NAME}!A1`,
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: rows },
        });
        record(`Da ghi ${rows.length} dong vao tab FPT_TEST`);
        runInfo.status = 'success';
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        record(`Lan thu ${attempt} ghi Sheet loi: ${e.message}`);
        if (attempt < 3) await sleep(5000 * attempt);
      }
    }
    if (lastErr) throw lastErr;
  } catch (e) {
    record(`LOI: ${e.message}`);
    runInfo.status = 'error';
    runInfo.error = e.message;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  fs.mkdirSync('scrape-output', { recursive: true });
  fs.writeFileSync('scrape-output/fpttest_log.txt', log.join('\n'));
  fs.writeFileSync('scrape-output/fpttest_runinfo.json', JSON.stringify(runInfo, null, 2));
})();
