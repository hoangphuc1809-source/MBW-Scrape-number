// Chẩn đoán: gọi Bright Data Web Unlocker fetch trang listing FPT, xem có
// lấy được HTML không, đếm số cardInfo (SP hiển thị sẵn không cần click "Xem
// thêm"), và tìm dấu hiệu JSON nhúng sẵn (__NEXT_DATA__ / __NUXT__ /
// __INITIAL_STATE__) — nếu có thì có thể lấy toàn bộ SP qua JSON thay vì
// phải giả lập click bằng browser thật (rẻ hơn nhiều so với Scraping Browser).
const fs = require('fs');

const API_KEY = process.env.BRIGHTDATA_API_KEY;
const ZONE = process.env.BRIGHTDATA_ZONE || 'fpt_scrape';
const TARGET_URL = 'https://fptshop.com.vn/may-tinh-xach-tay';

async function fetchViaBrightData(url) {
  const res = await fetch('https://api.brightdata.com/request', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ zone: ZONE, url, format: 'raw' }),
  });
  const status = res.status;
  const text = await res.text();
  return { status, text };
}

(async () => {
  if (!API_KEY) {
    console.log('❌ Thiếu BRIGHTDATA_API_KEY');
    process.exit(1);
  }

  console.log(`→ Gọi Bright Data Web Unlocker cho: ${TARGET_URL}`);
  const t0 = Date.now();
  let result;
  try {
    result = await fetchViaBrightData(TARGET_URL);
  } catch (e) {
    console.log(`❌ Lỗi request: ${e.message}`);
    process.exit(1);
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`← HTTP ${result.status} sau ${elapsed}s, độ dài: ${result.text.length} bytes`);

  fs.mkdirSync('scrape-output', { recursive: true });
  fs.writeFileSync('scrape-output/fpt_brightdata_raw.html', result.text);

  if (result.status !== 200) {
    console.log('❌ Status không phải 200 — xem file raw để biết lý do (rate limit? lỗi zone? bị chặn?)');
    console.log('   Đoạn đầu response:', result.text.slice(0, 500));
    process.exit(0);
  }

  const html = result.text;

  // Kiểm tra dấu hiệu bị chặn / challenge page
  const lower = html.toLowerCase();
  const blocked = /just a moment|checking your browser|cloudflare/i.test(html) && html.length < 5000;
  console.log(`Dấu hiệu bị chặn (challenge page nhỏ): ${blocked}`);

  // Đếm cardInfo
  const cardInfoCount = (html.match(/class="[^"]*cardInfo[^"]*"/g) || []).length;
  console.log(`Số lần xuất hiện class cardInfo: ${cardInfoCount}`);

  // Tìm JSON nhúng sẵn (Next.js / Nuxt / custom state)
  const patterns = [
    { name: '__NEXT_DATA__', re: /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/ },
    { name: '__NUXT__', re: /window\.__NUXT__\s*=\s*([\s\S]*?);?\s*<\/script>/ },
    { name: '__INITIAL_STATE__', re: /window\.__INITIAL_STATE__\s*=\s*([\s\S]*?);?\s*<\/script>/ },
    { name: 'application/json (any script)', re: /<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/ },
  ];
  for (const p of patterns) {
    const m = html.match(p.re);
    if (m) {
      console.log(`✅ Tìm thấy ${p.name}, độ dài JSON: ${m[1].length} bytes`);
      fs.writeFileSync(`scrape-output/fpt_${p.name.replace(/[^a-zA-Z0-9]/g, '_')}.json`, m[1]);
      // Thử đếm số object có vẻ là product (heuristic: có field "price" hoặc "sku" hoặc "slug")
      const productLike = (m[1].match(/"(price|sellPrice|sku|productSlug)"/g) || []).length;
      console.log(`   → số field giống product data: ${productLike}`);
    } else {
      console.log(`✗ Không thấy ${p.name}`);
    }
  }

  // Snippet đầu trang để mắt thường kiểm tra thêm
  console.log('\n--- Snippet 300 ký tự đầu <body> (nếu có) ---');
  const bodyMatch = html.match(/<body[^>]*>([\s\S]{0,300})/);
  if (bodyMatch) console.log(bodyMatch[1].replace(/\s+/g, ' '));

  console.log('\n✅ Xong. File raw HTML + JSON (nếu có) đã lưu vào scrape-output/ (xem artifact).');
})();
