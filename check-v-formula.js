const { google } = require('googleapis');
const fs = require('fs');
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const CREDS_PATH = '/tmp/gc-checkv.json';

(async () => {
  fs.writeFileSync(CREDS_PATH, process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({ keyFile: CREDS_PATH, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'RAW DATA'!V1:V3`,
    valueRenderOption: 'FORMULA',
  }, { timeout: 30000 });
  console.log('V1:V3 (FORMULA mode):', JSON.stringify(res.data.values));
})().catch(e => { console.log('LOI:', e.message); process.exitCode = 1; });
