// Backfill enrichment T→AE cho RAW DATA hien co (35.608 dong), va doi
// header A1:S1 sang tieng Anh. Dung 1 lan sau khi gan code enrich vao
// multi_dealer_scraper.js — cac lan scrape sau se tu enrich, khong can chay
// lai file nay (tru khi muon re-sync toan bo, vd sau khi Phuc cap nhat Part
// # voi nhieu Product Name moi).
const fs = require('fs');
const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const CREDS_PATH = '/tmp/gcreds-backfill.json';
const RAW_DATA_TAB = 'Daily SRP Tracking';
const PART_TAB = 'Part #';
const EXECUTE = process.env.EXECUTE === 'true';

const HEADERS_EN = [
  'Date', 'Time', 'No', 'Dealer', 'Model Name', 'Brand',
  'CPU (Listed)', 'RAM (Listed)', 'Storage', 'Screen Size', 'GPU (Listed)', 'Weight',
  'Original Price', 'Sale Price', 'Discount %', 'Units Sold', 'Rating', 'Product Link',
  'Availability',
];
const ENRICHMENT_HEADERS = [
  'Status', 'Series Group', 'Segment', 'CPU Segment', 'CPU', 'RAM', 'SSD',
  'Screen', 'GPU', 'V-RAM', 'Part #', 'Focus Model',
];

async function withRetry(fn, label, tries = 3) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try { return await fn(); }
    catch (err) {
      lastErr = err;
      console.log(`   ⚠ ${label} lần ${i}/${tries} lỗi: ${err.message}`);
      if (i < tries) await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw lastErr;
}

function safeVal(v) {
  if (typeof v === 'string' && v.startsWith('=')) return '';
  return v ?? '';
}

async function readAllRows(sheets, tabName, totalRows, lastCol) {
  const CHUNK = 5000;
  const out = [];
  for (let start = 2; start <= totalRows; start += CHUNK) {
    const end = Math.min(start + CHUNK - 1, totalRows);
    const res = await withRetry(
      () => sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${tabName}'!A${start}:${lastCol}${end}`,
        valueRenderOption: 'FORMULA',
      }, { timeout: 60000 }),
      `Đọc ${tabName} ${start}-${end}`
    );
    const rows = res.data.values || [];
    for (const r of rows) if (r.some((c) => c !== '' && c !== undefined && c !== null)) out.push(r);
    console.log(`   đọc ${tabName} ${start}-${end}: ${rows.length} dòng thô`);
  }
  return out;
}

(async () => {
  console.log(`=== Backfill enrichment T→AE cho RAW DATA — ${EXECUTE ? 'THỰC THI' : 'DRY RUN'} ===`);
  fs.writeFileSync(CREDS_PATH, process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({ keyFile: CREDS_PATH, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = google.sheets({ version: 'v4', auth });

  // 1. Doc Part # (A:T) xay map tra cuu
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets(properties(title,gridProperties))' });
  const partSheet = meta.data.sheets.find((s) => s.properties.title === PART_TAB);
  const partTotalRows = partSheet.properties.gridProperties.rowCount;
  console.log(`Tab "${PART_TAB}": grid rowCount=${partTotalRows}`);
  const partRows = await readAllRows(sheets, PART_TAB, partTotalRows, 'T');
  const partMap = new Map();
  for (const r of partRows) {
    const name = (r[0] || '').trim();
    if (!name) continue;
    partMap.set(name, {
      status: safeVal(r[10]), seriesGroup: safeVal(r[11]), segment: safeVal(r[12]),
      cpuSegment: safeVal(r[3]), cpu: safeVal(r[4]), ram: safeVal(r[5]), ssd: safeVal(r[6]),
      screen: safeVal(r[7]), gpu: safeVal(r[8]), vram: safeVal(r[9]), partNumber: safeVal(r[2]),
      focusModel: safeVal(r[19]),
    });
  }
  console.log(`→ Map tra cứu có ${partMap.size} Product Name`);

  // 2. Doc RAW DATA (can cot E = Model Name)
  const rawSheet = meta.data.sheets.find((s) => s.properties.title === RAW_DATA_TAB);
  const rawTotalRows = rawSheet.properties.gridProperties.rowCount;
  console.log(`Tab "${RAW_DATA_TAB}": grid rowCount=${rawTotalRows}`);
  const rawRows = await readAllRows(sheets, RAW_DATA_TAB, rawTotalRows, 'S');
  console.log(`→ ${rawRows.length} dòng có dữ liệu thật trong RAW DATA`);

  // 3. Tinh enrichment cho tung dong
  let matched = 0, unmatched = 0;
  const enrichRows = rawRows.map((row) => {
    const modelName = (row[4] || '').trim();
    const info = partMap.get(modelName);
    if (!info) { unmatched++; return ['', '', '', '', '', '', '', '', '', '', '', '']; }
    matched++;
    return [info.status, info.seriesGroup, info.segment, info.cpuSegment, info.cpu,
      info.ram, info.ssd, info.screen, info.gpu, info.vram, info.partNumber, info.focusModel];
  });

  console.log(`\n=== KẾT QUẢ ===`);
  console.log(`Khớp được với Part #: ${matched}/${rawRows.length}`);
  console.log(`Không khớp (để trống): ${unmatched}/${rawRows.length}`);
  console.log(`5 dòng mẫu đầu:`, JSON.stringify(enrichRows.slice(0, 5)));

  if (!EXECUTE) {
    console.log('\n>>> DRY RUN — chưa ghi gì cả. Nếu số liệu ổn, chạy lại với EXECUTE=true.');
    return;
  }

  console.log('\nĐang đổi header A1:S1 sang tiếng Anh...');
  await withRetry(() => sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID, range: `'${RAW_DATA_TAB}'!A1:S1`,
    valueInputOption: 'RAW', requestBody: { values: [HEADERS_EN] },
  }, { timeout: 60000 }), 'Cập nhật header A1:S1');

  console.log('Đang ghi header enrichment T1:AE1...');
  await withRetry(() => sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID, range: `'${RAW_DATA_TAB}'!T1:AE1`,
    valueInputOption: 'RAW', requestBody: { values: [ENRICHMENT_HEADERS] },
  }, { timeout: 60000 }), 'Cập nhật header T1:AE1');

  console.log(`Đang ghi dữ liệu enrichment (${enrichRows.length} dòng)...`);
  const CHUNK = 5000;
  for (let i = 0; i < enrichRows.length; i += CHUNK) {
    const chunk = enrichRows.slice(i, i + CHUNK);
    await withRetry(() => sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID, range: `'${RAW_DATA_TAB}'!T${2 + i}`,
      valueInputOption: 'RAW', requestBody: { values: chunk },
    }, { timeout: 60000 }), `Ghi lô ${i}`);
    console.log(`   ✓ Đã ghi lô ${i}-${i + chunk.length}`);
  }

  console.log('\n✅ HOÀN TẤT. Header đã đổi tiếng Anh, cột T→AE đã điền xong.');
})().catch((e) => {
  console.log(`💥 LỖI: ${e.stack || e}`);
  process.exitCode = 1;
});
