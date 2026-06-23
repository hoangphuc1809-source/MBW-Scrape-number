/**
 * FPT Shop Test Scraper — Byparr (Camoufox) + SSR HTML Parser
 * v2.1 — Production-ready cho parallel test
 *
 * Target: https://fptshop.com.vn/may-tinh-xach-tay/msi (MSI only, ~40 products)
 * Method: Byparr giải Cloudflare → full SSR HTML → regex parser
 * Output: FPT_TEST tab (format RAW DATA + col S: method, T: status)
 *
 * Usage: node fpt_byparr_scraper_v2.js
 * Env:
 *   BYPARR_URL  default: http://localhost:8191
 *   GAS_URL     Google Apps Script deployment URL  ← required để ghi sheet
 *   SHEET_NAME  default: FPT_TEST
 *   METHOD_TAG  default: byparr
 */

const https = require('https');
const http  = require('http');

const BYPARR_URL  = process.env.BYPARR_URL  || 'http://localhost:8191';
const GAS_URL     = process.env.GAS_URL     || '';
const SHEET_NAME  = process.env.SHEET_NAME  || 'FPT_TEST';
const METHOD_TAG  = process.env.METHOD_TAG  || 'byparr';
const MAX_TIMEOUT = 120000; // 2 min for Byparr to solve CF

const TARGET_URL  = 'https://fptshop.com.vn/may-tinh-xach-tay/msi';
const DEALER_NAME = 'FPT';

// ─── HTTP ─────────────────────────────────────────────────────────────────
function httpReq(url, opts = {}, body = null) {
  return new Promise((resolve, reject) => {
    const p = new URL(url);
    const lib = p.protocol === 'https:' ? https : http;
    const payload = body ? JSON.stringify(body) : null;
    const req = lib.request({
      hostname: p.hostname,
      port:     p.port || (p.protocol === 'https:' ? 443 : 80),
      path:     p.pathname + p.search,
      method:   opts.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Accept': '*/*',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => resolve({ status: res.statusCode, body: raw }));
    });
    req.on('error', reject);
    req.setTimeout(MAX_TIMEOUT, () => req.destroy(new Error('Timeout')));
    if (payload) req.write(payload);
    req.end();
  });
}

// ─── Byparr ───────────────────────────────────────────────────────────────
async function waitForByparr(ms = 90000) {
  const t0 = Date.now();
  process.stdout.write('⏳ Byparr');
  while (Date.now() - t0 < ms) {
    try {
      const r = await httpReq(`${BYPARR_URL}/health`);
      if (r.status === 200) { console.log(' ✅ ready'); return; }
    } catch (_) {}
    await new Promise(r => setTimeout(r, 3000));
    process.stdout.write('.');
  }
  throw new Error('Byparr not ready after ' + ms / 1000 + 's');
}

async function fetchViaByparr(url) {
  console.log(`🔓 Solving CF → ${url}`);
  const res  = await httpReq(`${BYPARR_URL}/v1`, { method: 'POST' }, {
    cmd: 'request.get', url, maxTimeout: MAX_TIMEOUT,
  });
  const data = JSON.parse(res.body);
  if (data.status !== 'ok')
    throw new Error('Byparr failed: ' + JSON.stringify(data.message || data).slice(0, 200));
  const html = data.solution?.response || '';
  if (!html || /Just a moment|Checking your browser/i.test(html))
    throw new Error('CF challenge not solved');
  console.log(`   HTML ${html.length.toLocaleString()} chars | cookies ${data.solution?.cookies?.length || 0}`);
  return html;
}

// ─── URL classifier ───────────────────────────────────────────────────────
// Category = exact known slugs OR sub-category paths
// Product  = contains model code ([letter][2digits][1+alphanums], eg c13m b14wfk a13vek)
const EXACT_CATS = new Set([
  '/may-tinh-xach-tay/msi',
  '/may-tinh-xach-tay/msi-modern',
  '/may-tinh-xach-tay/msi-venture',
]);
const CAT_RE = [
  /^\/may-tinh-xach-tay\/msi\//,             // /msi/sub-category
  /^\/may-tinh-xach-tay\/msi-gaming-(?:thin-gf|stealth-vector|katana-sword)[a-z-]*$/,
];
const MODEL_CODE_RE = /[a-z]\d{2}[a-z0-9]+/i;

function isProduct(path) {
  if (EXACT_CATS.has(path)) return false;
  if (CAT_RE.some(r => r.test(path))) return false;
  return MODEL_CODE_RE.test(path);
}

// ─── Parser ───────────────────────────────────────────────────────────────
function parseProducts(html) {
  const products = [];
  const seen     = new Set();

  // 1. Extract product links from anchor tags
  const linkRe = /href="(\/may-tinh-xach-tay\/msi[^"?#]*)"[^>]*title="([^"]+)"/gi;
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    const path  = m[1];
    const title = m[2].replace(/^Laptop\s+/i, '').trim();
    if (seen.has(path) || !isProduct(path)) continue;
    seen.add(path);
    products.push({ path, url: 'https://fptshop.com.vn' + path, name: title });
  }

  // 2. Build price block index
  // FPT pattern: 45.990.000đ-16%38.490.000đ
  const priceRe = /(\d{2,3}(?:\.\d{3})+)[đd][-–](\d+)%(\d{2,3}(?:\.\d{3})+)[đd]/gi;
  const prices  = [];
  while ((m = priceRe.exec(html)) !== null) {
    prices.push({
      pos:      m.index,
      priceOld: parseInt(m[1].replace(/\./g, ''), 10),
      discount: parseInt(m[2], 10),
      priceNew: parseInt(m[3].replace(/\./g, ''), 10),
    });
  }

  // 3. Assign nearest price + parse specs
  for (const p of products) {
    const hrefPos = html.indexOf(`href="${p.path}"`);
    let best = null, bestDist = Infinity;
    for (const pb of prices) {
      const d = pb.pos - hrefPos;
      if (d > 0 && d < 3000 && d < bestDist) { bestDist = d; best = pb; }
    }
    if (best) {
      p.priceOld = best.priceOld;
      p.priceNew = best.priceNew;
      p.discount = best.discount;
    } else {
      // Fallback: single price near href
      const slice   = html.substring(hrefPos, hrefPos + 1500);
      const singleM = slice.match(/(\d{2,3}(?:\.\d{3})+)[đd]/);
      if (singleM) p.priceNew = parseInt(singleM[1].replace(/\./g, ''), 10);
    }

    // Specs from title
    const t = p.name;
    const cpuM = t.match(/Core\s+Ultra\s+\d+|Core\s+[i\d]+\s+\d+[A-Z]+\w*|Ryzen\s+\d+\s+\d+\w*/i);
    p.cpu = cpuM ? cpuM[0].trim() : '';

    const rams = [...t.matchAll(/(\d+)\s*GB/gi)];
    p.ram = rams[0] ? rams[0][1] + 'GB' : '';
    if (rams.length >= 2) {
      p.ssd = rams[1][1] + 'GB';
    } else {
      const tbM = t.match(/(\d+)\s*TB/i);
      p.ssd = tbM ? tbM[1] + 'TB' : '';
    }

    const scrM = t.match(/(\d{2}(?:\.\d+)?)["\u201d]/);
    p.screen = scrM ? scrM[1] + '"' : '';

    const gpuM = t.match(/RTX\s*\d{4}(?:\s*Ti)?|GTX\s*\d{4}/i);
    p.gpu = gpuM ? gpuM[0].replace(/\s+/g, ' ').trim() : '';

    p.weight = ''; p.sold = ''; p.rating = '';
  }

  return products;
}

// ─── Format rows ──────────────────────────────────────────────────────────
function formatRows(products, method) {
  const now  = new Date(Date.now() + 7 * 3600000); // VN +7
  const d    = now.toISOString().slice(0, 10).split('-');
  const date = `${d[2]}/${d[1]}/${d[0]}`;
  const time = now.toISOString().slice(11, 16);
  return products.filter(p => p.name).map((p, i) => [
    date, time, i + 1, DEALER_NAME,
    p.name, 'MSI',
    p.cpu || '', p.ram || '', p.ssd || '',
    p.screen || '', p.gpu || '', p.weight || '',
    p.priceOld ? String(p.priceOld) : '',
    p.priceNew ? String(p.priceNew) : '',
    p.discount ? `-${p.discount}%` : '',
    p.sold || '', p.rating || '', p.url || '',
    method,  // Col S: tracking
    'ok',    // Col T: status
  ]);
}

// ─── GAS ──────────────────────────────────────────────────────────────────
async function sendToGAS(rows, method, status, meta = {}) {
  if (!GAS_URL) {
    console.log(`⚠️  GAS_URL not set (dry-run) — would write ${rows.length} rows`);
    return;
  }
  console.log(`📤 GAS → ${rows.length} rows (${SHEET_NAME})...`);
  try {
    const r = await httpReq(GAS_URL, { method: 'POST' }, {
      action: 'writeFptTest', sheetName: SHEET_NAME,
      rows, method, status, runAt: new Date().toISOString(), ...meta,
    });
    console.log('✅ GAS:', r.body.slice(0, 200));
  } catch (e) { console.error('❌ GAS:', e.message); }
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const t0 = Date.now();
  console.log('🚀 FPT Byparr Scraper v2.1');
  console.log(`   ${new Date().toISOString()}\n`);

  const meta = { method: METHOD_TAG, success: false, productCount: 0 };

  try {
    await waitForByparr();
    const html     = await fetchViaByparr(TARGET_URL);
    const products = parseProducts(html);

    console.log(`\n📦 ${products.length} products`);
    products.slice(0, 5).forEach((p, i) => {
      const price = p.priceNew
        ? (p.priceOld ? `${(p.priceOld/1e6).toFixed(1)}M→${(p.priceNew/1e6).toFixed(1)}M (-${p.discount}%)` : `${(p.priceNew/1e6).toFixed(1)}M`)
        : '—';
      console.log(`  [${i+1}] ${p.name.slice(0, 55)}`);
      console.log(`       ${p.cpu||'—'} | ${p.gpu||'—'} | ${p.ram||'—'} | ${price}`);
    });
    if (products.length > 5) console.log(`  ... +${products.length - 5} more`);

    if (products.length === 0) throw new Error('0 products — HTML structure changed?');

    meta.success = true;
    meta.productCount = products.length;

    const rows = formatRows(products, METHOD_TAG);
    await sendToGAS(rows, METHOD_TAG, 'ok', meta);

    const dur = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\n✅ ${products.length} products in ${dur}s (${products.filter(p=>p.priceNew).length} with price, ${products.filter(p=>p.gpu).length} with GPU)`);

    if (products.length < 5) { console.warn('⚠️  Too few products'); process.exit(1); }

  } catch (err) {
    console.error(`\n❌ ${err.message}`);
    await sendToGAS([], METHOD_TAG, 'failed', { ...meta, error: err.message });
    process.exit(1);
  }
}

main();
