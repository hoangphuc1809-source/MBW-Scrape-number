// cpu_normalize.js v2 — chuan hoa chuoi CPU tu moi retailer ve 1 dang duy nhat.
//
// VAN DE: cung 1 con chip, moi noi viet mot kieu:
//   "Core Ultra 7 255H" / "Ultra 7 255H" / "U7-255H"
//   "Core i7-1355U" / "Core Core i7 1355U" / "i7-1355U"
// -> phai go bang tay moi ngay.
//
// CACH LAM: parse ra (hang | dong | bac | ma so + hau to) roi dung lai chuoi
// chuan. KHONG doan mo.
//
// BA MUC DO TIN CAY — quan trong, dung gop lam mot:
//   'full'    : co ca dong VA ma so   -> dien duoc CPU + CPU Segment
//   'partial' : nguon chi ghi moi dong ("Core Ultra 7") -> chi dien Segment,
//               de trong CPU. Day KHONG phai loi parse, la nguon thieu.
//   'unknown' : khong nhan ra -> de nguoi xem, tuyet doi khong bia.
//
// v2 sua so voi v1: hau to kieu G1/G4/G7 (Core i3 1005G1), Core i3-N305,
// Ryzen AI Max+ 395 (khong co bac), hau to kep HX PRO, va tach 'partial'.

const CAP = s => s[0].toUpperCase() + s.slice(1).toLowerCase();

// --- Nhan dang DAY DU (co ma so) ---
const FULL_RULES = [
  {
    name: 'apple',
    re: /\b(?:Apple\s+)?M(\d)\s*(Pro|Max|Ultra)?\b/i,
    build: m => {
      const t = m[2] ? ' ' + CAP(m[2]) : '';
      return { cpu: `Apple M${m[1]}${t}`, segment: `Apple M${m[1]}${t}` };
    },
  },
  {
    name: 'snapdragon',
    re: /\b(?:Snapdragon\s+)?(?:X\s*)?(X1E|X1P|X2E|X1)[\s-]*(\d{2})[\s-]*(\d{3})\b/i,
    build: m => {
      const fam = m[1].toUpperCase();
      const tier = { X1E: 'X Elite', X1P: 'X Plus', X1: 'X', X2E: 'X2 Elite' }[fam] || 'X';
      return { cpu: `Snapdragon ${tier} ${fam}-${m[2]}-${m[3]}`, segment: `Snapdragon ${tier}` };
    },
  },
  {
    // Ryzen AI Max+ 395 / Max 392 — khong co bac 3/5/7/9
    name: 'ryzen-ai-max',
    re: /\bRyzen\s*AI\s*(Max\+?)\s*[- ]?(\d{3})\b/i,
    build: m => ({ cpu: `Ryzen AI Max+ ${m[2]}`, segment: 'Ryzen AI Max+' }),
  },
  {
    // "Ryzen AI 9 HX PRO 375", "Ryzen 9 AI HX 370", "Ryzen AI 7 350"
    name: 'ryzen-ai',
    re: /\bRyzen\s*(?:AI\s*)?([3579])\s*(?:AI\s*)?((?:HX|PRO)(?:\s+(?:HX|PRO))?)?\s*[- ]?(\d{3})\b/i,
    guard: s => /\bAI\b/i.test(s),
    build: m => {
      const sfx = m[2] ? m[2].toUpperCase().replace(/\s+/g, ' ') + ' ' : '';
      return { cpu: `Ryzen AI ${m[1]} ${sfx}${m[3]}`, segment: `Ryzen AI ${m[1]}` };
    },
  },
  {
    // Ryzen doi cu VA dong 100/200 series (ma 3 chu so: Ryzen 7 260,
    // Ryzen 5 150, Ryzen 7 170). Toi thieu 3 chu so — chan "Ryzen 5 40"
    // (nguon An Phat cat cut) lot vao.
    name: 'ryzen',
    re: /\b(?:AMD\s+)?(?:Ryz+en|R)\s*([3579])\s*[- ]?(\d{3,4})\s*([A-Z]{1,3})?\b/i,
    build: m => ({
      cpu: `Ryzen ${m[1]} ${m[2]}${m[3] ? m[3].toUpperCase() : ''}`,
      segment: `Ryzen ${m[1]}`,
    }),
  },
  {
    name: 'core-ultra',
    re: /\b(?:Intel\s+)?(?:Core\s+)?(?:Ultra|U)\s*(X)?\s*([579])\s*[- ]?(\d{3})\s*([A-Z]{1,2}\d?)?\b/i,
    build: m => {
      const x = m[1] ? 'X' : '';
      return {
        cpu: `Core Ultra ${x}${m[2]} ${m[3]}${m[4] ? m[4].toUpperCase() : ''}`,
        segment: `Core Ultra ${x}${m[2]}`,
      };
    },
  },
  {
    // Core i3-N305 (N-series co tien to i)
    name: 'core-i-n',
    re: /\b(?:Intel\s+)?Core\s*i([3579])\s*[- ]?N(\d{3})\b/i,
    build: m => ({ cpu: `Core i${m[1]} N${m[2]}`, segment: `Core i${m[1]}` }),
  },
  {
    // Hau to cho phep G1/G4/G7 (Core i3 1005G1)
    name: 'core-i',
    re: /\b(?:Intel\s+)?(?:Core\s+)*i([3579])\s*[- ]?(\d{4,5})\s*([A-Z]{1,2}\d?)?\b/i,
    build: m => ({
      cpu: `Core i${m[1]} ${m[2]}${m[3] ? m[3].toUpperCase() : ''}`,
      segment: `Core i${m[1]}`,
    }),
  },
  {
    name: 'core-n',
    re: /\b(?:Intel\s+)?Core\s*([357])\s*[- ]?N(\d{3})\b/i,
    build: m => ({ cpu: `Core ${m[1]} N${m[2]}`, segment: `Core ${m[1]}` }),
  },
  {
    name: 'core-new',
    re: /\b(?:Intel\s+)?Core\s*([3579])\s*[- ]?(\d{3})\s*([A-Z]{1,2}\d?)?\b/i,
    build: m => ({
      cpu: `Core ${m[1]} ${m[2]}${m[3] ? m[3].toUpperCase() : ''}`,
      segment: `Core ${m[1]}`,
    }),
  },
  {
    name: 'entry',
    re: /\b(Celeron|Pentium|Athlon)\s*([A-Z]?\d{3,4}[A-Z]?)\b/i,
    build: m => ({ cpu: `${CAP(m[1])} ${m[2]}`, segment: CAP(m[1]) }),
  },
];

// --- Nhan dang MOT PHAN (nguon chi ghi dong, khong co ma so) ---
// Van dien duoc CPU Segment — cot ma Phuc dang go tay nhieu nhat.
const PARTIAL_RULES = [
  { re: /\b(?:Intel\s+)?(?:Core\s+)?Ultra\s*(X)?\s*([579])\b/i, seg: m => `Core Ultra ${m[1] ? 'X' : ''}${m[2]}` },
  { re: /\bRyzen\s*AI\s*(Max\+?)\b/i,                            seg: () => 'Ryzen AI Max+' },
  { re: /\bRyzen\s*AI\s*([3579])\b/i,                            seg: m => `Ryzen AI ${m[1]}` },
  // "Ryzen 9 AI", "Ryzen 7 AI PRO" — AMD dao thu tu. PHAI dung TRUOC luat
  // Ryzen thuong, neu khong se gom nham Ryzen AI 9 vao Ryzen 9 (khac segment).
  { re: /\b(?:AMD\s+)?Ryz+en\s*([3579])\s*AI\b/i,                seg: m => `Ryzen AI ${m[1]}` },
  { re: /\b(?:AMD\s+)?Ryz+en\s*([3579])\b/i,                     seg: m => `Ryzen ${m[1]}` },
  { re: /\bMendocino\s*R([3579])\b/i,                            seg: m => `Ryzen ${m[1]}` },
  { re: /\b(?:Intel\s+)?(?:Core\s+)?i([3579])\b/i,               seg: m => `Core i${m[1]}` },
  { re: /\b(?:Intel\s+)?Core\s*([3579])\b/i,                     seg: m => `Core ${m[1]}` },
  { re: /\bSnapdragon\s+X2\s*Elite\b/i,                          seg: () => 'Snapdragon X2 Elite' },
  { re: /\bSnapdragon\s*X2\b/i,                                  seg: () => 'Snapdragon X2' },
  { re: /\bSnapdragon\s+X\s*Elite\b/i,                           seg: () => 'Snapdragon X Elite' },
  { re: /\bSnapdragon\s+X\s*Plus\b/i,                            seg: () => 'Snapdragon X Plus' },
  { re: /\bSnapdragon\b/i,                                       seg: () => 'Snapdragon X' },
  { re: /\b(Celeron|Pentium|Athlon)\b/i,                         seg: m => CAP(m[1]) },
];

function normalizeCpu(raw) {
  const s = String(raw || '').replace(/[™®©]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return { cpu: '', segment: '', rule: null, confidence: 'empty', raw: s };

  for (const r of FULL_RULES) {
    if (r.guard && !r.guard(s)) continue;
    const m = s.match(r.re);
    if (m) return { ...r.build(m), rule: r.name, confidence: 'full', raw: s };
  }
  for (const r of PARTIAL_RULES) {
    const m = s.match(r.re);
    if (m) return { cpu: '', segment: r.seg(m), rule: 'partial', confidence: 'partial', raw: s };
  }
  return { cpu: '', segment: '', rule: null, confidence: 'unknown', raw: s };
}

module.exports = { normalizeCpu, FULL_RULES, PARTIAL_RULES };
