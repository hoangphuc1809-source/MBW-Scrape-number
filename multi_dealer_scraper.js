/**
 * multi_dealer_scraper.js  — v2.6
 *
 * FIX v2.6:
 *  [BUG7] Bỏ giới hạn 30 specs/lần → fetch tất cả SP chưa có specs
 *         Kiểm soát bằng DEADLINE (50 phút) thay vì đếm số lượng
 *  [BUG8] MBW specs hoán đổi CPU/Màn hình → dùng findSpec() theo keyword
 *  [BUG9] FPT/CPS mapSpecs cập nhật đủ fields theo bảng chuẩn
 *  [KEY]  Specs chỉ fetch 1 lần duy nhất, lưu vào cache (sheet)
 *         Các lần chạy sau: copy specs từ cache vào row mới tự động
 */

'use strict';

const puppeteer    = require('puppeteer');
const { google }   = require('googleapis');
const fs           = require('fs');
const path         = require('path');
const os           = require('os');

// ── Config ────────────────────────────────────────────────
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME     = 'Laptop TGDĐ';
const CREDS_PATH     = path.join(os.tmpdir(), 'scraper_gcp.json');
// Deadline: dừng fetch specs sau 50 phút kể từ lúc start
// Đảm bảo còn đủ thời gian ghi sheet trước khi GitHub Actions timeout (6h)
const DEADLINE_MS    = 50 * 60 * 1000;

const BRANDS = [
  { name: 'Asus',     mbwUrl: 'https://www.thegioididong.com/laptop-asus',     fptUrl: 'https://fptshop.com.vn/may-tinh-xach-tay/asus',     cpsUrl: 'https://cellphones.com.vn/laptop/asus.html'     },
  { name: 'Acer',     mbwUrl: 'https://www.thegioididong.com/laptop-acer',     fptUrl: 'https://fptshop.com.vn/may-tinh-xach-tay/acer',     cpsUrl: 'https://cellphones.com.vn/laptop/acer.html'     },
  { name: 'Dell',     mbwUrl: 'https://www.thegioididong.com/laptop-dell',     fptUrl: 'https://fptshop.com.vn/may-tinh-xach-tay/dell',     cpsUrl: 'https://cellphones.com.vn/laptop/dell.html'     },
  { name: 'HP',       mbwUrl: 'https://www.thegioididong.com/laptop-hp',       fptUrl: 'https://fptshop.com.vn/may-tinh-xach-tay/hp',       cpsUrl: 'https://cellphones.com.vn/laptop/hp.html'       },
  { name: 'Lenovo',   mbwUrl: 'https://www.thegioididong.com/laptop-lenovo',   fptUrl: 'https://fptshop.com.vn/may-tinh-xach-tay/lenovo',   cpsUrl: 'https://cellphones.com.vn/laptop/lenovo.html'   },
  { name: 'MSI',      mbwUrl: 'https://www.thegioididong.com/laptop-msi',      fptUrl: 'https://fptshop.com.vn/may-tinh-xach-tay/msi',      cpsUrl: 'https://cellphones.com.vn/laptop/msi.html'      },
  { name: 'Samsung',  mbwUrl: 'https://www.thegioididong.com/laptop-samsung',  fptUrl: 'https://fptshop.com.vn/may-tinh-xach-tay/samsung',  cpsUrl: 'https://cellphones.com.vn/laptop/samsung.html'  },
  { name: 'MacBook',  mbwUrl: 'https://www.thegioididong.com/laptop-apple',    fptUrl: 'https://fptshop.com.vn/may-tinh-xach-tay/macbook',  cpsUrl: 'https://cellphones.com.vn/macbook.html'          },
  { name: 'Gigabyte', mbwUrl: 'https://www.thegioididong.com/laptop-gigabyte', fptUrl: 'https://fptshop.com.vn/may-tinh-xach-tay/gigabyte', cpsUrl: 'https://cellphones.com.vn/laptop/gigabyte.html' },
];

const HEADERS = [
  'Ngày','Giờ','STT','Dealer','Tên Model','Hãng',
  'CPU','RAM','Ổ cứng','Màn hình','Card đồ họa','Trọng lượng',
  'Giá gốc (₫)','Giá KM (₫)','Giảm (%)','Đã bán','Rating (★)','Link sản phẩm',
];

// ── Helpers ───────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

function formatDate(d) {
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}
function formatTime(d) {
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

async function scrollToBottom(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let total = 0;
      const timer = setInterval(() => {
        window.scrollBy(0, 600);
        total += 600;
        if (total >= document.body.scrollHeight) { clearInterval(timer); resolve(); }
      }, 300);
    });
  });
}

async function safeGoto(page, url) {
  for (let i = 0; i <= 2; i++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
      return true;
    } catch (e) {
      if (i === 2) { console.log(`    ⚠ goto failed: ${e.message.substring(0,60)}`); return false; }
      await sleep(2000);
    }
  }
}

// ── FPT: fetch specs từ detail page ──────────────────────
async function fetchSpecsFPT(page, url) {
  try {
    const ok = await safeGoto(page, url);
    if (!ok) return {};
    await sleep(1200);
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
    return mapSpecsFPT(raw);
  } catch (e) {
    return {};
  }
}

function mapSpecsFPT(raw) {
  // CPU: Công nghệ CPU + Loại CPU
  const cpu = [raw['Công nghệ CPU'], raw['Loại CPU']].filter(Boolean).join(' ')
              + (raw['Tốc độ tối đa'] ? ` - Max Turbo: ${raw['Tốc độ tối đa']}` : '');
  // RAM: Dung lượng + Loại (VD: "16GB DDR5")
  const ram = [raw['Dung lượng RAM'], raw['Loại RAM']].filter(Boolean).join(' ');
  // Ổ cứng: Kiểu + Dung lượng SSD (VD: "SSD 512GB")
  const storage = [raw['Kiểu ổ cứng'], raw['Dung lượng SSD']].filter(Boolean).join(' ');
  // Màn hình: Kích thước + Độ phân giải + Tần số quét + Độ phủ màu
  const screen = [
    raw['Kích thước màn hình'],
    raw['Độ phân giải'],
    raw['Tần số quét'] ? raw['Tần số quét'] + 'Hz' : '',
    raw['Độ phủ màu'],
  ].filter(Boolean).join(', ');
  // GPU: Card rời ưu tiên, fallback card onboard
  const gpu = raw['Tên đầy đủ (Card rời)'] || raw['Hãng (Card rời)']
           || raw['Tên đầy đủ (Card onbroad)'] || raw['Hãng (Card Oboard)'] || '';
  // Trọng lượng
  const weight = raw['Trọng lượng sản phẩm'] || raw['Khối lượng'] || raw['Trọng lượng'] || '';
  return { cpu, ram, storage, screen, gpu, weight };
}

// ── CPS: fetch specs từ detail page ──────────────────────
async function fetchSpecsCPS(page, url) {
  try {
    const ok = await safeGoto(page, url);
    if (!ok) return {};
    await sleep(1200);
    const raw = await page.evaluate(() => {
      const specs = {};
      document.querySelectorAll('tr.technical-content-item').forEach(row => {
        const tds = row.querySelectorAll('td');
        if (tds.length >= 2) {
          const label = tds[0].innerText?.trim();
          const value = tds[1].innerText?.trim().replace(/\n+/g, ' ');
          if (label && value) specs[label] = value;
        }
      });
      return specs;
    }).catch(() => ({}));
    return mapSpecsCPS(raw);
  } catch (e) {
    return {};
  }
}

function mapSpecsCPS(raw) {
  // CPU: Loại CPU
  const cpu = raw['Loại CPU'] || '';
  // RAM: Dung lượng + Loại RAM (VD: "16GB DDR5 4800MHz")
  const ram = [raw['Dung lượng RAM'], raw['Loại RAM']].filter(Boolean).join(' ');
  // Ổ cứng
  const storage = raw['Ổ cứng'] || '';
  // Màn hình: Kích thước + Công nghệ màn hình
  const screen = [raw['Kích thước màn hình'], raw['Công nghệ màn hình']].filter(Boolean).join(', ');
  // GPU: Loại card đồ họa
  const gpu = raw['Loại card đồ họa'] || '';
  // Trọng lượng
  const weight = raw['Trọng lượng'] || raw['Khối lượng'] || '';
  return { cpu, ram, storage, screen, gpu, weight };
}

// ── enrichSpecs: fetch specs cho SP chưa có, dừng khi hết deadline ──
async function enrichSpecs(products, specCache, fetchFn, page, startTime) {
  let fetched = 0;
  for (const p of products) {
    if (specCache.has(p.link)) {
      // Luôn copy specs từ cache vào product (kể cả SP cũ)
      Object.assign(p, specCache.get(p.link));
    } else {
      // Kiểm tra deadline trước khi fetch
      if (Date.now() - startTime > DEADLINE_MS) {
        console.log(`    ⏱ Deadline reached — dừng fetch specs`);
        break;
      }
      const specs = await fetchFn(page, p.link);
      Object.assign(p, specs);
      specCache.set(p.link, specs);
      fetched++;
      await sleep(600);
    }
  }
  if (fetched > 0) console.log(`    → Fetched specs: ${fetched} SP mới`);
}

// ── SCRAPER 1 — MBW ──────────────────────────────────────
async function scrapeMBW(page, brand) {
  console.log(`  [MBW] ${brand.name}`);
  try {
    await page.goto(brand.mbwUrl, { waitUntil: 'networkidle2', timeout: 90000 });
  } catch(e) {
    console.log(`    ⚠ Load failed: ${e.message.substring(0,60)}`);
    return [];
  }
  await sleep(2000);

  let clicks = 0;
  while (true) {
    const clicked = await page.evaluate(() => {
      const btn = document.querySelector('a.view-more, button.view-more, .view-more-btn');
      if (btn && btn.offsetParent !== null) { btn.click(); return true; }
      return false;
    }).catch(() => false);
    if (!clicked) break;
    clicks++;
    await sleep(2000);
  }
  if (clicks) console.log(`    → Load thêm: ${clicks} lần`);

  return page.evaluate((brandName, BASE) => {
    const out  = [];
    const seen = new Set();
    document.querySelectorAll('ul.listproduct li.item').forEach(item => {
      const aEl = item.querySelector('a.main-contain');
      if (!aEl) return;
      const href = aEl.getAttribute('href') || '';
      const link = href.startsWith('http') ? href : BASE + href;
      if (!href || seen.has(link)) return;
      seen.add(link);

      const name      = aEl.getAttribute('data-name') || aEl.querySelector('h3')?.innerText?.trim() || '';
      const salePrice = parseInt((aEl.getAttribute('data-price') || '0').replace(/\D/g,'')) || 0;
      const origPrice = parseInt((item.querySelector('p.price-old')?.innerText || '').replace(/\D/g,'')) || 0;
      const discount  = item.querySelector('span.percent')?.innerText?.trim() || '';
      const specs     = [...item.querySelectorAll('div.utility p')].map(p => p.innerText.trim());
      const compare   = [...item.querySelectorAll('div.item-compare span')].map(s => s.innerText.trim());
      const rating    = item.querySelector('div.vote-txt b')?.innerText?.trim() || '';
      const sold      = item.querySelector('div.rating_Compare span')?.innerText?.trim() || '';

      // MBW listing: mỗi spec có label prefix rõ ràng (VD: "Công nghệ CPU: i5-...")
      // Hàm parseSpec: tìm spec chứa keyword, trả về phần sau dấu ":"
      const parseSpec = (kw) => {
        const s = specs.find(s => s.toLowerCase().includes(kw.toLowerCase()));
        if (!s) return '';
        const colonIdx = s.indexOf(':');
        return colonIdx >= 0 ? s.substring(colonIdx + 1).trim() : s.trim();
      };
      // Fallback findSpec nếu không có dấu ":"
      const findSpec = (kw) => specs.find(s => s.toLowerCase().includes(kw.toLowerCase())) || '';

      const cpu    = parseSpec('Công nghệ CPU') || parseSpec('cpu') || findSpec('Core') || findSpec('Ryzen') || findSpec('Celeron') || findSpec('Snapdragon') || '';
      // RAM từ compare (div.item-compare) là chính xác nhất
      // Màn hình từ spec listing
      const screen = parseSpec('Kích thước màn hình') || parseSpec('màn hình') || findSpec('inch') || '';
      // GPU
      const gpu    = parseSpec('Card màn hình') || parseSpec('card') || findSpec('RTX') || findSpec('GTX') || findSpec('Radeon') || findSpec('Arc') || '';
      // Trọng lượng: từ "Kích thước:" có chứa kg, hoặc tìm theo kg
      const weightRaw = parseSpec('Kích thước') || parseSpec('trọng lượng') || findSpec('kg') || '';
      const weight = weightRaw;

      out.push({
        dealer: 'MBW', name, brand: brandName,
        cpu, screen, gpu, weight,
        ram: compare[0]||'', storage: compare[1]||'',
        origPrice, salePrice, discount, sold, rating, link,
      });
    });
    return out;
  }, brand.name, 'https://www.thegioididong.com');
}

// ── SCRAPER 2 — FPT Retail ────────────────────────────────
async function scrapeFPT(page, brand, specCache, startTime) {
  console.log(`  [FPT] ${brand.name}`);
  try {
    await page.goto(brand.fptUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch(e) {
    console.log(`    ⚠ Load failed: ${e.message.substring(0,60)}`);
    return [];
  }
  await sleep(2000);

  let prevCount = 0;
  for (let i = 0; i < 8; i++) {
    await scrollToBottom(page);
    await sleep(1500);
    const count = await page.evaluate(() => document.querySelectorAll('div.cardInfo').length);
    if (count === prevCount && count > 0) break;
    prevCount = count;
  }

  const products = await page.evaluate((brandName, BASE) => {
    const out  = [];
    const seen = new Set();
    document.querySelectorAll('div.cardInfo').forEach(card => {
      const linkEl = card.querySelector('a[href*="may-tinh-xach-tay/"]');
      if (!linkEl) return;
      const href = linkEl.getAttribute('href') || '';
      const link = href.startsWith('http') ? href : BASE + href;
      if (!href || seen.has(link)) return;
      seen.add(link);
      const name      = card.querySelector('h3, h2')?.innerText?.trim() || '';
      const salePrice = parseInt((card.querySelector('p.b1-semibold,[class*="b1-semibold"]')?.innerText||'').replace(/\D/g,'')) || 0;
      const origPrice = parseInt((card.querySelector('span[class*="line-through"]')?.innerText||'').replace(/\D/g,'')) || 0;
      const discount  = card.querySelector('[class*="discount"],[class*="percent"]')?.innerText?.trim() || '';
      if (!name || name.length < 5) return;
      out.push({
        dealer:'FPT Retail', name, brand:brandName,
        cpu:'', ram:'', storage:'', screen:'', gpu:'', weight:'',
        origPrice, salePrice, discount, sold:'', rating:'', link,
      });
    });
    return out;
  }, brand.name, 'https://fptshop.com.vn');

  console.log(`    → ${products.length} SP`);
  await enrichSpecs(products, specCache, fetchSpecsFPT, page, startTime);
  return products;
}

// ── SCRAPER 3 — CellPhone S ───────────────────────────────
async function scrapeCPS(page, brand, specCache, startTime) {
  console.log(`  [CPS] ${brand.name}`);
  try {
    await page.goto(brand.cpsUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch(e) {
    console.log(`    ⚠ Load failed: ${e.message.substring(0,60)}`);
    return [];
  }
  await sleep(2000);

  let clicks = 0;
  while (true) {
    await scrollToBottom(page);
    await sleep(1800);
    const clicked = await page.evaluate(() => {
      const sels = ['.btn-show-more','button.btn-show-more','.loadmore-btn',
                    'button[class*="loadmore"]','a[class*="loadmore"]','.load-more-button'];
      for (const sel of sels) {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) { el.click(); return true; }
      }
      return false;
    }).catch(() => false);
    if (!clicked) break;
    clicks++;
    await sleep(2500);
  }
  if (clicks) console.log(`    → Load thêm: ${clicks} lần`);

  const products = await page.evaluate((brandName, BASE) => {
    const out  = [];
    const seen = new Set();
    document.querySelectorAll('.product-item').forEach(card => {
      const linkEl = card.querySelector('a[href]');
      if (!linkEl) return;
      const href = linkEl.getAttribute('href') || '';
      const link = href.startsWith('http') ? href : BASE + href;
      if (!link.includes('.html') || seen.has(link)) return;
      seen.add(link);
      const name      = card.querySelector('h3, h2')?.innerText?.trim() || '';
      const salePrice = parseInt((card.querySelector('.product__price--show')?.innerText||'').replace(/\D/g,'')) || 0;
      const origPrice = parseInt((card.querySelector('.product__price--through')?.innerText||'').replace(/\D/g,'')) || 0;
      const discount  = card.querySelector('[class*="percent"],[class*="discount"]')?.innerText?.trim() || '';
      const rating    = card.querySelector('[class*="rating"] b, .rating b')?.innerText?.trim() || '';
      const soldEl    = [...card.querySelectorAll('span,p')].find(el => /[Đđ]ã bán/.test(el.innerText));
      const sold      = soldEl?.innerText?.replace(/[Đđ]ã bán\s*/i,'')?.trim() || '';
      if (!name || name.length < 5) return;
      out.push({
        dealer:'CellPhone S', name, brand:brandName,
        cpu:'', ram:'', storage:'', screen:'', gpu:'', weight:'',
        origPrice, salePrice, discount, sold, rating, link,
      });
    });
    return out;
  }, brand.name, 'https://cellphones.com.vn');

  console.log(`    → ${products.length} SP`);
  await enrichSpecs(products, specCache, fetchSpecsCPS, page, startTime);
  return products;
}

// ── Google Sheets: load spec cache ───────────────────────
async function loadSpecCacheFromSheet(sheets) {
  const cache = new Map();
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A2:R`,
    });
    (res.data.values || []).forEach(row => {
      const link = row[17];
      if (!link) return;
      const cpu=row[6]||'', ram=row[7]||'', storage=row[8]||'';
      const screen=row[9]||'', gpu=row[10]||'', weight=row[11]||'';
      if (cpu||ram||storage||screen||gpu||weight) {
        cache.set(link, { cpu, ram, storage, screen, gpu, weight });
      }
    });
    console.log(`📋 Spec cache: ${cache.size} SP đã có specs`);
  } catch(e) {
    console.log(`⚠ Spec cache load failed: ${e.message}`);
  }
  return cache;
}

// ── Google Sheets: ghi data ───────────────────────────────
async function writeToSheet(sheets, allProducts) {
  const today   = new Date();
  const dateStr = formatDate(today);
  const timeStr = formatTime(today);

  let existingRows = [];
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A2:R`,
    });
    existingRows = (res.data.values||[]).filter(row => row[0] && row[0] !== dateStr);
  } catch(e) {
    console.log('⚠ Read existing rows failed:', e.message);
  }

  const newRows = allProducts.map((p, i) => [
    dateStr, timeStr, i+1,
    p.dealer, p.name, p.brand,
    p.cpu, p.ram, p.storage, p.screen, p.gpu, p.weight,
    p.origPrice||'', p.salePrice||'', p.discount,
    p.sold, p.rating, p.link,
  ]);

  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A2:R`,
  });

  const allRows = [...existingRows, ...newRows];
  if (allRows.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A2`,
      valueInputOption: 'RAW',
      requestBody: { values: allRows },
    });
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A1:R1`,
    valueInputOption: 'RAW',
    requestBody: { values: [HEADERS] },
  });

  const missingSpecs = newRows.filter(r => !r[6] && !r[7]).length;
  console.log(`✅ Ghi ${newRows.length} dòng mới | Giữ ${existingRows.length} dòng cũ`);
  if (missingSpecs > 0) console.log(`⚠ ${missingSpecs} SP chưa có specs — sẽ fetch lần sau`);
}

// ── MAIN ──────────────────────────────────────────────────
(async () => {
  const startTime = Date.now();
  console.log('🚀 Multi-Dealer Scraper v2.6');
  console.log(`📅 ${new Date().toLocaleString('vi-VN')}`);
  console.log(`⏱ Deadline fetch specs: ${DEADLINE_MS/60000} phút`);

  fs.writeFileSync(CREDS_PATH, process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({
    keyFile: CREDS_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const specCache = await loadSpecCacheFromSheet(sheets);

  const browser = await puppeteer.launch({
    headless: true,
    protocolTimeout: 180000,
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage',
           '--disable-gpu','--window-size=1280,900'],
  });

  const allProducts = [];

  try {
    // ── MBW ──
    console.log('\n═══ MBW ═══');
    const pageMBW = await browser.newPage();
    await pageMBW.setViewport({ width: 1280, height: 900 });
    await pageMBW.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36');
    for (const brand of BRANDS) {
      const products = await scrapeMBW(pageMBW, brand);
      console.log(`    → ${products.length} SP`);
      allProducts.push(...products);
      await sleep(1000);
    }
    await pageMBW.close();

    // ── FPT ──
    console.log('\n═══ FPT Retail ═══');
    const pageFPT = await browser.newPage();
    await pageFPT.setViewport({ width: 1280, height: 900 });
    await pageFPT.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36');
    for (const brand of BRANDS) {
      const products = await scrapeFPT(pageFPT, brand, specCache, startTime);
      allProducts.push(...products);
      await sleep(800);
    }
    await pageFPT.close();

    // ── CPS ──
    console.log('\n═══ CellPhone S ═══');
    const pageCPS = await browser.newPage();
    await pageCPS.setViewport({ width: 1280, height: 900 });
    await pageCPS.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36');
    for (const brand of BRANDS) {
      const products = await scrapeCPS(pageCPS, brand, specCache, startTime);
      allProducts.push(...products);
      await sleep(800);
    }
    await pageCPS.close();

  } finally {
    await browser.close();
  }

  const byDealer = { MBW:0, 'FPT Retail':0, 'CellPhone S':0 };
  allProducts.forEach(p => { if (p.dealer in byDealer) byDealer[p.dealer]++; });
  console.log('\n📊 Kết quả:');
  Object.entries(byDealer).forEach(([d,c]) => console.log(`   ${d}: ${c} SP`));
  console.log(`   TỔNG: ${allProducts.length} SP`);
  console.log(`   Thời gian đã dùng: ${Math.round((Date.now()-startTime)/60000)} phút`);

  console.log('\n📝 Ghi Sheets...');
  await writeToSheet(sheets, allProducts);

  const elapsed = Math.round((Date.now()-startTime)/1000);
  console.log(`\n✅ Xong trong ${Math.floor(elapsed/60)}p${elapsed%60}s`);
  fs.unlinkSync(CREDS_PATH);
})().catch(err => {
  console.error('💥 Fatal:', err);
  process.exit(1);
});
