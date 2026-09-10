/**
 * refresh-embedded-snapshot.js
 *
 * Van de: dashboard/index.html nhung san `const DATA = {...}` lam ban du phong
 * cho truong hop fetch('./data.csv') that bai. Snapshot nay duoc bake mot lan
 * hoi 11/06/2026 roi khong bao gio cap nhat: no chi co 3 dealer (MBW/FPT/CPS),
 * stats khong co key pv/apc nen badge in ra "undefined", va no hien gia thang 6
 * nhu the la gia hom nay - nguy hiem hon la khong hien gi.
 *
 * Cach lam: KHONG viet lai logic dung du lieu bang Node. ~80 dong mapping CSV ->
 * product object nam trong index.html va thay doi thuong xuyen; ban sao Node se
 * lech pha am tham. Thay vao do mo chinh trang do bang Puppeteer, de no tu fetch
 * data.csv va tu dung du lieu bang code cua no, roi lay ket qua ra ghi nguoc lai.
 * Snapshot vi vay LUON dung bang thu trang tu tinh - frontend doi thi no doi theo.
 *
 * Best-effort: loi thi thoat 0, khong lam do job chinh.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const DASH = path.join(__dirname, 'dashboard');
const HTML = path.join(DASH, 'index.html');
const PORT = 8911;
const TIMEOUT_MS = 120000;

const log = m => console.log('[snapshot] ' + m);

const MIME = { '.html':'text/html', '.csv':'text/csv', '.js':'text/javascript',
               '.css':'text/css', '.json':'application/json', '.png':'image/png' };

function serve(){
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
      const f = path.join(DASH, rel);
      if (!f.startsWith(DASH) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){
        res.writeHead(404); return res.end('not found');
      }
      res.writeHead(200, {'Content-Type': MIME[path.extname(f)] || 'application/octet-stream'});
      fs.createReadStream(f).pipe(res);
    });
    srv.listen(PORT, '127.0.0.1', () => resolve(srv));
  });
}

// Thay khoi `const DATA = {...};` bang can bang ngoac, khong dung regex
function replaceDataBlock(html, json){
  const marker = 'const DATA = ';
  const i = html.indexOf(marker);
  if (i < 0) throw new Error('khong tim thay `const DATA = ` trong index.html');
  const start = html.indexOf('{', i);
  let d = 0, inStr = false, esc = false, j = start;
  for (; j < html.length; j++){
    const ch = html[j];
    if (inStr){ if (esc){esc=false;continue;} if (ch==='\\'){esc=true;continue;} if (ch==='"') inStr=false; continue; }
    if (ch === '"'){ inStr = true; continue; }
    if (ch === '{') d++;
    else if (ch === '}'){ d--; if (!d){ j++; break; } }
  }
  if (d !== 0) throw new Error('khoi DATA khong can bang ngoac');
  return html.slice(0, start) + json + html.slice(j);
}

(async () => {
  let srv, browser;
  try {
    if (!fs.existsSync(path.join(DASH, 'data.csv'))) { log('khong co data.csv - bo qua'); return; }
    srv = await serve();
    log('server cuc bo :' + PORT);

    const puppeteer = require('puppeteer');
    browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-dev-shm-usage'] });
    const page = await browser.newPage();
    page.on('console', m => { const t = m.text(); if (/error|fail/i.test(t)) log('page: ' + t.slice(0,140)); });

    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle2', timeout: TIMEOUT_MS });

    // Cho trang nap xong data.csv va dung xong du lieu tuoi.
    await page.waitForFunction('window.__snapshot && window.__snapshot.stats', { timeout: TIMEOUT_MS });
    const snap = await page.evaluate('window.__snapshot');

    if (!snap || !snap.allToday || !snap.allToday.length) throw new Error('trang khong dung duoc du lieu');

    // Kiem tra truoc khi ghi: du 5 dealer va ngay phai la moi nhat trong data.csv
    const csvLast = fs.readFileSync(path.join(DASH,'data.csv'),'utf8')
      .split(/\r?\n/).slice(1).filter(Boolean)
      .map(l => l.split(',')[0].trim())
      .filter(s => /^\d{2}\/\d{2}\/\d{4}$/.test(s))
      .map(s => s.slice(6)+s.slice(3,5)+s.slice(0,2))
      .sort().pop();
    const snapKey = snap.todayDate.slice(6)+snap.todayDate.slice(3,5)+snap.todayDate.slice(0,2);
    if (snapKey !== csvLast) throw new Error(`ngay snapshot (${snap.todayDate}) khac ngay moi nhat trong data.csv`);

    const s = snap.stats;
    for (const k of ['mbw','fpt','cps','pv','apc'])
      if (s[k] === undefined) throw new Error('stats thieu key: ' + k);

    log(`ngay ${snap.todayDate} | ${snap.allToday.length} SKU | MBW ${s.mbw} FPT ${s.fpt} CPS ${s.cps} PV ${s.pv} APC ${s.apc}`);

    // CAT GON: snapshot day du (~2.4k SKU) lam index.html phinh tu 544KB len 2.1MB,
    // tra gia tren MOI lan mo trang cho mot ban du phong hiem khi dung den.
    // Giu lai phan re ma huu ich nhat khi data.csv hong:
    //   - stats + ngay  -> header va badge dung ngay
    //   - drops/rises   -> tab Top Price Changes con noi dung
    // Bo allToday: bang All SKUs hien trang thai rong cho toi khi data.csv ve.
    // Trang rong tot hon trang hien gia thang 6 nhu the la gia hom nay.
    const TOP_N = 40;
    const slim = {
      todayDate: snap.todayDate,
      prevDate:  snap.prevDate,
      allToday:  [],
      drops:     (snap.drops || []).slice(0, TOP_N),
      rises:     (snap.rises || []).slice(0, TOP_N),
      changes:   [...(snap.drops || []).slice(0, TOP_N), ...(snap.rises || []).slice(0, TOP_N)],
      stats:     snap.stats,
      _builtAt:  new Date().toISOString(),
      _note:     'Ban du phong rut gon - chi dung khi khong nap duoc data.csv',
    };

    const html = fs.readFileSync(HTML, 'utf8');
    const out = replaceDataBlock(html, JSON.stringify(slim));
    // sanity: file moi phai van con cac moc chinh
    for (const marker of ['</style>','<div class="badges">','window.__snapshot'])
      if (!out.includes(marker)) throw new Error('file ket qua thieu moc: ' + marker);
    fs.writeFileSync(HTML, out, 'utf8');
    log(`da ghi index.html (${(out.length/1024).toFixed(0)} KB, truoc ${(html.length/1024).toFixed(0)} KB)`);
  } catch (e) {
    log('BO QUA - ' + e.message);   // best-effort, khong lam do job chinh
  } finally {
    if (browser) try { await browser.close(); } catch(_){}
    if (srv) try { srv.close(); } catch(_){}
  }
})();
