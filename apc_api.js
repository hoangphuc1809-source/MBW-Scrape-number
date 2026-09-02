// apc_api.js — 02/09/2026
//
// Lay danh sach laptop An Phat Computer (anphatpc.com.vn) qua API JSON noi bo
// cua site, thay vi dieu khien trinh duyet.
//
// TAI SAO KHONG DUNG PUPPETEER: trang danh muc render san server-side nhung
// phan trang bang AJAX ("Xem them"), va chinh AJAX do goi 1 endpoint JSON
// cong khai. Goi thang endpoint thi:
//   - 2-5 request la lay het ~947 SKU (khong click, khong scroll, khong
//     stagnant guard nhu MBW/PV)
//   - co truong `total` de doi chieu -> biet ngay co lay thieu hay khong
//   - co endpoint attribute-summary tra ve CPU/GPU/RAM/SSD/Screen da duoc
//     chuan hoa -> KHONG can regex tren ten san pham nhu MBW
//
// BAY DA GAP: endpoint BAT BUOC co header Referer + X-Requested-With.
// Thieu 1 trong 2 -> tra ve body rong 15 byte, status van 200 (khong bao loi).
// Neu mot ngay nao do so SP tut ve 0 ma status=200 thi kiem tra 2 header nay
// truoc tien.
//
// RUI RO da biet: day la API noi bo, An Phat co the doi schema hoac them auth
// bat ky luc nao ma khong bao. Job goi file nay nen coi that bai la khong
// nghiem trong (cac dealer khac van ghi binh thuong).
//
// Ghi ra scrape-output/products-APC.json — DUNG DINH DANG voi cac scraper
// khac, de job combine (COMBINE_MODE) doc gop nhu thuong.
const fs = require('fs');
const path = require('path');
const https = require('https');

// PROXY_HOST: neu set, di qua Cloudflare Worker (/__proxy/apc/...) de dung IP
// edge cua Cloudflare thay vi IP datacenter cua GitHub runner. Chua xac nhan
// An Phat co chan IP cloud hay khong (test 02/09 chay tu IP nha), nen mac dinh
// van goi thang; set MBW_PROXY_HOST de bat khi can.
const PROXY_HOST = (process.env.MBW_PROXY_HOST || '').replace(/\/$/, '');
const REAL_HOST = 'www.anphatpc.com.vn';
const BASE = PROXY_HOST ? `${PROXY_HOST}/__proxy/apc` : `https://${REAL_HOST}`;

const CATEGORY = 395;            // danh muc "Laptop - May Tinh Xach Tay"
const PAGE_SIZE = 200;           // server am tham cap o 500/request, 200 cho an toan
const MAX_PAGES = 15;            // chan vong lap vo han; 947 SP hien tai can 5 trang
const ATTR_BATCH = 50;           // so id moi lan goi attribute-summary
const OUTPUT_DIR = process.env.OUTPUT_DIR || './scrape-output';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const REFERER = `https://${REAL_HOST}/may-tinh-xach-tay-laptop.html`;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── HTTP ──────────────────────────────────────────────────
function getJson(url, attempt = 1) {
  return new Promise((resolve) => {
    const req = https.get(url, {
      timeout: 45000,
      headers: {
        'User-Agent': UA,
        'Referer': REFERER,              // BAT BUOC — thieu se tra body rong
        'X-Requested-With': 'XMLHttpRequest', // BAT BUOC
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
      },
    }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve({ ok: false, status: res.statusCode });
        // Body rong = gan nhu chac chan header bi thieu/bi tu choi.
        if (d.trim().length < 40) return resolve({ ok: false, status: 'EMPTY_BODY', err: `chi ${d.length} byte` });
        try { resolve({ ok: true, json: JSON.parse(d) }); }
        catch (e) { resolve({ ok: false, status: 'PARSE', err: e.message }); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 'TIMEOUT' }); });
    req.on('error', (e) => resolve({ ok: false, status: 'ERR', err: e.message }));
  }).then(async (r) => {
    if (!r.ok && attempt < 3) {
      console.log(`    ⚠ Lỗi (${r.status} ${r.err || ''}) — thử lại lần ${attempt + 1}/3`);
      await sleep(2000 * attempt);
      return getJson(url, attempt + 1);
    }
    return r;
  });
}

function listUrl(page) {
  return `${BASE}/ajax/get_json.php?action=product&action_type=product-list`
    + `&type=&category=${CATEGORY}&collection=0`
    + `&show=${PAGE_SIZE}&page=${page}&sort=order-last-update`;
}

function attrUrl(ids) {
  return `${BASE}/ajax/get_json.php?action=product&action_type=attribute-summary&ids=${ids.join('-')}`;
}

// ── Mapping ───────────────────────────────────────────────
// Danh muc 395 co lan vai SP khong phai laptop (Balo Predator, iPad...).
// Loc bang chinh ten SP: moi laptop deu bat dau bang "Laptop ".
// KHONG loc bang prefix SKU vi 149/939 SP co productSKU rong hoac = "0".
function isLaptop(p) {
  return /^\s*laptop\s/i.test(p.productName || '');
}

// attribute-summary tra ve mang cho moi thuoc tinh, vd:
//   "kich-thuoc-man-hinh-laptop": ["14.0 inch", "IPS", "FHD"]
function attrJoin(rec, key) {
  const v = rec && rec[key];
  if (!Array.isArray(v) || v.length === 0) return '';
  return v.join(' ').trim();
}

// ~10% SP (92/937 ngay 02/09) khong co attribute-summary, nhung ten SP luon co
// dang "Laptop <model> (<CPU> | <GPU> | <RAM> | ...)". Vot lai CPU/GPU tu ten.
// CO Y KHONG doan RAM/SSD/Screen: trong ngoac ca "16GB" (RAM) lan "512GB" (SSD)
// deu la "<so>GB", thu tu khong co dinh giua cac hang -> doan se sai im lang,
// nguy hiem hon la de trong. RAM/Screen da co san 96% tu attribute-summary.
const CPU_RE = /\b(Intel\s+)?(Core\s+Ultra\s+\d[\w-]*|Core\s+i\d[\w-]*|Core\s+\d{1,2}[\w-]*|Ryzen\s+AI\s+(?:Max\s+)?\d[\w+-]*|Ryzen\s+\d[\w-]*|Snapdragon[\w\s-]*?(?=\s*[|)])|Celeron[\w\s-]*?(?=\s*[|)])|Pentium[\w\s-]*?(?=\s*[|)])|Athlon[\w-]*|Mendocino\s+\w+)/i;
const GPU_RE = /\b(RTX\s?\d{4}\s?(?:Ti)?|GTX\s?\d{3,4}\s?(?:Ti)?|Radeon\s+Graphics|AMD\s+Radeon|Intel\s+Arc\s+Graphics|Arc\s+Graphics|Iris\s+Xe(?:\s+Graphics)?|UHD\s+Graphics|Intel\s+Graphics|MX\s?\d{3})/i;

function fromName(name, re) {
  // Bo ™ ® © truoc khi match: An Phat viet "Ryzen™ 7 8845HS", "Snapdragon® X
  // Elite" -> ky tu nay chen giua ten va so, lam regex truot.
  const clean = (name || '').replace(/[™®©]/g, ' ').replace(/\s+/g, ' ');
  const m = clean.match(re);
  return m ? m[0].replace(/\s+/g, ' ').trim() : '';
}

function mapProduct(p, attr) {
  const salePrice = parseInt(p.price, 10) || 0;
  // Giu dung rule cua Phuc: khi khong giam gia thi org = sale (khong de 0).
  let origPrice = parseInt(p.marketPrice, 10) || 0;
  if (origPrice <= salePrice) origPrice = salePrice;

  let discount = '';
  if (origPrice > salePrice && salePrice > 0) {
    discount = `-${Math.round((1 - salePrice / origPrice) * 100)}%`;
  }

  const a = attr || {};
  const storage = attrJoin(a, 'dung-luong-o-cung-laptop') || attrJoin(a, 'dung-luong-ssd');
  const name = (p.productName || '').trim();
  const cpu = attrJoin(a, 'bo-vi-xu-ly-laptop') || fromName(name, CPU_RE);
  const gpu = attrJoin(a, 'card-do-hoa-laptop') || fromName(name, GPU_RE);

  // Truong `quantity` KHONG dung de xac dinh con hang: 707/939 SP co
  // quantity=0 nhung van ban binh thuong (gia > 0, trang SP van cho mua).
  // Tin hieu dang tin la gia = 0 -> SP dang "Lien he" / chua co gia.
  const stockStatus = salePrice > 0 ? 'Còn hàng' : 'Tạm hết hàng';

  return {
    dealer: 'An Phat',
    name,
    brand: (p.brand && p.brand.name) || '',
    cpu,
    ram: attrJoin(a, 'bo-nho-trong'),
    storage,
    screen: attrJoin(a, 'kich-thuoc-man-hinh-laptop'),
    gpu,
    weight: '',
    origPrice,
    salePrice,
    discount,
    sold: '',
    rating: (p.review && p.review.rate) || '',
    link: `https://${REAL_HOST}${p.productUrl || ''}`,
    stockStatus,
  };
}

// ── Main ──────────────────────────────────────────────────
(async () => {
  const t0 = Date.now();
  const raw = new Map(); // id -> item goc (Map de tu khu trung id)
  let apiTotal = null;
  let ok = false;
  let errMsg = null;

  try {
    // 1) Lay danh sach
    for (let page = 1; page <= MAX_PAGES; page++) {
      const r = await getJson(listUrl(page));
      if (!r.ok) throw new Error(`product-list trang ${page} thất bại: ${r.status} ${r.err || ''}`);
      const j = r.json;
      if (!j || !Array.isArray(j.list)) throw new Error(`product-list trang ${page} trả cấu trúc lạ`);
      if (apiTotal === null && j.total != null) apiTotal = Number(j.total);
      if (j.list.length === 0) break;

      let added = 0;
      for (const p of j.list) {
        if (!p.id || raw.has(p.id)) continue;
        raw.set(p.id, p);
        added++;
      }
      console.log(`    → trang ${page}: ${j.list.length} SP (mới ${added}) | cộng dồn ${raw.size}/${apiTotal}`);
      if (j.list.length < PAGE_SIZE) break;
      if (apiTotal !== null && raw.size >= apiTotal) break;
    }

    // 2) Loc bo SP khong phai laptop
    const items = [...raw.values()].filter(isLaptop);
    const dropped = raw.size - items.length;
    if (dropped > 0) console.log(`    🧹 Bỏ ${dropped} SP không phải laptop (phụ kiện lẫn trong danh mục)`);

    // 3) Enrich specs qua attribute-summary (theo lo)
    const attrMap = {};
    const ids = items.map((p) => p.id);
    let attrFail = 0;
    for (let i = 0; i < ids.length; i += ATTR_BATCH) {
      const batch = ids.slice(i, i + ATTR_BATCH);
      const r = await getJson(attrUrl(batch));
      if (r.ok && r.json && typeof r.json === 'object') Object.assign(attrMap, r.json);
      else attrFail += batch.length;
      await sleep(150); // lich su voi server, tong ~19 request
    }
    const withCpu = Object.values(attrMap).filter((a) => (a['bo-vi-xu-ly-laptop'] || []).length > 0).length;
    console.log(`    🔧 Specs: ${Object.keys(attrMap).length}/${ids.length} SP có dữ liệu, ${withCpu} SP có CPU`
      + (attrFail ? ` — ${attrFail} SP lỗi lấy specs (vẫn giữ SP, để trống spec)` : ''));

    var products = items.map((p) => mapProduct(p, attrMap[p.id]));
    ok = products.length > 0;
  } catch (e) {
    errMsg = e.message;
    console.log(`❌ Lỗi: ${errMsg}`);
    products = products || [];
  }

  // 4) Doi chieu voi `total` do chinh API khai bao.
  // Luu y: total (947) tinh CA phu kien lan trong danh muc, con products chi
  // gom laptop -> luon lech mot chut. Nguong 92% da tinh den do lech nay.
  if (apiTotal !== null) {
    const pct = Math.round((products.length / apiTotal) * 100);
    if (products.length < apiTotal * 0.92) {
      console.log(`    ⚠️ CẢNH BÁO: API báo total=${apiTotal} nhưng chỉ lấy được ${products.length} SP (${pct}%)`);
      ok = false;
      errMsg = errMsg || `lay thieu: ${products.length}/${apiTotal}`;
    } else {
      console.log(`    ✓ Khớp total: ${products.length}/${apiTotal} SP (${pct}%)`);
    }
  }

  const oos = products.filter((p) => p.stockStatus !== 'Còn hàng').length;
  const noCpu = products.filter((p) => !p.cpu).length;
  console.log(`    📦 ${products.length - oos} còn hàng / ${oos} chưa có giá | ${noCpu} SP thiếu CPU`);

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outPath = path.join(OUTPUT_DIR, 'products-APC.json');
  fs.writeFileSync(outPath, JSON.stringify(products));
  console.log(`💾 Đã lưu ${products.length} SP ra ${outPath}`);

  const elapsed = Math.round((Date.now() - t0) / 1000);
  console.log(`\n=== TÓM TẮT (An Phat qua API noi bo) ===`);
  console.log(`ok=${ok} products=${products.length} apiTotal=${apiTotal} elapsedSec=${elapsed} error=${errMsg || 'none'}`);
  if (!ok) process.exitCode = 1;
})();
