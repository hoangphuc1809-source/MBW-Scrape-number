/**
 * diagnose-sheet.js
 *
 * 03/08/2026: Phuc đã xóa data ở "Dailly SRP Tracking" nhưng spreadsheet vẫn
 * chậm — nghĩa là còn công thức/tab khác đang quét dải lớn. Script này đọc
 * CÔNG THỨC (valueRenderOption: 'FORMULA') thay vì giá trị — Google trả về
 * text công thức nguyên văn, KHÔNG cần tính toán, nên luôn nhanh dù sheet
 * đang nặng ở đâu khác. Quét toàn bộ tab, tìm formula tham chiếu dải không
 * giới hạn (A:V, A2:V, cả cột...) — đó là các ứng viên gây treo.
 *
 * Output: diagnostic-report.txt ở repo root, commit lại để đọc qua GitHub
 * Contents API (log CI qua Azure blob mình không truy cập được).
 */
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const CREDS_PATH = path.join(os.tmpdir(), 'diag-gcreds.json');
const REPORT_PATH = path.join(__dirname, 'diagnostic-report.txt');
const REQ_TIMEOUT_MS = 20000;

const lines = [];
function log(msg) { lines.push(msg); console.log(msg); }

// Regex tìm formula "quét rộng": tham chiếu cả cột (A:V), hoặc dải không có
// số dòng kết thúc rõ (A2:V mà không kèm số dòng cuối), hoặc các hàm hay
// gây nặng khi quét lớn (QUERY, ARRAYFORMULA, VLOOKUP, IMPORTRANGE, SUMIFS,
// COUNTIFS, FILTER).
const HEAVY_FN_RE = /\b(QUERY|ARRAYFORMULA|VLOOKUP|IMPORTRANGE|SUMIFS|COUNTIFS|FILTER|IFERROR\(VLOOKUP)\b/i;
const WIDE_RANGE_RE = /'?[A-Za-z0-9 _#]+'?![A-Z]{1,2}[0-9]*:[A-Z]{1,2}(?![0-9])/; // vd 'RAW DATA'!A2:V hoặc A:V (không có số dòng cuối)

async function main() {
  if (!SPREADSHEET_ID || !process.env.GOOGLE_CREDENTIALS) {
    log('⚠ Thiếu SPREADSHEET_ID hoặc GOOGLE_CREDENTIALS.');
    fs.writeFileSync(REPORT_PATH, lines.join('\n'));
    return;
  }

  fs.writeFileSync(CREDS_PATH, process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({
    keyFile: CREDS_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  log(`--- Chẩn đoán spreadsheet ${SPREADSHEET_ID} — ${new Date().toISOString()} ---\n`);

  // Metadata: danh sách tab + rowCount/colCount + số rule conditional formatting
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets(properties(sheetId,title,gridProperties),conditionalFormats)',
  }, { timeout: REQ_TIMEOUT_MS });

  const tabs = meta.data.sheets || [];
  log(`Tổng ${tabs.length} tab:\n`);
  for (const t of tabs) {
    const p = t.properties;
    const cf = (t.conditionalFormats || []).length;
    log(`  • "${p.title}" (gid=${p.sheetId}) — ${p.gridProperties.rowCount} dòng x ${p.gridProperties.columnCount} cột — ${cf} rule conditional formatting`);
  }
  log('');

  // Đọc công thức từng tab (chỉ vài trăm dòng đầu đủ để phát hiện formula lặp
  // theo cột — nếu dòng 2 có formula thì thường cả cột đều vậy).
  for (const t of tabs) {
    const p = t.properties;
    const lastCol = String.fromCharCode(65 + Math.min(p.gridProperties.columnCount - 1, 25));
    const sampleRows = Math.min(p.gridProperties.rowCount, 5);
    if (sampleRows < 1) continue;
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${p.title}'!A1:${lastCol}${sampleRows}`,
        valueRenderOption: 'FORMULA',
      }, { timeout: REQ_TIMEOUT_MS });
      const rows = res.data.values || [];
      let foundFormula = false;
      rows.forEach((row, ri) => {
        row.forEach((cell, ci) => {
          if (typeof cell === 'string' && cell.startsWith('=')) {
            foundFormula = true;
            const isHeavyFn = HEAVY_FN_RE.test(cell);
            const isWideRange = WIDE_RANGE_RE.test(cell);
            const flag = (isHeavyFn || isWideRange) ? '  ⚠️ NGHI VẤN NẶNG' : '';
            const colLetter = String.fromCharCode(65 + ci);
            log(`  [${p.title}] ${colLetter}${ri + 1}: ${cell.substring(0, 300)}${flag}`);
          }
        });
      });
      if (!foundFormula) log(`  [${p.title}] — không có formula ở ${sampleRows} dòng đầu (có thể là data thuần)`);
    } catch (err) {
      log(`  [${p.title}] ⚠ Đọc lỗi: ${err.message}`);
    }
  }

  fs.writeFileSync(REPORT_PATH, lines.join('\n') + '\n');
  log(`\n✅ Đã ghi ${REPORT_PATH}`);
  fs.unlinkSync(CREDS_PATH);
}

main().catch(err => {
  log(`💥 Lỗi: ${err && err.stack ? err.stack : String(err)}`);
  try { fs.writeFileSync(REPORT_PATH, lines.join('\n')); } catch (_) {}
  process.exitCode = 0;
});
