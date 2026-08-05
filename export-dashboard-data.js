/**
 * export-dashboard-data.js
 *
 * v3.6.1 (05/08/2026): Nguon doi hoan toan — khong con doc tu "Dailly SRP
 * Tracking" (tab cu, sap xoa) nua. Gio doc truc tiep tu "Daily SRP Tracking"
 * (ten moi cua tab RAW DATA, da co san enrich T->AE tu Part#/Segment bang
 * CODE — khong con formula nao, khong con nghen). Vi layout cot khac hoan
 * toan (A->S tieng Anh + T->AE enrich, thay vi 24 cot QUERY-derived cu), can
 * REMAP lai dung thu tu cot CSV cu (dashboard/index.html dang doc theo vi
 * tri cot co dinh) + AP LAI FILTER ma QUERY formula cu tung lam (Sale Price
 * khong rong, Product Link khong rong, Status khac 'EOL') vi nguon moi la
 * RAW, chua loc.
 *
 * 03/08/2026: Fix triet de loi dashboard "Khong tai duoc du lieu moi -
 * dang dung du lieu cu". Nguyen nhan goc: dashboard/index.html truoc day
 * CHI co 1 nguon data - client-side fetch truc tiep CSV export tu
 * docs.google.com moi khi user mo trang. Cach nay mong manh: phu thuoc
 * CORS/rate-limit cua Google, toc do mang nguoi xem, va kich thuoc tab
 * (dang phinh to). Khi fetch fail sau 5 lan retry, dashboard roi ve DATA
 * tinh nhung cung trong HTML tu lan build cuoi - khong tu cap nhat bao gio.
 *
 * Script nay chay NGAY SAU khi write-sheet ghi xong Google Sheet (server-
 * side, trong GitHub Actions - khong gioi han 8s nhu client browser), doc
 * tab nguon roi xuat ra dashboard/data.csv, commit thang vao repo. Dashboard
 * gio doc file CSV same-origin nay TRUOC (nhanh, khong CORS, khong phu
 * thuoc Google), chi fallback ve Google Sheets neu file local chua co/loi.
 *
 * Best-effort: neu export loi, KHONG lam fail job chinh (write-sheet) -
 * dashboard van con data.csv cu dung tam, con hon de job do vi buoc phu.
 */
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const CREDS_PATH = path.join(os.tmpdir(), 'export-gcreds.json');
const DEBUG_LOG_PATH = path.join(__dirname, 'dashboard', '.export-debug.log');
// gid cua tab nguon - "Daily SRP Tracking" (RAW DATA cu, Phuc da rename
// 04-05/08/2026). Lay bang gid de khong vo neu ten tab doi tiep sau nay.
const TARGET_GID = 889472306;
// Dashboard chi can toi da 30 ngay lich su (xem dayBtns=[7,14,30] trong
// dashboard/index.html). Chi lay ~40k dong cuoi thay vi doc toan bo.
const MAX_DATA_ROWS = 40000;
const CHUNK_SIZE = 5000; // doc theo lo nho, tranh 1 request bi timeout

// Header CSV theo THU TU CU (dashboard/index.html dang doc theo vi tri cot
// nay - giu nguyen de khong phai sua frontend).
const CSV_HEADER = [
  'Date', 'Hour', 'Dealers', 'SKU', 'SRP', 'Promotion Price', 'Change', 'Sold',
  'Rate', 'Vendor', 'Series Group', 'Segment', 'CPU Segment', 'CPU', 'RAM',
  'SSD', 'Screen', 'GPU', 'V-RAM', 'Weight', 'Products Link', 'Part #',
  'Focus Model', 'Status',
];
// Vi tri cot (0-indexed) trong tab nguon MOI ("Daily SRP Tracking", A->AE)
// tuong ung voi tung cot CSV_HEADER o tren, theo dung thu tu.
// (A=0,B=1,C=2,D=3,E=4,F=5,G=6,H=7,I=8,J=9,K=10,L=11,M=12,N=13,O=14,P=15,
//  Q=16,R=17,S=18,T=19,U=20,V=21,W=22,X=23,Y=24,Z=25,AA=26,AB=27,AC=28,
//  AD=29,AE=30)
const SRC_COL_INDEX = [0, 1, 3, 4, 12, 13, 14, 15, 16, 5, 20, 21, 22, 23, 24, 25, 26, 27, 28, 11, 17, 29, 30, 19];

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
      debugLog(`   lỗi ${label} lần ${i}/${tries}: ${err.message}`);
      if (i < tries) await new Promise(r => setTimeout(r, 2000));
    }
  }
  throw lastErr;
}

function csvEscape(v) {
  const s = (v === null || v === undefined) ? '' : String(v);
  if (/["\n\r,]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function remapRow(srcRow) {
  return SRC_COL_INDEX.map(i => srcRow[i] ?? '');
}

// Thay cho WHERE cua QUERY formula cu: "N is not null and R is not null and
// V<>'EOL'" - tren tab nguon MOI, N (Sale Price) = index 13, R (Product
// Link) = index 17, T (Status) = index 19.
function passesFilter(srcRow) {
  const salePrice = srcRow[13];
  const productLink = srcRow[17];
  const status = srcRow[19];
  if (!salePrice) return false;
  if (!productLink) return false;
  if (status === 'EOL') return false;
  return true;
}

async function main() {
  try { fs.writeFileSync(DEBUG_LOG_PATH, ''); } catch (_) {}
  debugLog('--- Bắt đầu export-dashboard-data.js ---');
  debugLog(`SPREADSHEET_ID set: ${!!SPREADSHEET_ID}, GOOGLE_CREDENTIALS set: ${!!process.env.GOOGLE_CREDENTIALS}`);

  if (!SPREADSHEET_ID || !process.env.GOOGLE_CREDENTIALS) {
    debugLog('Thiếu SPREADSHEET_ID hoặc GOOGLE_CREDENTIALS - bỏ qua export dashboard data.');
    return;
  }

  fs.writeFileSync(CREDS_PATH, process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({
    keyFile: CREDS_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const REQ_TIMEOUT_MS = 20000;

  debugLog('Gọi spreadsheets.get() để lấy metadata...');
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID }, { timeout: REQ_TIMEOUT_MS });
  const allTabs = (meta.data.sheets || []).map(s => `${s.properties.title} (gid=${s.properties.sheetId})`);
  debugLog(`Danh sách tab tìm thấy: ${allTabs.join(' | ')}`);

  const sheetMeta = (meta.data.sheets || []).find(s => s.properties.sheetId === TARGET_GID);
  if (!sheetMeta) throw new Error(`Không tìm thấy tab với gid=${TARGET_GID}. Các tab hiện có: ${allTabs.join(', ')}`);
  const tabName = sheetMeta.properties.title;
  const totalRows = sheetMeta.properties.gridProperties.rowCount;
  debugLog(`Tab "${tabName}" (gid ${TARGET_GID}) - tổng ${totalRows} dòng`);

  const dataStartRow = Math.max(2, totalRows - MAX_DATA_ROWS + 1);
  debugLog(`   Sẽ đọc dòng ${dataStartRow} -> ${totalRows} (cột A:AE) theo lô ${CHUNK_SIZE} dòng/lần...`);

  const dataRows = [];
  for (let start = dataStartRow; start <= totalRows; start += CHUNK_SIZE) {
    const end = Math.min(start + CHUNK_SIZE - 1, totalRows);
    const chunkRes = await withRetry(
      () => sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${tabName}'!A${start}:AE${end}`,
        valueRenderOption: 'FORMULA',
        dateTimeRenderOption: 'FORMATTED_STRING',
      }, { timeout: REQ_TIMEOUT_MS }),
      `Đọc lô ${start}-${end}`
    );
    const chunkRows = chunkRes.data.values || [];
    for (const r of chunkRows) if (r.some(c => c !== '' && c !== undefined && c !== null)) dataRows.push(r);
    debugLog(`   Lô ${start}-${end}: ${chunkRows.length} dòng thô`);
  }

  debugLog(`   Đọc thô được ${dataRows.length} dòng, đang lọc + remap cột...`);
  const filteredRemapped = dataRows.filter(passesFilter).map(remapRow);
  debugLog(`   Sau filter: ${filteredRemapped.length}/${dataRows.length} dòng`);

  const rows = [CSV_HEADER, ...filteredRemapped];
  if (rows.length < 10) {
    throw new Error(`Chỉ có ${rows.length} dòng sau lọc - không ghi đè data.csv cũ`);
  }

  const csv = rows.map(row => row.map(csvEscape).join(',')).join('\n') + '\n';
  const outPath = path.join(__dirname, 'dashboard', 'data.csv');
  fs.writeFileSync(outPath, csv, 'utf8');
  debugLog(`Đã ghi ${outPath} (${(csv.length / 1024).toFixed(0)} KB, ${rows.length - 1} dòng data)`);

  fs.unlinkSync(CREDS_PATH);
  debugLog('--- Kết thúc export-dashboard-data.js: THÀNH CÔNG ---');
}

main().catch(err => {
  debugLog(`Export dashboard data thất bại: ${err && err.stack ? err.stack : String(err)}`);
  if (err && err.response && err.response.data) {
    debugLog(`   API response data: ${JSON.stringify(err.response.data).substring(0, 3000)}`);
  }
  process.exitCode = 0;
});
