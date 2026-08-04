// FPT_TEST integration — scrape listing FPT qua Bright Data Browser API
// (khong can self-hosted/may phai bat), ghi vao tab rieng "FPT_TEST" trong
// spreadsheet Retail Price Tracking (KHONG dung tab production "RAW DATA").
// Muc dich: theo doi vai ngay truoc khi quyet dinh thay hoan toan self-hosted
// trong scrape.yml. Chi lay listing (ten, gia, hang, tinh trang, link) —
// PHAN SPECS CHI TIET (CPU/RAM/o cung...) tam bo qua: FPT da doi giao dien,
// nut "Xem tat ca thong so" khong con mo bang chi tiet nhu truoc (selector cu
// .flex.gap-2.border-b khong con ton tai) — can dieu tra rieng, khong lien
// quan ha tang Browser API.
const fs = require('fs');
const puppeteer = require('puppeteer');
const { google } = require('googleapis');

const WS_ENDPOINT = process.env.BRIGHTDATA_BROWSER_WS;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const CREDS_PATH = '/tmp/gcreds.json';
const FPT_ALL_URL = 'https://fptshop.com.vn/may-tinh-xach-tay';
const SHEET_NAME = 'FPT_TEST';
const HEADERS = ['Ngày', 'Giờ', 'STT', 'Hãng', 'Tên Model', 'Giá (đã hiển thị)', 'Tình trạng', 'Link sản phẩm'];

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function detectBrand(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('msi')) return 'MSI';
  if (n.includes('asus') || n.includes('vivobook') || n.includes('zenbook') || n.includes('rog') || n.includes('tuf')) return 'Asus';
  if (n.includes('acer') || n.includes('aspire') || n.includes('predator') || n.includes('nitro') || n.includes('swift')) return 'Acer';
  if (n.includes('hp ') || n.startsWith('hp')) return 'HP';
  if (n.includes('dell') || n.includes('inspiron') || n.includes('vostro') || n.includes('latitude') || n.includes('xps')) return 'Dell';
  if (n.includes('lenovo') || n.includes('thinkpad') || n.includes('ideapad') || n.includes('legion')) return 'Lenovo';
  if (n.includes('macbook') || n.includes('apple')) return 'Apple';
  if (n.includes('lg gram') || n.includes('lg ')) return 'LG';
  return 'Khác';
}

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
      const loadMoreBtn = allBtns.find((el) => /xem\s*thêm\s+\d+/i.test(el.textContent || '') && el.offsetParent !== null);
      if (loadMoreBtn) { loadMoreBtn.scrollIntoView({ block: 'center' }); loadMoreBtn.click(); return true; }
      const fallbackBtn = allBtns.find((el) => {
        if (!/xem\s*thêm/i.test(el.textContent || '')) return false;
        if ((el.textContent || '').trim().length > 80) return false;
        if (el.closest('div.cardInfo')) return false;
        if (!el.offsetParent) return false;
        return true;
      });
      if (fallbackBtn) { fallbackBtn.scrollIntoView({ block: 'center' }); fallbackBtn.click(); return true; }
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
    document.querySelectorAll('div.cardInfo').forEach((card) => {
      const linkEl = card.querySelector('a[href*="may-tinh-xach-tay/"]');
      if (!linkEl) return;
      const href = linkEl.getAttribute('href') || '';
      const link = href.startsWith('http') ? href : BASE + href;
      if (!href || seen.has(link)) return;
      seen.add(link);
      const name = card.querySelector('h3, h2')?.textContent?.trim() || '';
      if (!name || name.length < 5) return;
      const priceEl = card.querySelector('[class*="price"], [class*="Price"]');
      const price = priceEl?.textContent?.trim() || '';
      const bodyText = card.textContent || '';
      let stockStatus = 'Còn hàng';
      if (/hết hàng/i.test(bodyText)) stockStatus = 'Hết hàng';
      else if (/sắp về/i.test(bodyText)) stockStatus = 'Hàng sắp về';
      out.push({ name, link, price, stockStatus });
    });
    return out;
  }, 'https://fptshop.com.vn');

  return { products, clicks };
}

async function writeToTestSheet(sheets, products) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  const timeStr = now.toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets(properties(sheetId,title))' });
  const exists = meta.data.sheets.some((s) => s.properties.title === SHEET_NAME);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: SHEET_NAME } } }] },
    });
    console.log(`   📄 Đã tạo tab mới: ${SHEET_NAME}`);
  }

  const rows = products.map((p, i) => [dateStr, timeStr, i + 1, detectBrand(p.name), p.name, p.price, p.stockStatus, p.link]);

  await sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range: `${SHEET_NAME}!A2:H` });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A1:H1`,
    valueInputOption: 'RAW',
    requestBody: { values: [HEADERS] },
  });
  if (rows.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A2`,
      valueInputOption: 'RAW',
      requestBody: { values: rows },
    });
  }
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!J1`,
    valueInputOption: 'RAW',
    requestBody: { values: [[`Lần chạy gần nhất: ${dateStr} ${timeStr} — ${products.length} SP (qua Bright Data Browser API)`]] },
  });
}

(async () => {
  const t0 = Date.now();
  const summary = { ok: false, productCount: 0, clicks: 0, elapsedSec: 0, error: null };

  if (!WS_ENDPOINT || !SPREADSHEET_ID || !process.env.GOOGLE_CREDENTIALS) {
    console.log('❌ Thiếu biến môi trường bắt buộc (BRIGHTDATA_BROWSER_WS / SPREADSHEET_ID / GOOGLE_CREDENTIALS)');
    process.exit(1);
  }

  let browser;
  try {
    console.log('→ Kết nối Bright Data Browser API...');
    browser = await puppeteer.connect({ browserWSEndpoint: WS_ENDPOINT });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(60000);

    console.log(`→ Scrape listing: ${FPT_ALL_URL}`);
    const { products, clicks } = await scrapeListing(page);
    console.log(`← Lấy được ${products.length} SP (${clicks} lần click "Xem thêm")`);
    summary.productCount = products.length;
    summary.clicks = clicks;

    fs.writeFileSync(CREDS_PATH, process.env.GOOGLE_CREDENTIALS);
    const auth = new google.auth.GoogleAuth({ keyFile: CREDS_PATH, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
    const sheets = google.sheets({ version: 'v4', auth });

    console.log(`→ Ghi vào tab ${SHEET_NAME}...`);
    await writeToTestSheet(sheets, products);
    console.log('✅ Ghi xong.');
    summary.ok = true;
  } catch (e) {
    console.log(`❌ Lỗi: ${e.message}`);
    summary.error = e.message;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  summary.elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
  fs.mkdirSync('scrape-output', { recursive: true });
  fs.writeFileSync('scrape-output/fpttest_summary.json', JSON.stringify(summary, null, 2));
  console.log(`\n=== TÓM TẮT ===\n${JSON.stringify(summary, null, 2)}`);
  if (!summary.ok) process.exit(1);
})();
