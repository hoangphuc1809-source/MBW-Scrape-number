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
  const gpuCols = allCols('GPU');
  // Cot CHUOI GOC: Phuc da dung san khoi anh xa trong tab —
  //   [12] "Card đồ họa" (chuoi tho tu retailer)  -> [13] "GPU" (dang chuan)
  //   [18] "CPU Orginal" (chuoi tho)              -> [17] "CPU" (dang chuan)
  // Ban dau em coi ca hai cot deu la danh sach chuan nen dem chung thanh
  // "trung lap" — sai. 40 cach viet cua RTX 3050 chinh la bang anh xa dang
  // hoat dong dung, khong phai loi.
  const rawGpuCols = allCols('Card đồ họa', 'GPU Orginal', 'GPU Original');
  const rawCpuCols = allCols('CPU Orginal', 'CPU Original');
  console.log(`Cot chuan : CPU=[${cpuCols}] Segment=[${segCols}] Platform=[${platCols}] GPU=[${gpuCols}]`);
  console.log(`Cot goc   : CPU=[${rawCpuCols}] GPU=[${rawGpuCols}]\n`);

  // Tab co HAI khoi CPU (cot F-H va Q-S) nen "dòng 41, cột CPU" la mo ho —
  // Phuc khong biet o nao. Ghi kem dia chi o that (vd "R41") de dan thang
  // vao Name Box cua Google Sheets la nhay den dung cho.
  const colLetter = i => {
    let n = i, s2 = '';
    do { s2 = String.fromCharCode(65 + (n % 26)) + s2; n = Math.floor(n / 26) - 1; } while (n >= 0);
    return s2;
  };
  const cellRef = (i, line) => colLetter(i) + line;

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
        problems.push({ kind: 'Ô rác', line, cell: cellRef(iCpu, line), col: 'CPU', now: cpu, note: 'không phải tên chip' });
        continue;
      }
      const n = normalizeCpu(cpu);
      if (n.confidence !== 'full') {
        problems.push({ kind: 'Luật chưa nhận ra', line, cell: cellRef(iCpu, line), col: 'CPU', now: cpu,
                        note: 'dữ liệu scraper sẽ không khớp vào dòng này — em cần sửa luật' });
        continue;
      }
      // Trung lap: hai cach viet cua cung mot con chip
      if (!seenCpu.has(n.cpu)) seenCpu.set(n.cpu, new Map());
      seenCpu.get(n.cpu).set(cpu, line);

      const iSeg = nearest(segCols, iCpu), iPlat = nearest(platCols, iCpu);
      if (iSeg >= 0) {
        const seg = String(row[iSeg] || '').trim();
        if (!seg) problems.push({ kind: 'Thiếu', line, cell: cellRef(iSeg, line), col: 'CPU Segment', now: '(trống)', note: `CPU là "${cpu}"` });
        else if (seg !== n.segment && seg.replace(/\s+/g, ' ') !== n.segment) {
          problems.push({ kind: 'Lệch trong cùng dòng', line, cell: cellRef(iSeg, line), col: 'CPU Segment', now: seg,
                          note: `CPU là "${cpu}" -> segment phải là "${n.segment}"` });
        }
      }
      if (iPlat >= 0) {
        const plat = String(row[iPlat] || '').trim(), should = cpuPlatform(n.cpu);
        if (plat && should && plat !== should) {
          problems.push({ kind: 'Lệch trong cùng dòng', line, cell: cellRef(iPlat, line), col: 'CPU Platform', now: plat,
                          note: `CPU là "${cpu}" -> hãng phải là "${should}"` });
        }
      }
    }

    for (const iGpu of gpuCols) {
      const gpu = String(row[iGpu] || '').trim();
      if (!gpu) continue;
      if (JUNK.test(gpu) || /đang cập nhật/i.test(gpu)) {
        problems.push({ kind: 'Ô rác', line, cell: cellRef(iGpu, line), col: 'GPU', now: gpu, note: 'không phải tên GPU' });
        continue;
      }
      const g = K.gpu(gpu);
      if (!g) {
        problems.push({ kind: 'Luật chưa nhận ra', line, cell: cellRef(iGpu, line), col: 'GPU', now: gpu,
                        note: 'dữ liệu scraper sẽ không khớp vào dòng này — em cần sửa luật' });
        continue;
      }
      if (!seenGpu.has(g)) seenGpu.set(g, new Map());
      seenGpu.get(g).set(gpu, line);
    }

    // --- Khoi ANH XA: chuoi goc -> dang chuan Phuc ghi canh no ---
    // Kiem tra khac han: khong hoi "co dung chuan khong", ma hoi "luat co dan
    // chuoi goc nay ve DUNG cai Phuc ghi khong". Neu lech thi khi scraper gap
    // chuoi do se dien ra gia tri khac voi y Phuc.
    for (const iRaw of rawCpuCols) {
      const raw = String(row[iRaw] || '').trim();
      const iC = nearest(cpuCols, iRaw);
      if (!raw || iC < 0) continue;
      const want = String(row[iC] || '').trim();
      if (!want || JUNK.test(raw)) continue;
      const got = normalizeCpu(raw);
      if (got.confidence !== 'full') {
        problems.push({ kind: 'Ánh xạ hỏng', line, cell: cellRef(iC, line), col: 'CPU Orginal', now: raw,
                        note: `luật không đọc được -> sẽ không dẫn về "${want}"` });
      } else if (got.cpu !== want) {
        problems.push({ kind: 'Ánh xạ lệch', line, cell: cellRef(iC, line), col: 'CPU Orginal', now: raw,
                        note: `anh ghi "${want}" nhưng luật dẫn về "${got.cpu}"` });
      }
    }
    for (const iRaw of rawGpuCols) {
      const raw = String(row[iRaw] || '').trim();
      const iC = nearest(gpuCols, iRaw);
      if (!raw || iC < 0) continue;
      const want = String(row[iC] || '').trim();
      if (!want || JUNK.test(raw)) continue;
      const got = K.gpu(raw);
      if (!got) {
        problems.push({ kind: 'Ánh xạ hỏng', line, cell: cellRef(iC, line), col: 'Card đồ họa', now: raw,
                        note: `luật không đọc được -> sẽ không dẫn về "${want}"` });
      } else if (got !== want) {
        problems.push({ kind: 'Ánh xạ lệch', line, cell: cellRef(iC, line), col: 'Card đồ họa', now: raw,
                        note: `anh ghi "${want}" nhưng luật dẫn về "${got}"` });
      }
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
  const order = ['Ánh xạ lệch', 'Ánh xạ hỏng', 'Trùng lặp', 'Lệch trong cùng dòng', 'Thiếu', 'Ô rác', 'Luật chưa nhận ra'];
  for (const kind of order) {
    const g = problems.filter(p => p.kind === kind);
    if (!g.length) continue;
    console.log(`\n--- ${kind} (${g.length}) ---`);
    g.slice(0, 60).forEach(p => console.log(`  dòng ${String(p.line).padStart(4)} | ${p.col.padEnd(13)} | ${p.now}\n${' '.repeat(24)}${p.note}`));
    if (g.length > 60) console.log(`  ... còn ${g.length - 60} dòng nữa, xem file`);
  }

  // Tat ca xuat ra .csv CO BOM (\uFEFF), khong dung .tsv nua: GitHub render
  // .csv thanh BANG xem duoc thang tren trinh duyet/dien thoai, con .tsv thi
  // hien ra van ban tho. Va thieu BOM thi Excel doc tieng Viet thanh ky tu loi.
  const csvEsc = v => {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const writeCsv = (file, rows) => {
    fs.writeFileSync(file, '\uFEFF' + rows.map(r => r.map(csvEsc).join(',')).join('\r\n'), 'utf8');
  };

  fs.mkdirSync('segment-audit', { recursive: true });
  writeCsv('segment-audit/segment-audit.csv',
    [['Loại', 'Ô', 'Dòng', 'Cột', 'Giá trị', 'Ghi chú'],
     ...problems.map(p => [p.kind, p.cell || '', p.line, p.col, p.now, p.note])]);
  console.log(`Da ghi segment-audit/segment-audit.csv (${problems.length} dong)`);

  // --- Danh sach CHUAN da khu trung, de Phuc thay the vao tab ---
  //
  // Dang chuan = dang BO LUAT dung lai, KHONG phai "cach viet dau tien gap".
  // Ly do: thu tu gap phu thuoc thu tu duyet dong, chay lai co the ra khac ->
  // dung im lang. Dang luat dung lai la tat dinh.
  const outLines = [['Loại', 'Giá trị chuẩn', 'Số cách viết', 'Các cách viết hiện có trong tab (dòng)']];
  let dupCount = 0;
  for (const [label, seen] of [['CPU', seenCpu], ['GPU', seenGpu]]) {
    const keys = [...seen.keys()].sort();
    for (const key of keys) {
      const variants = seen.get(key);
      if (variants.size > 1) dupCount++;
      const detail = [...variants.entries()]
        .sort((a, b) => Number(a[1]) - Number(b[1]))          // sap theo so dong cho de tra
        .map(([v, l]) => `"${v}" (${l})`).join(' | ');
      outLines.push([label, key, variants.size, detail]);
    }
  }
  writeCsv('segment-audit/segment-normalized.csv', outLines);
  console.log(`Da ghi segment-audit/segment-normalized.tsv`);
  console.log(`  CPU chuan: ${seenCpu.size} gia tri   |   GPU chuan: ${seenGpu.size} gia tri`);
  console.log(`  trong do ${dupCount} gia tri hien dang co NHIEU HON MOT cach viet trong tab`);

  // --- Danh sach SUA CU THE ---
  // Chi gom nhung van de co DICH RO RANG (biet phai sua thanh gi). Cac loai
  // khac (o rac, luat chua nhan ra) khong co dich nen khong dua vao day.
  const fix = [];
  for (const p of problems) {
    let target = null;
    if (p.kind === 'Ánh xạ lệch') {
      const m = p.note.match(/luật dẫn về "(.+?)"$/);
      if (m) target = m[1];
    } else if (p.kind === 'Lệch trong cùng dòng') {
      const m = p.note.match(/phải là "(.+?)"$/);
      if (m) target = m[1];
    }
    if (!target) continue;
    // Voi 'Anh xa lech', o CAN SUA la o DANG CHUAN ben canh, khong phai o goc.
    const cell = p.kind === 'Ánh xạ lệch'
      ? (p.col === 'CPU Orginal' ? 'CPU' : 'GPU')
      : p.col;
    const current = p.kind === 'Ánh xạ lệch'
      ? (p.note.match(/anh ghi "(.+?)" nhưng/) || [, ''])[1]
      : p.now;
    if (current === target) continue;
    fix.push({ cell: p.cell || '', line: p.line, col: cell, cur: current, to: target, kind: p.kind });
  }
  // Khu trung theo dia chi o: mot o chi can sua mot lan
  const seenCell = new Set();
  const uniq = fix.filter(f => {
    const k = `${f.cell}|${f.cur}|${f.to}`;
    if (seenCell.has(k)) return false;
    seenCell.add(k); return true;
  });
  // Sap xep theo CAP SUA (cot + gia tri cu + gia tri moi) roi moi den so dong:
  // cac o sua GIONG NHAU nam lien nhau -> Phuc lam mot mach, khong phai nhay
  // qua nhay lai giua cac loai sua khac nhau.
  uniq.sort((a, b) =>
    (a.col + a.cur + a.to).localeCompare(b.col + b.cur + b.to) || Number(a.line) - Number(b.line));
  writeCsv('segment-audit/segment-fixlist.csv',
    [['Ô', 'Dòng', 'Cột', 'Giá trị hiện tại', 'Sửa thành', 'Loại'],
     ...uniq.map(f => [f.cell, f.line, f.col, f.cur, f.to, f.kind])]);
  console.log(`Da ghi segment-audit/segment-fixlist.csv (${uniq.length} o can sua, co dich ro rang)`);

  // README de mo tren GitHub la hieu ngay moi file la gi, khong phai hoi lai.
  const stamp = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  fs.writeFileSync('segment-audit/README.md', [
    '# Kiểm tra tab `Segment`',
    '',
    `Cập nhật: **${stamp}** — tự sinh bởi job \`segment-audit\` (ops-tools).`,
    'Chỉ đọc Sheet, không ghi. Chạy lại: Actions → Ops Tools → tick `run_segment_audit`.',
    '',
    '| File | Nội dung |',
    '|---|---|',
    '| [`segment-fixlist.csv`](segment-fixlist.csv) | **Bắt đầu từ đây.** Ô cần sửa kèm giá trị đúng. |',
    '| [`segment-audit.csv`](segment-audit.csv) | Toàn bộ vấn đề, phân theo loại. |',
    '| [`segment-normalized.csv`](segment-normalized.csv) | Danh sách giá trị chuẩn, kèm mọi cách viết đang có. |',
    '',
    '## Cách dùng `segment-fixlist.csv`',
    '',
    'Cột **`Ô`** là địa chỉ ô thật trong tab `Segment` (ví dụ `R41`).',
    'Dán nó vào ô Name Box của Google Sheets (góc trên bên trái, cạnh thanh công thức)',
    'rồi Enter — con trỏ nhảy thẳng tới đúng ô. Gõ đè giá trị ở cột `Sửa thành`.',
    '',
    'Cần địa chỉ ô vì tab có **hai khối CPU** (cột F–H và Q–S), nên chỉ nói',
    '"dòng 41, cột CPU" là không đủ để biết ô nào.',
    '',
    'File đã sắp xếp theo **cặp sửa**: các ô sửa giống hệt nhau nằm liền nhau,',
    'làm một mạch cho nhanh. Không bắt buộc làm hết một lượt — sửa tới đâu,',
    'lần scrape sau áp tới đó.',
    '',
    '**Không sửa** cột chuỗi gốc (`CPU Orginal`, `Card đồ họa`) — đó là dữ liệu thô',
    'từ retailer, sửa vào là hỏng bảng ánh xạ.',
    '',
    '## Các loại vấn đề',
    '',
    '- **Ánh xạ lệch** — luật dẫn chuỗi gốc về giá trị khác với ô chuẩn ghi cạnh nó. Sửa ô **dạng chuẩn** (cột `CPU`/`GPU`), không sửa ô chuỗi gốc.',
    '- **Ánh xạ hỏng** — luật không đọc được chuỗi gốc, dòng ánh xạ đó vô dụng.',
    '- **Trùng lặp** — hai cách viết của cùng một thứ cùng tồn tại. Phải bỏ bớt một.',
    '- **Lệch trong cùng dòng** — `CPU Segment` hoặc `CPU Platform` không khớp `CPU` cùng dòng.',
    '- **Ô rác** — `#N/A`, `Đang cập nhật`, `Graphics` chung chung.',
    '- **Luật chưa nhận ra** — dữ liệu scraper sẽ không bao giờ khớp vào dòng này. Đây là việc cần sửa **luật**, không phải sửa Sheet.',
    '',
    `Tổng: **${problems.length}** vấn đề, trong đó **${uniq.length}** ô có đích rõ ràng.`,
    '',
    'Sửa tới đâu, lần scrape sau áp tới đó — không cần làm hết một lượt.',
    '',
  ].join('\n'), 'utf8');
  console.log('Da ghi segment-audit/README.md');
}

main().catch(e => { console.error('LOI:', e.message); process.exit(1); });
