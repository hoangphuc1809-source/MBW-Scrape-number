/**
 * enrich-and-export.js
 *
 * 03/08/2026: Thay thế hoàn toàn luồng "Dailly SRP Tracking" (QUERY + 5 MAP
 * formula sống, đang bị nghẽn — mọi thao tác đọc UNFORMATTED_VALUE trên
 * spreadsheet này đều timeout, kể cả RAW DATA). Script này:
 *
 *   1. Đọc data VỪA SCRAPE từ artifact JSON (không qua Sheets — giống 1:1
 *      logic runCombineMode() trong multi_dealer_scraper.js).
 *   2. Đọc Part# / Segment / Key Focus model qua Sheets API bằng
 *      valueRenderOption='FORMULA' — KHÔNG kích hoạt tính toán nên luôn
 *      nhanh, dù bên trong có formula nặng hay không (đã xác nhận qua
 *      diagnose-sheet.js chạy ổn định nhiều lần).
 *   3. Tự tính enrichment (Vendor/SeriesGroup/Segment/CPUSegment/Part#/
 *      Focus Model) bằng JS, port lại 1:1 logic từ các formula gốc:
 *        - Part#!K = 'EOL'  → loại khỏi kết quả (= WHERE V<>'EOL' cũ)
 *        - Segment (Part#!M): nếu ô đó vẫn là formula sống → tự đoán bằng
 *          cách tìm tên Segment!C dài nhất xuất hiện trong tên SP (thay
 *          cho BYROW+REGEXMATCH+SORT+LEN). Nếu Phuc đã ghi đè tay (không
 *          phải formula) → dùng nguyên giá trị đó.
 *        - Series Group (Part#!L): map Segment → Segment!D (exact match),
 *          hoặc dùng giá trị ghi đè tay nếu có.
 *        - Focus Model: map Part# → Key Focus model!D, default 'No'.
 *   4. Ghi thẳng ra dashboard/data.csv (rolling ~35 ngày), KHÔNG ghi lại
 *      vào Google Sheets — dashboard đọc file này trực tiếp.
 *
 * Best-effort: lỗi ở đâu thì log ra dashboard/.enrich-debug.log và dừng,
 * không đụng data.csv cũ, không làm fail job chính.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const CREDS_PATH = path.join(os.tmpdir(), 'enrich-gcreds.json');
const ARTIFACT_DIR = process.env.COMBINE_INPUT_DIR || './scrape-artifacts';
const DATA_CSV_PATH = path.join(__dirname, 'dashboard', 'data.csv');
const DEBUG_LOG_PATH = path.join(__dirname, 'dashboard', '.enrich-debug.log');
const REQ_TIMEOUT_MS = 25000;
const MAX_HISTORY_DAYS = 35; // dashboard chỉ cần tối đa 30 ngày, dư 5 ngày

function debugLog(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(DEBUG_LOG_PATH, line); } catch (_) {}
  console.log(msg);
}

function formatDate(d) {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}
function formatTime(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function csvEscape(v) {
  const s = (v === null || v === undefined) ? '' : String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function isFormula(cell) {
  return typeof cell === 'string' && cell.trim().startsWith('=');
}
function parseDMY(s) {
  const [d, m, y] = String(s).split('/').map(Number);
  return new Date(y, m - 1, d).getTime();
}

// CSV parser đơn giản (RFC4180 cơ bản, có quote) — đủ dùng cho file
// data.csv do chính mình sinh ra.
function parseCsvSimple(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 1 || r[0] !== '');
}

function listJsonFilesRecursive(dir) {
  let results = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (e) { debugLog(`⚠ Không đọc được ${dir}: ${e.message}`); return results; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results = results.concat(listJsonFilesRecursive(full));
    else if (entry.name.endsWith('.json')) results.push(full);
  }
  return results;
}

async function readTabFormula(sheets, tabName, lastCol) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${tabName}'!A1:${lastCol}`,
    valueRenderOption: 'FORMULA',
  }, { timeout: REQ_TIMEOUT_MS });
  return res.data.values || [];
}

async function main() {
  try { fs.writeFileSync(DEBUG_LOG_PATH, ''); } catch (_) {}
  debugLog('--- Bắt đầu enrich-and-export.js ---');

  // 1) Đọc data vừa scrape từ artifact
  const files = listJsonFilesRecursive(ARTIFACT_DIR);
  let allProducts = [];
  for (const f of files) {
    try {
      const arr = JSON.parse(fs.readFileSync(f, 'utf8'));
      allProducts = allProducts.concat(arr);
    } catch (e) {
      debugLog(`⚠ Lỗi đọc ${f}: ${e.message}`);
    }
  }
  debugLog(`Đọc được ${allProducts.length} SP từ ${files.length} file artifact (${ARTIFACT_DIR})`);
  if (allProducts.length === 0) {
    debugLog('⚠ 0 SP — bỏ qua, giữ data.csv cũ.');
    return;
  }

  if (!SPREADSHEET_ID || !process.env.GOOGLE_CREDENTIALS) {
    debugLog('⚠ Thiếu SPREADSHEET_ID/GOOGLE_CREDENTIALS — bỏ qua.');
    return;
  }

  fs.writeFileSync(CREDS_PATH, process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({
    keyFile: CREDS_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  debugLog('Đọc Part # (FORMULA render)...');
  const partRows = await readTabFormula(sheets, 'Part #', 'S');
  debugLog(`  ${Math.max(0, partRows.length - 1)} dòng`);

  debugLog('Đọc Segment (FORMULA render)...');
  const segmentRows = await readTabFormula(sheets, 'Segment', 'D');
  debugLog(`  ${Math.max(0, segmentRows.length - 1)} dòng`);

  debugLog('Đọc Key Focus model (FORMULA render)...');
  const focusRows = await readTabFormula(sheets, 'Key Focus model', 'D');
  debugLog(`  ${Math.max(0, focusRows.length - 1)} dòng`);

  fs.unlinkSync(CREDS_PATH);

  // 2) Segment!C (tên dòng SP) -> Series Group
  const segmentTable = [];
  for (let i = 1; i < segmentRows.length; i++) {
    const r = segmentRows[i];
    const segName = r[2];
    if (segName && !isFormula(segName)) segmentTable.push({ segment: String(segName), seriesGroup: r[3] || '' });
  }
  const segmentExactMap = new Map(segmentTable.map(s => [s.segment.toLowerCase(), s]));
  function guessSegment(productName) {
    if (!productName) return null;
    const lower = String(productName).toLowerCase();
    let best = null;
    for (const s of segmentTable) {
      if (lower.includes(s.segment.toLowerCase())) {
        if (!best || s.segment.length > best.segment.length) best = s;
      }
    }
    return best;
  }

  // 3) Part#!A (tên SP) -> spec đầy đủ
  const partMap = new Map();
  for (let i = 1; i < partRows.length; i++) {
    const r = partRows[i];
    const name = r[0];
    if (!name) continue;
    const status = r[10] || '';
    const lRaw = r[11], mRaw = r[12];

    let segment;
    if (mRaw && !isFormula(mRaw)) segment = String(mRaw);
    else segment = (guessSegment(name) || {}).segment || '';

    let seriesGroup;
    if (lRaw && !isFormula(lRaw)) seriesGroup = String(lRaw);
    else {
      const exact = segmentExactMap.get(String(segment).toLowerCase());
      seriesGroup = exact ? exact.seriesGroup : '';
    }

    partMap.set(String(name), {
      vendor: r[1] || '', partNumber: r[2] || '', cpuSegment: r[3] || '',
      cpu: r[4] || '', ram: r[5] || '', ssd: r[6] || '', screen: r[7] || '',
      gpu: r[8] || '', vram: r[9] || '', status: String(status).trim(),
      seriesGroup, segment,
    });
  }
  debugLog(`Part# map: ${partMap.size} SKU`);

  // 4) Key Focus model!B (Part#) -> D (Focus Model)
  const focusMap = new Map();
  for (let i = 1; i < focusRows.length; i++) {
    const r = focusRows[i];
    const partNo = r[1], focus = r[3];
    if (partNo && !isFormula(focus)) focusMap.set(String(partNo), String(focus || 'No'));
  }
  debugLog(`Focus model map: ${focusMap.size} Part#`);

  // 5) Tính enrichment, loại EOL
  const today = new Date();
  const dateStr = formatDate(today);
  const timeStr = formatTime(today);
  const HEADER = ['Date', 'Hour', 'Dealers', 'SKU', 'SRP', 'Promotion Price', 'Change', 'Sold', 'Rate', 'Vendor', 'Series Group', 'Segment', 'CPU Segment', 'CPU', 'RAM', 'SSD', 'Screen', 'GPU', 'V-RAM', 'Weight', 'Products link', 'Part #', 'Focus Model', 'Status'];

  let skippedEOL = 0;
  const newRows = [];
  for (const p of allProducts) {
    const info = partMap.get(p.name);
    if (info && info.status === 'EOL') { skippedEOL++; continue; }

    const partNumber = (info && info.partNumber) || '';
    newRows.push([
      dateStr, timeStr, p.dealer, p.name,
      p.origPrice || '', p.salePrice || '', p.discount || '',
      p.sold || '', p.rating || '',
      (info && info.vendor) || p.brand || '',
      (info && info.seriesGroup) || '',
      (info && info.segment) || '',
      (info && info.cpuSegment) || '',
      (info && info.cpu) || p.cpu || '',
      (info && info.ram) || p.ram || '',
      (info && info.ssd) || p.storage || '',
      (info && info.screen) || p.screen || '',
      (info && info.gpu) || p.gpu || '',
      (info && info.vram) || '',
      p.weight || '',
      p.link || '',
      partNumber,
      focusMap.get(partNumber) || 'No',
      p.stockStatus || '',
    ]);
  }
  debugLog(`Tính xong ${newRows.length} dòng enriched (loại ${skippedEOL} SP EOL)`);

  // 6) Gộp vào data.csv hiện có, bỏ dòng cũ của HÔM NAY (tránh trùng nếu
  //    chạy lại), cắt còn tối đa MAX_HISTORY_DAYS ngày gần nhất.
  let existingRows = [];
  if (fs.existsSync(DATA_CSV_PATH)) {
    const raw = fs.readFileSync(DATA_CSV_PATH, 'utf8');
    const parsed = parseCsvSimple(raw);
    existingRows = parsed.slice(1).filter(r => r[0] !== dateStr);
    debugLog(`data.csv cũ: ${parsed.length - 1} dòng, giữ lại ${existingRows.length} dòng (loại dòng ${dateStr} nếu có, sẽ thêm bản mới)`);
  } else {
    debugLog('Chưa có data.csv — tạo mới.');
  }

  let allRows = existingRows.concat(newRows);
  const uniqueDates = [...new Set(allRows.map(r => r[0]))];
  uniqueDates.sort((a, b) => parseDMY(a) - parseDMY(b));
  if (uniqueDates.length > MAX_HISTORY_DAYS) {
    const keepDates = new Set(uniqueDates.slice(-MAX_HISTORY_DAYS));
    allRows = allRows.filter(r => keepDates.has(r[0]));
    debugLog(`Cắt còn ${MAX_HISTORY_DAYS} ngày gần nhất (${allRows.length} dòng)`);
  }

  const csv = [HEADER, ...allRows].map(row => row.map(csvEscape).join(',')).join('\n') + '\n';
  fs.mkdirSync(path.dirname(DATA_CSV_PATH), { recursive: true });
  fs.writeFileSync(DATA_CSV_PATH, csv, 'utf8');
  debugLog(`✅ Đã ghi ${DATA_CSV_PATH} — ${allRows.length + 1} dòng (kể cả header), ${(csv.length / 1024).toFixed(0)} KB`);
}

main().catch(err => {
  debugLog(`💥 Lỗi: ${err && err.stack ? err.stack : String(err)}`);
  process.exitCode = 0;
});
