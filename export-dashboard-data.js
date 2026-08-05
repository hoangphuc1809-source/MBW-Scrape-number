/**
 * export-dashboard-data.js
 *
 * 03/08/2026: Fix triệt để lỗi dashboard "Không tải được dữ liệu mới —
 * đang dùng dữ liệu cũ". Nguyên nhân gốc: dashboard/index.html trước đây
 * CHỈ có 1 nguồn data — client-side fetch trực tiếp CSV export từ
 * docs.google.com (tab "Dailly SRP Tracking") mỗi khi user mở trang.
 * Cách này mong manh: phụ thuộc CORS/rate-limit của Google, tốc độ mạng
 * người xem, và kích thước tab (đang phình to). Khi fetch fail sau 5 lần
 * retry, dashboard rơi về DATA tĩnh nhúng cứng trong HTML từ lần build
 * cuối (11/06/2026) — không tự cập nhật bao giờ.
 *
 * Script này chạy NGAY SAU khi write-sheet ghi xong Google Sheet (server-
 * side, trong GitHub Actions — không giới hạn 8s như client browser), đọc
 * toàn bộ tab "Dailly SRP Tracking" rồi xuất ra dashboard/data.csv, commit
 * thẳng vào repo. Dashboard giờ đọc file CSV same-origin này TRƯỚC (nhanh,
 * không CORS, không phụ thuộc Google), chỉ fallback về Google Sheets nếu
 * vì lý do gì đó file local chưa có/lỗi.
 *
 * Best-effort: nếu export lỗi, KHÔNG làm fail job chính (write-sheet) —
 * dashboard vẫn còn data.csv cũ dùng tạm, còn hơn để job đỏ vì bước phụ.
 */
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const CREDS_PATH = path.join(os.tmpdir(), 'export-gcreds.json');
const DEBUG_LOG_PATH = path.join(__dirname, 'dashboard', '.export-debug.log');
// gid của tab "Dailly SRP Tracking" — lấy đúng bằng gid thay vì tên, để
// không vỡ nếu ai đó đổi tên tab sau này.
const TARGET_GID = 221053035;
// Dashboard chỉ cần tối đa 30 ngày lịch sử (xem dayBtns=[7,14,30] trong
// dashboard/index.html). Tab "Dailly SRP Tracking" đang rất lớn (đọc 1 lần
// A:Z bị Sheets API trả 503 sau ~6 phút — xác nhận 03/08/2026), nên chỉ lấy
// ~40k dòng cuối (dư ra so với 30 ngày thực tế) thay vì đọc toàn bộ.
const MAX_DATA_ROWS = 40000;
const CHUNK_SIZE = 5000; // đọc theo lô nhỏ, tránh 1 request bị timeout

function debugLog(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(DEBUG_LOG_PATH, line); } catch (_) {}
  console.log(msg);
}

async function withRetry(fn, label, tries = 2) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try { return await fn(); }
    catch (err) {
      lastErr = err;
      debugLog(`   ⚠ ${label} lần ${i}/${tries} lỗi: ${err.message}`);
      if (i < tries) await new Promise(r => setTimeout(r, 2000));
    }
  }
  throw lastErr;
}

function csvEscape(v) {
  const s = (v === null || v === undefined) ? '' : String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

async function main() {
  try { fs.writeFileSync(DEBUG_LOG_PATH, ''); } catch (_) {} // reset log mỗi lần chạy, tránh phình vô hạn
  debugLog('--- Bắt đầu export-dashboard-data.js ---');
  debugLog(`SPREADSHEET_ID set: ${!!SPREADSHEET_ID}, GOOGLE_CREDENTIALS set: ${!!process.env.GOOGLE_CREDENTIALS}`);

  if (!SPREADSHEET_ID || !process.env.GOOGLE_CREDENTIALS) {
    debugLog('⚠ Thiếu SPREADSHEET_ID hoặc GOOGLE_CREDENTIALS — bỏ qua export dashboard data.');
    return;
  }

  fs.writeFileSync(CREDS_PATH, process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({
    keyFile: CREDS_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const REQ_TIMEOUT_MS = 20000; // fail nhanh — tab "Dailly SRP Tracking" đang treo lâu do formula nặng, không cần đợi lâu

  debugLog('Gọi spreadsheets.get() để lấy metadata...');
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID }, { timeout: REQ_TIMEOUT_MS });
  const allTabs = (meta.data.sheets || []).map(s => `${s.properties.title} (gid=${s.properties.sheetId})`);
  debugLog(`Danh sách tab tìm thấy: ${allTabs.join(' | ')}`);

  const sheetMeta = (meta.data.sheets || []).find(s => s.properties.sheetId === TARGET_GID);
  if (!sheetMeta) throw new Error(`Không tìm thấy tab với gid=${TARGET_GID} trong spreadsheet. Các tab hiện có: ${allTabs.join(', ')}`);
  const tabName = sheetMeta.properties.title;
  const totalRows = sheetMeta.properties.gridProperties.rowCount;
  debugLog(`📋 Tab "${tabName}" (gid ${TARGET_GID}) — tổng ${totalRows} dòng (theo metadata, gồm cả dòng trống chưa dùng)`);

  // Header luôn ở dòng 1
  const headerRes = await withRetry(
    () => sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${tabName}'!A1:Z1`,
      valueRenderOption: 'FORMULA',
      dateTimeRenderOption: 'FORMATTED_STRING',
    }, { timeout: REQ_TIMEOUT_MS }),
    'Đọc header'
  );
  const header = (headerRes.data.values || [[]])[0];

  // Chỉ lấy MAX_DATA_ROWS dòng dữ liệu cuối (mới nhất) — dư so với 30 ngày
  // dashboard cần, nhưng tránh đọc hết tab đang bị phình (gây 503/timeout).
  const dataStartRow = Math.max(2, totalRows - MAX_DATA_ROWS + 1);
  debugLog(`   Sẽ đọc dòng ${dataStartRow} → ${totalRows} theo lô ${CHUNK_SIZE} dòng/lần...`);

  const dataRows = [];
  for (let start = dataStartRow; start <= totalRows; start += CHUNK_SIZE) {
    const end = Math.min(start + CHUNK_SIZE - 1, totalRows);
    const chunkRes = await withRetry(
      () => sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${tabName}'!A${start}:Z${end}`,
        valueRenderOption: 'FORMULA',
        dateTimeRenderOption: 'FORMATTED_STRING',
      }, { timeout: REQ_TIMEOUT_MS }),
      `Đọc lô ${start}-${end}`
    );
    const chunkRows = chunkRes.data.values || [];
    // Bỏ các dòng hoàn toàn trống (vùng cuối sheet thường có nhiều dòng trống chưa dùng)
    for (const r of chunkRows) if (r.some(c => c !== '' && c !== undefined && c !== null)) dataRows.push(r);
    debugLog(`   ✓ Lô ${start}-${end}: ${chunkRows.length} dòng thô`);
  }

  const rows = [header, ...dataRows];
  debugLog(`   Tổng ${rows.length} dòng (kể cả header) sau khi lọc dòng trống`);
  if (rows.length < 10) {
    throw new Error(`Chỉ đọc được ${rows.length} dòng — nghi ngờ lỗi, không ghi đè data.csv cũ`);
  }

  const csv = rows.map(row => row.map(csvEscape).join(',')).join('\n') + '\n';
  const outPath = path.join(__dirname, 'dashboard', 'data.csv');
  fs.writeFileSync(outPath, csv, 'utf8');
  debugLog(`✅ Đã ghi ${outPath} (${(csv.length / 1024).toFixed(0)} KB)`);

  fs.unlinkSync(CREDS_PATH);
  debugLog('--- Kết thúc export-dashboard-data.js: THÀNH CÔNG ---');
}

main().catch(err => {
  debugLog(`💥 Export dashboard data thất bại: ${err && err.stack ? err.stack : String(err)}`);
  if (err && err.response && err.response.data) {
    debugLog(`   API response data: ${JSON.stringify(err.response.data).substring(0, 3000)}`);
  }
  process.exitCode = 0;
});
