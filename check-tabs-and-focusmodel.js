const { google } = require('googleapis');
const fs = require('fs');
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const CREDS_PATH = '/tmp/gc-checktabs.json';

(async () => {
  fs.writeFileSync(CREDS_PATH, process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({ keyFile: CREDS_PATH, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets(properties(title,sheetId,gridProperties))' });
  console.log('Toan bo tab hien co:');
  meta.data.sheets.forEach(s => console.log(` - "${s.properties.title}" (gid=${s.properties.sheetId}, rows=${s.properties.gridProperties.rowCount}, cols=${s.properties.gridProperties.columnCount})`));

  // Kiem tra header cua Part # day du (het cot) de xem co "Focus Model" dau khong
  const header = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'Part #'!A1:Z1`, valueRenderOption: 'FORMULA' });
  console.log('\nHeader day du cua Part #:', JSON.stringify(header.data.values));

  // Kiem tra header day du cua SRP checking (co the la noi luu Focus Model)
  try {
    const h2 = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'SRP checking'!A1:Z2`, valueRenderOption: 'FORMULA' });
    console.log('\nSRP checking A1:Z2:', JSON.stringify(h2.data.values));
  } catch (e) { console.log('LOI SRP checking:', e.message); }
})().catch(e => { console.log('LOI:', e.message); process.exitCode = 1; });
