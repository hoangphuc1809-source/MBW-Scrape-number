/**
 * freeze-formulas.js
 *
 * 03/08/2026: đóng băng các cột formula sống (MAP/INDEX/MATCH/FILTER quét
 * hàng chục nghìn dòng chéo giữa RAW DATA ↔ Part # ↔ Check) thành giá trị
 * tĩnh. Tương đương "Copy → Paste special → Values only" nhưng làm qua API,
 * không cần mở UI. KHÔNG đổi số liệu — chỉ đọc giá trị đã tính hiện tại rồi
 * ghi lại nguyên vẹn dưới dạng tĩnh, formula bị xoá.
 *
 * An toàn: nếu 1 vùng lỗi, log lại rồi bỏ qua, không dừng cả script.
 */
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const CREDS_PATH = path.join(os.tmpdir(), 'freeze-gcreds.json');
const REPORT_PATH = path.join(__dirname, 'freeze-report.txt');
const REQ_TIMEOUT_MS = 30000;
const CHUNK_SIZE = 8000;

const lines = [];
function log(msg) { lines.push(msg); console.log(msg); }

async function withRetry(fn, label, tries = 2) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try { return await fn(); }
    catch (err) {
      lastErr = err;
      log(`   ⚠ ${label} lần ${i}/${tries} lỗi: ${err.message}`);
      if (i < tries) await new Promise(r => setTimeout(r, 2000));
    }
  }
  throw lastErr;
}

// Đóng băng 1 range: đọc UNFORMATTED_VALUE (giá trị đã tính, không phải text
// formula) rồi ghi lại chính range đó bằng RAW — formula biến mất, giá trị
// giữ nguyên.
async function freezeRange(sheets, tabName, colStart, colEnd, rowCount) {
  const label = `${tabName}!${colStart}2:${colEnd}${rowCount}`;
  log(`\n🧊 Đóng băng ${label} ...`);
  if (rowCount < 2) { log('   Không có data, bỏ qua.'); return; }

  for (let start = 2; start <= rowCount; start += CHUNK_SIZE) {
    const end = Math.min(start + CHUNK_SIZE - 1, rowCount);
    const range = `'${tabName}'!${colStart}${start}:${colEnd}${end}`;
    try {
      const res = await withRetry(
        () => sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID, range,
          valueRenderOption: 'UNFORMATTED_VALUE',
          dateTimeRenderOption: 'FORMATTED_STRING',
        }, { timeout: REQ_TIMEOUT_MS }),
        `Đọc ${range}`
      );
      const values = res.data.values || [];
      if (values.length === 0) { log(`   ${range}: trống, bỏ qua`); continue; }
      await withRetry(
        () => sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID, range,
          valueInputOption: 'RAW',
          requestBody: { values },
        }, { timeout: REQ_TIMEOUT_MS }),
        `Ghi lại ${range}`
      );
      log(`   ✓ ${range}: ${values.length} dòng đã đóng băng`);
    } catch (err) {
      log(`   ✗ ${range} LỖI, bỏ qua: ${err.message}`);
    }
  }
}

async function main() {
  if (!SPREADSHEET_ID || !process.env.GOOGLE_CREDENTIALS) {
    log('⚠ Thiếu SPREADSHEET_ID/GOOGLE_CREDENTIALS.');
    fs.writeFileSync(REPORT_PATH, lines.join('\n'));
    return;
  }
  fs.writeFileSync(CREDS_PATH, process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({
    keyFile: CREDS_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets(properties(sheetId,title,gridProperties))',
  }, { timeout: REQ_TIMEOUT_MS });
  const byTitle = {};
  for (const s of meta.data.sheets) byTitle[s.properties.title] = s.properties.gridProperties.rowCount;

  log(`--- Đóng băng formula — ${new Date().toISOString()} ---`);
  log(`Row count: RAW DATA=${byTitle['Daily SRP Tracking']}, Part #=${byTitle['Part #']}, Check=${byTitle['Check']}`);

  // RAW DATA!V — MAP tra 'Part #'
  await freezeRange(sheets, 'Daily SRP Tracking', 'V', 'V', byTitle['Daily SRP Tracking']);

  // Part #!L, N:S — MAP tra RAW DATA / Segment
  await freezeRange(sheets, 'Part #', 'L', 'L', byTitle['Part #']);
  await freezeRange(sheets, 'Part #', 'N', 'S', byTitle['Part #']);

  // Check!A:T — FILTER/REGEXMATCH/MAP nặng nhất
  await freezeRange(sheets, 'Check', 'A', 'T', byTitle['Check']);

  fs.writeFileSync(REPORT_PATH, lines.join('\n') + '\n');
  log(`\n✅ Xong. Ghi ${REPORT_PATH}`);
  fs.unlinkSync(CREDS_PATH);
}

main().catch(err => {
  log(`💥 Lỗi: ${err && err.stack ? err.stack : String(err)}`);
  try { fs.writeFileSync(REPORT_PATH, lines.join('\n')); } catch (_) {}
  process.exitCode = 0;
});
