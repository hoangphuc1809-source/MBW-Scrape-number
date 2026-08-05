const { google } = require('googleapis');
const fs = require('fs');
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const CREDS_PATH = '/tmp/gc-checkmbw.json';

(async () => {
  fs.writeFileSync(CREDS_PATH, process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({ keyFile: CREDS_PATH, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets(properties(title,gridProperties))' });
  const sheet = meta.data.sheets.find(s => s.properties.title === 'Daily SRP Tracking');
  const totalRows = sheet.properties.gridProperties.rowCount;
  console.log('Tong grid rows:', totalRows);

  // Doc TOAN BO cot A (Date) + D (Dealer) theo lo, dem theo (date, dealer)
  const CHUNK = 5000;
  const counts = {};
  let lastRows = [];
  for (let start = 2; start <= totalRows; start += CHUNK) {
    const end = Math.min(start + CHUNK - 1, totalRows);
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'Daily SRP Tracking'!A${start}:D${end}`,
      valueRenderOption: 'FORMULA',
    });
    const rows = (res.data.values || []).filter(r => r[0]);
    for (const r of rows) {
      const key = `${r[0]}__${r[3]}`;
      counts[key] = (counts[key] || 0) + 1;
    }
    if (rows.length > 0) lastRows = rows;
    console.log(`  doc ${start}-${end}: ${rows.length} dong thuc`);
  }

  console.log('\n=== Dem theo (Ngay, Dealer), 20 dong cuoi cung trong sheet ===');
  console.log('20 dong cuoi (Date, Time, No, Dealer):');
  console.log(JSON.stringify(lastRows.slice(-20)));

  console.log('\n=== Toan bo (ngay, dealer) counts, 30 gan nhat ===');
  const entries = Object.entries(counts);
  console.log(JSON.stringify(entries.slice(-30), null, 1));
})().catch(e => console.log('LOI:', e.message));
