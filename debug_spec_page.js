// Debug: dung Web Unlocker (re, con free tier) de xem raw HTML 1 trang chi
// tiet SP FPT, kiem tra xem bang thong so co san san trong DOM (chi an bang
// CSS) hay phai load qua AJAX sau khi click - quyet dinh cach fix
// fetchSpecsFPT ma khong ton budget Browser API.
const fs = require('fs');
const API_KEY = process.env.BRIGHTDATA_API_KEY;
const ZONE = process.env.BRIGHTDATA_ZONE || 'fpt_scrape';
const URL = 'https://fptshop.com.vn/may-tinh-xach-tay/acer-aspire-go-14-ag14-72p-563l-core-5-120u';

(async () => {
  const res = await fetch('https://api.brightdata.com/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
    body: JSON.stringify({ zone: ZONE, url: URL, format: 'raw' }),
  });
  const text = await res.text();
  fs.mkdirSync('scrape-output', { recursive: true });
  fs.writeFileSync('scrape-output/detail_raw.html', text);
  const log = [];
  log.push(`status=${res.status} len=${text.length}`);
  log.push(`"Xem tất cả thông số" xuat hien: ${(text.match(/Xem tất cả thông số/g)||[]).length} lan`);
  log.push(`"Xem tất cả" (khong dau cham) xuat hien: ${(text.match(/Xem tất cả/g)||[]).length} lan`);
  log.push(`class flex gap-2 border-b: ${(text.match(/flex gap-2 border-b/g)||[]).length} lan`);
  log.push(`class "border-b" bat ky: ${(text.match(/class="[^"]*border-b[^"]*"/g)||[]).length} lan`);
  // Tim cac tu khoa lien quan thong so ky thuat
  ['Công nghệ CPU','Loại CPU','Dung lượng RAM','Kiểu ổ cứng','THÔNG SỐ KỸ THUẬT','Thông số kỹ thuật','Cấu hình'].forEach(kw => {
    log.push(`"${kw}": ${(text.match(new RegExp(kw,'g'))||[]).length} lan`);
  });
  fs.writeFileSync('scrape-output/detail_debug.txt', log.join('\n'));
  console.log(log.join('\n'));
})();
