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

  // Tab co NHIEU khoi lap lai (CPU/GPU xuat hien o vai cum cot khac nhau), va
  // header co loi chinh ta thuc te: "CPU Flatform" thay vi "CPU Platform".
  // Nen tim TAT CA cot khop, khong phai cot dau tien, va chap nhan viet sai.
  const allCols = (...names) => header.map((h, i) => {
    const low = h.toLowerCase().replace(/\s+/g, ' ');
    return names.some(n => low === n.toLowerCase()) ? i : -1;
  }).filter(i => i >= 0);

  const cpuCols  = allCols('CPU');
  const segCols  = allCols('CPU Segment');
  const platCols = allCols('CPU Platform', 'CPU Flatform', 'CPU Flatfrom');
  const gpuCols  = allCols('GPU', 'Card đồ họa');
  console.log(`\nCot tim thay: CPU=[${cpuCols}]  CPU Segment=[${segCols}]  Platform=[${platCols}]  GPU=[${gpuCols}]`);

  // Ghep CPU voi Segment/Platform gan no nhat ve phia trai trong cung khoi.
  const nearest = (cols, target) => {
    const left = cols.filter(c => Math.abs(c - target) <= 3);
    return left.length ? left.reduce((a, b) => Math.abs(a - target) < Math.abs(b - target) ? a : b) : -1;
  };

  const problems = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const line = r + 1;                       // so dong that trong Sheet

    for (const iCpu of cpuCols) {
      const cpu = String(row[iCpu] || '').trim();
      if (!cpu) continue;
      const iSeg = nearest(segCols, iCpu), iPlat = nearest(platCols, iCpu);
      const n = normalizeCpu(cpu);
      if (n.confidence !== 'full') {
        problems.push({ line, col: 'CPU', now: cpu, should: '(máy không nhận ra)',
                        why: 'chuỗi thiếu mã số hoặc bị cắt cụt' });
        continue;
      }
      if (n.cpu !== cpu) {
        // Hai chuoi nhin GIONG HET nhau tren man hinh nhung khac nhau -> o do
        // chua khoang trang la (non-breaking space) hoac tab. Phai bao rieng,
        // neu khong Phuc se tuong may bao sai.
        const why = n.cpu.replace(/\s/g, '') === cpu.replace(/\s/g, '')
          ? 'có ký tự trắng lạ (nhìn giống nhau nhưng khác)'
          : 'khác dạng chuẩn';
        problems.push({ line, col: 'CPU', now: cpu, should: n.cpu, why });
      }
      if (iSeg >= 0) {
        const seg = String(row[iSeg] || '').trim();
        if (seg && seg !== n.segment) problems.push({ line, col: 'CPU Segment', now: seg, should: n.segment, why: 'không khớp CPU cùng dòng' });
        else if (!seg) problems.push({ line, col: 'CPU Segment', now: '(trống)', should: n.segment, why: 'thiếu' });
      }
      if (iPlat >= 0) {
        const plat = String(row[iPlat] || '').trim();
        const pShould = cpuPlatform(n.cpu);
        if (plat && pShould && plat !== pShould) problems.push({ line, col: 'CPU Platform', now: plat, should: pShould, why: 'sai hãng' });
      }
    }

    for (const iGpu of gpuCols) {
      const gpu = String(row[iGpu] || '').trim();
      if (!gpu) continue;
      const g = K.gpu(gpu);
      if (!g) problems.push({ line, col: 'GPU', now: gpu, should: '(máy không nhận ra)', why: 'không khớp mẫu nào' });
      else if (g !== gpu) {
        // Neu chi khac nhau o ky tu trang la o dang chua khoang trang la
        // (non-breaking space) — bao rieng vi nhin bang mat khong thay.
        const why = g.replace(/\s/g, '') === gpu.replace(/\s/g, '')
          ? 'có ký tự trắng lạ (nhìn giống nhau nhưng khác)'
          : 'khác dạng chuẩn';
        problems.push({ line, col: 'GPU', now: gpu, should: g, why });
      }
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
