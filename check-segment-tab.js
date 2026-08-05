const { google } = require('googleapis');
const fs = require('fs');
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const CREDS_PATH = '/tmp/gc-checksegment.json';

(async () => {
  fs.writeFileSync(CREDS_PATH, process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({ keyFile: CREDS_PATH, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });

  const header = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'Segment'!A1:D5`, valueRenderOption: 'FORMULA' });
  console.log('Segment A1:D5:', JSON.stringify(header.data.values, null, 1));

  const partLM = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'Part #'!L1:M5`, valueRenderOption: 'FORMULA' });
  console.log('\nPart # L1:M5 (FORMULA):', JSON.stringify(partLM.data.values, null, 1));

  // Doc gia tri DA TINH (khong phai formula) cho vai dong mau, de doi chieu
  const partLMVal = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'Part #'!A1:M5` });
  console.log('\nPart # A1:M5 (gia tri da tinh):', JSON.stringify(partLMVal.data.values, null, 1));

  const rawMeta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets(properties(title,gridProperties))' });
  const rawSheetInfo = rawMeta.data.sheets.find(s => s.properties.title === 'RAW DATA');
  console.log('\nRAW DATA gridProperties:', JSON.stringify(rawSheetInfo.properties.gridProperties));
  const rawHeader = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'RAW DATA'!S1:Z1`, valueRenderOption: 'FORMULA' });
  console.log('\nRAW DATA S1:Z1 (hien tai):', JSON.stringify(rawHeader.data.values));
})().catch(e => { console.log('LOI:', e.message); process.exitCode = 1; });
