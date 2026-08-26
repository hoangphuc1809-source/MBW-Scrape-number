// pv_online_fallback.js — 26/08/2026
//
// Scrape Phong Vu qua Bright Data Browser API (chay tren GitHub cloud, KHONG
// can may self-hosted (BARACK/MSI) bat). Chi duoc goi khi job "check-runners"
// xac nhan khong co may nao online, hoac khi dispatch tay voi
// force_fallback=true (xem .github/workflows/scrape.yml, job "scrape-pv-online").
//
// LY DO TON TAI: truoc 26/08/2026 CHI FPT co fallback. Ngay nao ca 2 may cung
// off thi PV mat trang du lieu — da xay ra that o run #507 (26/08): trong
// dashboard/data.csv ngay do khong con dong "Phong Vu" nao. PV bi Cloudflare
// bot-challenge chan IP cloud y het FPT, ma FPT da giai quyet duoc bang Bright
// Data, nen khong co rao can ky thuat nao — chi la truoc day chua ai viet.
//
// THIET KE: giu NGUYEN selector + logic click cua scrapePV() trong
// multi_dealer_scraper.js (~dong 1202) de output trung khop voi ban self-hosted.
// Khac 1 diem duy nhat: KHONG parse spec (cpu/ram/storage/screen/gpu/weight)
// tu icon block — de rong cho buoc enrichment tu tab "Part #" dien lai, giong
// het cach fpt_online_fallback.js dang lam. Luu y cach nay KHONG tiet kiem chi
// phi Bright Data (tinh theo bang thong TAI trang, khong theo so truong trich
// xuat), chi don gian hoa code va giam rui ro selector spec vo.
//
// KHAC BIET QUAN TRONG so voi ban self-hosted: brand cua PV lay TRUC TIEP tu
// DOM (.product-brand-name a) chu KHONG suy ra tu ten SP nhu FPT. Vi vay o day
// KHONG dung detectBrand() — lam vay se lech voi ban self-hosted.
//
// Ghi ra scrape-output/products-PV.json — DUNG DINH DANG voi scrapePV() de job
// write-sheet doc gop nhu thuong (khong can sua logic combine).
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const WS_ENDPOINT = process.env.BRIGHTDATA_BROWSER_WS;
const PV_URL = 'https://phongvu.vn/c/laptop';
const PV_MAX_CLICKS = 35; // giong multi_dealer_scraper.js dong 1201
const OUTPUT_DIR = process.env.OUTPUT_DIR || './scrape-output';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Bao ve moi page.evaluate bang timeout rieng — copy y tuong tu
// evalWithTimeout() trong multi_dealer_scraper.js. Ly do giu lai: PV tung gay
// treo vi page.evaluate() khong co timeout (root cause da fix truoc day).
function evalWithTimeout(promise, ms, fallback) {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise((r) => setTimeout(() => r(fallback), ms)),
  ]);
}

async function scrapePvListing(page) {
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  await page.goto(PV_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('.product-card', { timeout: 20000 }).catch(() => {});
  await sleep(2000);

  const countCards = () => evalWithTimeout(
    page.evaluate(() => document.querySelectorAll('.product-card').length), 8000, -1
  );

  let cardCount = await countCards();
  let retry = 0;
  while (cardCount <= 0 && retry < 3) {
    retry++;
    console.log(`    ⚠ 0 card sau load (thử ${retry}/3) — chờ thêm 5s`);
    await sleep(5000);
    cardCount = await countCards();
  }
  console.log(`    → ${cardCount} card ban đầu`);

  // Vong lap load-more: GIU NGUYEN co che state-machine cua scrapePV()
  // ('clicked'|'gone'|'hidden'|'timeout'). KHONG rut gon thanh boolean —
  // day chinh la bug da lam PV mat ~45% coverage tu 14/08 den 18/08/2026.
  let clicks = 0, stagnant = 0, softFail = 0, goneStreak = 0;
  while (clicks < PV_MAX_CLICKS) {
    const before = await countCards();
    const state = await evalWithTimeout(page.evaluate(() => {
      const els = [...document.querySelectorAll('div,a,button')].filter(
        (el) => el.textContent.trim() === 'Xem thêm sản phẩm'
      );
      if (els.length === 0) return 'gone';
      const target = els[els.length - 1];
      if (target.offsetParent === null) return 'hidden';
      target.scrollIntoView({ block: 'center' });
      target.click();
      return 'clicked';
    }), 10000, 'timeout');

    if (state !== 'clicked') {
      if (state === 'gone') {
        goneStreak++;
        if (goneStreak >= 3) {
          console.log(`    → Nút "Xem thêm sản phẩm" không còn (xác nhận ${goneStreak} lần) — đã load hết`);
          break;
        }
        console.log(`    · Nút biến mất (lần ${goneStreak}/3) — chờ 3s xác nhận lại`);
      } else {
        softFail++;
        console.log(`    ⚠ Load-more state=${state} (lần ${softFail}/5) — chờ rồi thử lại`);
        if (softFail >= 5) {
          console.log(`    💥 5 lần liên tiếp không bấm được nút — dừng (mới ${before} card)`);
          break;
        }
      }
      await sleep(3000);
      continue;
    }
    goneStreak = 0; softFail = 0;

    await sleep(2200);
    const after = await countCards();
    clicks++;
    if (before < 0 || after < 0) {
      console.log('    ⚠ Không đếm được số card lần này — bỏ qua, không tính stagnant');
      await sleep(2000);
      continue;
    }
    if (after === before) {
      stagnant++;
      if (stagnant >= 4) {
        console.log(`    ⚠ Load-more không tăng SP 4 lần liên tiếp (${after} card) — dừng`);
        break;
      }
      await sleep(2500);
    } else stagnant = 0;
  }
  if (clicks >= PV_MAX_CLICKS) console.log(`    ⚠ Đạt giới hạn ${PV_MAX_CLICKS} lần click — dừng`);
  const finalCards = await countCards();
  console.log(`    → "Xem thêm sản phẩm": ${clicks} lần | ${finalCards} card trên trang`);

  const products = await evalWithTimeout(page.evaluate((BASE) => {
    const out = [];
    const seen = new Set();
    document.querySelectorAll('.product-card').forEach((card) => {
      const a = card.querySelector('a[sku]');
      if (!a) return;
      const sku = a.getAttribute('sku');
      if (!sku || seen.has(sku)) return;
      seen.add(sku);
      let link = a.getAttribute('href') || '';
      if (!link.startsWith('http')) link = BASE + link;
      const name = card.querySelector('h3[title]')?.getAttribute('title') || '';
      if (!name || name.length < 5) return;
      const brand = card.querySelector('.product-brand-name a')?.textContent?.trim() || '';

      // Gia: latest-price luon co. retail-price CHI xuat hien khi co giam gia
      // — khong co nghia la SP khong giam gia, org=sale (rule cua Phuc).
      const salePrice = parseInt((card.querySelector('.att-product-detail-latest-price')?.textContent || '').replace(/\D/g, '')) || 0;
      const origEl = card.querySelector('.att-product-detail-retail-price');
      const origPrice = origEl ? (parseInt(origEl.textContent.replace(/\D/g, '')) || salePrice) : salePrice;
      const discount = origEl ? (origEl.parentElement.querySelector('[color="red"]')?.textContent.trim() || '') : '';

      const cardText = card.innerText || '';
      let pvStatus;
      if (/tạm hết hàng|hết hàng|out of stock/i.test(cardText)) pvStatus = 'Tạm hết hàng';
      else if (/ngừng kinh doanh|ngừng bán/i.test(cardText)) pvStatus = 'Ngừng KD';
      else if (!salePrice && !origPrice) pvStatus = 'Chưa rõ';
      else pvStatus = 'Còn hàng';

      out.push({
        dealer: 'Phong Vu', name, brand,
        cpu: '', ram: '', storage: '', screen: '', gpu: '', weight: '',
        origPrice, salePrice, discount, sold: '', rating: '', link,
        stockStatus: pvStatus,
      });
    });
    return out;
  }, 'https://phongvu.vn'), 20000, []);

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

    console.log(`→ Scrape listing Phong Vu (fallback online): ${PV_URL}`);
    const result = await scrapePvListing(page);
    products = result.products;
    console.log(`← Lấy được ${products.length} SP (${result.clicks} lần click "Xem thêm sản phẩm")`);
    ok = true;
  } catch (e) {
    errMsg = e.message;
    console.log(`❌ Lỗi: ${errMsg}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  // Ghi du khi loi (mang rong) — write-sheet van chay best-effort voi du lieu
  // cac dealer khac, giong triet ly cac job scrape-* khac.
  fs.writeFileSync(path.join(OUTPUT_DIR, 'products-PV.json'), JSON.stringify(products));
  console.log(`💾 Đã lưu ${products.length} SP ra ${path.join(OUTPUT_DIR, 'products-PV.json')}`);

  const elapsed = Math.round((Date.now() - t0) / 1000);
  console.log(`\n=== TÓM TẮT (PV fallback online) ===\nok=${ok} products=${products.length} elapsedSec=${elapsed} error=${errMsg || 'none'}`);
  if (!ok) process.exitCode = 1;
})();
