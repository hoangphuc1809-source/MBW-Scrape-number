/**
 * inspect-structure.js — đọc đầy đủ header row + 3 dòng mẫu (giá trị, không
 * phải formula) của các tab liên quan tới logic "cooking data", để port
 * đúng logic sang code, không đoán mò.
 */
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const CREDS_PATH = path.join(os.tmpdir(), 'inspect-gcreds.json');
const REPORT_PATH = path.join(__dirname, 'structure-report.txt');
const REQ_TIMEOUT_MS = 25000;
const TABS = ['RAW DATA', 'Part #', 'Segment', 'Key Focus model'];

const lines = [];
function log(msg) { lines.push(msg); console.log(msg); }

async function main() {
  fs.writeFileSync(CREDS_PATH, process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({
    keyFile: CREDS_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  for (const tab of TABS) {
    log(`\n=== ${tab} ===`);
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${tab}'!A1:AC15`,
        valueRenderOption: 'FORMULA',
      }, { timeout: REQ_TIMEOUT_MS });
      const rows = res.data.values || [];
      const header = rows[0] || [];
      log(`Header (${header.length} cột): ${header.map((h, i) => `${String.fromCharCode(65+i)}=${h}`).join(' | ')}`);
      for (let i = 1; i < rows.length; i++) {
        log(`  Dòng ${i+1}: ${JSON.stringify(rows[i])}`);
      }
    } catch (err) {
      log(`  ⚠ Lỗi: ${err.message}`);
    }
  }

  fs.writeFileSync(REPORT_PATH, lines.join('\n') + '\n');
  log(`\n✅ Ghi ${REPORT_PATH}`);
  fs.unlinkSync(CREDS_PATH);
}

main().catch(err => {
  log(`💥 Lỗi: ${err && err.stack ? err.stack : String(err)}`);
  try { fs.writeFileSync(REPORT_PATH, lines.join('\n')); } catch (_) {}
  process.exitCode = 0;
});
