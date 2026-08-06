// pv_test_integration.js — DIAGNOSTIC/DEV script cho dealer Phong Vu (PV)
//
// Mục đích: dò cấu trúc DOM THẬT của phongvu.vn/c/laptop (Claude không có
// browser access trực tiếp vào site này để inspect — chỉ có screenshot từ
// Phuc), và thử extract specs bằng heuristic v1 (positional, không phụ
// thuộc class CSS cụ thể vì chưa biết chính xác). KHÔNG ghi Google Sheet,
// KHÔNG động vào multi_dealer_scraper.js — chạy độc lập, an toàn 100%.
//
// CÁCH CHẠY (trên máy MSI/BARACK, trong thư mục repo):
//   node pv_test_integration.js
//
// Paste TOÀN BỘ output console (đặc biệt phần "First card outerHTML" và
// "Extract v1") lại cho Claude để chỉnh selector cho đúng trước khi tích
// hợp vào multi_dealer_scraper.js.
'use strict';
const puppeteer = require('puppeteer');

const PV_URL = 'https://phongvu.vn/c/laptop';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('🚀 PV test — khởi động browser...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
           '--disable-gpu', '--window-size=1280,900'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36');

  console.log('→ goto', PV_URL);
  try {
    await page.goto(PV_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (e) {
    console.log('💥 goto FAILED:', e.message);
    console.log('   → nếu lỗi timeout/ERR_CONNECTION: có thể site chặn IP/bot-detection giống FPT.');
    await browser.close();
    process.exit(1);
  }
  await sleep(3000);

  // 0) Đếm tổng SP hiển thị trên header "Máy tính laptop (413 sản phẩm)"
  const headerCount = await page.evaluate(() => {
    const m = (document.body.innerText || '').match(/\((\d+)\s*sản phẩm\)/);
    return m ? parseInt(m[1], 10) : null;
  }).catch(() => null);
  console.log('📊 Header count "xxx sản phẩm":', headerCount);

  // 1) Dò card container: mọi link sản phẩm PV đều có dạng "...--s<digits>"
  //    (confirmed qua search: phongvu.vn/laptop-msi-...-s260302478). Đi từ
  //    link này, walk lên DOM tới khi innerText chứa cả giá ("đ") và ít
  //    nhất 1 pattern spec (GB/TB/kg) — đó chính là card container thật.
  const diag = await page.evaluate(() => {
    const linkEls = [...document.querySelectorAll('a[href]')]
      .filter(a => /--s\d+/.test(a.getAttribute('href') || ''));
    const seen = new Set();
    const samples = [];
    for (const a of linkEls) {
      const href = a.getAttribute('href');
      if (seen.has(href)) continue;
      seen.add(href);
      let el = a, hops = 0;
      while (el && hops < 8) {
        const t = el.innerText || '';
        if (/\d\s?đ/.test(t) && /(GB|TB|kg)/i.test(t)) break;
        el = el.parentElement;
        hops++;
      }
      if (samples.length < 5) {
        samples.push({ href, hops, cardTag: el ? el.tagName : null, cardClass: el ? el.className : null });
      }
    }
    return { totalLinkTags: linkEls.length, uniqueHrefs: seen.size, samples };
  });
  console.log('\n📋 Diag card detection:', JSON.stringify(diag, null, 2));

  // 2) In outerHTML rút gọn của card ĐẦU TIÊN — quan trọng nhất, cho Claude
  //    thấy cấu trúc thật (class name, tag, nesting) để viết selector đúng.
  const firstCardHtml = await page.evaluate(() => {
    const a = [...document.querySelectorAll('a[href]')].find(a => /--s\d+/.test(a.getAttribute('href') || ''));
    if (!a) return null;
    let el = a, hops = 0;
    while (el && hops < 8) {
      const t = el.innerText || '';
      if (/\d\s?đ/.test(t) && /(GB|TB|kg)/i.test(t)) break;
      el = el.parentElement;
      hops++;
    }
    return el ? el.outerHTML.substring(0, 3000) : null;
  });
  console.log('\n--- First card outerHTML (cắt 3000 ký tự) ---');
  console.log(firstCardHtml);
  console.log('--- END outerHTML ---');

  // 3) Thử extract theo heuristic v1 (positional, dựa vào innerText lines,
  //    KHÔNG dùng class cụ thể — để không bị vỡ nếu class name khác giả định).
  const products = await page.evaluate((BASE) => {
    const out = [];
    const seen = new Set();
    const linkEls = [...document.querySelectorAll('a[href]')]
      .filter(a => /--s\d+/.test(a.getAttribute('href') || ''));
    for (const a of linkEls) {
      let href = a.getAttribute('href') || '';
      if (!href.startsWith('http')) href = BASE + (href.startsWith('/') ? '' : '/') + href;
      if (seen.has(href)) continue;

      let card = a, hops = 0;
      while (card && hops < 8) {
        const t = card.innerText || '';
        if (/\d\s?đ/.test(t) && /(GB|TB|kg)/i.test(t)) break;
        card = card.parentElement;
        hops++;
      }
      if (!card) continue;
      seen.add(href);

      const lines = (card.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
      const noise = /^(Thêm vào giỏ|Liên hệ đặt hàng|Liên hệ$|Trả góp|TRẢ GÓP|TIẾT KIỆM|COMBO GIẢM|Xem thêm|Online|Chấp nhận|^\d\.\d$)/i;
      const clean = lines.filter(l => !noise.test(l));

      const priceLines = clean.filter(l => /\d[\d.,]+\s?đ/.test(l) && !l.includes('~'));
      const priceNums = priceLines
        .map(l => parseInt(l.replace(/[^\d]/g, ''), 10))
        .filter(n => n > 1000000);
      const salePrice = priceNums[0] || 0;
      const origPrice = priceNums[1] || salePrice;
      const discount = (clean.find(l => /-\d+%/.test(l)) || '').match(/-\d+%/)?.[0] || '';

      const brand = clean.find(l => /^[A-Z][A-Za-z]{1,12}$/.test(l)) || '';
      const name = clean.find(l => /laptop/i.test(l)) || clean.find(l => l.length > 20) || '';

      const specLines = clean.filter(l =>
        l !== brand && l !== name && !priceLines.includes(l) && l !== discount && l.length < 40
      );
      const cpu = specLines.find(l => /^(i[3579]|U[3579]|Ultra|Core|Ryzen|R[3579]|Celeron|Pentium|Snapdragon|M[1-9])/i.test(l)) || '';
      const gpu = specLines.find(l => /RTX|GTX|Radeon|Arc|Graphics/i.test(l)) || '';
      const ramStorage = specLines.filter(l => /^\d+\s?(GB|TB)$/i.test(l));
      const ram = ramStorage[0] || '';
      const storage = ramStorage[1] || '';
      const weight = specLines.find(l => /kg$/i.test(l)) || '';
      const screen = specLines.find(l => /"|Hz/i.test(l)) || '';

      out.push({
        href, brand, name, cpu, gpu, ram, storage, weight, screen,
        salePrice, origPrice, discount,
        _rawLines: clean, // giữ lại để debug nếu field nào bị sai/thiếu
      });
    }
    return out;
  }, 'https://phongvu.vn');

  console.log(`\n=== Extract v1: ${products.length} SP (link unique tìm được) ===`);
  console.log(JSON.stringify(products.slice(0, 8), null, 2));

  // 4) Thử bấm "Xem thêm sản phẩm" 1 lần — confirm cơ chế load-more
  const beforeLinks = await page.evaluate(() =>
    [...document.querySelectorAll('a[href]')].filter(a => /--s\d+/.test(a.getAttribute('href') || '')).length
  );
  const clicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('a,button,div,span')].find(el =>
      /xem\s*thêm\s*sản phẩm/i.test(el.textContent || '') &&
      (el.textContent || '').trim().length < 40 &&
      el.offsetParent !== null
    );
    if (btn) { btn.scrollIntoView({ block: 'center' }); btn.click(); return true; }
    return false;
  });
  console.log('\n🖱 Tìm & click nút "Xem thêm sản phẩm":', clicked);
  if (clicked) {
    await sleep(2500);
    const afterLinks = await page.evaluate(() =>
      [...document.querySelectorAll('a[href]')].filter(a => /--s\d+/.test(a.getAttribute('href') || '')).length
    );
    console.log(`   Link tag count trước: ${beforeLinks} → sau click: ${afterLinks} (tăng lên = load-more hoạt động đúng)`);
  } else {
    console.log('   ⚠ Không tìm thấy nút — có thể text khác "Xem thêm sản phẩm", hoặc cần cuộn xuống trước để nút vào viewport.');
  }

  await browser.close();
  console.log('\n✅ Xong. Paste TOÀN BỘ output này lại cho Claude.');
}

main().catch(e => { console.error('💥 FATAL:', e); process.exit(1); });
