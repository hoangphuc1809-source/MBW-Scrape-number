/**
 * ═══════════════════════════════════════════════════════
 *  TGDĐ LAPTOP SCRAPER — Final Clean Version
 *  Tên file: tgdd_scraper.js
 *
 *  HEADER SHEET (17 cột):
 *  Ngày | Giờ | STT | Tên Model | Hãng | CPU | RAM | Ổ cứng |
 *  Màn hình | Card | Trọng lượng | Giá gốc | Giá KM | Giảm% |
 *  Đã bán | Rating | Link
 *
 *  LOGIC LỊCH SỬ:
 *  - Cùng ngày → ghi chồng (xóa rows hôm nay, ghi lại)
 *  - Ngày mới  → append thêm vào cuối
 * ═══════════════════════════════════════════════════════
 */

const puppeteer  = require('puppeteer');
const { google } = require('googleapis');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ── ENV ──────────────────────────────────────────────────
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '';
const GOOGLE_CREDS   = process.env.GOOGLE_CREDENTIALS || '';
if (!SPREADSHEET_ID) { console.error('❌ Thiếu SPREADSHEET_ID'); process.exit(1); }
if (!GOOGLE_CREDS)   { console.error('❌ Thiếu GOOGLE_CREDENTIALS'); process.exit(1); }

const CRED_FILE = path.join(os.tmpdir(), 'tgdd_gcp.json');
fs.writeFileSync(CRED_FILE, GOOGLE_CREDS, 'utf8');

// ── NGÀY HÔM NAY ─────────────────────────────────────────
// Format: DD/MM/YYYY — dùng làm key so sánh
const NOW        = new Date();
const TODAY_DATE = NOW.toLocaleDateString('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  day: '2-digit', month: '2-digit', year: 'numeric'
}); // → "08/06/2026"
const TODAY_TIME = NOW.toLocaleTimeString('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
}); // → "09:00:15"

console.log(`📅 Ngày: ${TODAY_DATE}  ⏰ Giờ: ${TODAY_TIME}`);

// ── CONFIG ───────────────────────────────────────────────
const SHEET_NAME = 'Laptop TGDĐ';
const BRANDS = [
  { name: 'HP',       url: 'https://www.thegioididong.com/laptop-hp-compaq'    },
  { name: 'Asus',     url: 'https://www.thegioididong.com/laptop-asus'         },
  { name: 'Acer',     url: 'https://www.thegioididong.com/laptop-acer'         },
  { name: 'Lenovo',   url: 'https://www.thegioididong.com/laptop-lenovo'       },
  { name: 'Dell',     url: 'https://www.thegioididong.com/laptop-dell'         },
  { name: 'MSI',      url: 'https://www.thegioididong.com/laptop-msi'          },
  { name: 'MacBook',  url: 'https://www.thegioididong.com/laptop-apple-macbook'},
  { name: 'Gigabyte', url: 'https://www.thegioididong.com/laptop-gigabyte'     },
  { name: 'Samsung',  url: 'https://www.thegioididong.com/laptop-samsung'      },
];

const HEADERS = [
  'Ngày', 'Giờ', 'STT', 'Tên Model', 'Hãng',
  'CPU', 'RAM', 'Ổ cứng', 'Màn hình', 'Card đồ họa', 'Trọng lượng',
  'Giá gốc (₫)', 'Giá KM (₫)', 'Giảm (%)',
  'Đã bán', 'Rating (★)', 'Link sản phẩm'
];
// Index (0-based): Ngày=0, Giờ=1, STT=2, Giá gốc=11, Giá KM=12, Giảm=13

// ════════════════════════════════════════════════════════
async function main() {
  console.log('\n🚀 TGDĐ Laptop Scraper — khởi động...');
  const t0 = Date.now();

  // 1. Scrape
  const browser = await launchBrowser();
  const page    = await setupPage(browser);

  let products = [];
  for (const brand of BRANDS) {
    console.log(`\n▶ ${brand.name}`);
    const list = await scrapeBrand(page, brand);
    products   = products.concat(list);
    console.log(`  ✓ ${list.length} SP (tổng: ${products.length})`);
    await sleep(2000);
  }
  await browser.close();
  console.log(`\n📦 Tổng scrape: ${products.length} sản phẩm`);

  // 2. Ghi Sheet
  const sheets = await initSheets();
  await writeHistory(sheets, products);

  console.log(`\n✅ Xong! (${((Date.now()-t0)/60000).toFixed(1)} phút)`);
}

// ── SCRAPE ───────────────────────────────────────────────
async function launchBrowser() {
  return puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--disable-dev-shm-usage', '--disable-gpu',
      '--disable-blink-features=AutomationControlled',
      '--lang=vi-VN', '--window-size=1366,768',
    ],
  });
}

async function setupPage(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 768 });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'plugins',   { get: () => [1,2,3] });
    Object.defineProperty(navigator, 'languages', { get: () => ['vi-VN','vi','en'] });
    window.chrome = { runtime: {} };
  });
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  );
  await page.setExtraHTTPHeaders({
    'Accept-Language'         : 'vi-VN,vi;q=0.9,en;q=0.8',
    'Accept'                  : 'text/html,application/xhtml+xml,*/*;q=0.8',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest'          : 'document',
    'Sec-Fetch-Mode'          : 'navigate',
    'Sec-Fetch-Site'          : 'none',
  });
  await page.setRequestInterception(true);
  page.on('request', req => {
    ['image','font','media'].includes(req.resourceType())
      ? req.abort() : req.continue();
  });
  return page;
}

async function scrapeBrand(page, brand) {
  try {
    await page.goto(brand.url, { waitUntil: 'networkidle2', timeout: 60000 });
  } catch(e) {
    console.log(`  ⚠ Không load được: ${e.message.substring(0,50)}`);
    return [];
  }
  await sleep(2000);

  // Click "Xem thêm" cho đến hết
  let clicks = 0;
  while (true) {
    await scrollToBottom(page);
    await sleep(1500);
    const clicked = await page.evaluate(() => {
      for (const sel of ['.view-more a:not(.prevent)','a.view-more','[class*="view-more"] a']) {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) { el.click(); return true; }
      }
      return false;
    });
    if (!clicked) break;
    clicks++;
    console.log(`  → Xem thêm lần ${clicks}`);
    await sleep(2500);
  }

  // Parse DOM
  return page.evaluate((brandName, BASE) => {
    const out  = [];
    const seen = new Set();
    document.querySelectorAll('ul.listproduct li.item').forEach(item => {
      const a    = item.querySelector('a.main-contain');
      if (!a) return;
      const href = a.getAttribute('href') || '';
      const name = a.getAttribute('data-name') || '';
      const link = href.startsWith('http') ? href : BASE + href;
      if (!name || !href || seen.has(link)) return;
      seen.add(link);

      const sp    = parseFloat(a.getAttribute('data-price') || '0');
      const oldEl = item.querySelector('p.price-old');
      const op    = oldEl ? parseInt(oldEl.innerText.replace(/[^\d]/g,'')) : 0;
      const pctEl = item.querySelector('span.percent');

      let cpu='', screen='', gpu='', weight='', ram='', storage='';
      item.querySelectorAll('div.utility p').forEach(p => {
        const t = p.innerText.trim();
        if      (t.startsWith('CPU:'))        cpu    = t.slice(4).trim().substring(0,60);
        else if (t.startsWith('Màn hình:'))   screen = t.slice(9).trim().substring(0,40);
        else if (t.startsWith('Card:'))       gpu    = t.slice(5).trim().substring(0,40);
        else if (t.startsWith('Khối lượng:')) weight = t.slice(11).trim();
      });
      item.querySelectorAll('div.item-compare span').forEach(s => {
        const t = s.innerText.trim();
        if (/RAM/i.test(t))      ram     = t;
        if (/SSD|HDD/i.test(t)) storage = t;
      });

      const rEl = item.querySelector('div.vote-txt b');
      let sold  = '';
      item.querySelectorAll('div.rating_Compare span').forEach(s => {
        if (s.innerText.includes('Đã bán'))
          sold = s.innerText.replace(/[•\s]*Đã bán\s*/i,'').trim();
      });

      out.push({
        name, brand: brandName, cpu, ram, storage, screen, gpu, weight,
        origPrice : op || '',
        salePrice : sp ? Math.round(sp) : '',
        discount  : pctEl ? pctEl.innerText.trim() : '',
        sold, rating: rEl ? rEl.innerText.trim() : '', link,
      });
    });
    return out;
  }, brand.name, 'https://www.thegioididong.com');
}

// ── GOOGLE SHEETS ─────────────────────────────────────────
async function initSheets() {
  const auth = new google.auth.GoogleAuth({
    keyFile: CRED_FILE,
    scopes : ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function writeHistory(sheets, products) {
  // Chuẩn bị rows hôm nay
  const todayRows = products.map((p, i) => [
    TODAY_DATE,          // Ngày  → "08/06/2026"
    TODAY_TIME,          // Giờ   → "09:00:15"
    i + 1,               // STT
    p.name, p.brand, p.cpu, p.ram, p.storage,
    p.screen, p.gpu, p.weight,
    p.origPrice || '', p.salePrice || '', p.discount,
    p.sold, p.rating, p.link,
  ]);

  // Đọc toàn bộ sheet hiện tại
  const res      = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID, range: SHEET_NAME,
  });
  const allRows  = res.data.values || [];
  const header   = allRows[0];
  const dataRows = allRows.slice(1);

  // Kiểm tra header — nếu chưa có hoặc lệch → reset header
  const needNewHeader = !header || header[0] !== 'Ngày' || header.length !== HEADERS.length;

  // Giữ lại các ngày KHÁC hôm nay
  const oldRows = dataRows.filter(row => row[0] !== TODAY_DATE);

  console.log(`  📅 Ngày cũ giữ lại: ${oldRows.length} rows`);
  console.log(`  📅 Hôm nay (${TODAY_DATE}): ghi ${todayRows.length} rows mới`);

  // Gộp: header + ngày cũ + hôm nay
  const finalData = [HEADERS, ...oldRows, ...todayRows];

  // Ghi lại toàn bộ
  await sheets.spreadsheets.values.update({
    spreadsheetId    : SPREADSHEET_ID,
    range            : `${SHEET_NAME}!A1`,
    valueInputOption : 'RAW',
    requestBody      : { values: finalData },
  });

  // Xóa rows thừa bên dưới nếu có
  const meta     = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheetObj = meta.data.sheets.find(s => s.properties.title === SHEET_NAME);
  const curRows  = sheetObj.properties.gridProperties.rowCount;
  if (curRows > finalData.length + 2) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody  : { requests: [{ deleteDimension: { range: {
        sheetId   : sheetObj.properties.sheetId,
        dimension : 'ROWS',
        startIndex: finalData.length,
        endIndex  : curRows,
      }}}]},
    });
  }

  // Format
  await applyFormat(sheets, sheetObj.properties.sheetId, finalData.length);
  console.log(`✓ Sheet OK — tổng ${finalData.length - 1} rows lịch sử`);
}

async function applyFormat(sheets, sheetId, totalRows) {
  const requests = [
    // Header: xanh đậm, chữ trắng, đậm
    { repeatCell: {
      range : { sheetId, startRowIndex:0, endRowIndex:1 },
      cell  : { userEnteredFormat: {
        backgroundColor     : { red:0.102, green:0.451, blue:0.914 },
        textFormat          : { foregroundColor:{red:1,green:1,blue:1}, bold:true, fontSize:10 },
        horizontalAlignment : 'CENTER' }},
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)' }},
    // Freeze row 1
    { updateSheetProperties: {
      properties: { sheetId, gridProperties:{ frozenRowCount:1 } },
      fields    : 'gridProperties.frozenRowCount' }},
    // Cột giá (index 11,12) → số có dấu phẩy
    { repeatCell: {
      range : { sheetId, startRowIndex:1, endRowIndex:totalRows, startColumnIndex:11, endColumnIndex:13 },
      cell  : { userEnteredFormat: { numberFormat:{ type:'NUMBER', pattern:'#,##0' } } },
      fields: 'userEnteredFormat.numberFormat' }},
    // Cột giảm (index 13) → đỏ đậm
    { repeatCell: {
      range : { sheetId, startRowIndex:1, endRowIndex:totalRows, startColumnIndex:13, endColumnIndex:14 },
      cell  : { userEnteredFormat: { textFormat:{ foregroundColor:{red:0.8,green:0.13,blue:0.08}, bold:true } } },
      fields: 'userEnteredFormat.textFormat' }},
    // Auto resize
    { autoResizeDimensions: {
      dimensions: { sheetId, dimension:'COLUMNS', startIndex:0, endIndex:HEADERS.length } }},
  ];

  // Zebra rows (chunk 500 để tránh giới hạn API)
  for (let r = 1; r < totalRows; r++) {
    requests.push({ repeatCell: {
      range : { sheetId, startRowIndex:r, endRowIndex:r+1, startColumnIndex:0, endColumnIndex:HEADERS.length },
      cell  : { userEnteredFormat: { backgroundColor: r%2===0
        ? {red:0.945,green:0.953,blue:0.957}
        : {red:1,green:1,blue:1} }},
      fields: 'userEnteredFormat.backgroundColor' }});
  }

  // Gửi theo batch 400 requests
  for (let i=0; i<requests.length; i+=400) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody  : { requests: requests.slice(i, i+400) },
    });
  }
}

// ── UTILS ─────────────────────────────────────────────────
async function scrollToBottom(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let y = 0;
      const t = setInterval(() => {
        window.scrollBy(0, 500); y += 500;
        if (y >= document.body.scrollHeight) { clearInterval(t); resolve(); }
      }, 150);
    });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(err => { console.error('\n❌', err.message); process.exit(1); });
