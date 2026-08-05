const { google } = require('googleapis');
const fs = require('fs');
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const CREDS_PATH = '/tmp/gc-simple.json';

(async () => {
  fs.writeFileSync(CREDS_PATH, process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({ keyFile: CREDS_PATH, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets(properties(title,sheetId,gridProperties))' });
  for (const s of meta.data.sheets) {
    console.log(JSON.stringify(s.properties));
  }
})().catch(e => console.log('LOI:', e.message));
