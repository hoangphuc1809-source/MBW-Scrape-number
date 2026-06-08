/**
 * TGDĐ LAPTOP SCRAPER — History Edition
 * Logic ghi sheet:
 *   - Nếu hôm nay đã có data → ghi chồng (xóa rows ngày hôm nay rồi ghi lại)
 *   - Nếu chưa có → append thêm vào cuối
 * Mỗi ngày là 1 snapshot độc lập, có thể filter theo cột "Ngày"
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

const CRED_PATH = path.join(os.tmpdir(), 'gcp_credentials.json');
fs.writeFileSync(CRED_PATH, credsJson);

// Ngày hôm nay dạng dd/MM/yyyy — dùng làm key so sánh
const TODAY = new Date().toLocaleDateString('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  day: '2-digit', month: '2-digit', year: 'numeric'
}); // VD: "08/06/2026"

const CONFIG = {
  SPREADSHEET_ID,
  SHEET_NAME: 'Laptop TGDĐ',
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

// Cột "Ngày" tách riêng để dễ filter, cột "Giờ" để biết chính xác lúc nào
const HEADERS = [
  'Ngày','Giờ','STT','Tên Model','Hãng','CPU','RAM','Ổ cứng','Màn hình',
  'Card đồ họa','Trọng lượng','Giá gốc (₫)','Giá KM (₫)','Giảm (%)',
  'Đã bán','Rating (★)','Link sản phẩm'
];

// Index cột Ngày (0-based) = 0
const COL_DATE = 0;

async function main() {
  const start = new Date();
  console.log(`\n🚀 TGDĐ Laptop Scraper History — ${TODAY}`);

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox','--disable-setuid-sandbox',
      '--disable-dev-shm-usage','--disable-gpu',
      '--disable-blink-features=AutomationControlled',
      '--lang=vi-VN,vi','--window-size=1366,768',
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
  await ensureHeaderRow(sheets);

  let allProducts = [];
  for (const brand of CONFIG.BRANDS) {
    console.log(`\n▶ Hãng: ${brand.name}`);
    const products = await scrapeBrand(page, brand);
    allProducts = allProducts.concat(products);
    console.log(`  ✓ ${products.length} sản phẩm`);
    await sleep(2000);
  }

  await browser.close();
  console.log(`\n📊 Tổng ${allProducts.length} sản phẩm — đang xử lý lịch sử...`);
  await writeWithHistory(sheets, allProducts);

  const elapsed = ((new Date() - start) / 60000).toFixed(1);
  console.log(`\n✅ HOÀN TẤT! (${elapsed} phút)`);
}

// ── Ghi theo logic lịch sử ────────────────────────────────
async function writeWithHistory(sheets, products) {
  const now  = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  const time = now.split(' ')[0]; // Chỉ lấy giờ HH:MM:SS

  // Chuẩn bị rows mới cho hôm nay
  const newRows = products.map((p, i) => [
    TODAY,              // Ngày  — dùng để filter/so sánh
    time,              // Giờ
    i + 1,             // STT
    p.name, p.brand, p.cpu, p.ram, p.storage, p.screen, p.gpu, p.weight,
    p.origPrice || '', p.salePrice || '', p.discount,
    p.sold, p.rating, p.link
  ]);

  // Đọc toàn bộ data hiện tại trong sheet
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId: CONFIG.SPREADSHEET_ID,
    range        : CONFIG.SHEET_NAME,
  });

  const allRows    = existing.data.values || [];
  const headerRow  = allRows[0] || HEADERS;
  const dataRows   = allRows.slice(1); // bỏ header

  // Tìm rows KHÔNG phải ngày hôm nay (giữ lại)
  const otherDays = dataRows.filter(row => row[COL_DATE] !== TODAY);

  console.log(`  Ngày khác cần giữ: ${otherDays.length} rows`);
  console.log(`  Ngày hôm nay (${TODAY}): ghi ${newRows.length} rows mới`);

  // Gộp: header + các ngày cũ + data hôm nay
  const finalRows = [headerRow, ...otherDays, ...newRows];

  // Ghi lại toàn bộ sheet
  await sheets.spreadsheets.values.update({
    spreadsheetId    : CONFIG.SPREADSHEET_ID,
    range            : `${CONFIG.SHEET_NAME}!A1`,
    valueInputOption : 'RAW',
    requestBody      : { values: finalRows },
  });

  // Xóa các ô thừa phía dưới (nếu bản mới ít hơn bản cũ)
  const sheetMeta   = await sheets.spreadsheets.get({ spreadsheetId: CONFIG.SPREADSHEET_ID });
  const sheetProps  = sheetMeta.data.sheets.find(s => s.properties.title === CONFIG.SHEET_NAME);
  const totalRowsInSheet = sheetProps.properties.gridProperties.rowCount;
  const newTotalRows     = finalRows.length;

  if (totalRowsInSheet > newTotalRows + 5) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: CONFIG.SPREADSHEET_ID,
      requestBody: { requests: [{
        deleteDimension: {
          range: {
            sheetId   : sheetProps.properties.sheetId,
            dimension : 'ROWS',
            startIndex: newTotalRows,
            endIndex  : totalRowsInSheet,
          }
        }
      }]}
    });
  }

  // Format
  await formatSheet(sheets, finalRows.length);
  console.log(`✓ Sheet đã cập nhật — tổng ${finalRows.length - 1} rows (${otherDays.length} ngày cũ + ${newRows.length} hôm nay)`);
}

async function ensureHeaderRow(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: CONFIG.SPREADSHEET_ID,
    range        : `${CONFIG.SHEET_NAME}!A1:Q1`,
  });
  const firstRow = (res.data.values || [[]])[0];

  // Nếu chưa có header hoặc header cũ → ghi header mới
  if (!firstRow || firstRow[0] !== 'Ngày') {
    console.log('📝 Tạo header row...');
    await sheets.spreadsheets.values.update({
      spreadsheetId    : CONFIG.SPREADSHEET_ID,
      range            : `${CONFIG.SHEET_NAME}!A1`,
      valueInputOption : 'RAW',
      requestBody      : { values: [HEADERS] },
    });
    const sid = await getSheetId(sheets);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: CONFIG.SPREADSHEET_ID,
      requestBody  : { requests: [
        { repeatCell: {
          range : { sheetId:sid, startRowIndex:0, endRowIndex:1 },
          cell  : { userEnteredFormat: {
            backgroundColor     : { red:0.102, green:0.451, blue:0.914 },
            textFormat          : { foregroundColor:{red:1,green:1,blue:1}, bold:true, fontSize:10 },
            horizontalAlignment : 'CENTER' }},
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)' }},
        { updateSheetProperties: {
          properties: { sheetId:sid, gridProperties:{ frozenRowCount:1 } },
          fields    : 'gridProperties.frozenRowCount' }},
      ]}
    });
  }
}

async function formatSheet(sheets, totalRows) {
  const sid = await getSheetId(sheets);

  // Zebra rows
  const zebraR = Array.from({ length: totalRows - 1 }, (_, r) => ({ repeatCell: {
    range : { sheetId:sid, startRowIndex:r+1, endRowIndex:r+2, startColumnIndex:0, endColumnIndex:HEADERS.length },
    cell  : { userEnteredFormat: { backgroundColor: r%2===0
      ? {red:0.945,green:0.953,blue:0.957}
      : {red:1,green:1,blue:1} }},
    fields: 'userEnteredFormat.backgroundColor'
  }}));

  // Tô màu cột Ngày (cột A) theo nhóm ngày — dùng màu xanh nhạt cho ngày hôm nay
  const todayHighlight = { repeatCell: {
    range : { sheetId:sid, startRowIndex:1, endRowIndex:totalRows, startColumnIndex:0, endColumnIndex:1 },
    cell  : { userEnteredFormat: { textFormat: { bold:false } } },
    fields: 'userEnteredFormat.textFormat'
  }};

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: CONFIG.SPREADSHEET_ID,
    requestBody  : { requests: [
      ...zebraR,
      todayHighlight,
      // Cột giá (L, M = index 11, 12) → format số
      { repeatCell: {
        range : {sheetId:sid,startRowIndex:1,endRowIndex:totalRows,startColumnIndex:11,endColumnIndex:13},
        cell  : {userEnteredFormat:{numberFormat:{type:'NUMBER',pattern:'#,##0'}}},
        fields: 'userEnteredFormat.numberFormat' }},
      // Cột % giảm (N = index 13) → đỏ đậm
      { repeatCell: {
        range : {sheetId:sid,startRowIndex:1,endRowIndex:totalRows,startColumnIndex:13,endColumnIndex:14},
        cell  : {userEnteredFormat:{textFormat:{foregroundColor:{red:0.8,green:0.13,blue:0.08},bold:true}}},
        fields: 'userEnteredFormat.textFormat' }},
      // Auto resize
      { autoResizeDimensions: {
        dimensions: {sheetId:sid,dimension:'COLUMNS',startIndex:0,endIndex:HEADERS.length} }},
    ]}
  });
}

// ── Scrape (giữ nguyên từ bản trước) ─────────────────────
async function scrapeBrand(page, brand) {
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  );
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8',
    'Sec-Fetch-Dest' : 'document', 'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site' : 'none', 'Upgrade-Insecure-Requests': '1',
  });

  try {
    await page.goto(brand.url, { waitUntil: 'networkidle2', timeout: CONFIG.TIMEOUT_MS });
  } catch(e) {
    console.log(`  ⚠ Lỗi: ${e.message.substring(0,60)}`); return [];
  }
  await sleep(2000);

  // Click "Xem thêm" đến hết
  let clickCount = 0;
  while (true) {
    await autoScroll(page);
    await sleep(1500);
    const clicked = await page.evaluate(() => {
      const selectors = ['.view-more a:not(.prevent)','a.btn-more','a.view-more','[class*="view-more"] a'];
      for (const sel of selectors) {
        const btn = document.querySelector(sel);
        if (btn && btn.offsetParent !== null) { btn.click(); return true; }
      }
      return false;
    });
    if (!clicked) break;
    clickCount++;
    console.log(`  → Xem thêm lần ${clickCount}`);
    await sleep(2500);
  }

  return await page.evaluate((brandName, BASE) => {
    const results = []; const seen = new Set();
    document.querySelectorAll('ul.listproduct li.item').forEach(item => {
      const a = item.querySelector('a.main-contain');
      if (!a) return;
      const href = a.getAttribute('href')||'';
      const name = a.getAttribute('data-name')||'';
      const link = href.startsWith('http') ? href : BASE+href;
      if (!name||!href||seen.has(link)) return;
      seen.add(link);

      const sp = parseFloat(a.getAttribute('data-price')||'0');
      const oldEl = item.querySelector('p.price-old');
      const op = oldEl ? parseInt(oldEl.innerText.replace(/[^\d]/g,'')) : 0;
      const pct = item.querySelector('span.percent');

      let cpu='',screen='',gpu='',weight='',ram='',storage='';
      item.querySelectorAll('div.utility p').forEach(p => {
        const t=p.innerText.trim();
        if(t.startsWith('CPU:'))cpu=t.replace('CPU:','').trim().substring(0,60);
        else if(t.startsWith('Màn hình:'))screen=t.replace('Màn hình:','').trim().substring(0,40);
        else if(t.startsWith('Card:'))gpu=t.replace('Card:','').trim().substring(0,40);
        else if(t.startsWith('Khối lượng:'))weight=t.replace('Khối lượng:','').trim();
      });
      item.querySelectorAll('div.item-compare span').forEach(s=>{
        const t=s.innerText.trim();
        if(/RAM/i.test(t))ram=t; if(/SSD|HDD/i.test(t))storage=t;
      });

      const rb=item.querySelector('div.vote-txt b');
      let sold='';
      const rBox=item.querySelector('div.rating_Compare');
      if(rBox)rBox.querySelectorAll('span').forEach(s=>{
        if(s.innerText.includes('Đã bán'))sold=s.innerText.replace(/[•\s]*Đã bán\s*/i,'').trim();
      });

      results.push({name:name.trim(),brand:brandName,cpu,ram,storage,screen,gpu,weight,
        origPrice:op||'',salePrice:sp?Math.round(sp):'',
        discount:pct?pct.innerText.trim():'',sold,
        rating:rb?rb.innerText.trim():'',link});
    });
    return results;
  }, brand.name, 'https://www.thegioididong.com');
}

async function initGoogleSheets() {
  const auth = new google.auth.GoogleAuth({ keyFile:CRED_PATH, scopes:['https://www.googleapis.com/auth/spreadsheets'] });
  return google.sheets({ version:'v4', auth });
}

async function getSheetId(sheets) {
  const meta  = await sheets.spreadsheets.get({spreadsheetId:CONFIG.SPREADSHEET_ID});
  const found = meta.data.sheets.find(s=>s.properties.title===CONFIG.SHEET_NAME);
  if (!found) throw new Error(`Không tìm thấy sheet "${CONFIG.SHEET_NAME}"`);
  return found.properties.sheetId;
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let total=0;
      const timer=setInterval(()=>{
        window.scrollBy(0,500);total+=500;
        if(total>=document.body.scrollHeight){clearInterval(timer);resolve();}
      },150);
    });
  });
}

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

main().catch(err=>{console.error('\n❌ Lỗi:',err.message);process.exit(1);});
