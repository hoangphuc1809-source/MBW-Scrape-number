/**
 * ═══════════════════════════════════════════════════════
 *  MULTI-DEALER LAPTOP SCRAPER — v2.0
 *  Dealers: Mobile World (TGDĐ) · FPT Shop · CellPhones
 *  File: multi_dealer_scraper.js
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

const CRED_FILE = path.join(os.tmpdir(), 'multi_dealer_gcp.json');
fs.writeFileSync(CRED_FILE, GOOGLE_CREDS, 'utf8');

// ── NGÀY GIỜ ─────────────────────────────────────────────
const NOW        = new Date();
const TODAY_DATE = NOW.toLocaleDateString('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  day: '2-digit', month: '2-digit', year: 'numeric',
});
const TODAY_TIME = NOW.toLocaleTimeString('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
console.log(`📅 Ngày: ${TODAY_DATE}  ⏰ Giờ: ${TODAY_TIME}`);

// ── CONFIG ───────────────────────────────────────────────
const SHEET_NAME = 'Laptop TGDĐ';

const HEADERS = [
  'Ngày', 'Giờ', 'STT', 'Dealer',
  'Tên Model', 'Hãng',
  'CPU', 'RAM', 'Ổ cứng', 'Màn hình', 'Card đồ họa', 'Trọng lượng',
  'Giá gốc (₫)', 'Giá KM (₫)', 'Giảm (%)',
  'Đã bán', 'Rating (★)', 'Link sản phẩm',
];

const MBW_BRANDS = [
  { name: 'HP',       url: 'https://www.thegioididong.com/laptop-hp-compaq'     },
  { name: 'Asus',     url: 'https://www.thegioididong.com/laptop-asus'          },
  { name: 'Acer',     url: 'https://www.thegioididong.com/laptop-acer'          },
  { name: 'Lenovo',   url: 'https://www.thegioididong.com/laptop-lenovo'        },
  { name: 'Dell',     url: 'https://www.thegioididong.com/laptop-dell'          },
  { name: 'MSI',      url: 'https://www.thegioididong.com/laptop-msi'           },
  { name: 'MacBook',  url: 'https://www.thegioididong.com/laptop-apple-macbook' },
  { name: 'Gigabyte', url: 'https://www.thegioididong.com/laptop-gigabyte'      },
  { name: 'Samsung',  url: 'https://www.thegioididong.com/laptop-samsung'       },
];

const FPT_BRANDS = [
  { name: 'HP',       url: 'https://fptshop.com.vn/may-tinh-xach-tay/hp'            },
  { name: 'Asus',     url: 'https://fptshop.com.vn/may-tinh-xach-tay/asus'          },
  { name: 'Acer',     url: 'https://fptshop.com.vn/may-tinh-xach-tay/acer'          },
  { name: 'Lenovo',   url: 'https://fptshop.com.vn/may-tinh-xach-tay/lenovo'        },
  { name: 'Dell',     url: 'https://fptshop.com.vn/may-tinh-xach-tay/dell'          },
  { name: 'MSI',      url: 'https://fptshop.com.vn/may-tinh-xach-tay/msi'           },
  { name: 'MacBook',  url: 'https://fptshop.com.vn/may-tinh-xach-tay/apple-macbook' },
  { name: 'Gigabyte', url: 'https://fptshop.com.vn/may-tinh-xach-tay/gigabyte'      },
  { name: 'Samsung',  url: 'https://fptshop.com.vn/may-tinh-xach-tay/samsung'       },
];

const CPS_BRANDS = [
  { name: 'HP',       url: 'https://cellphones.com.vn/laptop/hp.html'       },
  { name: 'Asus',     url: 'https://cellphones.com.vn/laptop/asus.html'     },
  { name: 'Acer',     url: 'https://cellphones.com.vn/laptop/acer.html'     },
  { name: 'Lenovo',   url: 'https://cellphones.com.vn/laptop/lenovo.html'   },
  { name: 'Dell',     url: 'https://cellphones.com.vn/laptop/dell.html'     },
  { name: 'MSI',      url: 'https://cellphones.com.vn/laptop/msi.html'      },
  { name: 'MacBook',  url: 'https://cellphones.com.vn/laptop/apple.html'    },
  { name: 'Gigabyte', url: 'https://cellphones.com.vn/laptop/gigabyte.html' },
  { name: 'Samsung',  url: 'https://cellphones.com.vn/laptop/samsung.html'  },
];

// ════════════════════════════════════════════════════════
async function main() {
  console.log('\n🚀 Multi-Dealer Laptop Scraper v2.0 — khởi động...');
  const t0 = Date.now();
  const browser = await launchBrowser();
  const page    = await setupPage(browser);
  let allProducts = [];

  console.log('\n══════════════════════════════');
  console.log('🏪 MOBILE WORLD (TGDĐ)');
  console.log('══════════════════════════════');
  for (const brand of MBW_BRANDS) {
    console.log(`\n  ▶ ${brand.name}`);
    const list = await scrapeMBW(page, brand);
    allProducts = allProducts.concat(list);
    console.log(`    ✓ ${list.length} SP`);
    await sleep(2000);
  }

  console.log('\n══════════════════════════════');
  console.log('🏪 FPT SHOP');
  console.log('══════════════════════════════');
  for (const brand of FPT_BRANDS) {
    console.log(`\n  ▶ ${brand.name}`);
    const list = await scrapeFPT(page, brand);
    allProducts = allProducts.concat(list);
    console.log(`    ✓ ${list.length} SP`);
    await sleep(2000);
  }

  console.log('\n══════════════════════════════');
  console.log('🏪 CELLPHONES');
  console.log('══════════════════════════════');
  for (const brand of CPS_BRANDS) {
    console.log(`\n  ▶ ${brand.name}`);
    const list = await scrapeCPS(page, brand);
    allProducts = allProducts.concat(list);
    console.log(`    ✓ ${list.length} SP`);
    await sleep(2000);
  }

  await browser.close();
  console.log(`\n📦 Tổng scrape: ${allProducts.length} sản phẩm`);
  const sheets = await initSheets();
  await writeHistory(sheets, allProducts);
  console.log(`\n✅ Xong! (${((Date.now()-t0)/60000).toFixed(1)} phút)`);
}

// ── BROWSER ───────────────────────────────────────────────
async function launchBrowser() {
  return puppeteer.launch({
    headless: true,
    protocolTimeout: 120000,
    args: [
      '--no-sandbox','--disable-setuid-sandbox',
      '--disable-dev-shm-usage','--disable-gpu',
      '--disable-blink-features=AutomationControlled',
      '--lang=vi-VN','--window-size=1366,768',
    ],
  });
}

async function setupPage(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 768 });
  await page.setDefaultTimeout(60000);
  await page.setDefaultNavigationTimeout(60000);
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator,'webdriver',{get:()=>false});
    Object.defineProperty(navigator,'plugins',{get:()=>[1,2,3]});
    Object.defineProperty(navigator,'languages',{get:()=>['vi-VN','vi','en']});
    window.chrome = { runtime:{} };
  });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  await page.setExtraHTTPHeaders({'Accept-Language':'vi-VN,vi;q=0.9,en;q=0.8','Accept':'text/html,application/xhtml+xml,*/*;q=0.8','Upgrade-Insecure-Requests':'1'});
  await page.setRequestInterception(true);
  page.on('request', req => { ['image','font','media'].includes(req.resourceType()) ? req.abort() : req.continue(); });
  return page;
}

// ════════════════════════════════════════════════════════
//  SCRAPER 1 — MOBILE WORLD
// ════════════════════════════════════════════════════════
async function scrapeMBW(page, brand) {
  try { await page.goto(brand.url,{waitUntil:'networkidle2',timeout:90000}); }
  catch(e) { console.log(`    ⚠ Không load: ${e.message.substring(0,60)}`); return []; }
  await sleep(2000);
  let clicks = 0;
  while (true) {
    await scrollToBottom(page); await sleep(1500);
    const clicked = await page.evaluate(() => {
      for (const sel of ['.view-more a:not(.prevent)','a.view-more','[class*="view-more"] a']) {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) { el.click(); return true; }
      }
      return false;
    }).catch(()=>false);
    if (!clicked) break;
    clicks++; await sleep(2500);
  }
  if (clicks) console.log(`    → Xem thêm: ${clicks} lần`);
  return page.evaluate((brandName, BASE) => {
    const out=[], seen=new Set();
    document.querySelectorAll('ul.listproduct li.item').forEach(item => {
      const a = item.querySelector('a.main-contain'); if (!a) return;
      const href = a.getAttribute('href')||'', name = a.getAttribute('data-name')||'';
      const link = href.startsWith('http') ? href : BASE+href;
      if (!name||!href||seen.has(link)) return; seen.add(link);
      const sp = parseFloat(a.getAttribute('data-price')||'0');
      const oldEl = item.querySelector('p.price-old');
      const op = oldEl ? parseInt(oldEl.innerText.replace(/[^\d]/g,'')) : 0;
      const pctEl = item.querySelector('span.percent');
      let cpu='',screen='',gpu='',weight='',ram='',storage='';
      item.querySelectorAll('div.utility p').forEach(p => {
        const t=p.innerText.trim();
        if(t.startsWith('CPU:')) cpu=t.slice(4).trim().substring(0,60);
        else if(t.startsWith('Màn hình:')) screen=t.slice(9).trim().substring(0,40);
        else if(t.startsWith('Card:')) gpu=t.slice(5).trim().substring(0,40);
        else if(t.startsWith('Khối lượng:')) weight=t.slice(11).trim();
      });
      item.querySelectorAll('div.item-compare span').forEach(s => {
        const t=s.innerText.trim();
        if(/RAM/i.test(t)) ram=t; if(/SSD|HDD/i.test(t)) storage=t;
      });
      const rEl=item.querySelector('div.vote-txt b'); let sold='';
      item.querySelectorAll('div.rating_Compare span').forEach(s => {
        if(s.innerText.includes('Đã bán')) sold=s.innerText.replace(/[•\s]*Đã bán\s*/i,'').trim();
      });
      out.push({dealer:'MBW',name,brand:brandName,cpu,ram,storage,screen,gpu,weight,
        origPrice:op||'',salePrice:sp?Math.round(sp):'',discount:pctEl?pctEl.innerText.trim():'',
        sold,rating:rEl?rEl.innerText.trim():'',link});
    });
    return out;
  }, brand.name, 'https://www.thegioididong.com');
}

// ════════════════════════════════════════════════════════
//  SCRAPER 2 — FPT SHOP (React/Next.js — domcontentloaded)
// ════════════════════════════════════════════════════════
async function scrapeFPT(page, brand) {
  try { await page.goto(brand.url,{waitUntil:'domcontentloaded',timeout:30000}); }
  catch(e) { console.log(`    ⚠ Không load: ${e.message.substring(0,60)}`); return []; }
  await sleep(3000);
  let lastCount=0, noChange=0;
  for (let r=0; r<15; r++) {
    await scrollToBottom(page); await sleep(2000);
    const count = await page.evaluate(()=>document.querySelectorAll('.cardInfo').length).catch(()=>0);
    if (count===lastCount) { if(++noChange>=2) break; } else { noChange=0; lastCount=count; }
  }
  console.log(`    → FPT cards: ${lastCount}`);
  return page.evaluate((brandName, BASE) => {
    const out=[], seen=new Set();
    document.querySelectorAll('.cardInfo').forEach(card => {
      const aEl = card.closest('a[href]') || card.parentElement?.closest('a[href]') ||
                  card.parentElement?.parentElement?.closest('a[href]') || card.querySelector('a[href]');
      if (!aEl) return;
      const href = aEl.getAttribute('href')||'';
      if (!href||href==='#') return;
      const link = href.startsWith('http') ? href : BASE+href;
      if (seen.has(link)) return; seen.add(link);
      const lines = (card.innerText||'').split('\n').map(l=>l.trim()).filter(Boolean);
      const nameLine = lines.find(l=>l.includes('Laptop')||l.includes('MacBook'))||lines[lines.length-1]||'';
      const priceM = (card.innerText||'').match(/[\d.]+\.[\d.]+\.?\d*đ/g)||[];
      const prices = priceM.map(p=>parseInt(p.replace(/[^\d]/g,'')));
      const origPrice = prices.length>=2?prices[0]:'';
      const salePrice = prices.length>=2?prices[1]:(prices[0]||'');
      const discM = (card.innerText||'').match(/-(\d+)%/);
      const discount = discM?`-${discM[1]}%`:'';
      if (!nameLine||!salePrice) return;
      out.push({dealer:'FPT Retail',name:nameLine.substring(0,100),brand:brandName,
        cpu:'',ram:'',storage:'',screen:'',gpu:'',weight:'',
        origPrice,salePrice,discount,sold:'',rating:'',link});
    });
    return out;
  }, brand.name, 'https://fptshop.com.vn');
}

// ════════════════════════════════════════════════════════
//  SCRAPER 3 — CELLPHONES (React — domcontentloaded)
// ════════════════════════════════════════════════════════
async function scrapeCPS(page, brand) {
  try { await page.goto(brand.url,{waitUntil:'domcontentloaded',timeout:30000}); }
  catch(e) { console.log(`    ⚠ Không load: ${e.message.substring(0,60)}`); return []; }
  await sleep(3000);
  let lastCount=0, noChange=0;
  for (let r=0; r<15; r++) {
    await scrollToBottom(page); await sleep(2000);
    await page.evaluate(()=>{
      const btn=document.querySelector('.btn-show-more,button.loadmore,[class*="loadmore"],[class*="load-more"]');
      if(btn&&btn.offsetParent!==null) btn.click();
    }).catch(()=>{});
    const count = await page.evaluate(()=>
      document.querySelectorAll('.product-item,.product__item,[class*="product-item"]:not([class*="product-items"]),.cps-product-card').length
    ).catch(()=>0);
    if (count===lastCount) { if(++noChange>=2) break; } else { noChange=0; lastCount=count; }
  }
  console.log(`    → CPS cards: ${lastCount}`);
  return page.evaluate((brandName, BASE) => {
    const out=[], seen=new Set();
    const cards = document.querySelectorAll('.product-item,.product__item,[class*="product-item"]:not([class*="product-items"]),.cps-product-card');
    cards.forEach(card => {
      const aEl = card.querySelector('a[href]')||card.closest('a[href]'); if (!aEl) return;
      const href = aEl.getAttribute('href')||'';
      if (!href||href==='#') return;
      const link = href.startsWith('http') ? href : BASE+href;
      if (seen.has(link)) return; seen.add(link);
      const nameEl = card.querySelector('h3,h2,[class*="name"],[class*="title"]');
      const name = (nameEl?.innerText||aEl.innerText||'').trim().substring(0,100);
      if (!name) return;
      const salePriceEl = card.querySelector('[class*="price-show"],[class*="sale"],.price strong,[class*="current-price"]');
      let salePrice='';
      if (salePriceEl) { const r=salePriceEl.innerText.replace(/[^\d]/g,''); if(r) salePrice=parseInt(r); }
      if (!salePrice) { const m=(card.innerText||'').match(/[\d.]+\.[\d]+đ/g); if(m) salePrice=parseInt(m[0].replace(/[^\d]/g,'')); }
      const origPriceEl = card.querySelector('[class*="price-old"],[class*="origin"],del,s');
      let origPrice='';
      if (origPriceEl) { const r=origPriceEl.innerText.replace(/[^\d]/g,''); if(r) origPrice=parseInt(r); }
      const discountEl = card.querySelector('[class*="percent"],[class*="discount"],[class*="badge"]');
      const discount = discountEl?discountEl.innerText.trim():'';
      out.push({dealer:'CellPhone S',name,brand:brandName,
        cpu:'',ram:'',storage:'',screen:'',gpu:'',weight:'',
        origPrice,salePrice,discount,sold:'',rating:'',link});
    });
    return out;
  }, brand.name, 'https://cellphones.com.vn');
}

// ── GOOGLE SHEETS ─────────────────────────────────────────
async function initSheets() {
  const auth = new google.auth.GoogleAuth({keyFile:CRED_FILE,scopes:['https://www.googleapis.com/auth/spreadsheets']});
  return google.sheets({version:'v4',auth});
}

async function writeHistory(sheets, products) {
  const todayRows = products.map((p,i) => [
    TODAY_DATE,TODAY_TIME,i+1,p.dealer,p.name,p.brand,p.cpu,p.ram,p.storage,
    p.screen,p.gpu,p.weight,p.origPrice||'',p.salePrice||'',p.discount,p.sold,p.rating,p.link,
  ]);
  const res = await sheets.spreadsheets.values.get({spreadsheetId:SPREADSHEET_ID,range:SHEET_NAME});
  const allRows = res.data.values||[];
  const oldRows = allRows.slice(1).filter(row=>row[0]!==TODAY_DATE);
  console.log(`  📅 Ngày cũ giữ lại: ${oldRows.length} rows`);
  console.log(`  📅 Hôm nay ghi mới: ${todayRows.length} rows`);
  const finalData = [HEADERS,...oldRows,...todayRows];
  await sheets.spreadsheets.values.update({
    spreadsheetId:SPREADSHEET_ID,range:`${SHEET_NAME}!A1`,
    valueInputOption:'RAW',requestBody:{values:finalData},
  });
  const meta = await sheets.spreadsheets.get({spreadsheetId:SPREADSHEET_ID});
  const sheetObj = meta.data.sheets.find(s=>s.properties.title===SHEET_NAME);
  const curRows = sheetObj.properties.gridProperties.rowCount;
  if (curRows>finalData.length+2) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId:SPREADSHEET_ID,
      requestBody:{requests:[{deleteDimension:{range:{
        sheetId:sheetObj.properties.sheetId,dimension:'ROWS',
        startIndex:finalData.length,endIndex:curRows,
      }}}]},
    });
  }
  await applyFormat(sheets,sheetObj.properties.sheetId,finalData.length);
  console.log(`✓ Sheet OK — tổng ${finalData.length-1} rows`);
}

async function applyFormat(sheets, sheetId, totalRows) {
  const requests = [
    {repeatCell:{range:{sheetId,startRowIndex:0,endRowIndex:1},cell:{userEnteredFormat:{
      backgroundColor:{red:0.102,green:0.451,blue:0.914},
      textFormat:{foregroundColor:{red:1,green:1,blue:1},bold:true,fontSize:10},
      horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'}},
    {updateSheetProperties:{properties:{sheetId,gridProperties:{frozenRowCount:1}},fields:'gridProperties.frozenRowCount'}},
    {repeatCell:{range:{sheetId,startRowIndex:1,endRowIndex:totalRows,startColumnIndex:12,endColumnIndex:14},
      cell:{userEnteredFormat:{numberFormat:{type:'NUMBER',pattern:'#,##0'}}},fields:'userEnteredFormat.numberFormat'}},
    {repeatCell:{range:{sheetId,startRowIndex:1,endRowIndex:totalRows,startColumnIndex:14,endColumnIndex:15},
      cell:{userEnteredFormat:{textFormat:{foregroundColor:{red:0.8,green:0.13,blue:0.08},bold:true}}},fields:'userEnteredFormat.textFormat'}},
    {autoResizeDimensions:{dimensions:{sheetId,dimension:'COLUMNS',startIndex:0,endIndex:HEADERS.length}}},
  ];
  for (let r=1;r<totalRows;r++) {
    requests.push({repeatCell:{
      range:{sheetId,startRowIndex:r,endRowIndex:r+1,startColumnIndex:0,endColumnIndex:HEADERS.length},
      cell:{userEnteredFormat:{backgroundColor:r%2===0?{red:0.945,green:0.953,blue:0.957}:{red:1,green:1,blue:1}}},
      fields:'userEnteredFormat.backgroundColor'}});
  }
  for (let i=0;i<requests.length;i+=400) {
    await sheets.spreadsheets.batchUpdate({spreadsheetId:SPREADSHEET_ID,requestBody:{requests:requests.slice(i,i+400)}});
  }
}

// ── UTILS ─────────────────────────────────────────────────
async function scrollToBottom(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let y=0;
      const t=setInterval(()=>{ window.scrollBy(0,400); y+=400;
        if(y>=document.body.scrollHeight){clearInterval(t);resolve();}
      },200);
    });
  });
}

function sleep(ms) { return new Promise(r=>setTimeout(r,ms)); }

main().catch(err=>{ console.error('\n❌',err.message); process.exit(1); });
