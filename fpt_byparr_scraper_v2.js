/**
 * FPT Shop Test Scraper — Pure HTTPS fetch (no browser)
 * v3.0 — Bỏ Byparr/Camoufox, dùng node https trực tiếp
 *
 * Insight: FPT Shop SSR trả HTML đầy đủ cho plain GET requests.
 * Byparr (headless browser) bị Cloudflare detect → timeout.
 * Plain HTTPS với browser headers KHÔNG bị block.
 *
 * Target: https://fptshop.com.vn/may-tinh-xach-tay/msi
 * Output: FPT_TEST tab (format RAW DATA + col S: method, T: status)
 */

const https = require('https');
const zlib  = require('zlib');

const GAS_URL    = process.env.GAS_URL    || '';
const SHEET_NAME = process.env.SHEET_NAME || 'FPT_TEST';
const METHOD_TAG = process.env.METHOD_TAG || 'fetch';

const TARGET_URL  = 'https://fptshop.com.vn/may-tinh-xach-tay/msi';
const DEALER_NAME = 'FPT';
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000;

// ─── Fetch với browser-like headers ──────────────────────────────────────
function fetchPage(url, attempt = 1) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   'GET',
      headers: {
        'User-Agent':                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept':                    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language':           'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding':           'gzip, deflate, br',
        'Cache-Control':             'no-cache',
        'Pragma':                    'no-cache',
        'Sec-Ch-Ua':                 '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
        'Sec-Ch-Ua-Mobile':          '?0',
        'Sec-Ch-Ua-Platform':        '"Windows"',
        'Sec-Fetch-Dest':            'document',
        'Sec-Fetch-Mode':            'navigate',
        'Sec-Fetch-Site':            'none',
        'Sec-Fetch-User':            '?1',
        'Upgrade-Insecure-Requests': '1',
        'Connection':                'keep-alive',
      },
    }, (res) => {
      const status = res.statusCode;
      const ct     = res.headers['content-type'] || '';
      const enc    = res.headers['content-encoding'] || '';

      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);

        // Decompress nếu cần
        const decompress = (buf, cb) => {
          if (enc === 'br') {
            zlib.brotliDecompress(buf, cb);
          } else if (enc === 'gzip') {
            zlib.gunzip(buf, cb);
          } else if (enc === 'deflate') {
            zlib.inflate(buf, cb);
          } else {
            cb(null, buf);
          }
        };

        decompress(buf, (err, decoded) => {
          if (err) return reject(new Error('Decompress error: ' + err.message));
          const html = decoded.toString('utf8');
          resolve({ status, html, contentType: ct });
        });
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('Request timeout')));
    req.end();
  });
}

// ─── Fetch với retry ──────────────────────────────────────────────────────
async function fetchWithRetry(url) {
  for (let i = 1; i <= MAX_RETRIES; i++) {
    try {
      console.log(`📡 Fetch attempt ${i}/${MAX_RETRIES}: ${url}`);
      const { status, html, contentType } = await fetchPage(url);
      console.log(`   Status: ${status} | ${html.length.toLocaleString()} chars | ${contentType.slice(0, 40)}`);

      if (status === 403 || status === 429) {
        throw new Error(`HTTP ${status} — blocked`);
      }
      if (status !== 200) {
        throw new Error(`HTTP ${status}`);
      }
      if (/Just a moment|Checking your browser|challenge-platform/i.test(html.slice(0, 2000))) {
        throw new Error('Cloudflare challenge page returned');
      }
      if (!html.includes('fptshop') && !html.includes('may-tinh-xach-tay')) {
        throw new Error('Unexpected response — not FPT page');
      }

      return html;

    } catch (err) {
      console.log(`   ❌ ${err.message}`);
      if (i < MAX_RETRIES) {
        console.log(`   ⏳ Retry in ${RETRY_DELAY / 1000}s...`);
        await new Promise(r => setTimeout(r, RETRY_DELAY));
      } else {
        throw new Error(`Fetch failed after ${MAX_RETRIES} attempts: ${err.message}`);
      }
    }
  }
}

// ─── Product URL classifier ───────────────────────────────────────────────
const EXACT_CATS = new Set([
  '/may-tinh-xach-tay/msi',
  '/may-tinh-xach-tay/msi-modern',
  '/may-tinh-xach-tay/msi-venture',
]);
const CAT_RE = [
  /^\/may-tinh-xach-tay\/msi\//,
  /^\/may-tinh-xach-tay\/msi-gaming-(?:thin-gf|stealth-vector|katana-sword)[a-z-]*$/,
];
const MODEL_CODE_RE = /[a-z]\d{2}[a-z0-9]+/i;

function isProduct(path) {
  if (EXACT_CATS.has(path)) return false;
  if (CAT_RE.some(r => r.test(path))) return false;
  return MODEL_CODE_RE.test(path);
}

// ─── Parse SSR HTML ───────────────────────────────────────────────────────
function parseProducts(html) {
  const products = [];
  const seen     = new Set();

  const linkRe = /href="(\/may-tinh-xach-tay\/msi[^"?#]*)"[^>]*title="([^"]+)"/gi;
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    const path  = m[1];
    const title = m[2].replace(/^Laptop\s+/i, '').trim();
    if (seen.has(path) || !isProduct(path)) continue;
    seen.add(path);
    products.push({ path, url: 'https://fptshop.com.vn' + path, name: title });
  }

  // Price blocks: 45.990.000đ-16%38.490.000đ
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

  for (const p of products) {
    const hrefPos = html.indexOf(`href="${p.path}"`);

    // Nearest price block after href (within 3000 chars)
    let best = null, bestDist = Infinity;
    for (const pb of prices) {
      const d = pb.pos - hrefPos;
      if (d > 0 && d < 3000 && d < bestDist) { bestDist = d; best = pb; }
    }
    if (best) {
      p.priceOld = best.priceOld; p.priceNew = best.priceNew; p.discount = best.discount;
    } else {
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
    p.ssd = rams[1] ? rams[1][1] + 'GB' : (t.match(/(\d+)\s*TB/i) ? t.match(/(\d+)\s*TB/i)[1] + 'TB' : '');
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
  const now  = new Date(Date.now() + 7 * 3600000);
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
    method, 'ok',
  ]);
}

// ─── POST to GAS ──────────────────────────────────────────────────────────
function postToGAS(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const p    = new URL(GAS_URL);
    const req  = https.request({
      hostname: p.hostname,
      path:     p.pathname + p.search,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => resolve(raw));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('GAS timeout')));
    req.write(body);
    req.end();
  });
}

async function sendToGAS(rows, method, status, meta = {}) {
  if (!GAS_URL) {
    console.log(`\n⚠️  GAS_URL not set — dry run (${rows.length} rows not written)`);
    return;
  }
  console.log(`\n📤 GAS → ${rows.length} rows (${SHEET_NAME})...`);
  try {
    const r = await postToGAS({
      action: 'writeFptTest', sheetName: SHEET_NAME,
      rows, method, status, runAt: new Date().toISOString(), ...meta,
    });
    console.log('✅ GAS:', r.slice(0, 200));
  } catch (e) { console.error('❌ GAS:', e.message); }
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const t0 = Date.now();
  console.log('🚀 FPT Scraper v3.0 (pure HTTPS fetch — no browser)');
  console.log(`   ${new Date().toISOString()}\n`);

  const meta = { method: METHOD_TAG, success: false, productCount: 0, version: '3.0' };

  try {
    const html     = await fetchWithRetry(TARGET_URL);
    const products = parseProducts(html);

    console.log(`\n📦 ${products.length} products parsed`);
    products.slice(0, 5).forEach((p, i) => {
      const price = p.priceNew
        ? (p.priceOld ? `${(p.priceOld/1e6).toFixed(1)}M→${(p.priceNew/1e6).toFixed(1)}M (-${p.discount}%)` : `${(p.priceNew/1e6).toFixed(1)}M`)
        : '—';
      console.log(`  [${i+1}] ${p.name.slice(0, 55)}`);
      console.log(`       ${p.cpu||'—'} | ${p.gpu||'—'} | ${price}`);
    });
    if (products.length > 5) console.log(`  ... +${products.length - 5} more`);

    if (products.length === 0) throw new Error('0 products — HTML changed or CF blocked?');

    meta.success      = true;
    meta.productCount = products.length;

    const rows = formatRows(products, METHOD_TAG);
    await sendToGAS(rows, METHOD_TAG, 'ok', meta);

    const dur = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\n✅ Done in ${dur}s — ${products.length} products (${products.filter(p=>p.priceNew).length} with price)`);

    if (products.length < 5) { console.warn('⚠️  Too few products'); process.exit(1); }

  } catch (err) {
    console.error(`\n❌ FAILED: ${err.message}`);
    await sendToGAS([], METHOD_TAG, 'failed', { ...meta, error: err.message });
    process.exit(1);
  }
}

main();
