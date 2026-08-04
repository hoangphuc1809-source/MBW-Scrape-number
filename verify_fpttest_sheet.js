// Chi doc Sheet de xac nhan tab FPT_TEST, khong goi Bright Data (khong ton phi)
const fs = require('fs');
const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const CREDS_PATH = '/tmp/gcreds.json';

(async () => {
  fs.writeFileSync(CREDS_PATH, process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({ keyFile: CREDS_PATH, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets(properties(title,gridProperties))' });
  const titles = meta.data.sheets.map(s => s.properties.title);
  console.log('Cac tab hien co:', JSON.stringify(titles));

  if (titles.includes('FPT_TEST')) {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'FPT_TEST!A1:J10' });
    console.log('10 dong dau FPT_TEST:', JSON.stringify(res.data.values, null, 1));
    const j1 = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'FPT_TEST!J1' });
    console.log('J1 (note lan chay gan nhat):', JSON.stringify(j1.data.values));
    // Dem tong so dong
    const all = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'FPT_TEST!A:A' });
    console.log('Tong so dong (ke ca header):', (all.data.values || []).length);
  } else {
    console.log('Khong tim thay tab FPT_TEST');
  }
})().catch(e => { console.log('LOI:', e.message); process.exit(1); });
