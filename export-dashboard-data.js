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

function debugLog(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(DEBUG_LOG_PATH, line); } catch (_) {}
  console.log(msg);
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

  debugLog('Gọi spreadsheets.get() để lấy metadata...');
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const allTabs = (meta.data.sheets || []).map(s => `${s.properties.title} (gid=${s.properties.sheetId})`);
  debugLog(`Danh sách tab tìm thấy: ${allTabs.join(' | ')}`);

  const sheetMeta = (meta.data.sheets || []).find(s => s.properties.sheetId === TARGET_GID);
  if (!sheetMeta) throw new Error(`Không tìm thấy tab với gid=${TARGET_GID} trong spreadsheet. Các tab hiện có: ${allTabs.join(', ')}`);
  const tabName = sheetMeta.properties.title;
  debugLog(`📋 Đọc tab "${tabName}" (gid ${TARGET_GID})...`);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${tabName}'!A:Z`,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });

  const rows = res.data.values || [];
  debugLog(`   ${rows.length} dòng (kể cả header)`);
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
