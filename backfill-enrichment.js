// Backfill enrichment T->AE cho RAW DATA hien co, va doi header A1:S1 sang
// tieng Anh. v3.6.2: doc Part # va Segment theo TEN COT (header), khong
// theo vi tri co dinh -- Phuc co the chen/doi vi tri cot Part # tuy y ma
// khong lam vo script nay (giong multi_dealer_scraper.js).
const fs = require('fs');
const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const CREDS_PATH = '/tmp/gcreds-backfill.json';
const RAW_DATA_TAB = 'Daily SRP Tracking';
const PART_TAB = 'Part #';
const SEGMENT_TAB = 'Segment';
const EXECUTE = process.env.EXECUTE === 'true';

const HEADERS_EN = [
  'Date', 'Time', 'No', 'Dealer', 'Model Name', 'Brand',
  'CPU (Listed)', 'RAM (Listed)', 'Storage', 'Screen Size', 'GPU (Listed)', 'Weight',
  'Original Price', 'Sale Price', 'Discount %', 'Units Sold', 'Rating', 'Product Link',
  'Availability',
];
const ENRICHMENT_HEADERS = [
  'Status', 'Series Group', 'Segment', 'CPU Segment', 'CPU', 'RAM', 'SSD',
  'Screen', 'GPU', 'V-RAM', 'Part #', 'Focus Model',
];

async function withRetry(fn, label, tries = 3) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try { return await fn(); }
    catch (err) {
      lastErr = err;
      console.log(`   loi ${label} lan ${i}/${tries}: ${err.message}`);
      if (i < tries) await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw lastErr;
}

function safeVal(v) {
  if (typeof v === 'string' && v.startsWith('=')) return '';
  return v ?? '';
}

function buildHeaderIndex(headerRow) {
  const idx = {};
  (headerRow || []).forEach((h, i) => {
    const key = String(h || '').trim();
    if (key) idx[key] = i;
  });
  return idx;
}

function colLetter(n) {
  let s = '';
  let num = n + 1;
  while (num > 0) {
    const rem = (num - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    num = Math.floor((num - 1) / 26);
  }
  return s;
}

// Thay cho cong thuc BYROW+REGEXMATCH cua Part # cot Segment, roi MAP+INDEX
// cua cot Series Group: tim tu khoa Segment (tab Segment) DAI NHAT xuat
// hien trong ten san pham (khong phan biet hoa/thuong), tra ve chinh tu
// khoa do (=Segment) va Series Group tuong ung.
function matchSegment(productName, segmentRefs) {
  const nameLower = (productName || '').toLowerCase();
  let best = null;
  for (const ref of segmentRefs) {
    if (ref.keywordLower && nameLower.includes(ref.keywordLower)) {
      if (!best || ref.keyword.length > best.keyword.length) best = ref;
    }
  }
  return best ? { segment: best.keyword, seriesGroup: best.seriesGroup } : { segment: '', seriesGroup: '' };
}

async function readAllRows(sheets, tabName, totalRows, lastCol) {
  const CHUNK = 5000;
  const out = [];
  for (let start = 2; start <= totalRows; start += CHUNK) {
    const end = Math.min(start + CHUNK - 1, totalRows);
    const res = await withRetry(
      () => sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${tabName}'!A${start}:${lastCol}${end}`,
        valueRenderOption: 'FORMULA',
      }, { timeout: 60000 }),
      `Doc ${tabName} ${start}-${end}`
    );
    const rows = res.data.values || [];
    for (const r of rows) if (r.some((c) => c !== '' && c !== undefined && c !== null)) out.push(r);
    console.log(`   doc ${tabName} ${start}-${end}: ${rows.length} dong tho`);
  }
  return out;
}

(async () => {
  console.log(`=== Backfill enrichment T->AE cho RAW DATA - ${EXECUTE ? 'THUC THI' : 'DRY RUN'} ===`);
  fs.writeFileSync(CREDS_PATH, process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({ keyFile: CREDS_PATH, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = google.sheets({ version: 'v4', auth });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets(properties(title,gridProperties))' });

  // 1. Doc header Part # de biet vi tri THAT SU cua tung cot can (khong
  //    doan mo theo vi tri co dinh nua).
  const partSheet = meta.data.sheets.find((s) => s.properties.title === PART_TAB);
  const partTotalRows = partSheet.properties.gridProperties.rowCount;
  const partLastCol = colLetter(partSheet.properties.gridProperties.columnCount - 1);
  console.log(`Tab "${PART_TAB}": grid rowCount=${partTotalRows}`);

  const partHeaderRes = await withRetry(
    () => sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${PART_TAB}'!A1:${partLastCol}1`, valueRenderOption: 'FORMULA' }, { timeout: 60000 }),
    'Doc header Part #'
  );
  const pIdx = buildHeaderIndex((partHeaderRes.data.values || [[]])[0]);
  const REQUIRED = ['Product Name', 'Part #', 'CPU Segment', 'CPU', 'RAM', 'SSD', 'Screen', 'GPU', 'V-RAM', 'Status', 'Focus Model'];
  const missing = REQUIRED.filter((name) => !(name in pIdx));
  if (missing.length > 0) console.log(`   CANH BAO: Part # thieu cot: ${missing.join(', ')} - cac field nay se de trong.`);
  const iName = pIdx['Product Name'];
  if (iName === undefined) throw new Error('Khong tim thay cot "Product Name" trong Part # - dung lai.');

  const partRows = await readAllRows(sheets, PART_TAB, partTotalRows, partLastCol);
  const partMap = new Map();
  for (const r of partRows) {
    const name = (r[iName] || '').trim();
    if (!name) continue;
    partMap.set(name, {
      status: pIdx['Status'] !== undefined ? safeVal(r[pIdx['Status']]) : '',
      cpuSegment: pIdx['CPU Segment'] !== undefined ? safeVal(r[pIdx['CPU Segment']]) : '',
      cpu: pIdx['CPU'] !== undefined ? safeVal(r[pIdx['CPU']]) : '',
      ram: pIdx['RAM'] !== undefined ? safeVal(r[pIdx['RAM']]) : '',
      ssd: pIdx['SSD'] !== undefined ? safeVal(r[pIdx['SSD']]) : '',
      screen: pIdx['Screen'] !== undefined ? safeVal(r[pIdx['Screen']]) : '',
      gpu: pIdx['GPU'] !== undefined ? safeVal(r[pIdx['GPU']]) : '',
      vram: pIdx['V-RAM'] !== undefined ? safeVal(r[pIdx['V-RAM']]) : '',
      partNumber: pIdx['Part #'] !== undefined ? safeVal(r[pIdx['Part #']]) : '',
      focusModel: pIdx['Focus Model'] !== undefined ? safeVal(r[pIdx['Focus Model']]) : '',
      // Series Group, Segment KHONG doc tu day - la formula song trong
      // Part #, tinh truc tiep bang code o duoi (matchSegment).
    });
  }
  console.log(`-> Map tra cuu co ${partMap.size} Product Name (tra theo ten cot)`);

  // Doc tab "Segment" theo ten cot (Segment, Series Group)
  const segmentSheet = meta.data.sheets.find((s) => s.properties.title === SEGMENT_TAB);
  let segmentRefs = [];
  if (segmentSheet) {
    const segLastCol = colLetter(segmentSheet.properties.gridProperties.columnCount - 1);
    const segHeaderRes = await withRetry(
      () => sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${SEGMENT_TAB}'!A1:${segLastCol}1` }, { timeout: 60000 }),
      'Doc header Segment'
    );
    const sIdx = buildHeaderIndex((segHeaderRes.data.values || [[]])[0]);
    const iSegKeyword = sIdx['Segment'];
    const iSeriesGroup = sIdx['Series Group'];
    if (iSegKeyword === undefined || iSeriesGroup === undefined) {
      console.log(`   CANH BAO: tab "${SEGMENT_TAB}" thieu cot "Segment" hoac "Series Group" - bo qua tra cuu.`);
    } else {
      const segRes = await withRetry(
        () => sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${SEGMENT_TAB}'!A2:${segLastCol}${segmentSheet.properties.gridProperties.rowCount}` }, { timeout: 60000 }),
        'Doc Segment tab'
      );
      segmentRefs = (segRes.data.values || [])
        .filter((r) => r[iSegKeyword])
        .map((r) => ({ keyword: String(r[iSegKeyword]).trim(), keywordLower: String(r[iSegKeyword]).trim().toLowerCase(), seriesGroup: r[iSeriesGroup] || '' }));
      console.log(`-> Doc duoc ${segmentRefs.length} tu khoa Segment tu tab "${SEGMENT_TAB}" (tra theo ten cot)`);
    }
  } else {
    console.log(`   CANH BAO: khong tim thay tab "${SEGMENT_TAB}" - Series Group/Segment se de trong`);
  }

  // 2. Doc RAW DATA (can cot E = Model Name)
  const rawSheet = meta.data.sheets.find((s) => s.properties.title === RAW_DATA_TAB);
  const rawTotalRows = rawSheet.properties.gridProperties.rowCount;
  console.log(`Tab "${RAW_DATA_TAB}": grid rowCount=${rawTotalRows}`);
  const rawRows = await readAllRows(sheets, RAW_DATA_TAB, rawTotalRows, 'S');
  console.log(`-> ${rawRows.length} dong co du lieu thuc trong RAW DATA`);

  // 3. Tinh enrichment cho tung dong
  let matched = 0, unmatched = 0, segmentMatched = 0;
  const enrichRows = rawRows.map((row) => {
    const modelName = (row[4] || '').trim();
    const info = partMap.get(modelName);
    const { segment, seriesGroup } = matchSegment(modelName, segmentRefs);
    if (segment) segmentMatched++;
    if (!info) { unmatched++; return ['', seriesGroup, segment, '', '', '', '', '', '', '', '', '']; }
    matched++;
    return [info.status, seriesGroup, segment, info.cpuSegment, info.cpu,
      info.ram, info.ssd, info.screen, info.gpu, info.vram, info.partNumber, info.focusModel];
  });

  console.log(`\n=== KET QUA ===`);
  console.log(`Khop duoc voi Part #: ${matched}/${rawRows.length}`);
  console.log(`Khop duoc Series Group/Segment (qua tab Segment): ${segmentMatched}/${rawRows.length}`);
  console.log(`Khong khop (de trong): ${unmatched}/${rawRows.length}`);
  console.log(`5 dong mau dau:`, JSON.stringify(enrichRows.slice(0, 5)));

  if (!EXECUTE) {
    console.log('\n>>> DRY RUN - chua ghi gi ca. Neu so lieu on, chay lai voi EXECUTE=true.');
    return;
  }

  console.log('\nDang doi header A1:S1 sang tieng Anh...');
  await withRetry(() => sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID, range: `'${RAW_DATA_TAB}'!A1:S1`,
    valueInputOption: 'RAW', requestBody: { values: [HEADERS_EN] },
  }, { timeout: 60000 }), 'Cap nhat header A1:S1');

  console.log('Dang xoa T2:AE cu truoc khi ghi lai (tranh hang ma khi so dong giam)...');
  await withRetry(() => sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID, range: `'${RAW_DATA_TAB}'!T2:AE`,
  }, { timeout: 60000 }), 'Clear T2:AE truoc khi ghi lai');

  console.log('Dang ghi header enrichment T1:AE1...');
  await withRetry(() => sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID, range: `'${RAW_DATA_TAB}'!T1:AE1`,
    valueInputOption: 'RAW', requestBody: { values: [ENRICHMENT_HEADERS] },
  }, { timeout: 60000 }), 'Cap nhat header T1:AE1');

  console.log(`Dang ghi du lieu enrichment (${enrichRows.length} dong)...`);
  const CHUNK = 5000;
  for (let i = 0; i < enrichRows.length; i += CHUNK) {
    const chunk = enrichRows.slice(i, i + CHUNK);
    await withRetry(() => sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID, range: `'${RAW_DATA_TAB}'!T${2 + i}`,
      valueInputOption: 'RAW', requestBody: { values: chunk },
    }, { timeout: 60000 }), `Ghi lo ${i}`);
    console.log(`   Da ghi lo ${i}-${i + chunk.length}`);
  }

  console.log('\nHOAN TAT. Header da doi tieng Anh, cot T->AE da dien xong.');
})().catch((e) => {
  console.log(`LOI: ${e.stack || e}`);
  process.exitCode = 1;
});
