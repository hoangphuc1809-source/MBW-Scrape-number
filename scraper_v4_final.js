/**
 * TGDĐ LAPTOP SCRAPER v4 — Windows Self-hosted Runner Edition
 */

const puppeteer  = require('puppeteer');
const { google } = require('googleapis');
const fs         = require('fs');
const path       = require('path');
const os         = require('os');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '';
if (!SPREADSHEET_ID) { console.error('❌ Thiếu SPREADSHEET_ID'); process.exit(1); }

const credsJson = process.env.GOOGLE_CREDENTIALS || '';
if (!credsJson) { console.error('❌ Thiếu GOOGLE_CREDENTIALS'); process.exit(1); }

// ── Fix path cho cả Windows lẫn Linux ──
const CRED_PATH = path.join(os.tmpdir(), 'gcp_credentials.json');
fs.writeFileSync(CRED_PATH, credsJson);
console.log('✓ Credentials saved to:', CRED_PATH);

const CONFIG = {
  SPREADSHEET_ID,
  SHEET_NAME: 'Laptop TGDĐ',
  DELAY_MS  : 3000,
  TIMEOUT_MS: 60000,
  BRANDS: [
    { name: 'HP',       url: 'https://www.thegioididong.com/laptop-hp-compaq'    },
    { name: 'Asus',     url: 'https://www.thegioididong.com/laptop-asus'         },
    { name: 'Acer',     url: 'https://www.thegioididong.com/laptop-acer'         },
    { name: 'Lenovo',   url: 'https://www.thegioididong.com/laptop-lenovo'       },
    { name: 'Dell',     url: 'https://www.thegioididong.com/laptop-dell'         },
    { name: 'MSI',      url: 'https://www.thegioididong.com/laptop-msi'          },
    { name: 'MacBook',  url: 'https://www.thegioididong.com/laptop-apple-macbook'},
    { name: 'Gigabyte', url: 'https://www.thegioididong.com/laptop-gigabyte'     },
    { name: 'Samsung',  url: 'https://www.thegioididong.com/laptop-samsung'      },
  ],
};

const HEADERS = [
  'STT','Tên Model','Hãng','CPU','RAM','Ổ cứng','Màn hình',
  'Card đồ họa','Trọng lượng','Giá gốc (₫)','Giá KM (₫)','Giảm (%)',
  'Đã bán','Rating (★)','Link sản phẩm','Cập nhật'
];

async function main() {
  const start = new Date();
  console.log(`\n🚀 TGDĐ Laptop Scraper — ${start.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`);

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--disable-dev-shm-usage', '--disable-gpu',
      '--disable-blink-features=AutomationControlled',
      '--lang=vi-VN,vi', '--window-size=1366,768',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 768 });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'plugins',   { get: () => [1,2,3,4,5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['vi-VN','vi','en-US','en'] });
    window.chrome = { runtime: {} };
  });
  await page.setRequestInterception(true);
  page.on('request', req => {
    if (['image','font','media'].includes(req.resourceType())) req.abort();
    else req.continue();
  });

  const sheets = await initGoogleSheets();
  await setupSheet(sheets);

  let allProducts = [];
  for (const brand of CONFIG.BRANDS) {
    console.log(`\n▶ Hãng: ${brand.name}`);
    const products = await scrapeBrand(page, brand);
    allProducts = allProducts.concat(products);
    console.log(`  ✓ ${products.length} sản phẩm`);
    await sleep(2000);
  }

  await browser.close();
  console.log(`\n📊 Ghi ${allProducts.length} sản phẩm vào Google Sheet...`);
  await writeToSheet(sheets, allProducts);

  const elapsed = ((new Date() - start) / 60000).toFixed(1);
  console.log(`\n✅ HOÀN TẤT! (${elapsed} phút)`);
}

async function scrapeBrand(page, brand) {
  const products  = [];
  const seenLinks = new Set();
  let   pageNum   = 1;

  while (pageNum <= 30) {
    const url = pageNum === 1 ? brand.url : `${brand.url}?page=${pageNum}`;
    console.log(`  Trang ${pageNum}`);

    try {
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      );
      await page.setExtraHTTPHeaders({
        'Accept-Language'       : 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept'                : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Sec-Ch-Ua'             : '"Chromium";v="124","Google Chrome";v="124"',
        'Sec-Ch-Ua-Mobile'      : '?0',
        'Sec-Ch-Ua-Platform'    : '"Windows"',
        'Sec-Fetch-Dest'        : 'document',
        'Sec-Fetch-Mode'        : 'navigate',
        'Sec-Fetch-Site'        : 'none',
        'Upgrade-Insecure-Requests': '1',
      });

      await page.goto(url, { waitUntil: 'networkidle2', timeout: CONFIG.TIMEOUT_MS });
      await sleep(2500);
      await autoScroll(page);
      await sleep(1500);

      const pageProducts = await page.evaluate((brandName, BASE) => {
        const results = [];
        document.querySelectorAll('ul.listproduct li.item').forEach(item => {
          const anchor = item.querySelector('a.main-contain');
          if (!anchor) return;
          const href      = anchor.getAttribute('href') || '';
          const fullName  = anchor.getAttribute('data-name') || '';
          const link      = href.startsWith('http') ? href : BASE + href;
          if (!fullName || !href) return;

          const salePrice = parseFloat(anchor.getAttribute('data-price') || '0');
          const oldEl     = item.querySelector('p.price-old');
          const origPrice = oldEl ? parseInt(oldEl.innerText.replace(/[^\d]/g,'')) : 0;
          const pctEl     = item.querySelector('span.percent');
          const discount  = pctEl ? pctEl.innerText.trim() : '';

          let cpu='',screen='',gpu='',weight='',ram='',storage='';
          item.querySelectorAll('div.utility p').forEach(p => {
            const t = p.innerText.trim();
            if      (t.startsWith('CPU:'))       cpu    = t.replace('CPU:','').trim().substring(0,60);
            else if (t.startsWith('Màn hình:'))  screen = t.replace('Màn hình:','').trim().substring(0,40);
            else if (t.startsWith('Card:'))      gpu    = t.replace('Card:','').trim().substring(0,40);
            else if (t.startsWith('Khối lượng:'))weight = t.replace('Khối lượng:','').trim();
          });
          item.querySelectorAll('div.item-compare span').forEach(s => {
            const t = s.innerText.trim();
            if (/RAM/i.test(t))      ram     = t;
            if (/SSD|HDD/i.test(t)) storage = t;
          });

          const ratingEl = item.querySelector('div.vote-txt b');
          const rating   = ratingEl ? ratingEl.innerText.trim() : '';
          let sold = '';
          const rBox = item.querySelector('div.rating_Compare');
          if (rBox) rBox.querySelectorAll('span').forEach(s => {
            if (s.innerText.includes('Đã bán'))
              sold = s.innerText.replace(/[•\s]*Đã bán\s*/i,'').trim();
          });

          results.push({ name:fullName.trim(), brand:brandName,
            cpu, ram, storage, screen, gpu, weight,
            origPrice:origPrice||'', salePrice:salePrice?Math.round(salePrice):'',
            discount, sold, rating, link });
        });
        return results;
      }, brand.name, 'https://www.thegioididong.com');

      const newOnes = pageProducts.filter(p => {
        if (!p.link || seenLinks.has(p.link)) return false;
        seenLinks.add(p.link); return true;
      });

      if (newOnes.length === 0) { console.log(`  → Hết sản phẩm`); break; }
      products.push(...newOnes);
      console.log(`    +${newOnes.length} SP (tổng: ${products.length})`);

      const hasMore = await page.evaluate(() =>
        !!document.querySelector('.view-more a:not(.prevent)')
      ).catch(() => false);
      if (!hasMore) { console.log(`  → Hết trang`); break; }

      pageNum++;
      await sleep(CONFIG.DELAY_MS);
    } catch(err) {
      console.log(`  ⚠ ${err.message.substring(0,80)}`);
      break;
    }
  }
  return products;
}

async function initGoogleSheets() {
  const auth = new google.auth.GoogleAuth({
    keyFile: CRED_PATH,
    scopes : ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function setupSheet(sheets) {
  await sheets.spreadsheets.values.clear({
    spreadsheetId: CONFIG.SPREADSHEET_ID, range: CONFIG.SHEET_NAME,
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: CONFIG.SPREADSHEET_ID, range: `${CONFIG.SHEET_NAME}!A1`,
    valueInputOption: 'RAW', requestBody: { values: [HEADERS] },
  });
  const sid = await getSheetId(sheets);
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: CONFIG.SPREADSHEET_ID, requestBody: { requests: [
    { repeatCell: { range: { sheetId:sid, startRowIndex:0, endRowIndex:1 },
      cell: { userEnteredFormat: {
        backgroundColor: { red:0.102, green:0.451, blue:0.914 },
        textFormat: { foregroundColor:{red:1,green:1,blue:1}, bold:true, fontSize:10 },
        horizontalAlignment: 'CENTER' }},
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)' }},
    { updateSheetProperties: { properties: { sheetId:sid, gridProperties:{ frozenRowCount:1 } },
      fields: 'gridProperties.frozenRowCount' }},
  ]}});
  console.log('✓ Sheet reset xong');
}

async function writeToSheet(sheets, products) {
  if (!products.length) { console.log('⚠ Không có SP để ghi'); return; }
  const now  = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  const rows = products.map((p,i) => [
    i+1, p.name, p.brand, p.cpu, p.ram, p.storage, p.screen, p.gpu, p.weight,
    p.origPrice||'', p.salePrice||'', p.discount, p.sold, p.rating, p.link, now
  ]);
  for (let i=0; i<rows.length; i+=500) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: CONFIG.SPREADSHEET_ID, range: `${CONFIG.SHEET_NAME}!A2`,
      valueInputOption: 'RAW', requestBody: { values: rows.slice(i,i+500) },
    });
    console.log(`  Đã ghi ${Math.min(i+500,rows.length)}/${rows.length} dòng`);
  }
  const sid   = await getSheetId(sheets);
  const total = rows.length + 1;
  const zebraR = Array.from({length:rows.length}, (_,r) => ({ repeatCell: {
    range: { sheetId:sid, startRowIndex:r+1, endRowIndex:r+2, startColumnIndex:0, endColumnIndex:HEADERS.length },
    cell:  { userEnteredFormat: { backgroundColor: r%2===0
      ? {red:0.945,green:0.953,blue:0.957} : {red:1,green:1,blue:1} }},
    fields: 'userEnteredFormat.backgroundColor' }}));
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: CONFIG.SPREADSHEET_ID, requestBody: { requests: [
    ...zebraR,
    { repeatCell: { range:{sheetId:sid,startRowIndex:1,endRowIndex:total,startColumnIndex:9,endColumnIndex:11},
      cell:{userEnteredFormat:{numberFormat:{type:'NUMBER',pattern:'#,##0'}}},
      fields:'userEnteredFormat.numberFormat' }},
    { repeatCell: { range:{sheetId:sid,startRowIndex:1,endRowIndex:total,startColumnIndex:11,endColumnIndex:12},
      cell:{userEnteredFormat:{textFormat:{foregroundColor:{red:0.8,green:0.13,blue:0.08},bold:true}}},
      fields:'userEnteredFormat.textFormat' }},
    { autoResizeDimensions: { dimensions:{sheetId:sid,dimension:'COLUMNS',startIndex:0,endIndex:HEADERS.length} }},
  ]}});
  console.log('✓ Format xong');
}

async function getSheetId(sheets) {
  const meta  = await sheets.spreadsheets.get({ spreadsheetId: CONFIG.SPREADSHEET_ID });
  const found = meta.data.sheets.find(s => s.properties.title === CONFIG.SHEET_NAME);
  if (!found) throw new Error(`Không tìm thấy sheet "${CONFIG.SHEET_NAME}"`);
  return found.properties.sheetId;
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let total = 0;
      const timer = setInterval(() => {
        window.scrollBy(0, 400); total += 400;
        if (total >= document.body.scrollHeight) { clearInterval(timer); resolve(); }
      }, 150);
    });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(err => { console.error('\n❌ Lỗi:', err.message); process.exit(1); });
