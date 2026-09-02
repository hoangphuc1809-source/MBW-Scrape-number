// build_dictionary.js â€” dung bo tu dien chuan tu chinh du lieu Phuc da go.
//
// NGUYEN TAC: khong bia quy uoc moi. Voi moi nhom bien the cua CUNG mot thu,
// chon dang viet MA PHUC DA DUNG NHIEU NHAT lam dang chuan. Neu Phuc khong
// thich dang do, sua 1 o trong tab tu dien la xong â€” khong dong vao code.

const { normalizeCpu } = require('./spec_normalize.js');

// ---- KEY: rut moi chuoi ve "dinh danh" cua vat the that ----
const K = {
  cpu: s => { const r = normalizeCpu(s); return r.confidence === 'full' ? r.cpu : null; },

  cpuSegment: s => { const r = normalizeCpu(s); return r.segment || null; },

  // RAM â€” quy uoc Phuc chot 02/09:
  //   co thong tin so thanh  -> "DDR5 16GB x 1"   (dung luong MOI THANH x so thanh)
  //   khong co thong tin     -> "DDR5 16GB"
  //   khong ro loai DDR      -> "16GB"
  // Doc "16 GB (2 thanh 8 GB) DDR5" = 2 thanh 8GB -> "DDR5 8GB x 2".
  // Lay dung luong MOI THANH chu khong phai tong, vi "16GB x 2" se bi hieu
  // nham thanh 32GB.
  ram: s => {
    const raw = String(s);
    const type = (raw.match(/\bLPDDR\d[A-Z]*|\bDDR\d\b/i) || [''])[0]
      .toUpperCase().replace(/\s+/g, '');

    // Truong hop co mo ta so thanh: "(2 thanh 8 GB)" / "(1 thanh 16 GB)"
    const sticks = raw.match(/\(\s*(\d+)\s*thanh\s*(\d+)\s*GB/i);
    if (sticks) {
      const n = sticks[1], per = sticks[2];
      return `${type ? type + ' ' : ''}${per}GB x ${n}`;
    }
    // Dang "16GB*1" hoac "8GB x 2"
    const star = raw.match(/(\d+)\s*GB\s*[*x]\s*(\d+)\b/i);
    if (star) return `${type ? type + ' ' : ''}${star[1]}GB x ${star[2]}`;

    // Khong co thong tin so thanh -> chi dung luong (bo ngoac & menh de nang cap)
    const t = raw.replace(/\([^)]*\)/g, ' ')
      .replace(/(nÃ¢ng\s*cáº¥p|tá»‘i\s*Ä‘a|up\s*to|max|há»—\s*trá»£|lÃªn\s*Ä‘áº¿n)[\s\S]*$/i, ' ');
    const m = t.match(/(\d+)\s*GB/i);
    if (!m) return null;
    return `${type ? type + ' ' : ''}${m[1]}GB`;
  },

  // SSD: dung luong THAT, khong phai dung luong nang cap toi da.
  // BAY: "512GB PCIe NVMe SSD (NÃ¢ng cáº¥p tá»‘i Ä‘a 2TB)" â€” neu quet TB truoc thi
  // ra 2TB, sai hoan toan. Phai cat bo ngoac + menh de nang cap TRUOC, roi lay
  // dung luong XUAT HIEN DAU TIEN.
  ssd: s => {
    let t = String(s)
      .replace(/\([^)]*\)/g, ' ')                                  // bo moi thu trong ngoac
      .replace(/(nÃ¢ng\s*cáº¥p|tá»‘i\s*Ä‘a|up\s*to|max|há»—\s*trá»£|lÃªn\s*Ä‘áº¿n)[\s\S]*$/i, ' ');
    const m = t.match(/(\d+)\s*(TB|GB)/i);
    if (m) {
      const n = parseInt(m[1], 10);
      const unit = m[2].toUpperCase();
      if (unit === 'GB' && n >= 1024) return `${n / 1024}TB`;       // 1024GB -> 1TB
      return `${n}${unit}`;
    }
    const m2 = t.match(/SSD\s*(\d{3,4})\b/i);                       // "SSD 512" thieu don vi
    return m2 ? `${m2[1]}GB` : null;
  },

  gpu: s => {
    const t = String(s).replace(/[â„¢Â®Â©]/g, ' ');
    let m = t.match(/\b(RTX|GTX|RX)\s*(\d{4})\s*(Ti|XT|Super)?\b/i);
    if (m) return `${m[1].toUpperCase()} ${m[2]}${m[3] ? ' ' + m[3][0].toUpperCase() + m[3].slice(1).toLowerCase() : ''}`;
    m = t.match(/\bMX\s*(\d{3})\b/i);          if (m) return `MX ${m[1]}`;
    // Radeon CO model (680M, 840M, 8060S) la GPU KHAC voi Radeon tich hop
    // chung chung â€” phai giu lai model, khong duoc gom het lam mot.
    m = t.match(/\bRadeon\s+(\d{3,4}[A-Z])\b/i);
    if (m) return `AMD Radeon ${m[1].toUpperCase()}`;
    if (/\bIntel\s+Arc\b/i.test(t))            return 'Intel Arc Graphics';
    if (/\bIris\s*Xe\b/i.test(t))              return 'Intel Iris Xe';
    if (/\bUHD\b/i.test(t))                    return 'Intel UHD Graphics';
    if (/\bIntel\s+Graphics\b/i.test(t))       return 'Intel Graphics';
    if (/\bRadeon\b/i.test(t))                 return 'AMD Radeon Graphics';
    if (/\bAdreno\b/i.test(t))                 return 'Qualcomm Adreno';
    return null;
  },

  vram: s => { const m = String(s).match(/(\d+)\s*G/i); return m ? `${m[1]}GB` : null; },
};

// Gom nhom: key -> {bien the: so lan}. Dang chuan = bien the pho bien nhat.
function buildGroups(values, keyFn) {
  const g = new Map();
  for (const [raw, n] of values) {
    const k = keyFn(raw);
    if (!k) { // khong nhan dang duoc -> hang doi cho nguoi xem
      if (!g.has('@UNKNOWN')) g.set('@UNKNOWN', new Map());
      g.get('@UNKNOWN').set(raw, n);
      continue;
    }
    if (!g.has(k)) g.set(k, new Map());
    g.get(k).set(raw, (g.get(k).get(raw) || 0) + n);
  }
  return g;
}

function pickCanonical(variants, key) {
  // DANG CHUAN = chinh cai KEY may dung lai ("Core Ultra 7 255H", "16GB",
  // "RTX 5060"). KHONG lay bien the pho bien nhat: "M5 10" xuat hien 507 lan
  // nhung "Apple M5" moi la dang dung.
  // Key da la dang chuan cho moi truong, nen tra thang ve.
  return key;
}

// Hang san xuat CPU â€” khop cot "CPU Platform" san co trong tab Segment.
function cpuPlatform(canonical) {
  if (/^Core\b|^Celeron|^Pentium/i.test(canonical)) return 'Intel';
  if (/^Ryzen|^Athlon/i.test(canonical)) return 'AMD';
  if (/^Snapdragon/i.test(canonical)) return 'Qualcomm';
  if (/^Apple\b/i.test(canonical)) return 'Apple';
  return '';
}

module.exports = { K, buildGroups, pickCanonical, cpuPlatform };
