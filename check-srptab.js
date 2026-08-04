const { google } = require('googleapis');
const fs = require('fs');
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const CREDS_PATH = '/tmp/gc2.json';
const TARGET_GID = 221053035;

(async () => {
  fs.writeFileSync(CREDS_PATH, process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({ keyFile: CREDS_PATH, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets(properties(title,sheetId,gridProperties))' });
  const allTabs = meta.data.sheets.map(s => `${s.properties.title} (gid=${s.properties.sheetId}, rows=${s.properties.gridProperties.rowCount})`);
  console.log('Cac tab trong spreadsheet:', JSON.stringify(allTabs, null, 1));

  const sheetMeta = meta.data.sheets.find(s => s.properties.sheetId === TARGET_GID);
  if (!sheetMeta) { console.log('KHONG TIM THAY gid=221053035'); return; }
  const tabName = sheetMeta.properties.title;
  const totalRows = sheetMeta.properties.gridProperties.rowCount;
  console.log(`Tab "${tabName}" - grid rowCount=${totalRows}`);

  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${tabName}'!A1:A20` });
  console.log('20 dong dau (cot A - Date):', JSON.stringify(res.data.values));

  // Tim dong cuoi co du lieu bang cach doc theo lo tu cuoi
  const tail = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${tabName}'!A${Math.max(1,totalRows-20)}:A${totalRows}` });
  console.log(`20 dong cuoi (A${Math.max(1,totalRows-20)}:A${totalRows}):`, JSON.stringify(tail.data.values));
})().catch(e => { console.log('LOI:', e.message); process.exit(1); });
