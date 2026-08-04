// Thu cach khac: dung Google Sheets CSV EXPORT endpoint (docs.google.com)
// thay vi Sheets API v4 values.get (dang bi nghen/timeout lien tuc). Day la
// duong dan backend khac han — co the khong bi anh huong boi cong thuc nang
// cua Dailly SRP Tracking.
const fs = require('fs');
const https = require('https');
const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const CREDS_PATH = '/tmp/gcreds-csvexport.json';
const TARGET_GID = process.env.TARGET_GID || '221053035'; // Dailly SRP Tracking

function httpsGetWithAuth(url, token, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    function doGet(u, redirectsLeft) {
      const req = https.get(u, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 270000,
      }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
          res.resume();
          console.log(`   → redirect ${res.statusCode} tới: ${res.headers.location.slice(0, 120)}...`);
          doGet(res.headers.location, redirectsLeft - 1);
          return;
        }
        let chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks), headers: res.headers }));
      });
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.on('error', reject);
    }
    doGet(url, maxRedirects);
  });
}

(async () => {
  fs.writeFileSync(CREDS_PATH, process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({ keyFile: CREDS_PATH, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const client = await auth.getClient();
  const tokenResp = await client.getAccessToken();
  const token = tokenResp.token;
  console.log('Đã lấy access token, độ dài:', token ? token.length : 0);

  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${TARGET_GID}`;
  console.log('Đang GET:', url);
  const t0 = Date.now();
  const res = await httpsGetWithAuth(url, token);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`Status: ${res.status}, elapsed: ${elapsed}s, size: ${res.body.length} bytes`);
  console.log('Content-Type:', res.headers['content-type']);

  if (res.status !== 200) {
    console.log('Body (first 1000 bytes):', res.body.toString('utf8').slice(0, 1000));
    process.exitCode = 1;
    return;
  }

  fs.writeFileSync('csv-export-test.csv', res.body);
  const text = res.body.toString('utf8');
  const lines = text.split('\n').filter(Boolean);
  console.log(`Tổng ${lines.length} dòng (kể cả header)`);
  console.log('3 dòng đầu:', JSON.stringify(lines.slice(0, 3)));
  console.log('3 dòng cuối:', JSON.stringify(lines.slice(-3)));
})().catch((e) => {
  console.log('LỖI:', e.stack || e);
  process.exitCode = 1;
});
