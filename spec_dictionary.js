// spec_dictionary.js — gom nhom cac bien the cua cung mot thu ve dang chuan.
//
// NGUYEN TAC: khong bia quy uoc moi. Rut moi chuoi ve "dinh danh" cua vat the
// that (con chip nao, bao nhieu GB), roi dung lai ten theo mot khuon duy nhat.
const { normalizeCpu } = require('./spec_normalize.js');

const K = {
  cpu: s => { const r = normalizeCpu(s); return r.confidence === 'full' ? r.cpu : null; },

  cpuSegment: s => { const r = normalizeCpu(s); return r.segment || null; },

  // RAM — quy uoc chot 02/09:
  //   biet so thanh  -> "DDR5 16GB x 1"  (dung luong MOI THANH x so thanh)
  //   khong biet     -> "DDR5 16GB"
  //   khong ro DDR   -> "16GB"
  // "16 GB (2 thanh 8 GB) DDR5" = 2 thanh 8GB -> "DDR5 8GB x 2".
  // Lay dung luong MOI THANH chu khong phai tong: "16GB x 2" se bi doc thanh 32GB.
  ram: s => {
    const raw = String(s);
    const type = (raw.match(/\bLPDDR\d[A-Z]*|\bDDR\d\b/i) || [''])[0].toUpperCase().replace(/\s+/g, '');
    const sticks = raw.match(/\(\s*(\d+)\s*thanh\s*(\d+)\s*GB/i);
    if (sticks) return `${type ? type + ' ' : ''}${sticks[2]}GB x ${sticks[1]}`;
    const star = raw.match(/(\d+)\s*GB\s*[*x]\s*(\d+)\b/i);
    if (star) return `${type ? type + ' ' : ''}${star[1]}GB x ${star[2]}`;
    const t = raw.replace(/\([^)]*\)/g, ' ')
      .replace(/(nâng\s*cấp|tối\s*đa|up\s*to|max|hỗ\s*trợ|lên\s*đến)[\s\S]*$/i, ' ');
    const m = t.match(/(\d+)\s*GB/i);
    return m ? `${type ? type + ' ' : ''}${m[1]}GB` : null;
  },

  // SSD: dung luong THAT, khong phai dung luong nang cap toi da.
  // BAY: "512GB PCIe NVMe SSD (Nang cap toi da 2TB)" — quet TB truoc thi ra
  // 2TB, sai hoan toan. Phai cat ngoac + menh de nang cap TRUOC.
  ssd: s => {
    const t = String(s).replace(/\([^)]*\)/g, ' ')
      .replace(/(nâng\s*cấp|tối\s*đa|up\s*to|max|hỗ\s*trợ|lên\s*đến)[\s\S]*$/i, ' ');
    const m = t.match(/(\d+)\s*(TB|GB)/i);
    if (m) {
      const n = parseInt(m[1], 10), unit = m[2].toUpperCase();
      if (unit === 'GB' && n >= 1024) return `${n / 1024}TB`;
      return `${n}${unit}`;
    }
    const m2 = t.match(/SSD\s*(\d{3,4})\b/i);
    return m2 ? `${m2[1]}GB` : null;
  },

  // GPU. Nguyen tac: GIU LAI model, khong gom ve ten chung chung.
  // "Intel UHD Graphics 620" KHAC "Intel UHD Graphics"; "Radeon RX Vega 10"
  // KHAC "Radeon Graphics". Ban dau gom het -> mat thong tin.
  // Chuoi liet ke 2 GPU ("MX570A 2GB GDDR6 / Intel Iris Xe Graphics") thi lay
  // GPU ROI truoc, vi do moi la con quyet dinh hieu nang.
  gpu: s => {
    const t = String(s).replace(/[\u2122\u00AE\u00A9]/g, ' ').replace(/\s+/g, ' ').trim();

    // RX 560X, GTX 1650 Ti, GT 740M — hau to gom ca X va Max-Q
    let m = t.match(/\b(RTX|GTX|GT|RX)\s*(\d{3,4})\s*(Ti|XT|Super|M|X)?\b/i);
    if (m) {
      // Hau to "M"/"X" viet DINH LIEN ("GTX 960M", "RX 560X"), con
      // Ti/XT/Super thi tach ra ("RTX 5070 Ti"). Day la cach NVIDIA/AMD viet.
      let sfx = '';
      if (m[3]) {
        const s3 = m[3].toUpperCase();
        sfx = (s3 === 'M' || s3 === 'X') ? s3 : ' ' + s3[0] + m[3].slice(1).toLowerCase();
      }
      return `${m[1].toUpperCase()} ${m[2]}${sfx}`;
    }
    // GeForce doi cu khong co tien to: "GeForce 940MX"
    m = t.match(/\bGeForce\s+(\d{3})(MX|M)?\b/i);
    if (m) return `GeForce ${m[1]}${m[2] ? m[2].toUpperCase() : ''}`;
    // MX550 / MX570A — hau to chu cai phai bat duoc, khong thi ra "MX 570" sai
    m = t.match(/\bMX\s*(\d{3})([A-Z])?\b/i);
    if (m) return `MX ${m[1]}${m[2] ? m[2].toUpperCase() : ''}`;

    m = t.match(/\bRadeon\s+RX\s+Vega\s+(\d+)\b/i);
    if (m) return `AMD Radeon RX Vega ${m[1]}`;
    m = t.match(/\bRadeon\s+(?:RX\s+)?(?:Graphics\s+)?Vega\s+(\d+)\b/i);
    if (m) return `AMD Radeon Vega ${m[1]}`;
    // Model co the co hoac khong co chu cai cuoi: 680M, 8060S, va ca 520.
    m = t.match(/\bRadeon\s+(\d{3,4}[A-Z]?)\b/i);
    if (m) return `AMD Radeon ${m[1].toUpperCase()}`;

    m = t.match(/\bUHD\s*(?:Graphics)?\s*(\d{3})?\b/i);
    if (m) return `Intel UHD Graphics${m[1] ? ' ' + m[1] : ''}`;
    m = t.match(/\bHD\s*(?:Graphics)?\s*(\d{3})?\b/i);
    if (m) return `Intel HD Graphics${m[1] ? ' ' + m[1] : ''}`;
    if (/\bIris\s*Xe\b/i.test(t))        return 'Intel Iris Xe Graphics';
    // Arc co the kem model: "Intel Arc Graphics 140V" — giu lai.
    m = t.match(/\bArc\s*(?:Graphics)?\s*(\d{3}[A-Z]?)?\b/i);
    if (m) return `Intel Arc Graphics${m[1] ? ' ' + m[1].toUpperCase() : ''}`;
    if (/\bIntel\s+Graphics\b/i.test(t)) return 'Intel Graphics';

    if (/\bRadeon\b/i.test(t))           return 'AMD Radeon Graphics';
    if (/\bAdreno\b/i.test(t))           return 'Qualcomm Adreno';
    return null;
  },

  vram: s => { const m = String(s).match(/(\d+)\s*G/i); return m ? `${m[1]}GB` : null; },
};

// Gom nhom: key -> {bien the: so lan}.
function buildGroups(values, keyFn) {
  const g = new Map();
  for (const [raw, n] of values) {
    const k = keyFn(raw);
    if (!k) {
      if (!g.has('@UNKNOWN')) g.set('@UNKNOWN', new Map());
      g.get('@UNKNOWN').set(raw, n);
      continue;
    }
    if (!g.has(k)) g.set(k, new Map());
    g.get(k).set(raw, (g.get(k).get(raw) || 0) + n);
  }
  return g;
}

// DANG CHUAN = chinh cai KEY may dung lai. KHONG lay bien the pho bien nhat:
// "M5 10" xuat hien 507 lan nhung "Apple M5" moi la dang dung.
function pickCanonical(variants, key) { return key; }

// Hang san xuat CPU — khop cot "CPU Platform" trong tab Segment.
function cpuPlatform(canonical) {
  if (/^Core\b|^Celeron|^Pentium/i.test(canonical)) return 'Intel';
  if (/^Ryzen|^Athlon/i.test(canonical)) return 'AMD';
  if (/^Snapdragon/i.test(canonical)) return 'Qualcomm';
  if (/^Apple\b/i.test(canonical)) return 'Apple';
  return '';
}

module.exports = { K, buildGroups, pickCanonical, cpuPlatform };
