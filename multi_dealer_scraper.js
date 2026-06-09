/**
 * multi_dealer_scraper.js  — v2.1
 * Scrape laptop prices từ MBW / FPT Retail / CellPhone S → Google Sheets
 *
 * THAY ĐỔI v2.1 (spec-enrichment):
 *  - FPT + CPS: lần đầu gặp model mới → mở detail page → parse full specs
 *  - Specs được cache theo "link sản phẩm" → không fetch lại nếu đã có
 *  - MBW: giữ nguyên logic cũ (specs lấy từ listing page)
 *
 * Selectors đã verify thực tế (09/06/2026):
 *  FPT : modal "Xem tất cả thông số" → div.flex.gap-2.border-b → children[0]=label, [1]=value
 *  CPS : tr.technical-content-item → td[0]=label, td[1]=value
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

const BRANDS = [
  { name: 'Asus',    mbwUrl: 'https://www.thegioididong.com/laptop-asus',    fptUrl: 'https://fptshop.com.vn/may-tinh-xach-tay/asus',    cpsUrl: 'https://cellphones.com.vn/laptop/thuong-hieu-asus.html'    },
  { name: 'Acer',    mbwUrl: 'https://www.thegioididong.com/laptop-acer',    fptUrl: 'https://fptshop.com.vn/may-tinh-xach-tay/acer',    cpsUrl: 'https://cellphones.com.vn/laptop/thuong-hieu-acer.html'    },
  { name: 'Dell',    mbwUrl: 'https://www.thegioididong.com/laptop-dell',    fptUrl: 'https://fptshop.com.vn/may-tinh-xach-tay/dell',    cpsUrl: 'https://cellphones.com.vn/laptop/thuong-hieu-dell.html'    },
  { name: 'HP',      mbwUrl: 'https://www.thegioididong.com/laptop-hp',      fptUrl: 'https://fptshop.com.vn/may-tinh-xach-tay/hp',      cpsUrl: 'https://cellphones.com.vn/laptop/thuong-hieu-hp.html'      },
  { name: 'Lenovo',  mbwUrl: 'https://www.thegioididong.com/laptop-lenovo',  fptUrl: 'https://fptshop.com.vn/may-tinh-xach-tay/lenovo',  cpsUrl: 'https://cellphones.com.vn/laptop/thuong-hieu-lenovo.html'  },
  { name: 'MSI',     mbwUrl: 'https://www.thegioididong.com/laptop-msi',     fptUrl: 'https://fptshop.com.vn/may-tinh-xach-tay/msi',     cpsUrl: 'https://cellphones.com.vn/laptop/thuong-hieu-msi.html'     },
  { name: 'Samsung', mbwUrl: 'https://www.thegioididong.com/laptop-samsung', fptUrl: 'https://fptshop.com.vn/may-tinh-xach-tay/samsung', cpsUrl: 'https://cellphones.com.vn/laptop/thuong-hieu-samsung.html' },
  { name: 'MacBook', mbwUrl: 'https://www.thegioididong.com/laptop-apple',   fptUrl: 'https://fptshop.com.vn/may-tinh-xach-tay/macbook', cpsUrl: 'https://cellphones.com.vn/macbook.html'                    },
  { name: 'Gigabyte',mbwUrl: 'https://www.thegioididong.com/laptop-gigabyte',fptUrl: 'https://fptshop.com.vn/may-tinh-xach-tay/gigabyte',cpsUrl: 'https://cellphones.com.vn/laptop/thuong-hieu-gigabyte.html' },
];

const HEADERS = [
  'Ngày','Giờ','STT','Dealer','Tên Model','Hãng',
  'CPU','RAM','Ổ cứng','Màn hình','Card đồ họa','Trọng lượng',
  'Giá gốc (₫)','Giá KM (₫)','Giảm (%)','Đã bán','Rating (★)','Link sản phẩm',
];

// ── Helpers ───────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

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

// ── FPT: parse specs từ modal "Thông số nổi bật" ─────────
async function fetchSpecsFPT(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(1500);

    // Click "Xem tất cả thông số"
    const clicked = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('span, button, a')];
      const btn = btns.find(b => b.innerText?.trim() === 'Xem tất cả thông số');
      if (btn) { btn.click(); return true; }
      return false;
    });

    if (clicked) await sleep(800);

    // Parse rows từ modal: div.flex.gap-2.border-b → 2 children
    const rawSpecs = await page.evaluate(() => {
      const rows = document.querySelectorAll('.flex.gap-2.border-b');
      const specs = {};
      rows.forEach(row => {
        const children = [...row.children];
        if (children.length >= 2) {
          const label = children[0].innerText?.trim();
          const value = children[1].innerText?.trim().replace(/\n+/g, ' ');
          if (label && value) specs[label] = value;
        }
      });
      return specs;
    });

    return mapSpecsFPT(rawSpecs);
  } catch (e) {
    console.log(`    ⚠ FPT spec fetch failed: ${e.message.substring(0, 60)}`);
    return {};
  }
}

function mapSpecsFPT(raw) {
  // CPU: ghép "Công nghệ CPU" + "Loại CPU" (VD: "Core Ultra 5 115U")
  const cpuTech = raw['Công nghệ CPU'] || '';
  const cpuType = raw['Loại CPU'] || '';
  const cpuHz   = raw['Tốc độ tối đa'] ? ` - Max Turbo: ${raw['Tốc độ tối đa']}` : '';
  const cpu     = [cpuTech, cpuType].filter(Boolean).join(' ') + cpuHz;

  const ram     = raw['Dung lượng RAM'] || '';
  // Ổ cứng: ưu tiên "Dung lượng SSD" (chỉ số GB), fallback "Kiểu ổ cứng"
  const storage = raw['Dung lượng SSD']
    ? `${raw['Dung lượng SSD']}GB SSD`
    : (raw['Kiểu ổ cứng'] || '');
  const screen  = raw['Kích thước màn hình'] || '';
  // GPU: "Tên đầy đủ (Card onbroad)" hoặc fallback "Hãng (Card Oboard)"
  const gpu     = raw['Tên đầy đủ (Card onbroad)'] || raw['Hãng (Card Oboard)'] || '';
  const weight  = raw['Khối lượng'] || raw['Trọng lượng'] || '';

  return { cpu, ram, storage, screen, gpu, weight };
}

// ── CPS: parse specs từ tr.technical-content-item ─────────
async function fetchSpecsCPS(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(1500);

    const rawSpecs = await page.evaluate(() => {
      const rows = document.querySelectorAll('tr.technical-content-item');
      const specs = {};
      rows.forEach(row => {
        const tds = row.querySelectorAll('td');
        if (tds.length >= 2) {
          const label = tds[0].innerText?.trim();
          const value = tds[1].innerText?.trim().replace(/\n+/g, ' ');
          if (label && value) specs[label] = value;
        }
      });
      return specs;
    });

    return mapSpecsCPS(rawSpecs);
  } catch (e) {
    console.log(`    ⚠ CPS spec fetch failed: ${e.message.substring(0, 60)}`);
    return {};
  }
}

function mapSpecsCPS(raw) {
  const cpu     = raw['Loại CPU'] || '';
  const ram     = raw['Dung lượng RAM'] || '';
  const storage = raw['Ổ cứng'] || '';
  const screen  = raw['Kích thước màn hình'] || '';
  const gpu     = raw['Loại card đồ họa'] || '';
  const weight  = raw['Trọng lượng'] || raw['Khối lượng'] || '';
  return { cpu, ram, storage, screen, gpu, weight };
}

// ── SCRAPER 1 — MBW (thegioididong.com) ───────────────────
async function scrapeMBW(page, brand) {
  console.log(`  [MBW] ${brand.name}`);
  try {
    await page.goto(brand.mbwUrl, { waitUntil: 'networkidle2', timeout: 90000 });
  } catch(e) {
    console.log(`    ⚠ Load failed: ${e.message.substring(0,60)}`);
    return [];
  }
  await sleep(2000);

  // Click "Xem thêm" loop
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
    const items = document.querySelectorAll('ul.listproduct li.item');

    items.forEach(item => {
      const aEl = item.querySelector('a.main-contain');
      if (!aEl) return;
      const href = aEl.getAttribute('href') || '';
      const link = href.startsWith('http') ? href : BASE + href;
      if (!href || seen.has(link)) return;
      seen.add(link);

      const name      = aEl.getAttribute('data-name') || aEl.querySelector('h3')?.innerText?.trim() || '';
      const salePrice = parseInt((aEl.getAttribute('data-price') || '0').replace(/\D/g,'')) || 0;
      const origEl    = item.querySelector('p.price-old');
      const origPrice = origEl ? parseInt(origEl.innerText.replace(/\D/g,'')) || 0 : 0;
      const discEl    = item.querySelector('span.percent');
      const discount  = discEl ? discEl.innerText.trim() : '';

      // Specs từ listing
      const specEls = item.querySelectorAll('div.utility p');
      const specs   = [...specEls].map(p => p.innerText.trim());
      const compareEls = item.querySelectorAll('div.item-compare span');
      const compare    = [...compareEls].map(s => s.innerText.trim());

      const cpu    = specs[0] || '';
      const screen = specs[1] || '';
      const gpu    = specs[2] || '';
      const weight = specs[3] || '';
      const ram    = compare[0] || '';
      const storage= compare[1] || '';

      const ratingEl = item.querySelector('div.vote-txt b');
      const rating   = ratingEl ? ratingEl.innerText.trim() : '';
      const soldEl   = item.querySelector('div.rating_Compare span');
      const sold     = soldEl ? soldEl.innerText.trim() : '';

      out.push({
        dealer: 'MBW', name, brand: brandName,
        cpu, ram, storage, screen, gpu, weight,
        origPrice, salePrice, discount, sold, rating, link,
      });
    });
    return out;
  }, brand.name, 'https://www.thegioididong.com');
}

// ── SCRAPER 2 — FPT Retail (fptshop.com.vn) ───────────────
async function scrapeFPT(page, brand, specCache) {
  console.log(`  [FPT] ${brand.name}`);
  try {
    await page.goto(brand.fptUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch(e) {
    console.log(`    ⚠ Load failed: ${e.message.substring(0,60)}`);
    return [];
  }
  await sleep(2000);

  // Scroll để load lazy products
  let prevCount = 0;
  for (let i = 0; i < 8; i++) {
    await scrollToBottom(page);
    await sleep(1500);
    const count = await page.evaluate(() =>
      document.querySelectorAll('a[href*="may-tinh-xach-tay/"]').length
    );
    if (count === prevCount) break;
    prevCount = count;
  }

  // Lấy danh sách sản phẩm từ listing
  const products = await page.evaluate((brandName, BASE) => {
    const out  = [];
    const seen = new Set();

    // FPT product cards
    const cards = document.querySelectorAll(
      '.cdt-product__info, [class*="product-info"], .item__info, ' +
      '[class*="CardProduct"], [class*="card-product"]'
    );

    // Fallback: tìm tất cả links sản phẩm
    const links = document.querySelectorAll('a[href*="may-tinh-xach-tay/"]');
    links.forEach(a => {
      const href = a.href || '';
      // Chỉ lấy link sản phẩm cụ thể (slug dài >= 15 ký tự, không phải category)
      const slug = href.replace(/.*may-tinh-xach-tay\//, '').split('?')[0];
      if (slug.length < 12 || seen.has(href)) return;
      // Bỏ các category slug
      const categories = ['gaming-do-hoa','sinh-vien-van-phong','mong-nhe','doanh-nhan',
                          'asus','acer','dell','hp','lenovo','msi','samsung','macbook',
                          'gigabyte','apple','colorful','masstel','lg','ai'];
      if (categories.includes(slug)) return;
      seen.add(href);

      // Tìm tên và giá từ context xung quanh link
      const container = a.closest('[class*="product"], [class*="item"], li, article') || a.parentElement;
      const nameEl  = container?.querySelector('h3, h2, [class*="name"], [class*="title"]');
      const priceEl = container?.querySelector('[class*="price"]:not([class*="old"]):not([class*="original"])');
      const oldEl   = container?.querySelector('[class*="old-price"], [class*="price-old"], [class*="original"]');
      const discEl  = container?.querySelector('[class*="discount"], [class*="percent"], [class*="sale"]');

      const name      = nameEl?.innerText?.trim() || a.innerText?.trim() || slug;
      const salePrice = parseInt((priceEl?.innerText || '').replace(/\D/g,'')) || 0;
      const origPrice = parseInt((oldEl?.innerText || '').replace(/\D/g,'')) || 0;
      const discount  = discEl?.innerText?.trim() || '';

      if (!name || name.length < 5) return;

      out.push({
        dealer: 'FPT Retail', name, brand: brandName,
        cpu: '', ram: '', storage: '', screen: '', gpu: '', weight: '',
        origPrice, salePrice, discount,
        sold: '', rating: '', link: href,
      });
    });
    return out;
  }, brand.name, 'https://fptshop.com.vn');

  console.log(`    → ${products.length} sản phẩm tìm thấy`);

  // Fetch specs cho sản phẩm mới (chưa có trong cache)
  let specFetched = 0;
  for (const p of products) {
    if (specCache.has(p.link)) {
      // Đã có specs từ lần trước
      Object.assign(p, specCache.get(p.link));
    } else {
      // Sản phẩm mới — fetch detail page
      console.log(`    → Fetch specs: ${p.name.substring(0, 40)}`);
      const specs = await fetchSpecsFPT(page, p.link);
      Object.assign(p, specs);
      specCache.set(p.link, specs);
      specFetched++;
      await sleep(800);
    }
  }
  if (specFetched) console.log(`    → Đã fetch specs cho ${specFetched} SP mới`);

  return products;
}

// ── SCRAPER 3 — CellPhone S (cellphones.com.vn) ───────────
async function scrapeCPS(page, brand, specCache) {
  console.log(`  [CPS] ${brand.name}`);
  try {
    await page.goto(brand.cpsUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch(e) {
    console.log(`    ⚠ Load failed: ${e.message.substring(0,60)}`);
    return [];
  }
  await sleep(2000);

  // Scroll + "Xem thêm" loop
  let clicks = 0;
  while (true) {
    await scrollToBottom(page);
    await sleep(1800);
    const clicked = await page.evaluate(() => {
      const sels = ['.btn-show-more','button.btn-show-more','.loadmore-btn',
                    'button[class*="loadmore"]','a[class*="loadmore"]',
                    '.view-more-wrap a','.load-more-button'];
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

  // Lấy danh sách sản phẩm
  const products = await page.evaluate((brandName, BASE) => {
    const out  = [];
    const seen = new Set();

    const cards = document.querySelectorAll(
      '.product-item, .product__item, [class*="product-item"], ' +
      '.cps-product-card, [class*="product-card"]'
    );

    cards.forEach(card => {
      const aEl = card.querySelector('a[href]');
      if (!aEl) return;
      const href = aEl.getAttribute('href') || '';
      const link = href.startsWith('http') ? href : BASE + href;
      if (!link.includes('.html') || seen.has(link)) return;
      seen.add(link);

      const nameEl    = card.querySelector('h3, h2, .product-name, [class*="product-name"]');
      const name      = nameEl?.innerText?.trim() || '';
      const priceEl   = card.querySelector('.product__price--show, [class*="price-show"], [class*="price-current"]');
      const oldEl     = card.querySelector('.product__price--through, [class*="price-through"], [class*="price-old"]');
      const discEl    = card.querySelector('[class*="discount"], [class*="percent"], [class*="sale-off"]');
      const ratingEl  = card.querySelector('[class*="rating"] b, [class*="star"] b, .rating b');
      const soldEl    = [...card.querySelectorAll('span, p')].find(el =>
        el.innerText.includes('Đã bán') || el.innerText.includes('đã bán'));

      const salePrice = parseInt((priceEl?.innerText || '').replace(/\D/g,'')) || 0;
      const origPrice = parseInt((oldEl?.innerText || '').replace(/\D/g,'')) || 0;
      const discount  = discEl?.innerText?.trim() || '';
      const rating    = ratingEl?.innerText?.trim() || '';
      const sold      = soldEl?.innerText?.replace(/[Đđ]ã bán\s*/i,'')?.trim() || '';

      if (!name || name.length < 5) return;

      out.push({
        dealer: 'CellPhone S', name, brand: brandName,
        cpu: '', ram: '', storage: '', screen: '', gpu: '', weight: '',
        origPrice, salePrice, discount, sold, rating, link,
      });
    });
    return out;
  }, brand.name, 'https://cellphones.com.vn');

  console.log(`    → ${products.length} sản phẩm tìm thấy`);

  // Fetch specs cho sản phẩm mới
  let specFetched = 0;
  for (const p of products) {
    if (specCache.has(p.link)) {
      Object.assign(p, specCache.get(p.link));
    } else {
      console.log(`    → Fetch specs: ${p.name.substring(0, 40)}`);
      const specs = await fetchSpecsCPS(page, p.link);
      Object.assign(p, specs);
      specCache.set(p.link, specs);
      specFetched++;
      await sleep(800);
    }
  }
  if (specFetched) console.log(`    → Đã fetch specs cho ${specFetched} SP mới`);

  return products;
}

// ── Google Sheets: đọc spec cache hiện có ─────────────────
async function loadSpecCacheFromSheet(sheets) {
  const cache = new Map();
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A2:R`,
    });
    const rows = res.data.values || [];
    // Cột R (index 17) = Link sản phẩm
    // Cột G (index 6)  = CPU ... Cột L (index 11) = Trọng lượng
    rows.forEach(row => {
      const link = row[17];
      if (!link) return;
      const cpu    = row[6]  || '';
      const ram    = row[7]  || '';
      const storage= row[8]  || '';
      const screen = row[9]  || '';
      const gpu    = row[10] || '';
      const weight = row[11] || '';
      // Chỉ cache nếu có ít nhất 1 spec
      if (cpu || ram || storage || screen || gpu || weight) {
        cache.set(link, { cpu, ram, storage, screen, gpu, weight });
      }
    });
    console.log(`📋 Spec cache: ${cache.size} sản phẩm đã có specs`);
  } catch(e) {
    console.log(`⚠ Không đọc được spec cache: ${e.message}`);
  }
  return cache;
}

// ── Google Sheets: ghi data ────────────────────────────────
async function writeToSheet(sheets, allProducts) {
  const today    = new Date();
  const dateStr  = today.toLocaleDateString('vi-VN');
  const timeStr  = today.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

  // Đọc dữ liệu hiện có để giữ lại rows cũ (ngày khác)
  let existingRows = [];
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A2:R`,
    });
    existingRows = (res.data.values || []).filter(row => row[0] && row[0] !== dateStr);
  } catch(e) {
    console.log('⚠ Không đọc được dữ liệu cũ:', e.message);
  }

  // Build rows mới (hôm nay)
  const newRows = allProducts.map((p, i) => [
    dateStr, timeStr, i + 1,
    p.dealer, p.name, p.brand,
    p.cpu, p.ram, p.storage, p.screen, p.gpu, p.weight,
    p.origPrice || '', p.salePrice || '', p.discount,
    p.sold, p.rating, p.link,
  ]);

  const allRows = [...existingRows, ...newRows];

  // Xoá + ghi lại toàn bộ
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A2:R`,
  });

  if (allRows.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A2`,
      valueInputOption: 'RAW',
      requestBody: { values: allRows },
    });
  }

  // Ghi header nếu chưa có
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A1:R1`,
    valueInputOption: 'RAW',
    requestBody: { values: [HEADERS] },
  });

  console.log(`✅ Đã ghi ${newRows.length} dòng mới, giữ ${existingRows.length} dòng cũ`);
}

// ── MAIN ──────────────────────────────────────────────────
(async () => {
  const startTime = Date.now();
  console.log('🚀 Multi-Dealer Scraper v2.1 bắt đầu...');
  console.log(`📅 ${new Date().toLocaleString('vi-VN')}`);

  // Setup Google Sheets auth
  fs.writeFileSync(CREDS_PATH, process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({
    keyFile: CREDS_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  // Load spec cache từ sheet hiện có (tránh fetch lại)
  const specCache = await loadSpecCacheFromSheet(sheets);

  // Launch Puppeteer
  const browser = await puppeteer.launch({
    headless: true,
    protocolTimeout: 120000,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1280,900',
    ],
  });

  const allProducts = [];

  try {
    // ── MBW ──
    console.log('\n═══ MBW (thegioididong.com) ═══');
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
    console.log('\n═══ FPT Retail (fptshop.com.vn) ═══');
    const pageFPT = await browser.newPage();
    await pageFPT.setViewport({ width: 1280, height: 900 });
    await pageFPT.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36');

    for (const brand of BRANDS) {
      const products = await scrapeFPT(pageFPT, brand, specCache);
      allProducts.push(...products);
      await sleep(1000);
    }
    await pageFPT.close();

    // ── CPS ──
    console.log('\n═══ CellPhone S (cellphones.com.vn) ═══');
    const pageCPS = await browser.newPage();
    await pageCPS.setViewport({ width: 1280, height: 900 });
    await pageCPS.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36');

    for (const brand of BRANDS) {
      const products = await scrapeCPS(pageCPS, brand, specCache);
      allProducts.push(...products);
      await sleep(1000);
    }
    await pageCPS.close();

  } finally {
    await browser.close();
  }

  // Tổng kết
  const byDealer = { MBW: 0, 'FPT Retail': 0, 'CellPhone S': 0 };
  allProducts.forEach(p => { if (byDealer[p.dealer] !== undefined) byDealer[p.dealer]++; });
  console.log('\n📊 Kết quả scraping:');
  Object.entries(byDealer).forEach(([d, c]) => console.log(`   ${d}: ${c} SP`));
  console.log(`   TỔNG: ${allProducts.length} SP`);

  // Ghi vào Google Sheets
  console.log('\n📝 Ghi vào Google Sheets...');
  await writeToSheet(sheets, allProducts);

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n✅ Hoàn thành trong ${Math.floor(elapsed/60)}p${elapsed%60}s`);
  fs.unlinkSync(CREDS_PATH);
})().catch(err => {
  console.error('💥 Fatal error:', err);
  process.exit(1);
});
