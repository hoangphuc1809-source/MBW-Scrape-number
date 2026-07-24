/**
 * test_fpt_diagnostic.js
 * Mục tiêu: xác định CƠ CHẾ FPT chặn, không phải lấy dữ liệu.
 *
 * Chạy 3 tầng để phân biệt:
 *   1. plain fetch      -> HTTP thuần, không trình duyệt
 *   2. puppeteer mặc định -> trình duyệt thật, cấu hình mặc định
 *   3. puppeteer thực tế  -> trình duyệt thật + UA/locale/timezone Việt Nam
 *
 * Nếu (1) fail mà (3) pass  -> KHÔNG phải chặn IP, không cần VPS
 * Nếu cả 3 đều fail giống nhau -> chặn ở tầng IP/ASN
 *
 * Usage: node test_fpt_diagnostic.js
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const FPT_URL = process.env.FPT_URL || 'https://fptshop.com.vn/may-tinh-xach-tay';
const CONTROL_URL = process.env.CONTROL_URL || 'https://www.thegioididong.com/laptop';
const OUT_DIR = path.join(__dirname, 'artifacts');
const NAV_TIMEOUT = 45000;

// Dấu hiệu nhận biết trang challenge / chặn bot
const CHALLENGE_MARKERS = [
  'just a moment',
  'checking your browser',
  'attention required',
  'cf-browser-verification',
  'cf_chl_opt',
  'access denied',
  'captcha',
  'ddos-guard',
  '請稍候',
];

// Header đáng quan tâm khi chẩn đoán
const HEADERS_OF_INTEREST = [
  'server', 'cf-ray', 'cf-mitigated', 'cf-cache-status',
  'retry-after', 'x-sucuri-id', 'x-cdn', 'via', 'x-cache',
];

function ensureOutDir() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
}

function pickHeaders(headers) {
  const out = {};
  for (const key of HEADERS_OF_INTEREST) {
    const val = headers[key] ?? headers[key.toLowerCase()];
    if (val !== undefined) out[key] = val;
  }
  return out;
}

function detectChallenge(html) {
  const lower = (html || '').toLowerCase();
  return CHALLENGE_MARKERS.filter((m) => lower.includes(m));
}

function logResult(label, r) {
  console.log(`\n${'='.repeat(64)}`);
  console.log(`  ${label}`);
  console.log('='.repeat(64));
  console.log(`  Kết quả     : ${r.ok ? 'THÀNH CÔNG' : 'THẤT BẠI'}`);
  console.log(`  HTTP status : ${r.status ?? '(không có phản hồi)'}`);
  if (r.errorType) console.log(`  Loại lỗi    : ${r.errorType}`);
  if (r.error) console.log(`  Chi tiết    : ${r.error}`);
  if (r.title) console.log(`  Tiêu đề     : ${r.title}`);
  if (r.challenge && r.challenge.length) {
    console.log(`  CHALLENGE   : phát hiện [${r.challenge.join(', ')}]`);
  }
  if (r.headers && Object.keys(r.headers).length) {
    console.log(`  Headers     :`);
    for (const [k, v] of Object.entries(r.headers)) {
      console.log(`      ${k}: ${v}`);
    }
  }
  if (r.bodyPreview) {
    console.log(`  Body (400 ký tự đầu):`);
    console.log(`      ${r.bodyPreview.replace(/\s+/g, ' ').slice(0, 400)}`);
  }
}

/** Phân loại lỗi mạng thành nhóm có ý nghĩa chẩn đoán */
function classifyError(err) {
  const msg = (err && err.message ? err.message : String(err)).toUpperCase();
  if (msg.includes('TIMEOUT')) return 'TIMEOUT';
  if (msg.includes('ECONNRESET') || msg.includes('CONNECTION_RESET')) return 'CONNECTION_RESET';
  if (msg.includes('ECONNREFUSED') || msg.includes('CONNECTION_REFUSED')) return 'CONNECTION_REFUSED';
  if (msg.includes('ENOTFOUND') || msg.includes('NAME_NOT_RESOLVED')) return 'DNS_FAIL';
  if (msg.includes('CERT') || msg.includes('SSL')) return 'TLS_FAIL';
  return 'OTHER';
}

/** Tầng 0: IP công khai của runner — cho biết ASN đang dùng */
async function checkRunnerIp() {
  try {
    const res = await fetch('https://ipinfo.io/json', { signal: AbortSignal.timeout(15000) });
    const data = await res.json();
    console.log(`\n${'='.repeat(64)}`);
    console.log('  TẦNG 0 — Danh tính mạng của runner');
    console.log('='.repeat(64));
    console.log(`  IP        : ${data.ip}`);
    console.log(`  Quốc gia  : ${data.country}`);
    console.log(`  Tổ chức   : ${data.org}`);
    console.log(`  >> Nếu quốc gia KHÔNG phải VN và FPT chặn theo địa lý,`);
    console.log(`     thì VPS đặt tại Việt Nam sẽ giải quyết được.`);
    return data;
  } catch (err) {
    console.log(`  Không lấy được thông tin IP: ${err.message}`);
    return null;
  }
}

/** Tầng 1: HTTP thuần, không trình duyệt */
async function testPlainFetch(url) {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(NAV_TIMEOUT),
    });
    const html = await res.text();
    const headers = {};
    res.headers.forEach((v, k) => { headers[k] = v; });
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      headers: pickHeaders(headers),
      title: titleMatch ? titleMatch[1].trim() : null,
      challenge: detectChallenge(html),
      bodyPreview: html.slice(0, 1500),
      htmlLength: html.length,
    };
  } catch (err) {
    return { ok: false, status: null, errorType: classifyError(err), error: err.message };
  }
}

/** Tầng 2 & 3: trình duyệt thật */
async function testPuppeteer(url, { realistic, tag }) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        ...(realistic ? ['--lang=vi-VN,vi'] : []),
      ],
    });

    const page = await browser.newPage();

    if (realistic) {
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
      );
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8',
        'Upgrade-Insecure-Requests': '1',
      });
      await page.emulateTimezone('Asia/Ho_Chi_Minh');
      // Ẩn dấu hiệu automation cơ bản
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'languages', { get: () => ['vi-VN', 'vi', 'en-US'] });
      });
    }

    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: NAV_TIMEOUT,
    });

    // Cho JS challenge (nếu có) thời gian tự chạy
    await new Promise((r) => setTimeout(r, 5000));

    const html = await page.content();
    const title = await page.title();
    const status = response ? response.status() : null;
    const headers = response ? pickHeaders(response.headers()) : {};

    ensureOutDir();
    const shotPath = path.join(OUT_DIR, `${tag}.png`);
    await page.screenshot({ path: shotPath, fullPage: false });
    fs.writeFileSync(path.join(OUT_DIR, `${tag}.html`), html);

    return {
      ok: status !== null && status >= 200 && status < 300 && detectChallenge(html).length === 0,
      status,
      headers,
      title,
      challenge: detectChallenge(html),
      bodyPreview: html.slice(0, 1500),
      htmlLength: html.length,
      screenshot: shotPath,
    };
  } catch (err) {
    return { ok: false, status: null, errorType: classifyError(err), error: err.message };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/** Đưa ra kết luận có thể hành động được */
function verdict({ plain, pptrDefault, pptrReal, control }) {
  console.log(`\n\n${'#'.repeat(64)}`);
  console.log('  KẾT LUẬN CHẨN ĐOÁN');
  console.log('#'.repeat(64));

  if (control && !control.ok) {
    console.log('\n  ⚠️  CẢNH BÁO: trang đối chứng (MBW) cũng fail.');
    console.log('     Vấn đề nằm ở runner hoặc mạng, KHÔNG phải riêng FPT.');
    console.log('     Sửa runner trước rồi chạy lại test này.');
    return;
  }

  const anyChallenge =
    (plain.challenge?.length || 0) +
    (pptrDefault.challenge?.length || 0) +
    (pptrReal.challenge?.length || 0) > 0;

  const netErrors = [plain, pptrDefault, pptrReal]
    .map((r) => r.errorType)
    .filter(Boolean);

  if (pptrReal.ok && !plain.ok) {
    console.log('\n  ✅ KHÔNG PHẢI CHẶN IP.');
    console.log('     Trình duyệt thật + header Việt Nam vào được, HTTP thuần thì không.');
    console.log('     => KHÔNG cần thuê VPS. Sửa scraper để dùng Puppeteer đầy đủ');
    console.log('        trên ubuntu-latest là chạy được, tiết kiệm toàn bộ chi phí.');
    return;
  }

  if (pptrReal.ok && pptrDefault.ok) {
    console.log('\n  ✅ FPT KHÔNG chặn runner cloud nữa.');
    console.log('     => Chuyển thẳng scrape-fpt sang ubuntu-latest, bỏ self-hosted.');
    return;
  }

  if (anyChallenge) {
    console.log('\n  ❌ BOT FINGERPRINTING (trang challenge).');
    console.log('     Đổi IP không giải quyết được. VPS Việt Nam VÔ ÍCH.');
    console.log('     => Giữ MSI cho FPT, hoặc nghiên cứu puppeteer-extra-plugin-stealth.');
    return;
  }

  if (netErrors.includes('TIMEOUT') || netErrors.includes('CONNECTION_RESET')) {
    console.log('\n  🟡 CÓ KHẢ NĂNG CHẶN THEO ĐỊA LÝ (timeout/reset ở tầng mạng).');
    console.log('     Đây là kịch bản DUY NHẤT mà VPS Việt Nam có thể cứu được.');
    console.log('     => Đáng thuê 1 tháng VPS VN rẻ nhất để test dứt điểm.');
    return;
  }

  const statuses = [plain.status, pptrDefault.status, pptrReal.status];
  if (statuses.every((s) => s === 403)) {
    console.log('\n  ❌ CHẶN Ở TẦNG IP/ASN (403 ở cả 3 tầng).');
    console.log('     Trình duyệt thật không giúp được => là IP, không phải fingerprint.');
    console.log('     VPS Việt Nam CÓ THỂ cứu nếu chặn theo địa lý,');
    console.log('     nhưng VÔ ÍCH nếu chặn theo ASN datacenter.');
    console.log('     => Xem TẦNG 0 ở trên: nếu runner ở nước ngoài thì còn hy vọng.');
    console.log('        Test rẻ nhất tiếp theo: bật VPN nước ngoài trên MSI, chạy lại FPT.');
    console.log('        Nếu MSI qua VPN cũng fail => chắc chắn chặn địa lý => thuê VPS VN.');
    return;
  }

  console.log('\n  ❓ Kết quả không khớp mẫu nào đã biết.');
  console.log('     Xem log chi tiết và ảnh chụp màn hình trong artifacts/ để phân tích.');
}

(async () => {
  console.log('FPT BLOCKING DIAGNOSTIC');
  console.log(`Thời điểm : ${new Date().toISOString()}`);
  console.log(`URL đích  : ${FPT_URL}`);
  console.log(`Đối chứng : ${CONTROL_URL}`);

  ensureOutDir();
  await checkRunnerIp();

  const plain = await testPlainFetch(FPT_URL);
  logResult('TẦNG 1 — HTTP thuần (không trình duyệt)', plain);

  const pptrDefault = await testPuppeteer(FPT_URL, { realistic: false, tag: 'fpt-default' });
  logResult('TẦNG 2 — Puppeteer mặc định', pptrDefault);

  const pptrReal = await testPuppeteer(FPT_URL, { realistic: true, tag: 'fpt-realistic' });
  logResult('TẦNG 3 — Puppeteer + UA/locale/timezone Việt Nam', pptrReal);

  const control = await testPuppeteer(CONTROL_URL, { realistic: true, tag: 'control-mbw' });
  logResult('ĐỐI CHỨNG — MBW (đã biết chạy được trên cloud)', control);

  verdict({ plain, pptrDefault, pptrReal, control });

  // Lưu JSON để đối chiếu giữa các lần chạy
  fs.writeFileSync(
    path.join(OUT_DIR, 'diagnostic-result.json'),
    JSON.stringify(
      { timestamp: new Date().toISOString(), url: FPT_URL, plain, pptrDefault, pptrReal, control },
      null,
      2
    )
  );
  console.log('\nĐã lưu kết quả vào artifacts/diagnostic-result.json');
})();
