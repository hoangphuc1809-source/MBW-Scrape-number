// pv_api.js — 26/08/2026
//
// Lay danh sach laptop Phong Vu qua API JSON cua Teko (backend that su cua
// phongvu.vn) thay vi dieu khien trinh duyet.
//
// TAI SAO: trang HTML phongvu.vn bi Cloudflare bot-challenge chan IP cloud nen
// scrapePV() phai chay self-hosted, mat ~138s + ~4 phut recovery, va phu thuoc
// toc do may (bug 26/08: BARACK cham -> dung o 220/404 card). API thi:
//   - KHONG bi chan tu IP cloud (da do bang workflow probe tren ubuntu-latest:
//     status=200, 384 SKU trong 3s)
//   - khong can trinh duyet, khong click "Xem them", khong stagnant guard
//   - tra ve ca `total` de doi chieu -> biet ngay co lay thieu hay khong
//
// RUI RO da biet: day la API noi bo, Teko co the doi schema hoac them auth bat
// ky luc nao ma khong bao. Vi vay job goi file nay PHAI co duong lui ve
// scrapePV() (Puppeteer) khi API that bai — xem scrape.yml.
//
// Ghi ra scrape-output/products-PV.json — DUNG DINH DANG voi scrapePV() de job
// write-sheet doc gop nhu thuong.
const fs = require('fs');
const path = require('path');
const https = require('https');

const API_HOST = 'discovery.tekoapis.com';
const API_PATH = '/api/v2/search-skus-v2';
const SLUG = '/c/laptop';
const PAGE_SIZE = 100;
const MAX_PAGES = 20; // chan vong lap vo han; 384 SP hien tai chi can 4 trang
const OUTPUT_DIR = process.env.OUTPUT_DIR || './scrape-output';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function callApi(page, attempt = 1) {
  const body = JSON.stringify({
    terminalId: 4, page, pageSize: PAGE_SIZE, slug: SLUG, filter: {},
    sorting: { sort: 'SORT_BY_CREATED_AT', order: 'ORDER_BY_DESCENDING' },
    returnFilterable: [], isNeedFeaturedProducts: false,
  });
  return new Promise((resolve) => {
    const req = https.request({
      hostname: API_HOST, path: API_PATH, method: 'POST', timeout: 30000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve({ ok: false, status: res.statusCode });
        try { resolve({ ok: true, json: JSON.parse(d) }); }
        catch (e) { resolve({ ok: false, status: 'PARSE', err: e.message }); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 'TIMEOUT' }); });
    req.on('error', (e) => resolve({ ok: false, status: 'ERR', err: e.message }));
    req.write(body); req.end();
  }).then(async (r) => {
    if (!r.ok && attempt < 3) {
      console.log(`    ⚠ Trang ${page} lỗi (${r.status}) — thử lại lần ${attempt + 1}/3`);
      await sleep(2000 * attempt);
      return callApi(page, attempt + 1);
    }
    return r;
  });
}

// Spec nam trong truong `highlight` duoi dang <img src=".../icon/CPU.svg"><span>...</span>
// — CUNG cau truc ma scrapePV() doc tu DOM, nen dung y nguyen bo tu khoa cu.
function getSpec(highlight, keyword) {
  if (!highlight) return '';
  const re = new RegExp(`<img[^>]+src="[^"]*${keyword}[^"]*"[^>]*>\\s*<span>([^<]*)</span>`, 'i');
  const m = highlight.match(re);
  return m ? m[1].trim() : '';
}

function mapProduct(p) {
  const salePrice = parseInt(p.latestPrice, 10) || 0;
  // Giu dung rule cua Phuc: khi khong giam gia thi org = sale (khong de 0).
  const origPrice = parseInt(p.supplierRetailPrice, 10) || salePrice;
  const h = p.highlight || '';
  // Link: DOM scraper lay href tu a[sku], co dang /<canonical> va co kem
  // ?selectPromotionId=N khi SP dang chay khuyen mai — tai lap y het de link
  // trong Sheet khong bi doi so voi cac ngay truoc.
  let link = `https://phongvu.vn/${p.canonical}`;
  if (p.selectedPromotionId) link += `?selectPromotionId=${p.selectedPromotionId}`;

  return {
    dealer: 'Phong Vu',
    name: p.name || '',
    brand: p.brandName || '',
    cpu: getSpec(h, 'CPU'),
    ram: getSpec(h, 'RAM'),
    storage: getSpec(h, 'SSD'),
    screen: getSpec(h, 'Screen'),
    gpu: getSpec(h, 'GPU'),
    weight: getSpec(h, 'weight'),
    origPrice,
    salePrice,
    discount: p.discountPercent ? `-${p.discountPercent}%` : '',
    sold: '',
    rating: '',
    link,
    stockStatus: p.sellable === false ? 'Tạm hết hàng' : 'Còn hàng',
  };
}

(async () => {
  const t0 = Date.now();
  const seen = new Set();
  const products = [];
  let apiTotal = null;
  let ok = false;
  let errMsg = null;

  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const r = await callApi(page);
      if (!r.ok) throw new Error(`API trang ${page} thất bại: ${r.status} ${r.err || ''}`);
      const data = r.json && r.json.data;
      if (!data || !Array.isArray(data.products)) throw new Error(`API trang ${page} trả cấu trúc lạ`);
      if (apiTotal === null && typeof data.total === 'number') apiTotal = data.total;
      if (data.products.length === 0) break;

      let added = 0;
      for (const p of data.products) {
        const key = p.sku || p.sellerSku;
        if (!key || seen.has(key)) continue;
        if (!p.name || p.name.length < 5) continue;
        seen.add(key);
        products.push(mapProduct(p));
        added++;
      }
      console.log(`    → trang ${page}: ${data.products.length} SP (mới ${added}) | cộng dồn ${products.length}`);
      if (apiTotal !== null && products.length >= apiTotal) break;
    }
    ok = products.length > 0;
  } catch (e) {
    errMsg = e.message;
    console.log(`❌ Lỗi: ${errMsg}`);
  }

  // Doi chieu voi `total` do chinh API khai bao — day la thu scrapePV() khong
  // co, truoc day phai doan xem lay du chua.
  if (apiTotal !== null) {
    const pct = Math.round((products.length / apiTotal) * 100);
    if (products.length < apiTotal * 0.95) {
      console.log(`    ⚠️ CẢNH BÁO: API báo total=${apiTotal} nhưng chỉ lấy được ${products.length} SP (${pct}%)`);
      ok = false;
      errMsg = errMsg || `lay thieu: ${products.length}/${apiTotal}`;
    } else {
      console.log(`    ✓ Khớp total: ${products.length}/${apiTotal} SP (${pct}%)`);
    }
  }

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, 'products-PV.json'), JSON.stringify(products));
  console.log(`💾 Đã lưu ${products.length} SP ra ${path.join(OUTPUT_DIR, 'products-PV.json')}`);

  const elapsed = Math.round((Date.now() - t0) / 1000);
  console.log(`\n=== TÓM TẮT (PV qua Teko API) ===\nok=${ok} products=${products.length} apiTotal=${apiTotal} elapsedSec=${elapsed} error=${errMsg || 'none'}`);
  if (!ok) process.exitCode = 1;
})();
