/**
 * multi_dealer_scraper.js  — v3.4.2
 *
 * FIX v3.4.2:
 *  [BUG12] Process crash hoàn toàn (exit code 1, mất sạch data lần chạy) do
 *          Puppeteer's internal FrameManager.initialize() (#createIsolatedWorld)
 *          ném ProtocolError "addScriptToEvaluateOnNewDocument timed out" khi 1
 *          iframe con (ads/chat widget) trên trang CPS bị treo. Lỗi này là
 *          unhandled rejection TÁCH BIỆT khỏi mọi await chain/try-catch của
 *          code này → Node 15+ tự kill process. Fix: process.on('unhandledRejection'/
 *          'uncaughtException') ở đầu file, log rồi tiếp tục thay vì crash.
 *
 * FIX v3.4.1:
 *  [BUG11] Process không exit sau khi xong — googleapis/puppeteer giữ event
 *          loop qua HTTP keep-alive + Chrome subprocess → thêm process.exit(0)
 *
 * FIX v3.4:
 *  [BUG10] FPT hung process khi Cloudflare chặn detail page → safeGoto retry
 *          loop không exit, toàn bộ job treo 45 phút rồi bị workflow kill.
 *          Fix:
 *           (a) FPT_DEADLINE_MS = 25 phút (riêng FPT, thay vì dùng chung DEADLINE_MS)
 *           (b) Promise.race timeout bọc ngoài scrapeFPT() → tự thoát sau 28 phút
 *           (c) FPT page setDefaultTimeout 20s (override 0=vô hạn của puppeteer)
 *           (d) process.exit(0) kill-timer 60 phút → safety net cuối
 *
 * FIX v2.9:
 *  [BUG7] Bỏ giới hạn 30 specs/lần → fetch tất cả SP chưa có specs
 *         Kiểm soát bằng DEADLINE (50 phút) thay vì đếm số lượng
 *  [BUG8] MBW specs hoán đổi CPU/Màn hình → dùng findSpec() theo keyword
 *  [BUG9] FPT/CPS mapSpecs cập nhật đủ fields theo bảng chuẩn
 *  [KEY]  Specs chỉ fetch 1 lần duy nhất, lưu vào cache (sheet)
 *
 * v3.0:
 *  [NEW]  FPT: đổi từ per-brand → 1 URL tổng /may-tinh-xach-tay (lấy đủ 400+)
 *  [NEW]  FPT: auto-detect brand từ tên sản phẩm (detectBrand)
 *  [NEW]  FPT_MAPPING_VERSION=3 → force re-fetch toàn bộ FPT specs lần đầu
 *         Các lần chạy sau: copy specs từ cache vào row mới tự động
 */

'use strict';

const puppeteer    = require('puppeteer');
const { google }   = require('googleapis');
const fs           = require('fs');
const path         = require('path');
const os           = require('os');

// ── FIX v3.4.2 [BUG12] ────────────────────────────────────
// Puppeteer tự khởi tạo "isolated world" ngầm cho MỌI frame con mới xuất
// hiện trên trang (iframe ads/chat widget/tracking...) qua FrameManager,
// KHÔNG nằm trong bất kỳ await chain nào của code này. Khi 1 frame con bị
// treo (VD trang CPS có nhiều iframe sau khi "Load thêm" 50+ lần), Puppeteer
// ném ra 1 unhandled rejection HOÀN TOÀN TÁCH BIỆT khỏi try/catch của mình
// (kể cả catch tổng ở cuối file) — Node 15+ mặc định CRASH TOÀN BỘ PROCESS
// khi gặp unhandled rejection, xóa sạch data đã scrape được trong lần chạy.
// Fix: chặn ở tầng process, log rồi bỏ qua thay vì để Node kill cả job.
process.on('unhandledRejection', (reason) => {
  const msg = (reason && reason.message) ? reason.message.substring(0, 150) : String(reason).substring(0, 150);
  console.log(`⚠️ Unhandled rejection (bỏ qua, tiếp tục chạy): ${msg}`);
});
process.on('uncaughtException', (err) => {
  console.log(`⚠️ Uncaught exception (bỏ qua, tiếp tục chạy): ${(err.message || String(err)).substring(0, 150)}`);
});

// ── Config ────────────────────────────────────────────────
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME   = 'RAW DATA';

// SCRAPE_DEALERS: danh sách dealer chạy trong job này, phân tách bởi dấu phẩy
// (vd: "MBW,CPS" hoặc "FPT"). Mặc định = cả 3 (chạy full như trước).
// Dùng khi tách workflow thành nhiều job song song (vd: MBW+CPS trên
// ubuntu-latest, FPT trên self-hosted) — mỗi job chỉ ghi đè dữ liệu của
// CHÍNH dealer mình phụ trách trong sheet hôm nay, không đụng tới dữ liệu
// dealer khác do job song song ghi (tránh race condition khi cả 2 job
// cùng đọc-sửa-ghi RAW DATA cùng lúc).
const DEALER_KEY_TO_NAME = { MBW: 'MBW', FPT: 'FPT Retail', CPS: 'CellPhone S' };
const SCRAPE_DEALERS_RAW = (process.env.SCRAPE_DEALERS || 'MBW,FPT,CPS')
  .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
const SCRAPE_DEALERS = new Set(SCRAPE_DEALERS_RAW);
// Tên dealer (giá trị cột D) tương ứng với các key trong SCRAPE_DEALERS
const SCRAPE_DEALER_NAMES = new Set(
  [...SCRAPE_DEALERS].map(k => DEALER_KEY_TO_NAME[k]).filter(Boolean)
);
const CREDS_PATH     = path.join(os.tmpdir(), 'scraper_gcp.json');
// Deadline: dừng fetch specs sau 50 phút kể từ lúc start
// Đảm bảo còn đủ thời gian ghi sheet trước khi GitHub Actions timeout (6h)
const DEADLINE_MS    = 75 * 60 * 1000;
// FPT-specific deadline cho enrichSpecs: 25 phút (FPT detail page hay bị CF chặn → chạy lâu)
const FPT_DEADLINE_MS = 25 * 60 * 1000;
// Timeout bọc ngoài scrapeFPT(): nếu toàn bộ FPT scrape treo quá 28 phút → reject
const FPT_SCRAPE_TIMEOUT_MS = 28 * 60 * 1000;
// Tăng version này mỗi khi thay đổi mapping FPT → force re-fetch toàn bộ FPT specs
// CPS cache giữ nguyên (không bị ảnh hưởng)
const FPT_MAPPING_VERSION = 3; // v3.0: scrape tất cả laptop FPT (1 URL duy nhất thay vì per-brand)

// FPT: scrape toàn bộ laptop qua 1 URL tổng thay vì loop per-brand
// Lợi ích: (1) lấy đủ 400+ products, (2) không bỏ sót brand nào,
//           (3) pagination "Xem thêm" load hết không giới hạn
const FPT_ALL_URL = 'https://fptshop.com.vn/may-tinh-xach-tay';

// MBW: scrape trang tổng /laptop để lấy đủ ~464 SP (thay vì per-brand chỉ ~150)
// FPT và CPS: vẫn scrape per-brand như cũ
//
// Cả 3 dealer đều có thể bị chặn/challenge IP của GitHub-hosted runners:
//  - MBW (thegioididong.com): ERR_CONNECTION_RESET → fix bằng Cloudflare Worker proxy
//  - FPT (fptshop.com.vn): Cloudflare "Just a moment..." bot-challenge — Worker
//    proxy KHÔNG bypass được (Cloudflare Worker → origin cũng do Cloudflare bảo vệ
//    bị chặn ở edge-to-edge level) → vẫn gọi trực tiếp, có thể trả 0 SP trên CI.
//  - CPS (cellphones.com.vn): không bị chặn → gọi trực tiếp.
// PROXY_HOST (vd: "https://mbw-proxy.<account>.workers.dev") là 1 Cloudflare
// Worker reverse-proxy đa-target — forward request tới đúng site qua đường dẫn
// /__proxy/<mbw|fpt|cps>/<path> bằng IP Cloudflare edge.
// Nếu không set PROXY_HOST, MBW gọi trực tiếp thegioididong.com (cần self-hosted).
const PROXY_HOST = (process.env.MBW_PROXY_HOST || '').replace(/\/$/, '');

const MBW_REAL_HOST = 'www.thegioididong.com';

const MBW_BASE = PROXY_HOST ? `${PROXY_HOST}/__proxy/mbw` : `https://${MBW_REAL_HOST}`;

const MBW_URL = `${MBW_BASE}/laptop`;

// Helper: gắn request interception lên 1 page để rewrite mọi request tới
// `realHost` sang `proxyBase + /__proxy/<key>` + path gốc — cho phép các AJAX
// call tuyệt đối (load-more, API nội bộ...) cũng đi qua proxy.
// Idempotent: nếu page đã enable interception rồi thì bỏ qua, tránh add 2
// listener cùng gọi req.continue() trên 1 request → "Request is already handled!"
function enableProxyInterception(page, realHost, proxyKey) {
  if (!PROXY_HOST) return Promise.resolve();
  if (page.__proxyInterceptionEnabled) return Promise.resolve();
  page.__proxyInterceptionEnabled = true;
  const proxyPrefix = `${PROXY_HOST}/__proxy/${proxyKey}`;
  return page.setRequestInterception(true).then(() => {
    page.on('request', (req) => {
      try {
        const reqUrl = new URL(req.url());
        if (reqUrl.hostname === realHost) {
          const proxied = proxyPrefix + reqUrl.pathname + reqUrl.search;
          req.continue({ url: proxied });
          return;
        }
      } catch (_) { /* fall through */ }
      req.continue();
    });
  });
}

const BRANDS = [

  { name: 'Asus',     fptUrl: 'https://fptshop.com.vn/may-tinh-xach-tay/asus',     cpsUrl: 'https://cellphones.com.vn/laptop/asus.html'     },
  { name: 'Acer',     fptUrl: 'https://fptshop.com.vn/may-tinh-xach-tay/acer',     cpsUrl: 'https://cellphones.com.vn/laptop/acer.html'     },
  { name: 'Dell',     fptUrl: 'https://fptshop.com.vn/may-tinh-xach-tay/dell',     cpsUrl: 'https://cellphones.com.vn/laptop/dell.html'     },
  { name: 'HP',       fptUrl: 'https://fptshop.com.vn/may-tinh-xach-tay/hp',       cpsUrl: 'https://cellphones.com.vn/laptop/hp.html'       },
  { name: 'Lenovo',   fptUrl: 'https://fptshop.com.vn/may-tinh-xach-tay/lenovo',   cpsUrl: 'https://cellphones.com.vn/laptop/lenovo.html'   },
  { name: 'MSI',      fptUrl: 'https://fptshop.com.vn/may-tinh-xach-tay/msi',      cpsUrl: 'https://cellphones.com.vn/laptop/msi.html'      },
  { name: 'Samsung',  fptUrl: 'https://fptshop.com.vn/may-tinh-xach-tay/samsung',  cpsUrl: 'https://cellphones.com.vn/laptop/samsung.html'  },
  { name: 'MacBook',  fptUrl: 'https://fptshop.com.vn/may-tinh-xach-tay/macbook',  cpsUrl: 'https://cellphones.com.vn/macbook.html'          },
  { name: 'Gigabyte', fptUrl: 'https://fptshop.com.vn/may-tinh-xach-tay/gigabyte', cpsUrl: 'https://cellphones.com.vn/laptop/gigabyte.html' },
];

const HEADERS = [
  'Ngày','Giờ','STT','Dealer','Tên Model','Hãng',
  'CPU','RAM','Ổ cứng','Màn hình','Card đồ họa','Trọng lượng',
  'Giá gốc (₫)','Giá KM (₫)','Giảm (%)','Đã bán','Rating (★)','Link sản phẩm',
  'Tình trạng',
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
  // BUG FIX v3.2: async evaluate với long-running Promise → CDP timeout trên trang lớn
  // Fix: scroll nhiều bước nhỏ từ Node.js thay vì 1 evaluate async block lớn
  let lastHeight = 0;
  for (let i = 0; i < 40; i++) {
    const height = await page.evaluate(() => document.body.scrollHeight).catch(() => 0);
    if (height === lastHeight && i > 0) break;
    lastHeight = height;
    const steps = Math.ceil(height / 1500);
    for (let s = 0; s <= steps; s++) {
      await page.evaluate((y) => window.scrollTo(0, y), s * 1500).catch(() => {});
    }
    await sleep(400);
    const newHeight = await page.evaluate(() => document.body.scrollHeight).catch(() => 0);
    if (newHeight === height) break;
  }
}

// Lỗi "fatal" nghĩa là page/frame/browser đã chết hẳn — retry thêm là vô ích,
// phải ném lên để caller đóng page cũ + tạo page mới (xem main loop CPS/FPT).
function isFatalPageError(e) {
  return /detached Frame|Session closed|Target closed|Protocol error|Connection closed/i.test(e.message || '');
}

async function safeGoto(page, url) {
  for (let i = 0; i <= 2; i++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
      return true;
    } catch (e) {
      if (isFatalPageError(e)) {
        console.log(`    💀 fatal page error, ngừng retry: ${e.message.substring(0,60)}`);
        throw e; // propagate lên để scrapeCPS/scrapeFPT caller tạo page mới
      }
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
    // Detect stock status TRƯỚC khi click "Xem tất cả thông số"
    const stockStatus = await page.evaluate(() => {
      const body = document.body.innerText || '';
      // "Hàng sắp về" — button/div đặc biệt trên FPT
      if (/hàng sắp về/i.test(body)) return 'Hàng sắp về';
      // "Ngừng kinh doanh" / "Ngừng bán"
      if (/ngừng kinh doanh|ngừng bán|stop.*sell/i.test(body)) return 'Ngừng KD';
      // "Hết hàng"
      if (/hết hàng/i.test(body)) return 'Hết hàng';
      // "Liên hệ" thay vì giá
      const priceEl = document.querySelector('[class*="b1-semibold"],[class*="price"]');
      if (priceEl && /liên hệ/i.test(priceEl.innerText || '')) return 'Liên hệ';
      return 'Còn hàng';
    }).catch(() => 'Còn hàng');

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
    const result = mapSpecsFPT(raw);
    result.stockStatus = stockStatus;
    return result;
  } catch (e) {
    if (isFatalPageError(e)) throw e; // page chết hẳn → propagate, không nuốt lỗi
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
  // GPU: Nếu có cả card rời lẫn onboard → ghi cả 2 (VD: "RTX 5060 8GB / Intel Graphics")
  //       Nếu chỉ có 1 loại → ghi loại đó
  const gpuDiscrete = raw['Tên đầy đủ (Card rời)'] || raw['Hãng (Card rời)'] || '';
  const gpuOnboard  = raw['Tên đầy đủ (Card onbroad)'] || raw['Hãng (Card Oboard)'] || '';
  const gpu = gpuDiscrete && gpuOnboard
    ? `${gpuDiscrete} / ${gpuOnboard}`  // Cả 2: card rời trước
    : gpuDiscrete || gpuOnboard;        // Chỉ 1 loại
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
    // Detect stock status từ CPS detail page
    const stockStatus = await page.evaluate(() => {
      const body = document.body.innerText || '';
      if (/ngừng kinh doanh|ngừng bán|không còn bán/i.test(body)) return 'Ngừng KD';
      if (/hết hàng|out of stock/i.test(body)) return 'Hết hàng';
      if (/sắp về|pre.?order|đặt trước/i.test(body)) return 'Hàng sắp về';
      // CPS: nếu không có giá hiển thị → Liên hệ
      const priceEl = document.querySelector('.product__price--show,.tpt-price,.price-show');
      if (!priceEl || !/\d/.test(priceEl.innerText || '')) return 'Liên hệ';
      return 'Còn hàng';
    }).catch(() => 'Còn hàng');

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
    const result = mapSpecsCPS(raw);
    result.stockStatus = stockStatus;
    return result;
  } catch (e) {
    if (isFatalPageError(e)) throw e; // page chết hẳn → propagate, không nuốt lỗi
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
async function enrichSpecs(products, specCache, fetchFn, page, startTime, deadlineMs) {
  const effectiveDeadline = deadlineMs || DEADLINE_MS;
  let fetched = 0;
  for (const p of products) {
    if (specCache.has(p.link)) {
      // Copy specs từ cache NHƯNG KHÔNG override stockStatus:
      // stockStatus đã được detect chính xác từ listing/detail page HÔM NAY.
      // Cache chỉ lưu specs tĩnh (cpu/ram/...) — stockStatus thay đổi hàng ngày.
      const { stockStatus: _skip, ...cachedSpecs } = specCache.get(p.link);
      Object.assign(p, cachedSpecs);
    } else {
      // Kiểm tra deadline trước khi fetch
      if (Date.now() - startTime > effectiveDeadline) {
        console.log(`    ⏱ Deadline reached (${Math.round(effectiveDeadline/60000)}m) — dừng fetch specs`);
        break;
      }
      const specs = await fetchFn(page, p.link);
      // Khi fetch detail page: stockStatus từ detail page chính xác hơn listing
      // → dùng stockStatus từ detail page (override listing status)
      Object.assign(p, specs);
      // Lưu vào cache: chỉ lưu specs tĩnh, KHÔNG lưu stockStatus
      // (tránh cache stockStatus cũ gây lỗi ngày hôm sau)
      const { stockStatus: _skip2, ...specsToCache } = specs;
      specCache.set(p.link, specsToCache);
      fetched++;
      await sleep(600);
    }
  }
  if (fetched > 0) console.log(`    → Fetched specs: ${fetched} SP mới`);
}

// ── FIX #2: SKU rớt khỏi listing hôm nay (mọi dealer) — thay vì im lặng ────
// biến mất, ghé thẳng trang chi tiết để phân biệt 3 trường hợp:
//   (a) Ngừng kinh doanh / hết hàng thật  → đúng như kỳ vọng, không phải bug
//   (b) SP vẫn còn bán bình thường trên web → XÁC NHẬN đây là lỗi scrape thật
//       (vd: FPT B85LNPA 06/07 — web vẫn bán nhưng bị bỏ sót ở trang listing)
//   (c) Trang lỗi/không tải được → cần soát lại thủ công
const MISSING_CHECK_CAP = 20; // giới hạn số SP check/lần/dealer để không kéo dài job

async function getMissingCandidates(sheets, dealerName, todayLinks) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A2:S`,
    });
    const rows = res.data.values || [];
    const parseVN = (d) => {
      const [dd, mm, yyyy] = (d || '').split('/').map(Number);
      return (dd && mm && yyyy) ? new Date(yyyy, mm - 1, dd) : null;
    };
    // SKU đã từng được xác nhận "Ngừng kinh doanh"/"Hết hàng" → bỏ qua, không
    // check lại mỗi ngày nữa (đỡ tốn thời gian job). SKU dạng "bị bỏ sót khi
    // scrape" thì VẪN check lại mỗi ngày vì đó là lỗi cần theo dõi tiếp.
    const confirmedGone = new Set(
      rows.filter(r => r[3] === dealerName && ['Ngừng kinh doanh','Hết hàng'].includes(r[18]))
          .map(r => r[17])
    );
    let latestDate = null, latestDt = null;
    rows.forEach(r => {
      if (r[3] !== dealerName || !r[0]) return;
      const dt = parseVN(r[0]);
      if (dt && (!latestDt || dt > latestDt)) { latestDt = dt; latestDate = r[0]; }
    });
    if (!latestDate) return [];
    const candidates = [];
    const seen = new Set();
    rows.forEach(r => {
      if (r[3] !== dealerName || r[0] !== latestDate) return;
      const link = r[17];
      if (!link || seen.has(link)) return;
      seen.add(link);
      if (todayLinks.has(link)) return;
      if (confirmedGone.has(link)) return;
      candidates.push({ link, name: r[4] || '', brand: r[5] || '' });
    });
    return candidates;
  } catch (e) {
    console.log(`⚠ getMissingCandidates(${dealerName}) lỗi: ${e.message}`);
    return [];
  }
}

async function checkMissingProducts(browser, dealerName, candidates, specCache) {
  if (candidates.length === 0) return [];
  const toCheck = candidates.slice(0, MISSING_CHECK_CAP);
  if (candidates.length > MISSING_CHECK_CAP) {
    console.log(`    ℹ [${dealerName}] ${candidates.length} SP mất khỏi listing, chỉ check ${MISSING_CHECK_CAP} SP/lần (còn lại check ở lần chạy sau)`);
  }
  const out = [];
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36');
  const isMBW = dealerName === 'MBW';
  if (isMBW) await enableProxyInterception(page, MBW_REAL_HOST, 'mbw');

  for (const c of toCheck) {
    const url = isMBW && PROXY_HOST ? c.link.replace(`https://${MBW_REAL_HOST}`, MBW_BASE) : c.link;
    let status = 'Trang không tải đủ nội dung - cần kiểm tra thủ công';
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await sleep(1200);
      const bodyText = await page.evaluate(() => document.body.innerText || '').catch(() => '');
      if (/ngừng\s*kinh\s*doanh|ngừng sản xuất|không tìm thấy sản phẩm|sản phẩm không tồn tại/i.test(bodyText)) {
        status = 'Ngừng kinh doanh';
      } else if (/tạm hết hàng|đã hết hàng|hàng sắp về/i.test(bodyText)) {
        status = 'Hết hàng';
      } else if (bodyText.length >= 300) {
        // Trang tải bình thường, không thấy dấu hiệu ngừng bán/hết hàng
        // → SP thực sự vẫn đang bán, chứng tỏ đây là lỗi scrape THẬT
        status = 'Còn hàng - bị bỏ sót khi scrape (lỗi thật, cần kiểm tra thuật toán tải trang)';
      }
    } catch (e) {
      status = 'Không tải được trang - cần kiểm tra thủ công';
    }
    const spec = specCache.get(c.link) || {};
    out.push({
      dealer: dealerName, name: c.name, brand: c.brand,
      cpu: spec.cpu || '', screen: spec.screen || '', gpu: spec.gpu || '', weight: spec.weight || '',
      ram: spec.ram || '', storage: spec.storage || '',
      origPrice: 0, salePrice: 0, discount: '', sold: '', rating: '',
      link: c.link, stockStatus: status,
    });
    await sleep(600);
  }
  await page.close().catch(() => {});
  const realMiss = out.filter(p => p.stockStatus.startsWith('Còn hàng - bị bỏ sót')).length;
  const gone     = out.filter(p => p.stockStatus === 'Ngừng kinh doanh' || p.stockStatus === 'Hết hàng').length;
  console.log(`    → [${dealerName}] Đã kiểm tra ${toCheck.length} SP mất khỏi listing: ${gone} ngừng/hết hàng thật, ${realMiss} LỖI SCRAPE THẬT (vẫn còn bán), ${toCheck.length-gone-realMiss} cần kiểm tra thêm`);
  return out;
}

// ── SCRAPER 1 — MBW ──────────────────────────────────────
async function scrapeMBW(page) {
  console.log('  [MBW] Trang tổng /laptop');

  // Khi dùng proxy: trang chính được load qua PROXY_HOST, nhưng các AJAX call
  // ("Xem thêm" load more) mà page tự phát ra vẫn có thể trỏ thẳng tới
  // thegioididong.com (URL tuyệt đối trong JS bundle) → cần rewrite sang proxy.
  await enableProxyInterception(page, MBW_REAL_HOST, 'mbw');

  try {
    // Qua proxy: networkidle2 hay bị timeout (1 request nền không bao giờ "idle"
    // khi đi qua Worker). domcontentloaded + sleep ổn định hơn, giống FPT/CPS.
    const waitUntil = PROXY_HOST ? 'domcontentloaded' : 'networkidle2';
    await page.goto(MBW_URL, { waitUntil, timeout: 90000 });
    if (PROXY_HOST) await sleep(3000);
  } catch(e) {
    console.log(`    ⚠ Load failed: ${e.message.substring(0,60)}`);
    return [];
  }
  await sleep(2000);

  // Loop: scroll xuống để "Xem thêm" visible → click → chờ load → repeat
  let clicks = 0;
  let prevCount = 0;
  let stagnant = 0;
  while (true) {
    // Scroll đến cuối trang để trigger lazy load và đưa button vào viewport
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(1500);

    const result = await page.evaluate(() => {
      // 1) CSS selectors — chú ý: class "view-more" nằm trên DIV bọc ngoài,
      //    thẻ <a> click được nằm BÊN TRONG → cần ".view-more a" (descendant)
      const selectors = [
        '.view-more a', 'div.view-more a', '[class*="view-more"] a',
        'a.view-more', 'button.view-more', '.view-more-btn',
        'a[class*="view-more"]', 'button[class*="view-more"]',
        '.btn-view-more', 'a.btn-more', '.show-more', '.see-more a',
      ];
      for (const sel of selectors) {
        const btn = document.querySelector(sel);
        if (btn && btn.offsetParent !== null) {
          btn.scrollIntoView({ block: 'center' });
          btn.click();
          return { clicked: true, selector: sel };
        }
      }
      // 2) Fallback: tìm theo text "Xem thêm" — chống chịu khi site đổi class
      const els = [...document.querySelectorAll('a, button')];
      const btn = els.find(el =>
        /xem\s*thêm/i.test(el.textContent || '') &&
        (el.textContent || '').trim().length < 80 &&
        el.offsetParent !== null
      );
      if (btn) {
        btn.scrollIntoView({ block: 'center' });
        btn.click();
        return { clicked: true, selector: 'text:Xem thêm' };
      }
      return { clicked: false };
    }).catch(() => ({ clicked: false }));

    if (!result.clicked) break;
    clicks++;
    await sleep(3500); // tăng wait: proxy AJAX render cần thêm thời gian

    // BUG FIX: đếm a.main-contain (product thực) không đếm banner/skeleton
    // Tăng threshold 2→3 để chịu được 1 lần proxy lag.
    const count = await page.evaluate(() =>
      document.querySelectorAll('ul.listproduct li.item a.main-contain').length
    );
    if (count === prevCount) {
      stagnant++;
      if (stagnant >= 3) break;
    } else {
      stagnant = 0;
      prevCount = count;
    }
  }
  console.log(`    → Clicked "Xem thêm": ${clicks} lần`);

  const totalItems = await page.evaluate(() =>
    document.querySelectorAll('ul.listproduct li.item').length
  );
  const productItems = await page.evaluate(() =>
    document.querySelectorAll('ul.listproduct li.item a.main-contain').length
  );
  console.log(`    → Tổng items trên trang: ${totalItems} (products: ${productItems})`);

  if (totalItems === 0) {
    const diag = await page.evaluate(() => ({
      title: document.title,
      url: location.href,
      bodyLen: document.body.innerHTML.length,
      bodySnippet: (document.body.innerText || '').slice(0, 200).replace(/\s+/g, ' '),
    })).catch(() => null);
    if (diag) {
      console.log(`    🔍 diag: title="${diag.title}" url=${diag.url} bodyLen=${diag.bodyLen}`);
      console.log(`    🔍 body: ${diag.bodySnippet}`);
    }
  }

  return page.evaluate((BASE) => {
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
      // data-brand từ data attribute hoặc từ tên model
      const brandName = aEl.getAttribute('data-brand') || aEl.getAttribute('data-trademark') || '';
      // data-price trên MBW là float string (VD: "16790000.0") → dùng parseFloat+Math.round, KHÔNG dùng parseInt+replace (sẽ xóa dấu . → sai x10)
      const salePrice = Math.round(parseFloat(aEl.getAttribute('data-price') || '0')) || 0;
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

      // MBW: detect stock status từ listing page
      // "Ngừng kinh doanh" → thường không có giá (origPrice=0, salePrice=0)
      // và có text "Ngừng" hoặc không có nút mua
      const mbwStatus = (() => {
        // Nếu đã bán rất nhiều nhưng không còn giá → ngừng KD
        if (!origPrice && !salePrice) return 'Chưa rõ';
        return 'Còn hàng';
      })();
      out.push({
        dealer: 'MBW', name, brand: brandName,
        cpu, screen, gpu, weight,
        ram: compare[0]||'', storage: compare[1]||'',
        origPrice, salePrice, discount, sold, rating, link,
        stockStatus: mbwStatus,
      });
    });
    return out;
  }, 'https://www.thegioididong.com');
}

// ── SCRAPER 2 — FPT Retail ────────────────────────────────
async function scrapeFPT(page, brand, specCache, startTime) {
  console.log(`  [FPT] ${brand.name}`);
  // FPT bị Cloudflare bot-challenge ngay cả qua Worker proxy (Cloudflare Worker
  // → Cloudflare-protected origin bị chặn ở edge-to-edge level) → gọi trực tiếp.
  try {
    await page.goto(brand.fptUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForSelector('div.cardInfo', { timeout: 15000 }).catch(() => {});
  } catch(e) {
    console.log(`    ⚠ Load failed: ${e.message.substring(0,60)}`);
    return [];
  }
  await sleep(2000);

  // Simple scroll để trigger lazy load đầu trang
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await sleep(2000);
  }

  // FPT Shop giới hạn ~15-20 SP/trang qua lazy-load cuộn — cần click nút
  // "Xem thêm sản phẩm" để load hết toàn bộ danh mục (giống MBW/CPS).
  let clicks = 0;
  while (true) {
    const clicked = await page.evaluate(() => {
      // FPT button: "Xem thêm N kết quả" — match by text pattern /xem thêm \d+ kết quả/i
      // Must exclude product-card overlay buttons (short "Xem thêm" without digit)
      const allBtns = [...document.querySelectorAll('button, a')];
      
      // Primary: "Xem thêm N kết quả" (load more results button)
      const loadMoreBtn = allBtns.find(el =>
        /xem\s*thêm\s+\d+/i.test(el.textContent || '') &&
        el.offsetParent !== null
      );
      if (loadMoreBtn) {
        loadMoreBtn.scrollIntoView({block:'center'});
        loadMoreBtn.click();
        return true;
      }
      
      // Fallback: any visible button/link with "xem thêm" NOT in product card overlay
      // Exclude buttons inside cardInfo (those are card-level overlays)
      const fallbackBtn = allBtns.find(el => {
        if (!/xem\s*thêm/i.test(el.textContent || '')) return false;
        if ((el.textContent || '').trim().length > 80) return false;
        if (el.closest('div.cardInfo')) return false; // skip card overlays
        if (!el.offsetParent) return false;
        return true;
      });
      if (fallbackBtn) {
        fallbackBtn.scrollIntoView({block:'center'});
        fallbackBtn.click();
        return true;
      }
      return false;
    }).catch(() => false);
    if (!clicked) break;
    clicks++;
    await sleep(2000);
    // Simple scroll: KHÔNG dùng scrollToBottom() vì CDP timeout trên trang 400+ products
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await sleep(1500);
    if (clicks > 50) break; // safety cap
  }
  if (clicks) console.log(`    → Xem thêm: ${clicks} lần`);

  const products = await page.evaluate((BASE) => {
    const out  = [];
    const seen = new Set();
    // Auto-detect brand từ tên sản phẩm
    function detectBrand(name) {
      const n = (name || '').toLowerCase();
      if (n.includes('msi'))     return 'MSI';
      if (n.includes('asus') || n.includes('vivobook') || n.includes('zenbook') || n.includes('rog') || n.includes('tuf')) return 'Asus';
      if (n.includes('acer') || n.includes('aspire') || n.includes('predator') || n.includes('nitro') || n.includes('swift')) return 'Acer';
      if (n.includes('dell') || n.includes('inspiron') || n.includes('xps') || n.includes('alienware') || n.includes('latitude') || n.includes('vostro')) return 'Dell';
      if (n.includes('hp ') || n.includes('pavilion') || n.includes('envy') || n.includes('spectre') || n.includes('omen') || n.includes('elitebook') || n.includes('probook') || n.includes('victus')) return 'HP';
      if (n.includes('lenovo') || n.includes('ideapad') || n.includes('thinkpad') || n.includes('legion') || n.includes('yoga') || n.includes('loq')) return 'Lenovo';
      if (n.includes('samsung') || n.includes('galaxy book')) return 'Samsung';
      if (n.includes('macbook') || n.includes('apple')) return 'MacBook';
      if (n.includes('gigabyte') || n.includes('aorus')) return 'Gigabyte';
      if (n.includes('lg ') || n.includes('gram')) return 'LG';
      if (n.includes('huawei') || n.includes('matebook')) return 'Huawei';
      if (n.includes('microsoft') || n.includes('surface')) return 'Microsoft';
      return 'Other';
    }
    document.querySelectorAll('div.cardInfo').forEach(card => {
      const linkEl = card.querySelector('a[href*="may-tinh-xach-tay/"]');
      if (!linkEl) return;
      const href = linkEl.getAttribute('href') || '';
      const link = href.startsWith('http') ? href : BASE + href;
      if (!href || seen.has(link)) return;
      seen.add(link);
      const name      = card.querySelector('h3, h2')?.textContent?.trim() || '';
      const salePrice = parseInt((card.querySelector('p.b1-semibold,[class*="b1-semibold"]')?.textContent||'').replace(/\D/g,'')) || 0;
      const origPrice = parseInt((card.querySelector('span[class*="line-through"]')?.textContent||'').replace(/\D/g,'')) || 0;
      const discount  = card.querySelector('[class*="discount"],[class*="percent"]')?.innerText?.trim() || '';
      if (!name || name.length < 5) return;
      // FPT listing: detect "Hàng sắp về" từ card text
      // Detail page sẽ update chính xác hơn khi fetch specs
      const fptStatus = (() => {
        const cardText = (card.innerText || '').toLowerCase();
        if (/hàng sắp về/.test(cardText)) return 'Hàng sắp về';
        if (/ngừng/.test(cardText)) return 'Ngừng KD';
        if (!salePrice && !origPrice) return 'Chưa rõ';
        return 'Còn hàng';
      })();
      out.push({
        dealer:'FPT Retail', name, brand: detectBrand(name),
        cpu:'', ram:'', storage:'', screen:'', gpu:'', weight:'',
        origPrice, salePrice, discount, sold:'', rating:'', link,
        stockStatus: fptStatus,
      });
    });
    return out;
  }, 'https://fptshop.com.vn');

  console.log(`    → ${products.length} SP`);
  if (products.length === 0) {
    // Chẩn đoán: trang trả 0 SP có thể do (a) bị chặn/redirect sang trang
    // block, hoặc (b) selector "div.cardInfo" đã đổi. Log title + URL + đoạn
    // đầu body để phân biệt 2 trường hợp ở lần chạy sau.
    const diag = await page.evaluate(() => ({
      title: document.title,
      url: location.href,
      cardInfoCount: document.querySelectorAll('div.cardInfo').length,
      bodyLen: document.body.innerHTML.length,
      bodySnippet: (document.body.innerText || '').slice(0, 200).replace(/\s+/g, ' '),
    })).catch(() => null);
    if (diag) {
      console.log(`    🔍 diag: title="${diag.title}" url=${diag.url} cardInfo=${diag.cardInfoCount} bodyLen=${diag.bodyLen}`);
      console.log(`    🔍 body: ${diag.bodySnippet}`);
    }
  }
  await enrichSpecs(products, specCache, fetchSpecsFPT, page, startTime, FPT_DEADLINE_MS);
  return products;
}

// ── SCRAPER 3 — CellPhone S ───────────────────────────────
async function scrapeCPS(page, brand, specCache, startTime) {
  console.log(`  [CPS] ${brand.name}`);
  // CPS không bị chặn IP datacenter → gọi trực tiếp, không cần proxy.
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
      const cpsStatus = (!salePrice && !origPrice) ? 'Chưa rõ' : 'Còn hàng';
      out.push({
        dealer:'CellPhone S', name, brand:brandName,
        cpu:'', ram:'', storage:'', screen:'', gpu:'', weight:'',
        origPrice, salePrice, discount, sold, rating, link,
        stockStatus: cpsStatus,
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
      range: `${SHEET_NAME}!A2:S`,
    });

    // Đọc version đã lưu trong sheet (cell T1 — ngoài range data chính)
    let savedVersion = 0;
    try {
      const vRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!T1`,  // T1: FPT mapping version (S giờ là cột Tình trạng data)
      });
      savedVersion = parseInt(vRes.data.values?.[0]?.[0] || '0') || 0;
    } catch(e) {}

    const fptCacheValid = savedVersion >= FPT_MAPPING_VERSION;
    if (!fptCacheValid) {
      console.log(`🔄 FPT mapping v${FPT_MAPPING_VERSION} (sheet: v${savedVersion}) → Re-fetch toàn bộ FPT specs`);
    }

    (res.data.values || []).forEach(row => {
      const link = row[17];
      if (!link) return;
      const dealer = row[3] || '';
      // Skip FPT cache nếu mapping version cũ → sẽ fetch lại với mapping mới
      if (dealer === 'FPT Retail' && !fptCacheValid) return;

      const cpu=row[6]||'', ram=row[7]||'', storage=row[8]||'';
      const screen=row[9]||'', gpu=row[10]||'', weight=row[11]||'';
      // Cache specs + stockStatus (col S = index 18)
      // KHONG load stockStatus vào cache — stockStatus thay đổi hàng ngày,
      // phải detect lại từ listing/detail page mỗi lần scrape.
      if (cpu||ram||storage||screen||gpu||weight) {
        cache.set(link, { cpu, ram, storage, screen, gpu, weight });
      }
    });

    const fptCount  = (res.data.values||[]).filter(r => r[3]==='FPT Retail' && r[17]).length;
    const cpsCount  = cache.size - [...cache.keys()].filter(k => k.includes('fptshop')).length;
    console.log(`📋 Spec cache: ${cache.size} SP (FPT: ${fptCacheValid ? 'từ cache' : 'sẽ re-fetch'}, CPS: từ cache)`);
  } catch(e) {
    console.log(`⚠ Spec cache load failed: ${e.message}`);
  }
  return cache;
}

// ── FIX #1: cảnh báo khi số SP scrape được giảm bất thường so với ────────
// ngày gần nhất (dấu hiệu vòng lặp "Xem thêm" dừng sớm / site load chậm)
function buildScrapeHealthNotes(existingRows, newRows, scrapeDealerNames) {
  const notes = [];
  const parseVN = (d) => {
    const [dd, mm, yyyy] = (d || '').split('/').map(Number);
    return (dd && mm && yyyy) ? new Date(yyyy, mm - 1, dd) : null;
  };
  for (const dealerName of scrapeDealerNames) {
    const countByDate = {};
    existingRows.forEach(r => {
      if (r[3] !== dealerName || !r[0]) return;
      countByDate[r[0]] = (countByDate[r[0]] || 0) + 1;
    });
    const dates = Object.keys(countByDate)
      .map(d => ({ d, dt: parseVN(d) }))
      .filter(x => x.dt)
      .sort((a, b) => a.dt - b.dt);
    if (dates.length === 0) continue;
    const latestDate  = dates[dates.length - 1].d;
    const latestCount = countByDate[latestDate];
    const todayCount  = newRows.filter(r => r[3] === dealerName).length;
    // Chỉ cảnh báo khi baseline đủ lớn (tránh false-positive lúc mới có ít data)
    // và giảm ≥15% — ngưỡng ước tính cho phép dao động tự nhiên (SP hết hàng lẻ tẻ)
    if (latestCount >= 5 && todayCount < latestCount * 0.85) {
      const pct = Math.round((1 - todayCount / latestCount) * 100);
      notes.push(`⚠ ${dealerName}: ${todayCount} SP hôm nay vs ${latestCount} SP ngày ${latestDate} (giảm ${pct}%) — kiểm tra xem có bị dừng sớm khi load "Xem thêm" không`);
    }
  }
  return notes;
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
    // Chỉ loại bỏ rows hôm nay thuộc dealer mà JOB NÀY phụ trách.
    // Rows hôm nay của dealer khác (do job song song ghi) được giữ lại,
    // tránh race condition khi 2 job cùng đọc-sửa-ghi RAW DATA.
    existingRows = (res.data.values||[]).filter(row => {
      if (!row[0]) return false; // bỏ rows trống/lỗi
      if (row[0] !== dateStr) return true; // ngày khác → giữ
      const dealer = row[3];
      return !SCRAPE_DEALER_NAMES.has(dealer); // hôm nay nhưng dealer khác → giữ
    });
  } catch(e) {
    console.log('⚠ Read existing rows failed:', e.message);
  }

  const newRows = allProducts.map((p, i) => [
    dateStr, timeStr, i+1,
    p.dealer, p.name, p.brand,
    p.cpu, p.ram, p.storage, p.screen, p.gpu, p.weight,
    p.origPrice||'', p.salePrice||'', p.discount,
    p.sold, p.rating, p.link,
    p.stockStatus || 'Còn hàng',
  ]);

  // Safety guard: nếu scrape được 0 SP thì KHÔNG clear sheet
  // (tránh xóa mất data cũ khi proxy lỗi / site thay đổi selector)
  if (newRows.length === 0) {
    console.log(`⚠ SKIP ghi sheet: 0 SP scrape được (dealer: ${[...SCRAPE_DEALER_NAMES].join(',')}). Giữ nguyên data cũ.`);
    return;
  }

  // FIX #1: kiểm tra tụt số lượng SP bất thường trước khi ghi (vẫn ghi bình
  // thường — chỉ cảnh báo để không bị bỏ sót âm thầm như trước đây)
  const healthNotes = buildScrapeHealthNotes(existingRows, newRows, SCRAPE_DEALER_NAMES);
  if (healthNotes.length > 0) {
    console.log('\n🚨 CẢNH BÁO SỐ LƯỢNG SP GIẢM BẤT THƯỜNG:');
    healthNotes.forEach(n => console.log('   ' + n));
  } else {
    console.log(`✅ Health check: số lượng SP mỗi dealer bình thường (${[...SCRAPE_DEALER_NAMES].join(', ')})`);
  }

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
    range: `${SHEET_NAME}!A1:S1`,
    valueInputOption: 'RAW',
    requestBody: { values: [HEADERS] },
  });

  // Lưu FPT_MAPPING_VERSION vào T1 để track khi nào cần re-fetch
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!T1`,  // T1: FPT mapping version
    valueInputOption: 'RAW',
    requestBody: { values: [[FPT_MAPPING_VERSION]] },
  });

  // FIX #1: ghi health note vào U1 — mở sheet lên là thấy ngay lần chạy gần nhất
  // có bị tụt số lượng SP bất thường không, khỏi phải mò log GitHub Actions
  const healthNote = healthNotes.length > 0
    ? `[${dateStr} ${timeStr}] ${healthNotes.join(' | ')}`
    : `[${dateStr} ${timeStr}] ✅ OK — số lượng SP bình thường`;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!U1`,  // U1: Scrape health note (lần chạy gần nhất)
    valueInputOption: 'RAW',
    requestBody: { values: [[healthNote]] },
  });

  const missingSpecs = newRows.filter(r => !r[6] && !r[7]).length;
  console.log(`✅ Ghi ${newRows.length} dòng mới | Giữ ${existingRows.length} dòng cũ`);
  if (missingSpecs > 0) console.log(`⚠ ${missingSpecs} SP chưa có specs — sẽ fetch lần sau`);
}

// ── MAIN ──────────────────────────────────────────────────
// Safety net: nếu toàn bộ process treo quá 60 phút → force exit
// Ngăn workflow GitHub Actions bị hang 90 phút rồi fail do timeout
const PROCESS_KILL_TIMEOUT_MS = 60 * 60 * 1000;
const killTimer = setTimeout(() => {
  console.error(`\n💀 Process kill-timer (${PROCESS_KILL_TIMEOUT_MS/60000} phút) — force exit để tránh workflow timeout`);
  process.exit(1);
}, PROCESS_KILL_TIMEOUT_MS);
killTimer.unref(); // Không giữ event loop nếu process kết thúc bình thường trước đó

(async () => {
  const startTime = Date.now();
  console.log('🚀 Multi-Dealer Scraper v3.4.2');
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
    protocolTimeout: 300000, // 300s — ubuntu-latest đôi khi CDP chậm bất thường (đã gặp Network.setCacheDisabled timeout ở 180s)
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage',
           '--disable-gpu','--window-size=1280,900'],
  });

  const allProducts = [];

  try {
    // ── MBW ── scrape 1 lần từ trang tổng /laptop
    if (SCRAPE_DEALERS.has('MBW')) {
      console.log('\n═══ MBW ═══');
      try {
        const pageMBW = await browser.newPage();
        await pageMBW.setViewport({ width: 1280, height: 900 });
        await pageMBW.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36');
        const mbwProducts = await scrapeMBW(pageMBW);
        console.log(`    → ${mbwProducts.length} SP tổng MBW`);
        allProducts.push(...mbwProducts);
        await pageMBW.close();

        // FIX #2: SP nào hôm qua có mà hôm nay không thấy trong listing nữa
        // → ghé trang chi tiết xác nhận Ngừng kinh doanh thay vì để im lặng mất tích
        const todayLinksMBW = new Set(mbwProducts.map(p => p.link));
        const missingCandidatesMBW = await getMissingCandidates(sheets, 'MBW', todayLinksMBW);
        if (missingCandidatesMBW.length > 0) {
          console.log(`    🔍 ${missingCandidatesMBW.length} SP MBW mất khỏi listing hôm nay — đang kiểm tra...`);
          const missingCheckedMBW = await checkMissingProducts(browser, 'MBW', missingCandidatesMBW, specCache);
          allProducts.push(...missingCheckedMBW);
        }
      } catch (e) {
        console.log(`    💥 MBW lỗi: ${e.message.substring(0,100)}`);
      }
    } else {
      console.log('\n═══ MBW ═══ (skip — không trong SCRAPE_DEALERS)');
    }

    // ── FPT ──
    if (SCRAPE_DEALERS.has('FPT')) {
      console.log('\n═══ FPT Retail ═══');
      let pageFPT = await browser.newPage();
      await pageFPT.setViewport({ width: 1280, height: 900 });
      await pageFPT.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36');
      // v3.4: đặt timeout mặc định cho tất cả operation trên FPT page
      // Puppeteer default = 0 (vô hạn) → nếu CF chặn 1 page.evaluate/waitForSelector
      // thì block mãi mãi. 20s đủ cho normal page, bắt buộc timeout nếu bị chặn.
      pageFPT.setDefaultTimeout(20000);
      pageFPT.setDefaultNavigationTimeout(30000);
      // v3.0: scrape TẤT CẢ laptop qua 1 URL tổng thay vì loop per-brand
      // → lấy đủ 400+ products, không bỏ sót brand, pagination hoạt động tốt hơn
      // v3.4: Promise.race với FPT_SCRAPE_TIMEOUT_MS → nếu toàn bộ FPT treo thì tự thoát
      try {
        const fptAllBrand = { name: 'All', fptUrl: FPT_ALL_URL };
        const fptTimeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`FPT scrape timeout sau ${FPT_SCRAPE_TIMEOUT_MS/60000} phút`)), FPT_SCRAPE_TIMEOUT_MS)
        );
        const products = await Promise.race([
          scrapeFPT(pageFPT, fptAllBrand, specCache, startTime),
          fptTimeoutPromise,
        ]);
        allProducts.push(...products);

        // FIX #2: SP FPT nào hôm qua có mà hôm nay không thấy trong listing
        const todayLinksFPT = new Set(products.map(p => p.link));
        const missingCandidatesFPT = await getMissingCandidates(sheets, 'FPT Retail', todayLinksFPT);
        if (missingCandidatesFPT.length > 0) {
          console.log(`    🔍 ${missingCandidatesFPT.length} SP FPT mất khỏi listing hôm nay — đang kiểm tra...`);
          const missingCheckedFPT = await checkMissingProducts(browser, 'FPT Retail', missingCandidatesFPT, specCache);
          allProducts.push(...missingCheckedFPT);
        }
      } catch (e) {
        console.log(`    💥 FPT All lỗi: ${e.message.substring(0,100)}`);
      }
      await pageFPT.close().catch(() => {});
    } else {
      console.log('\n═══ FPT Retail ═══ (skip — không trong SCRAPE_DEALERS)');
    }

    // ── CPS ──
    if (SCRAPE_DEALERS.has('CPS')) {
      console.log('\n═══ CellPhone S ═══');
      let pageCPS = await browser.newPage();
      await pageCPS.setViewport({ width: 1280, height: 900 });
      await pageCPS.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36');
      const todayLinksCPS = new Set();
      for (const brand of BRANDS) {
        try {
          const products = await scrapeCPS(pageCPS, brand, specCache, startTime);
          allProducts.push(...products);
          products.forEach(p => todayLinksCPS.add(p.link));
        } catch (e) {
          console.log(`    💥 ${brand.name} lỗi: ${e.message.substring(0,100)}`);
          try { await pageCPS.close(); } catch(_) {}
          pageCPS = await browser.newPage();
          await pageCPS.setViewport({ width: 1280, height: 900 });
          await pageCPS.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36');
        }
        await sleep(800);
      }
      await pageCPS.close();

      // FIX #2: SP CPS nào hôm qua có mà hôm nay không thấy trong listing
      const missingCandidatesCPS = await getMissingCandidates(sheets, 'CellPhone S', todayLinksCPS);
      if (missingCandidatesCPS.length > 0) {
        console.log(`    🔍 ${missingCandidatesCPS.length} SP CPS mất khỏi listing hôm nay — đang kiểm tra...`);
        const missingCheckedCPS = await checkMissingProducts(browser, 'CellPhone S', missingCandidatesCPS, specCache);
        allProducts.push(...missingCheckedCPS);
      }
    } else {
      console.log('\n═══ CellPhone S ═══ (skip — không trong SCRAPE_DEALERS)');
    }

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
  // v3.4.1: force exit sau khi xong — googleapis/puppeteer giữ event loop
  // sống vô thời hạn qua HTTP keep-alive connections và Chrome subprocess.
  process.exit(0);
})().catch(err => {
  console.error('💥 Fatal:', err);
  process.exit(1);
});





