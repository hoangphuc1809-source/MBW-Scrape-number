// Archive RAW DATA theo mo hinh CUA SO TRUOT CO DINH:
//   - RAW DATA: chi giu N1 ngay gan nhat (mac dinh 15)
//   - RAW DATA ARCHIVE: chi giu N2 ngay tiep theo (mac dinh 15, tuc ngay
//     16-30 tinh tu hom nay)
//   - Bat cu thu gi CU HON N1+N2 ngay (mac dinh >30 ngay): XOA VINH VIEN,
//     khong giu o dau ca.
//
// Dung de RAW DATA va RAW DATA ARCHIVE luon nho + on dinh, tranh tai dien su
// co cong thuc/API bi nghen do sheet phinh to khong kiem soat.
//
// NGUYEN TAC AN TOAN (do truoc day co Apps Script archive bi loi tu xoa
// data, da bi xoa bo):
//   1. Doc ca RAW DATA va RAW DATA ARCHIVE, TINH TOAN truoc, KHONG ghi/xoa
//      gi cho den khi EXECUTE=true.
//   2. Ghi RAW DATA ARCHIVE (noi dung moi, da tinh toan) TRUOC, XAC NHAN
//      ghi dung so dong ky vong, moi duoc dong vao RAW DATA.
//   3. Mac dinh DRY RUN — chi bao cao, khong sua gi.
const fs = require('fs');
const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const CREDS_PATH = '/tmp/gcreds-archive.json';
const RAW_DATA_TAB = 'RAW DATA';
const ARCHIVE_TAB = 'RAW DATA ARCHIVE';
const RAW_DATA_KEEP_DAYS = parseInt(process.env.RAW_DATA_KEEP_DAYS || '15', 10);
const ARCHIVE_KEEP_DAYS = parseInt(process.env.ARCHIVE_KEEP_DAYS || '15', 10);
const TOTAL_KEEP_DAYS = RAW_DATA_KEEP_DAYS + ARCHIVE_KEEP_DAYS;
const EXECUTE = process.env.EXECUTE === 'true';

function parseVNDate(s) {
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
  const CHUNK = 5000;
  const out = [];
  for (let start = 2; start <= totalRows; start += CHUNK) {
    const end = Math.min(start + CHUNK - 1, totalRows);
    const res = await withRetry(
      () => sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${tabName}'!A${start}:${lastCol}${end}`,
        valueRenderOption: 'FORMULA',
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

async function writeFullReplace(sheets, tabName, rows) {
  await withRetry(
    () => sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range: `'${tabName}'!A2:S` }, { timeout: 60000 }),
    `Clear ${tabName}`
  );
  const CHUNK = 5000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await withRetry(
      () => sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${tabName}'!A${2 + i}`,
        valueInputOption: 'RAW',
        requestBody: { values: chunk },
      }, { timeout: 60000 }),
      `Ghi ${tabName} lô ${i}`
    );
    console.log(`   ✓ Đã ghi ${tabName} lô ${i}-${i + chunk.length}`);
  }
}

(async () => {
  console.log(`=== Archive RAW DATA (cửa sổ trượt) — ${EXECUTE ? 'THỰC THI' : 'DRY RUN'} ===`);
  console.log(`RAW DATA giữ ${RAW_DATA_KEEP_DAYS} ngày, RAW DATA ARCHIVE giữ thêm ${ARCHIVE_KEEP_DAYS} ngày (tổng ${TOTAL_KEEP_DAYS} ngày). Cũ hơn ${TOTAL_KEEP_DAYS} ngày → XOÁ VĨNH VIỄN.`);

  fs.writeFileSync(CREDS_PATH, process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({ keyFile: CREDS_PATH, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = google.sheets({ version: 'v4', auth });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets(properties(title,sheetId,gridProperties))' });
  const rawSheet = meta.data.sheets.find((s) => s.properties.title === RAW_DATA_TAB);
  const archiveSheet = meta.data.sheets.find((s) => s.properties.title === ARCHIVE_TAB);
  if (!rawSheet) throw new Error(`Không tìm thấy tab "${RAW_DATA_TAB}"`);
  if (!archiveSheet) throw new Error(`Không tìm thấy tab "${ARCHIVE_TAB}"`);

  const rawTotalRows = rawSheet.properties.gridProperties.rowCount;
  const archiveTotalRows = archiveSheet.properties.gridProperties.rowCount;
  console.log(`Tab "${RAW_DATA_TAB}": grid rowCount=${rawTotalRows}`);
  console.log(`Tab "${ARCHIVE_TAB}": grid rowCount=${archiveTotalRows}`);

  console.log('\nĐang đọc RAW DATA...');
  const rawRows = await readAllRows(sheets, RAW_DATA_TAB, rawTotalRows);
  console.log(`→ ${rawRows.length} dòng có dữ liệu thật trong RAW DATA`);

  console.log('\nĐang đọc RAW DATA ARCHIVE...');
  const archiveRows = archiveTotalRows > 1 ? await readAllRows(sheets, ARCHIVE_TAB, archiveTotalRows) : [];
  console.log(`→ ${archiveRows.length} dòng có dữ liệu thật trong RAW DATA ARCHIVE`);

  const now = new Date();
  const cutoffRawData = new Date(now); cutoffRawData.setDate(now.getDate() - RAW_DATA_KEEP_DAYS);
  const cutoffTotal = new Date(now); cutoffTotal.setDate(now.getDate() - TOTAL_KEEP_DAYS);
  console.log(`\nNgưỡng RAW DATA (giữ nếu Ngày >=): ${cutoffRawData.toLocaleDateString('vi-VN')}`);
  console.log(`Ngưỡng tổng (xoá vĩnh viễn nếu Ngày <): ${cutoffTotal.toLocaleDateString('vi-VN')}`);

  const allRows = [...rawRows, ...archiveRows];
  const newRawData = [];
  const newArchive = [];
  let toDelete = 0;
  let unparsable = 0;
  for (const r of allRows) {
    const d = parseVNDate(r[0]);
    if (!d) { unparsable++; newRawData.push(r); continue; }
    if (d >= cutoffRawData) newRawData.push(r);
    else if (d >= cutoffTotal) newArchive.push(r);
    else toDelete++;
  }

  console.log(`\n=== KẾT QUẢ ===`);
  console.log(`RAW DATA (giữ ${RAW_DATA_KEEP_DAYS} ngày): ${newRawData.length} dòng`);
  console.log(`RAW DATA ARCHIVE (giữ thêm ${ARCHIVE_KEEP_DAYS} ngày): ${newArchive.length} dòng`);
  console.log(`XOÁ VĨNH VIỄN (cũ hơn ${TOTAL_KEEP_DAYS} ngày): ${toDelete} dòng`);
  console.log(`Không parse được ngày (giữ lại trong RAW DATA để an toàn): ${unparsable}`);

  if (!EXECUTE) {
    console.log('\n>>> DRY RUN — chưa ghi/xoá gì cả. Xem số liệu trên, nếu ổn thì chạy lại với EXECUTE=true.');
    return;
  }

  if (toDelete === 0 && archiveRows.length === newArchive.length && rawRows.length === newRawData.length) {
    console.log('\nKhông có gì thay đổi — dừng, không ghi lại.');
    return;
  }

  console.log(`\nĐang ghi lại ${ARCHIVE_TAB} (${newArchive.length} dòng)...`);
  await writeFullReplace(sheets, ARCHIVE_TAB, newArchive);

  const verifyArchive = await withRetry(
    () => sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${ARCHIVE_TAB}'!A2:A`, valueRenderOption: 'FORMULA' }, { timeout: 60000 }),
    `Xác nhận ${ARCHIVE_TAB}`
  );
  const verifyCount = (verifyArchive.data.values || []).filter((r) => r[0]).length;
  console.log(`Xác nhận: ${ARCHIVE_TAB} hiện có ${verifyCount} dòng (kỳ vọng ${newArchive.length})`);
  if (verifyCount < newArchive.length) {
    console.log('❌ XÁC NHẬN THẤT BẠI — dừng ngay, KHÔNG đụng RAW DATA để tránh mất dữ liệu.');
    process.exitCode = 1;
    return;
  }
  console.log('✅ Xác nhận RAW DATA ARCHIVE thành công.');

  console.log(`\nĐang ghi lại ${RAW_DATA_TAB} (${newRawData.length} dòng)...`);
  await writeFullReplace(sheets, RAW_DATA_TAB, newRawData);

  console.log(`\n✅ HOÀN TẤT. RAW DATA: ${newRawData.length} dòng. RAW DATA ARCHIVE: ${newArchive.length} dòng. Đã xoá vĩnh viễn ${toDelete} dòng cũ hơn ${TOTAL_KEEP_DAYS} ngày.`);
})().catch((e) => {
  console.log(`💥 LỖI: ${e.stack || e}`);
  process.exitCode = 1;
});
