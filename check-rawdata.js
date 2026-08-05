const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const CREDS_PATH = path.join(os.tmpdir(), 'check-gcreds.json');
const REPORT_PATH = path.join(__dirname, 'rawdata-check-report.txt');
const lines = [];
function log(m) { lines.push(m); console.log(m); }

async function main() {
  fs.writeFileSync(CREDS_PATH, process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({ keyFile: CREDS_PATH, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });

  // Kiểm tra vài điểm mốc trong RAW DATA: đầu, giữa, cuối
  const checkpoints = [2, 100, 500, 1000, 1700, 2000, 5000, 10000, 30000, 50000, 70000];
  for (const row of checkpoints) {
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `'Daily SRP Tracking'!A${row}:E${row}`,
        valueRenderOption: 'FORMULA',
      }, { timeout: 20000 });
      const v = res.data.values || [];
      log(`Dòng ${row}: ${v.length ? JSON.stringify(v[0]) : '(TRỐNG)'}`);
    } catch (e) {
      log(`Dòng ${row}: lỗi ${e.message}`);
    }
  }

  // Đếm số dòng có date khác ngày hôm nay (dò trong khoảng 2-3000, vốn luôn
  // có nếu data cũ còn nguyên do trước đây co hon 1600 SP/ngay)
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'Daily SRP Tracking'!A2:A3000`,
      valueRenderOption: 'FORMULA',
    }, { timeout: 25000 });
    const vals = (res.data.values || []).map(r => r[0]).filter(Boolean);
    const uniqueDates = [...new Set(vals)];
    log(`\nTrong A2:A3000 — ${vals.length} dòng có date, ${uniqueDates.length} ngày khác nhau: ${uniqueDates.join(', ')}`);
  } catch (e) {
    log(`Lỗi đếm ngày: ${e.message}`);
  }

  fs.writeFileSync(REPORT_PATH, lines.join('\n') + '\n');
  fs.unlinkSync(CREDS_PATH);
}
main().catch(e => { log('LỖI: ' + e.message); try{fs.writeFileSync(REPORT_PATH, lines.join('\n'));}catch(_){} process.exitCode=0; });
