// Archive RAW DATA an toan: chi giu N ngay gan nhat trong RAW DATA (tab
// production dang doc/viet), don phan cu hon sang RAW DATA ARCHIVE.
//
// NGUYEN TAC AN TOAN (do truoc day co Apps Script archive bi loi tu xoa
// data, da bi xoa bo):
//   1. KHONG BAO GIO xoa/ghi de RAW DATA truoc khi da ghi + xac nhan thanh
//      cong vao RAW DATA ARCHIVE.
//   2. Mac dinh chi chay DRY RUN (chi bao cao so lieu se archive, KHONG
//      ghi/xoa gi ca). Phai dat EXECUTE=true moi thuc su chay.
//   3. Sau khi ghi archive xong, DOC LAI RAW DATA ARCHIVE de xac nhan so
//      dong tang dung nhu ky vong, moi tiep tuc buoc trim RAW DATA.
const fs = require('fs');
const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const CREDS_PATH = '/tmp/gcreds-archive.json';
const RAW_DATA_TAB = 'RAW DATA';
const ARCHIVE_TAB = 'RAW DATA ARCHIVE';
const DAYS_TO_KEEP = parseInt(process.env.ARCHIVE_DAYS_TO_KEEP || '45', 10);
const EXECUTE = process.env.EXECUTE === 'true';

function parseVNDate(s) {
  // format "DD/MM/YYYY"
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((s || '').trim());
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

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

async function readAllRows(sheets, tabName, totalRows, lastCol = 'S') {
  // Chi doc toi cot S (data thuan tu scraper) — bo qua T/U/V la cac cot
  // note/formula rieng (T=version, U=health note, V=MAP formula nang) de
  // tranh timeout. Du lieu can cho archive la A (ngay) + cac cot data goc.
  const CHUNK = 2000;
  const out = [];
  for (let start = 2; start <= totalRows; start += CHUNK) {
    const end = Math.min(start + CHUNK - 1, totalRows);
    const res = await withRetry(
      () => sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${tabName}'!A${start}:${lastCol}${end}`,
        valueRenderOption: 'UNFORMATTED_VALUE',
        dateTimeRenderOption: 'FORMATTED_STRING',
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
  console.log(`=== Archive RAW DATA — ${EXECUTE ? 'THỰC THI' : 'DRY RUN (chỉ xem, không sửa gì)'} — giữ ${DAYS_TO_KEEP} ngày gần nhất ===`);
  fs.writeFileSync(CREDS_PATH, process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({ keyFile: CREDS_PATH, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = google.sheets({ version: 'v4', auth });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets(properties(title,sheetId,gridProperties))' });
  const rawSheet = meta.data.sheets.find((s) => s.properties.title === RAW_DATA_TAB);
  const archiveSheet = meta.data.sheets.find((s) => s.properties.title === ARCHIVE_TAB);
  if (!rawSheet) throw new Error(`Không tìm thấy tab "${RAW_DATA_TAB}"`);
  if (!archiveSheet) throw new Error(`Không tìm thấy tab "${ARCHIVE_TAB}"`);

  const totalRows = rawSheet.properties.gridProperties.rowCount;
  console.log(`Tab "${RAW_DATA_TAB}": grid rowCount=${totalRows}`);

  const header = (await withRetry(
    () => sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${RAW_DATA_TAB}'!A1:S1` }, { timeout: 60000 }),
    'Đọc header'
  )).data.values[0];
  console.log('Header:', JSON.stringify(header));

  console.log('Đang đọc toàn bộ RAW DATA...');
  const allRows = await readAllRows(sheets, RAW_DATA_TAB, totalRows);
  console.log(`Tổng ${allRows.length} dòng có dữ liệu thật`);

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - DAYS_TO_KEEP);
  console.log(`Ngưỡng archive: giữ mọi dòng có Ngày >= ${cutoff.toLocaleDateString('vi-VN')}`);

  const toKeep = [];
  const toArchive = [];
  let unparsable = 0;
  for (const r of allRows) {
    const d = parseVNDate(r[0]);
    if (!d) { unparsable++; toKeep.push(r); continue; } // an toàn: không parse được ngày -> giữ lại, không archive
    if (d >= cutoff) toKeep.push(r); else toArchive.push(r);
  }

  console.log(`\n=== KẾT QUẢ ===`);
  console.log(`Sẽ GIỮ trong RAW DATA: ${toKeep.length} dòng`);
  console.log(`Sẽ CHUYỂN sang RAW DATA ARCHIVE: ${toArchive.length} dòng`);
  console.log(`Số dòng không parse được ngày (giữ lại để an toàn): ${unparsable}`);
  if (toArchive.length > 0) {
    const dates = toArchive.map((r) => r[0]).filter(Boolean);
    console.log(`Khoảng ngày sẽ archive: ${dates[0]} → ${dates[dates.length - 1]}`);
  }

  if (!EXECUTE) {
    console.log('\n>>> DRY RUN — chưa ghi/xoá gì cả. Xem số liệu trên, nếu ổn thì chạy lại với EXECUTE=true để thực thi thật.');
    return;
  }

  if (toArchive.length === 0) {
    console.log('Không có gì để archive — dừng.');
    return;
  }

  // BƯỚC 1: Ghi phần archive vào RAW DATA ARCHIVE (APPEND, không đụng gì cũ)
  const archiveMeta = await withRetry(
    () => sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${ARCHIVE_TAB}'!A:A` }, { timeout: 60000 }),
    'Đọc RAW DATA ARCHIVE (trước ghi)'
  );
  const archiveRowsBefore = (archiveMeta.data.values || []).length;
  console.log(`\nSố dòng hiện có trong ${ARCHIVE_TAB} trước khi ghi: ${archiveRowsBefore}`);

  const appendStartRow = archiveRowsBefore + 1;
  const CHUNK = 5000;
  for (let i = 0; i < toArchive.length; i += CHUNK) {
    const chunk = toArchive.slice(i, i + CHUNK);
    await withRetry(
      () => sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${ARCHIVE_TAB}'!A${appendStartRow + i}`,
        valueInputOption: 'RAW',
        requestBody: { values: chunk },
      }, { timeout: 60000 }),
      `Ghi archive lô ${i}`
    );
    console.log(`   ✓ Đã ghi archive lô ${i}-${i + chunk.length}`);
  }

  // BƯỚC 2: XÁC NHẬN ghi archive thành công trước khi đụng RAW DATA
  const archiveMetaAfter = await withRetry(
    () => sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${ARCHIVE_TAB}'!A:A` }, { timeout: 60000 }),
    'Đọc RAW DATA ARCHIVE (sau ghi, xác nhận)'
  );
  const archiveRowsAfter = (archiveMetaAfter.data.values || []).length;
  const expectedAfter = archiveRowsBefore + toArchive.length;
  console.log(`Số dòng trong ${ARCHIVE_TAB} sau khi ghi: ${archiveRowsAfter} (kỳ vọng ${expectedAfter})`);

  if (archiveRowsAfter < expectedAfter) {
    console.log('❌ XÁC NHẬN THẤT BẠI — số dòng archive không khớp kỳ vọng. DỪNG NGAY, KHÔNG đụng RAW DATA để tránh mất dữ liệu.');
    process.exitCode = 1;
    return;
  }
  console.log('✅ Xác nhận archive thành công.');

  // BƯỚC 3: Chỉ bây giờ mới trim RAW DATA — giữ header + toKeep
  console.log(`\nĐang ghi lại ${RAW_DATA_TAB} chỉ với ${toKeep.length} dòng gần đây (chỉ cột A:S — không đụng cột T/U/V là note/formula)...`);
  await withRetry(
    () => sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range: `'${RAW_DATA_TAB}'!A2:S` }, { timeout: 60000 }),
    'Clear RAW DATA'
  );
  for (let i = 0; i < toKeep.length; i += CHUNK) {
    const chunk = toKeep.slice(i, i + CHUNK);
    await withRetry(
      () => sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${RAW_DATA_TAB}'!A${2 + i}`,
        valueInputOption: 'RAW',
        requestBody: { values: chunk },
      }, { timeout: 60000 }),
      `Ghi lại RAW DATA lô ${i}`
    );
    console.log(`   ✓ Đã ghi lại RAW DATA lô ${i}-${i + chunk.length}`);
  }
  console.log(`\n✅ HOÀN TẤT. RAW DATA giờ còn ${toKeep.length} dòng (từ ${totalRows} ban đầu), đã archive ${toArchive.length} dòng.`);
})().catch((e) => {
  console.log(`💥 LỖI: ${e.stack || e}`);
  process.exitCode = 1;
});
