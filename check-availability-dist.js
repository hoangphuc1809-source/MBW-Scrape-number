const { google } = require('googleapis');
const fs = require('fs');
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const CREDS_PATH = '/tmp/gc-checkavail.json';

(async () => {
  fs.writeFileSync(CREDS_PATH, process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({ keyFile: CREDS_PATH, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets(properties(title,gridProperties))' });
  const sheet = meta.data.sheets.find(s => s.properties.title === 'Daily SRP Tracking');
  const totalRows = sheet.properties.gridProperties.rowCount;

  // Doc theo lo de an toan (data lon)
  const CHUNK = 5000;
  const rows = [];
  for (let start = 2; start <= totalRows; start += CHUNK) {
    const end = Math.min(start + CHUNK - 1, totalRows);
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'Daily SRP Tracking'!A${start}:S${end}`,
      valueRenderOption: 'FORMULA',
    });
    const chunk = (res.data.values || []).filter(r => r[0]);
    rows.push(...chunk);
    console.log(`  doc ${start}-${end}: ${chunk.length} dong`);
  }
  console.log(`Tong ${rows.length} dong`);

  // Lay ngay gan nhat
  const dates = [...new Set(rows.map(r => r[0]))];
  console.log('Cac ngay co trong data:', dates.slice(-3));
  const latestDate = dates[dates.length - 1];

  const todayRows = rows.filter(r => r[0] === latestDate);
  console.log(`\nData ngay ${latestDate}: ${todayRows.length} dong`);

  const byDealer = {};
  for (const r of todayRows) {
    const dealer = r[3] || '?';
    const avail = r[18] || '(trong)'; // cot S = index 18
    byDealer[dealer] = byDealer[dealer] || {};
    byDealer[dealer][avail] = (byDealer[dealer][avail] || 0) + 1;
  }
  console.log('\nPhan bo Availability theo dealer (ngay moi nhat):');
  console.log(JSON.stringify(byDealer, null, 2));
})().catch(e => console.log('LOI:', e.message));
