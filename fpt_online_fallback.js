// fpt_online_fallback.js — 06/08/2026
//
// Scrape FPT qua Bright Data Browser API (chay tren GitHub cloud, KHONG can
// may self-hosted (BARACK/MSI) bat). Chi duoc goi khi job "check-runners"
// xac nhan khong co may nao online (xem .github/workflows/scrape.yml, job
// "scrape-fpt-online").
//
// THIET KE: chi lay Model/Gia/Tinh trang/Link tu trang listing — KHONG parse
// CPU/RAM/GPU/Man hinh/Trong luong. Cac truong nay se duoc dien lai boi
// buoc enrichment tu tab "Part #" trong job write-sheet (giong cach MBW/CPS/
// FPT self-host deu dang dua vao). LUU Y: cach lam nay KHONG tiet kiem chi
// phi Bright Data — Bright Data Browser API tinh tien theo bang thong trinh
// duyet TAI TRANG (HTML/anh/font/script), khong theo so truong ma script
// trich xuat sau do tu DOM da load san. Chi don gian hoa code/giam rui ro
// selector vo cho cac truong spec (da thao luan voi Phuc 06/08/2026).
//
// Ghi ra scrape-output/products-FPT.json — DUNG DINH DANG voi scrapeFPT() tu
// host trong multi_dealer_scraper.js, de job write-sheet doc gop nhu thuong
// (khong can sua logic combine).
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const WS_ENDPOINT = process.env.BRIGHTDATA_BROWSER_WS;
const FPT_ALL_URL = 'https://fptshop.com.vn/may-tinh-xach-tay';
const OUTPUT_DIR = process.env.OUTPUT_DIR || './scrape-output';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// FIX 26/08/2026: ham nay TRUOC DAY duoc goi ben trong page.evaluate() ->
// ReferenceError "detectBrand is not defined" (browser context khong thay
// scope cua Node) -> path fallback luon tra 0 SP (run #499, #500). Nay brand
// duoc gan o Node SAU khi evaluate tra ve (xem scrapeFptListing).
//
// Noi dung ham COPY NGUYEN VAN tu detectBrand() inline trong
// multi_dealer_scraper.js (scrapeFPT, ~dong 1475) de output fallback trung
// khop 100% voi output self-hosted. Sua 1 trong 2 noi thi phai sua ca hai.
function detectBrand(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('msi')) return 'MSI';
  if (n.includes('asus') || n.includes('vivobook') || n.includes('zenbook') || n.includes('rog') || n.includes('tuf')) return 'Asus';
  if (n.includes('acer') || n.includes('aspire') || n.includes('predator') || n.includes('nitro') || n.includes('swift')) return 'Acer';
  if (n.includes('dell') || n.includes('inspiron') || n.includes('xps') || n.includes('alienware') || n.includes('latitude') || n.includes('vostro')) return 'Dell';
  if (n.includes('hp ') || n.includes('pavilion') || n.includes('envy') || n.includes('spectre') || n.includes('omen') || n.includes('elitebook') || n.includes('probook') || n.includes('victus')) return 'HP';
  if (n.includes('lenovo') || n.includes('ideapad') || n.includes('thinkpad') || n.includes('legion') || n.includes('yoga') || n.includes('loq')) return 'Lenovo';
  if (n.includes('samsung') || n.includes('galaxy book')) return 'Samsung';
  if (n.includes('macbook') || n.includes('apple')) return 'Apple';
  if (n.includes('gigabyte') || n.includes('aorus')) return 'Gigabyte';
  if (n.includes('lg ') || n.includes('gram')) return 'LG';
  if (n.includes('huawei') || n.includes('matebook')) return 'Huawei';
  if (n.includes('microsoft') || n.includes('surface')) return 'Microsoft';
  return 'Other';
}

async function scrapeFptListing(page) {
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
    // FIX 06/08/2026: cap 50 tung sai (Asus 1 brand da co 825 SP trong toan
    // bo catalog CellphoneS, nhung day la FPT All-brand page, ~447 SP thuc
    // te — cap 50 lan click du nhieu, khong phai nguyen nhan thieu SP nhu
    // CPS. Giu 50 lam luoi an toan chong loop vo han.
    if (clicks > 50) break;
  }

  const products = await page.evaluate((BASE) => {
    const out = [];
    const seen = new Set();
    document.querySelectorAll('div.cardInfo').forEach((card) => {
      // FIX 06/08/2026: khong con gioi han href chua "/may-tinh-xach-tay/" —
      // MacBook va vai category khac dung path rieng, bi loai oan truoc day.
      const linkEl = [...card.querySelectorAll('a[href]')].find((a) => {
        const h = a.getAttribute('href') || '';
        return h && h !== '#' && !h.startsWith('javascript:');
      });
      if (!linkEl) return;
      const href = linkEl.getAttribute('href') || '';
      const link = href.startsWith('http') ? href : BASE + href;
      if (!href || seen.has(link)) return;
      seen.add(link);
      const name = card.querySelector('h3, h2')?.textContent?.trim() || '';
      if (!name || name.length < 5) return;
      const salePrice = parseInt((card.querySelector('p.b1-semibold,[class*="b1-semibold"]')?.textContent || '').replace(/\D/g, '')) || 0;
      const origPrice = parseInt((card.querySelector('span[class*="line-through"]')?.textContent || '').replace(/\D/g, '')) || 0;
      const discount = card.querySelector('[class*="discount"],[class*="percent"]')?.innerText?.trim() || '';
      const cardText = (card.innerText || '').toLowerCase();
      let stockStatus;
      if (/tạm hết hàng|hết hàng/.test(cardText)) stockStatus = 'Tạm hết hàng';
      else if (/hàng sắp về/.test(cardText)) stockStatus = 'Hàng sắp về';
      else if (/ngừng kinh doanh|ngừng bán|ngừng/.test(cardText)) stockStatus = 'Ngừng KD';
      else if (!salePrice && !origPrice) stockStatus = 'Chưa rõ';
      else stockStatus = 'Còn hàng';
      out.push({
        // brand de rong o day — gan lai o Node sau khi evaluate tra ve
        // (callback nay chay trong browser context, khong thay detectBrand).
        dealer: 'FPT Retail', name, brand: '',
        // TAM RONG - dien lai boi enrichment tu Part# o job write-sheet.
        cpu: '', ram: '', storage: '', screen: '', gpu: '', weight: '',
        origPrice, salePrice, discount, sold: '', rating: '', link,
        stockStatus,
      });
    });
    return out;
  }, 'https://fptshop.com.vn');

  // Gan brand o Node scope (detectBrand khong ton tai trong browser context).
  products.forEach((p) => { p.brand = detectBrand(p.name); });

  return { products, clicks };
}

(async () => {
  const t0 = Date.now();
  let browser;
  let products = [];
  let ok = false;
  let errMsg = null;

  if (!WS_ENDPOINT) {
    console.log('❌ Thiếu BRIGHTDATA_BROWSER_WS — không thể chạy fallback online.');
    process.exit(1);
  }

  try {
    console.log('→ Kết nối Bright Data Browser API...');
    browser = await puppeteer.connect({ browserWSEndpoint: WS_ENDPOINT });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(60000);

    console.log(`→ Scrape listing FPT (fallback online): ${FPT_ALL_URL}`);
    const result = await scrapeFptListing(page);
    products = result.products;
    console.log(`← Lấy được ${products.length} SP (${result.clicks} lần click "Xem thêm")`);
    ok = true;
  } catch (e) {
    errMsg = e.message;
    console.log(`❌ Lỗi: ${errMsg}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  // Ghi du khi loi (mang rong) — write-sheet job van chay best-effort voi
  // du lieu cac dealer khac, giong triet ly cac job scrape-* khac.
  fs.writeFileSync(path.join(OUTPUT_DIR, 'products-FPT.json'), JSON.stringify(products));
  console.log(`💾 Đã lưu ${products.length} SP ra ${path.join(OUTPUT_DIR, 'products-FPT.json')}`);

  const elapsed = Math.round((Date.now() - t0) / 1000);
  console.log(`\n=== TÓM TẮT (fallback online) ===\nok=${ok} products=${products.length} elapsedSec=${elapsed} error=${errMsg || 'none'}`);
  if (!ok) process.exitCode = 1;
})();
