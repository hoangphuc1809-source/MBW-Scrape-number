// audit_segment.js — doc tab "Segment" trong Retail Price Tracking, doi chieu
// tung dong voi bo luat chuan hoa, in ra dong nao sai quy luat.
//
// CHI DOC. Scope la spreadsheets.readonly — khong the ghi vao Sheet du co loi
// lap trinh. Phuc tu sua tay sau khi xem bao cao.
//
// Tab "Segment" gom nhieu KHOI cach nhau bang cot trong:
//   B:D  Brand | Segment | Series Group
//   F:H  CPU Segment | CPU | CPU Platform
//   J    GPU
// Script tu do vi tri khoi bang header thay vi hardcode chu cai cot, de sau
// nay Phuc chen them cot ma khong lam hong.
const fs = require('fs');
const { google } = require('googleapis');
const { normalizeCpu } = require('./spec_normalize.js');
const { K, cpuPlatform } = require('./spec_dictionary.js');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const TAB = process.env.SEGMENT_TAB || 'Segment';

async function main() {
  const credsPath = '/tmp/creds.json';
  fs.writeFileSync(credsPath, process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({
    keyFile: credsPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${TAB}'!A1:Z2000`,
  });
  const rows = res.data.values || [];
  if (!rows.length) { console.log('Tab rong hoac khong doc duoc.'); return; }

  const header = rows[0].map(h => String(h || '').trim());
  console.log('Header:', header.map((h, i) => h ? `[${i}] ${h}` : null).filter(Boolean).join('  '));

  const col = name => header.findIndex(h => h.toLowerCase() === name.toLowerCase());
  const iSeg = col('CPU Segment'), iCpu = col('CPU'), iPlat = col('CPU Platform'), iGpu = col('GPU');
  console.log(`\nVi tri cot: CPU Segment=${iSeg}  CPU=${iCpu}  Platform=${iPlat}  GPU=${iGpu}`);

  const problems = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const line = r + 1;                       // so dong that trong Sheet

    // --- Khoi CPU ---
    const cpu = String(row[iCpu] || '').trim();
    if (cpu) {
      const n = normalizeCpu(cpu);
      if (n.confidence !== 'full') {
        problems.push({ line, col: 'CPU', now: cpu, should: '(máy không nhận ra)',
                        why: 'chuỗi thiếu mã số hoặc bị cắt cụt' });
      } else {
        if (n.cpu !== cpu) problems.push({ line, col: 'CPU', now: cpu, should: n.cpu, why: 'khác dạng chuẩn' });
        const seg = String(row[iSeg] || '').trim();
        if (seg && seg !== n.segment) problems.push({ line, col: 'CPU Segment', now: seg, should: n.segment, why: 'không khớp CPU cùng dòng' });
        if (!seg) problems.push({ line, col: 'CPU Segment', now: '(trống)', should: n.segment, why: 'thiếu' });
        const plat = String(row[iPlat] || '').trim();
        const pShould = cpuPlatform(n.cpu);
        if (plat && pShould && plat !== pShould) problems.push({ line, col: 'CPU Platform', now: plat, should: pShould, why: 'sai hãng' });
      }
    }

    // --- Khoi GPU ---
    const gpu = String(row[iGpu] || '').trim();
    if (gpu) {
      const g = K.gpu(gpu);
      if (!g) problems.push({ line, col: 'GPU', now: gpu, should: '(máy không nhận ra)', why: 'không khớp mẫu nào' });
      else if (g !== gpu) problems.push({ line, col: 'GPU', now: gpu, should: g, why: 'khác dạng chuẩn' });
    }
  }

  console.log(`\n===== ${problems.length} DONG SAI QUY LUAT =====\n`);
  const byCol = {};
  problems.forEach(p => { byCol[p.col] = (byCol[p.col] || 0) + 1; });
  Object.entries(byCol).forEach(([c, n]) => console.log(`  ${c.padEnd(14)} ${n}`));
  console.log('');
  for (const p of problems) {
    console.log(`  dòng ${String(p.line).padStart(4)} | ${p.col.padEnd(13)} | "${p.now}"  ->  "${p.should}"   (${p.why})`);
  }

  fs.mkdirSync('segment-audit', { recursive: true });
  const tsv = ['Dòng\tCột\tGiá trị hiện tại\tĐề xuất\tLý do',
    ...problems.map(p => [p.line, p.col, p.now, p.should, p.why].join('\t'))].join('\n');
  fs.writeFileSync('segment-audit/segment-audit.tsv', tsv, 'utf8');
  console.log(`\nDa ghi segment-audit/segment-audit.tsv (${problems.length} dong)`);
}

main().catch(e => { console.error('LOI:', e.message); process.exit(1); });
