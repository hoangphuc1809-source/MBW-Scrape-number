const { google } = require('googleapis');
const fs = require('fs');
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const CREDS_PATH = '/tmp/gc-checkstruct.json';

(async () => {
  fs.writeFileSync(CREDS_PATH, process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({ keyFile: CREDS_PATH, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });

  for (const tab of ["'Part #'", "'Key Focus model'", "'Dailly SRP Tracking'"]) {
    console.log(`\n=== ${tab} ===`);
    try {
      const header = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${tab}!A1:Z1` }, { timeout: 30000 });
      console.log('Header:', JSON.stringify(header.data.values));
      const sample = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${tab}!A2:Z4` }, { timeout: 30000 });
      console.log('3 dòng mẫu:', JSON.stringify(sample.data.values));
      const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets(properties(title,gridProperties))' });
      const t = meta.data.sheets.find(s => `'${s.properties.title}'` === tab);
      if (t) console.log('rowCount:', t.properties.gridProperties.rowCount);
    } catch (e) {
      console.log('LOI:', e.message);
    }
  }

  // Kiem tra tab Dailly SRP Tracking co con formula khong (sau paste-special)
  try {
    const f = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'Dailly SRP Tracking'!A1:X3`, valueRenderOption: 'FORMULA' }, { timeout: 30000 });
    console.log('\nDailly SRP Tracking A1:X3 (FORMULA mode):', JSON.stringify(f.data.values));
  } catch (e) {
    console.log('LOI check Dailly SRP formula:', e.message);
  }
})().catch(e => { console.log('LOI tong the:', e.message); process.exitCode = 1; });
