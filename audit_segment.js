// audit_segment.js — kiem tra tab "Segment" trong Retail Price Tracking.
//
// TRIET LY (sua 02/09 sau khi Phuc gop y): tab Segment la CHUAN, do Phuc da
// chuan hoa ~99%. Bo luat trong spec_normalize.js KHONG phai thuoc do dung/sai
// — no chi lam mot viec: ANH XA chuoi lon xon tu cac retailer VE cac gia tri
// co san trong tab nay.
//
// Vi vay audit KHONG con bao "khac dang chuan" khi luat dung lai ten khac cach
// Phuc viet. Truoc do em lam vay va no sai huong: bao 496 o "phai sua" trong
// khi phan lon chi la luat cua em viet khac, chu du lieu khong sai.
//
// Gio chi bao 4 loai — deu la van de THAT du lay tab nay lam chuan:
//   1. TRUNG LAP: hai cach viet cua CUNG mot con chip/GPU cung ton tai trong
//      tab. Bat buoc phai bo mot, neu khong tra cuu se ra hai ket qua khac nhau.
//   2. LECH TRONG CUNG DONG: CPU Segment hoac Platform khong khop voi CPU.
//   3. O RAC: "#N/A", "Dang cap nhat", "Graphics", o trong.
//   4. KHONG ANH XA DUOC: luat khong nhan ra gia tri nay, nghia la du lieu
//      scraper se KHONG BAO GIO khop vao dong do -> dong do vo dung.
//      Day la loi CUA LUAT, khong phai cua Phuc; bao ra de em di sua luat.
//
// CHI DOC: scope spreadsheets.readonly.
const fs = require('fs');
const { google } = require('googleapis');
const { normalizeCpu } = require('./spec_normalize.js');
const { K, cpuPlatform } = require('./spec_dictionary.js');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const TAB = process.env.SEGMENT_TAB || 'Segment';

// O khong mang thong tin — khong phai gia tri chuan.
const JUNK = /^(#N\/A|#REF!|#VALUE!|n\/a|na|-|--|\?+|đang cập nhật|dang cap nhat|graphics|integrated graphics|intel|amd|apple|nvidia)$/i;

async function main() {
  fs.writeFileSync('/tmp/creds.json', process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({
    keyFile: '/tmp/creds.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID, range: `'${TAB}'!A1:Z2000`,
  });
  const rows = res.data.values || [];
  if (!rows.length) { console.log('Tab rong hoac khong doc duoc.'); return; }

  const header = rows[0].map(h => String(h || '').trim());
  // Tab co nhieu khoi CPU/GPU lap lai, va header viet "CPU Flatform" (thieu P).
  const allCols = (...names) => header.map((h, i) =>
    names.some(n => h.toLowerCase().replace(/\s+/g, ' ') === n.toLowerCase()) ? i : -1).filter(i => i >= 0);
  const cpuCols = allCols('CPU'), segCols = allCols('CPU Segment');
  const platCols = allCols('CPU Platform', 'CPU Flatform', 'CPU Flatfrom');
  const gpuCols = allCols('GPU', 'Card đồ họa');
  console.log(`Cot: CPU=[${cpuCols}] Segment=[${segCols}] Platform=[${platCols}] GPU=[${gpuCols}]\n`);

  const nearest = (cols, t) => {
    const c = cols.filter(x => Math.abs(x - t) <= 3);
    return c.length ? c.reduce((a, b) => Math.abs(a - t) < Math.abs(b - t) ? a : b) : -1;
  };

  const problems = [];
  const seenCpu = new Map();   // key con chip -> [cach viet]
  const seenGpu = new Map();

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [], line = r + 1;

    for (const iCpu of cpuCols) {
      const cpu = String(row[iCpu] || '').trim();
      if (!cpu) continue;
      if (JUNK.test(cpu) || /đang cập nhật/i.test(cpu)) {
        problems.push({ kind: 'Ô rác', line, col: 'CPU', now: cpu, note: 'không phải tên chip' });
        continue;
      }
      const n = normalizeCpu(cpu);
      if (n.confidence !== 'full') {
        problems.push({ kind: 'Luật chưa nhận ra', line, col: 'CPU', now: cpu,
                        note: 'dữ liệu scraper sẽ không khớp vào dòng này — em cần sửa luật' });
        continue;
      }
      // Trung lap: hai cach viet cua cung mot con chip
      if (!seenCpu.has(n.cpu)) seenCpu.set(n.cpu, new Map());
      seenCpu.get(n.cpu).set(cpu, line);

      const iSeg = nearest(segCols, iCpu), iPlat = nearest(platCols, iCpu);
      if (iSeg >= 0) {
        const seg = String(row[iSeg] || '').trim();
        if (!seg) problems.push({ kind: 'Thiếu', line, col: 'CPU Segment', now: '(trống)', note: `CPU là "${cpu}"` });
        else if (seg !== n.segment && seg.replace(/\s+/g, ' ') !== n.segment) {
          problems.push({ kind: 'Lệch trong cùng dòng', line, col: 'CPU Segment', now: seg,
                          note: `CPU là "${cpu}" -> segment phải là "${n.segment}"` });
        }
      }
      if (iPlat >= 0) {
        const plat = String(row[iPlat] || '').trim(), should = cpuPlatform(n.cpu);
        if (plat && should && plat !== should) {
          problems.push({ kind: 'Lệch trong cùng dòng', line, col: 'CPU Platform', now: plat,
                          note: `CPU là "${cpu}" -> hãng phải là "${should}"` });
        }
      }
    }

    for (const iGpu of gpuCols) {
      const gpu = String(row[iGpu] || '').trim();
      if (!gpu) continue;
      if (JUNK.test(gpu) || /đang cập nhật/i.test(gpu)) {
        problems.push({ kind: 'Ô rác', line, col: 'GPU', now: gpu, note: 'không phải tên GPU' });
        continue;
      }
      const g = K.gpu(gpu);
      if (!g) {
        problems.push({ kind: 'Luật chưa nhận ra', line, col: 'GPU', now: gpu,
                        note: 'dữ liệu scraper sẽ không khớp vào dòng này — em cần sửa luật' });
        continue;
      }
      if (!seenGpu.has(g)) seenGpu.set(g, new Map());
      seenGpu.get(g).set(gpu, line);
    }
  }

  // Trung lap trong chinh tab
  for (const [label, seen] of [['CPU', seenCpu], ['GPU', seenGpu]]) {
    for (const [key, variants] of seen) {
      if (variants.size <= 1) continue;
      const list = [...variants.entries()].map(([v, l]) => `"${v}" (dòng ${l})`).join('  vs  ');
      problems.push({ kind: 'Trùng lặp', line: [...variants.values()][0], col: label, now: list,
                      note: 'cùng một thứ nhưng hai cách viết — phải bỏ bớt một' });
    }
  }

  const byKind = {};
  problems.forEach(p => { byKind[p.kind] = (byKind[p.kind] || 0) + 1; });
  console.log(`===== ${problems.length} VAN DE =====`);
  Object.entries(byKind).forEach(([k, n]) => console.log(`  ${k.padEnd(22)} ${n}`));
  console.log('');
  const order = ['Trùng lặp', 'Lệch trong cùng dòng', 'Thiếu', 'Ô rác', 'Luật chưa nhận ra'];
  for (const kind of order) {
    const g = problems.filter(p => p.kind === kind);
    if (!g.length) continue;
    console.log(`\n--- ${kind} (${g.length}) ---`);
    g.slice(0, 60).forEach(p => console.log(`  dòng ${String(p.line).padStart(4)} | ${p.col.padEnd(13)} | ${p.now}\n${' '.repeat(24)}${p.note}`));
    if (g.length > 60) console.log(`  ... còn ${g.length - 60} dòng nữa, xem file`);
  }

  fs.mkdirSync('segment-audit', { recursive: true });
  fs.writeFileSync('segment-audit/segment-audit.tsv',
    ['Loại\tDòng\tCột\tGiá trị\tGhi chú', ...problems.map(p => [p.kind, p.line, p.col, p.now, p.note].join('\t'))].join('\n'), 'utf8');
  console.log(`\nDa ghi segment-audit/segment-audit.tsv (${problems.length} dong)`);

  // --- Danh sach CHUAN da khu trung, de Phuc thay the vao tab ---
  //
  // Dang chuan = dang BO LUAT dung lai, KHONG phai "cach viet dau tien gap".
  // Ly do: thu tu gap phu thuoc thu tu duyet dong, chay lai co the ra khac ->
  // dung im lang. Dang luat dung lai la tat dinh.
  const outLines = ['Loại\tGiá trị chuẩn\tSố cách viết\tCác cách viết hiện có trong tab (dòng)'];
  let dupCount = 0;
  for (const [label, seen] of [['CPU', seenCpu], ['GPU', seenGpu]]) {
    const keys = [...seen.keys()].sort();
    for (const key of keys) {
      const variants = seen.get(key);
      if (variants.size > 1) dupCount++;
      const detail = [...variants.entries()]
        .sort((a, b) => Number(a[1]) - Number(b[1]))          // sap theo so dong cho de tra
        .map(([v, l]) => `"${v}" (${l})`).join(' | ');
      outLines.push([label, key, variants.size, detail].join('\t'));
    }
  }
  fs.writeFileSync('segment-audit/segment-normalized.tsv', outLines.join('\n'), 'utf8');
  console.log(`Da ghi segment-audit/segment-normalized.tsv`);
  console.log(`  CPU chuan: ${seenCpu.size} gia tri   |   GPU chuan: ${seenGpu.size} gia tri`);
  console.log(`  trong do ${dupCount} gia tri hien dang co NHIEU HON MOT cach viet trong tab`);
}

main().catch(e => { console.error('LOI:', e.message); process.exit(1); });
