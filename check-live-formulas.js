const { google } = require('googleapis');
const fs = require('fs');
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const CREDS_PATH = '/tmp/gc-checklive.json';

(async () => {
  fs.writeFileSync(CREDS_PATH, process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({ keyFile: CREDS_PATH, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });

  // Doc vai vi tri (dau, giua, cuoi) o dang FORMULA de xem con cong thuc khong
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets(properties(title,gridProperties))' });
  const tab = meta.data.sheets.find(s => s.properties.title === 'Dailly SRP Tracking');
  const totalRows = tab.properties.gridProperties.rowCount;
  console.log('Dailly SRP Tracking rowCount:', totalRows);

  const ranges = [
    `A1:X5`,
    `A${Math.floor(totalRows/2)}:X${Math.floor(totalRows/2)+3}`,
    `A${totalRows-5}:X${totalRows}`,
  ];
  for (const r of ranges) {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'Dailly SRP Tracking'!${r}`,
      valueRenderOption: 'FORMULA',
    });
    const vals = res.data.values || [];
    const hasFormula = vals.some(row => row.some(cell => typeof cell === 'string' && cell.startsWith('=')));
    console.log(`Range ${r}: ${vals.length} dòng, có formula: ${hasFormula}`);
    if (hasFormula) {
      vals.forEach((row, i) => row.forEach((cell, j) => {
        if (typeof cell === 'string' && cell.startsWith('=')) console.log(`   FORMULA tại dòng ${i} cột ${j}: ${cell.slice(0,100)}`);
      }));
    }
  }

  // Kiem tra RAW DATA V column con formula khong (sau lan paste dau)
  const vCheck = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID, range: `'RAW DATA'!V1:V5`, valueRenderOption: 'FORMULA',
  });
  console.log('\nRAW DATA V1:V5 (FORMULA mode):', JSON.stringify(vCheck.data.values));

  // Cau truc Part # va Key Focus model de build code thay formula
  for (const tab of ["Part #", "Key Focus model"]) {
    console.log(`\n=== ${tab} ===`);
    const meta2 = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets(properties(title,gridProperties))' });
    const t = meta2.data.sheets.find(s => s.properties.title === tab);
    console.log('rowCount:', t ? t.properties.gridProperties.rowCount : 'N/A');
    const header = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${tab}'!A1:S1`, valueRenderOption: 'FORMULA' });
    console.log('Header:', JSON.stringify(header.data.values));
    const sample = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${tab}'!A2:S4`, valueRenderOption: 'FORMULA' });
    console.log('3 dòng mẫu:', JSON.stringify(sample.data.values));
  }
})().catch(e => { console.log('LOI:', e.message); process.exitCode = 1; });
