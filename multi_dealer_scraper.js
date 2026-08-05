/**
 * multi_dealer_scraper.js  — v3.4.16
 *
 * FIX v3.4.16 [30/07/2026]:
 *  (a) GHI SHEET FAIL Run #362/#363: "exceeds grid limits. Max rows: 45001"
 *      — RAW DATA tích lũy 43k+ rows vượt grid limit. Fix: auto-expand sheet
 *      grid trước khi ghi (check metadata → batchUpdate nếu cần).
 *  (b) CPS vẫn 1523 SP với cap=15: giảm CPS_MAX_CLICKS 15→8. Brand lớn nhất
 *      ~100 SP (~5 clicks). Cap 8 = max ~180 SP/brand, tổng ~700 — gần ~590.
 *
 * FIX v3.4.15 [29/07/2026 — ROOT CAUSE: CPS "Load thêm" loop vô tận]:
 *  Run #359 trả 2316 CPS SP (bình thường ~590). CPS MSI page chỉ có 52 SP,
 *  9 brands × ~60 = ~540 SP. Root cause: "Load thêm" button không biến mất
 *  khi hết SP của brand → tiếp tục load SP từ category/brand khác vô tận.
 *  Fix: cap MAX_LOAD_MORE_CLICKS = 15 per brand (đủ cho ~320 SP/brand).
 *  Kết hợp với v3.4.14 HTTP stock check để lọc OOS/EOL product.
 *
 * FIX v3.4.14 [29/07/2026 — HTTP stock check cho SP mới CPS]:
 *  v3.4.12 card-text detection bắt 0 SP vì CPS listing card KHÔNG chứa text
 *  "Tạm hết hàng" — text đó chỉ có trên detail page. v3.4.12 filter "Sẵn hàng"
 *  quá hung dữ (143/590 SP).
 *  Fix mới: sau khi extract listing, cho SP KHÔNG CÓ TRONG SPEC CACHE (SP mới/
 *  chưa biết), dùng Node.js native fetch() GET detail page HTML rồi regex tìm
 *  "TẠM HẾT HÀNG" / "ngừng kinh doanh". KHÔNG dùng Puppeteer → zero impact
 *  lên tính ổn định. Concurrency=5, timeout=6s/SP, cap=80 SP/brand.
 *  Card-text detection vẫn giữ làm lớp 1 (free, dù hiện tại bắt 0).
 *
 * FIX v3.4.13 [29/07/2026 — revert filter "Sẵn hàng", giữ card-text detection]:
 *  v3.4.12 filter "Sẵn hàng" quá hung dữ — lọc theo "có hàng tại cửa hàng gần"
 *  thay vì "còn bán online", chỉ còn 143/590 SP (~25%). REVERT lớp (a).
 *  Giữ nguyên lớp (b) card-text detection + lớp (c) post-filter: nếu card
 *  listing chứa text "tạm hết hàng"/"hết hàng"/"ngừng kinh doanh" sẽ lọc ra.
 *  Nếu card KHÔNG có text OOS (chỉ detail page mới có), cần hướng xử lý khác
 *  → xem log lần chạy này để quyết định bước tiếp.
 *
 * FIX v3.4.12 [29/07/2026 — yêu cầu Phuc, lọc mã "Tạm hết hàng" CPS]:
 *  CPS listing page hiển thị cả SP đã EOL/hết hàng — card vẫn có giá nhưng
 *  detail page ghi "TẠM HẾT HÀNG". Vì v3.4.10 tắt detail-page navigation,
 *  stockStatus "Tạm hết hàng" không bao giờ được detect → SP rác vào sheet.
 *  Fix 3 lớp (KHÔNG cần navigate detail page — giữ nguyên tính ổn định v3.4.10):
 *   (a) Click filter "Sẵn hàng" trên trang listing CPS trước khi bấm "Load
 *       thêm" — lọc tại nguồn, CPS chỉ render SP còn hàng thật. Zero cost.
 *   (b) Safety net: trong page.evaluate trích xuất listing, kiểm tra card
 *       text chứa "tạm hết hàng"/"hết hàng"/"ngừng kinh doanh" → đánh dấu
 *       stockStatus chính xác thay vì mặc định "Còn hàng".
 *   (c) Post-filter: sau extract, lọc bỏ SP có stockStatus khác "Còn hàng"
 *       khỏi kết quả, log số lượng đã lọc.
 *
 * FIX v3.4.11 [25/07/2026 — học từ bản thử nghiệm MBW-Scrape-number-v2]:
 *  So sánh với bản v2 (viết lại bằng Playwright, không dùng được trực tiếp vì
 *  đổi engine + đổi Sheet ID + lệch schema cột + MBW quay lại pattern điều
 *  hướng tuần tự hàng trăm trang chi tiết — đúng lỗi mà v3.4.10 vừa né).
 *  Điểm hay duy nhất đáng lấy: fetchSpecsCPS() định vị bảng specs bằng
 *  heading text "Thông số kỹ thuật" thay vì phụ thuộc 1 class CSS cụ thể →
 *  bền hơn khi CellphoneS đổi giao diện. Đã thêm làm FALLBACK (chỉ chạy khi
 *  selector `tr.technical-content-item` hiện tại trả về rỗng) — không đổi
 *  hành vi khi site vẫn giữ nguyên cấu trúc như hiện tại.
 *
 * STOP-AND-STABILIZE v3.4.10 [23/07/2026 — theo yêu cầu Phuc, dừng điều tra]:
 *  Bằng chứng cuối cùng loại bỏ MỌI giả thuyết hạ tầng: chuyển CPS sang
 *  self-hosted (máy MSI, nhiều tài nguyên hơn hẳn ubuntu-latest) VẪN gặp
 *  "detached Frame" giống hệt sau ~49 phút, và FPT (scraper ổn định từ lâu,
 *  chạy sau CPS trên CÙNG máy) cũng dính lỗi tương tự ngay sau đó. Vậy lỗi
 *  không phải do: cloud yếu, IP bị chặn, proxy, hay máy tự host yếu — mà là
 *  vấn đề nội tại của việc điều hướng liên tục hàng trăm lần tới trang chi
 *  tiết sản phẩm trong 1 session Puppeteer kéo dài (bất kể hạ tầng nào).
 *  Quyết định: DỪNG vá thêm, ưu tiên phục hồi trạng thái ổn định.
 *  enrichSpecs() giờ nhận thêm param skipNewFetch — khi true, KHÔNG điều
 *  hướng sang trang chi tiết SP nữa, chỉ áp dụng specs đã có trong cache cho
 *  SP đã biết. Áp dụng cho cả CPS và FPT (FPT cũng dính lỗi trong run này).
 *  Đánh đổi: SP mới sẽ thiếu specs (cpu/ram/gpu/...) cho tới khi vấn đề gốc
 *  được xử lý dứt điểm — nhưng listing (giá/tên/link/tình trạng) luôn lấy
 *  được đầy đủ, ổn định, không còn treo/mất data toàn brand nữa.
 *
 * FIX v3.4.9:
 *  v3.4.6 routed CPS through the Cloudflare Worker proxy to test the "site
 *  blocks runner IP" hypothesis. Result: not only did it fail to fix the
 *  hangs, it made things worse — 6/6 brands failing — AND introduced a new,
 *  distinct symptom: "Load thêm" click counts jumped to a suspiciously
 *  uniform ~125-126 across different brands (Acer/HP/Lenovo/MSI), whereas
 *  before v3.4.6 each brand had a reasonable, DIFFERENT count matching its
 *  real catalog size (Asus 51, Acer 15, Dell 24, HP 24, Lenovo 34, MSI 16).
 *  Identical counts across unrelated brands strongly suggests the proxy
 *  broke CPS's cookie/session-based brand filtering (Worker rewrites Host/
 *  Origin/Referer, strips cf-* headers, rewrites Set-Cookie domain) — likely
 *  causing the origin to serve a generic/fallback view instead of the
 *  correct brand-filtered page, or causing the "Load thêm" AJAX call to fail
 *  silently while the button stays clickable, looping indefinitely.
 *  MBW uses the identical proxy mechanism and remains fine — this is site-
 *  specific behavior, not a flaw in the proxy code itself.
 *  ACTION: CPS reverted to calling cellphones.com.vn directly, as before
 *  15/06. PROXY_HOST / CPS_BASE kept in code but CPS_BASE is now hardcoded
 *  to the direct URL and enableProxyInterception is no longer called for
 *  CPS anywhere (scrapeCPS, fetchSpecsCPS, checkMissingProducts).
 *
 * FIX v3.4.8:
 *  [BUG17] Phát hiện quan trọng: writeToSheet() chỉ được gọi 1 LẦN Ở CUỐI
 *          script, sau khi MBW+CPS đều xong. Mỗi lần CPS treo dẫn tới kill-
 *          timer (process.exit trực tiếp, KHÔNG chạy finally/cleanup nào),
 *          TOÀN BỘ data đã scrape — kể cả MBW đã xong thành công — bị mất,
 *          KHÔNG ghi được gì vào sheet cả. Đây là lý do sheet không có data
 *          mới suốt nhiều lần chạy gần đây dù MBW luôn chạy tốt.
 *          Fix: killTimer giờ có quyền truy cập allProducts/sheets qua biến
 *          global (globalAllProducts/globalSheets), cố ghi best-effort
 *          (deadline riêng 30s) TRƯỚC KHI exit — dù CPS thất bại, data MBW/
 *          CPS đã scrape được tới thời điểm đó vẫn được lưu vào sheet.
 *
 * FIX v3.4.7:
 *  [BUG16] v3.4.6 (proxy CPS) KHÔNG fix được — 6/6 brand CPS treo, LOẠI HẲN
 *          giả thuyết "site chặn IP" (proxy đổi IP nguồn mà vẫn treo y hệt).
 *          Nhìn kỹ log: 1 số brand treo TRƯỚC khi in được "Load thêm: N lần"
 *          (treo trong vòng lặp bấm nút), 1 số brand in được "Load thêm" nhưng
 *          KHÔNG BAO GIỜ in "→ N SP" (treo ở bước extract listing). → Chỗ
 *          treo thật sự là các page.evaluate() dùng để đọc/thao tác DOM tại
 *          chỗ (bấm nút, scroll, trích xuất listing) — CHƯA TỪNG có timeout
 *          nào từ trước tới giờ, chỉ có .catch() bắt lỗi reject (không bắt
 *          được hang vì evaluate treo thì không resolve lẫn reject). Vì CẢ
 *          6 brand đều treo liên tiếp (không phải 1-2 brand ngẫu nhiên), nghi
 *          cả CDP session/browser bị đơ toàn bộ từ 1 điểm, không phải lỗi
 *          riêng của trang/brand nào.
 *          Fix: (1) helper evalWithTimeout() bọc timeout cho MỌI evaluate()
 *          trong scrollToBottom + vòng lặp "Load thêm" + extract listing của
 *          CPS (8-15s/lệnh). (2) Theo dõi số brand thất bại LIÊN TIẾP — nếu
 *          ≥2 brand liên tiếp trả về 0 SP/timeout, RELAUNCH TOÀN BỘ BROWSER
 *          (không chỉ tạo page mới) trước khi thử brand kế, vì nghi browser
 *          instance chứ không chỉ 1 tab bị đơ.
 *
 * FIX v3.4.6:
 *  Route CPS (cellphones.com.vn) qua CÙNG Cloudflare Worker proxy đã dùng cho
 *  MBW (đa-target, đã xác nhận worker deploy sẵn có route "cps" từ trước —
 *  không cần đổi gì ở Cloudflare). Test giả thuyết BUG15 (v3.4.5): nghi
 *  cellphones.com.vn rate-limit/soft-block IP datacenter của GitHub Actions
 *  runner, khiến 4-5/6 brand CPS treo im lặng ngay lần goto đầu tới trang
 *  chi tiết SP dù page hoàn toàn sạch (v3.4.4 đã loại được giả thuyết DOM/
 *  memory tích lũy). Nếu route qua Worker (đổi IP nguồn sang Cloudflare edge)
 *  giải quyết được hang → xác nhận đúng là site-side block. Nếu vẫn treo →
 *  loại tiếp giả thuyết này, cần điều tra hướng khác.
 *
 * FIX v3.4.5:
 *  [BUG15] v3.4.4 (page mới mỗi brand) KHÔNG giải quyết được hang — thực tế
 *          22-23/07 thấy 4-5/6 brand CPS treo liên tiếp NGAY LẦN GOTO ĐẦU
 *          TIÊN tới trang chi tiết SP dù page hoàn toàn mới, sạch. Loại được
 *          giả thuyết "tích lũy DOM/memory". Nghi vấn hiện tại: cellphones.com.vn
 *          rate-limit/soft-block IP runner GitHub Actions (kiểu WAF im lặng
 *          không phản hồi, giống thegioididong.com/FPT đã gặp) — CẦN TEST
 *          route CPS qua Cloudflare Worker proxy (đã có sẵn cho MBW) để xác
 *          nhận. Trong lúc chờ: vấn đề cấp bách hơn là timeout CHỈ có ở CẤP
 *          BRAND (10 phút) → 1 SP treo làm mất toàn bộ SP của cả brand (kể cả
 *          listing data đã lấy xong) + tốn nguyên 10 phút mới cứu được.
 *          Fix: thêm timeout CẤP TỪNG SẢN PHẨM (25s) trong enrichSpecs() —
 *          treo thì bỏ qua đúng 1 SP đó (không cache), tiếp tục ngay SP kế
 *          bằng cùng page, không cần đợi brand-level timeout.
 *
 * FIX v3.4.4:
 *  [BUG14] v3.4.3 (Promise.race timeout/brand) chỉ chữa TRIỆU CHỨNG: vẫn dùng
 *          1 page CPS xuyên suốt cả 4 brand (Asus→Acer→Dell→HP) → DOM/memory
 *          tích lũy dần qua hàng trăm lần "Load thêm" + điều hướng trang chi
 *          tiết → tới brand thứ 3-4 trình duyệt bắt đầu treo. Thực tế đã thấy
 *          Dell VÀ HP treo liên tiếp cùng 1 lần chạy (22/07) → 2×10 phút cộng
 *          dồn với thời gian Asus/Acer, job vẫn chạm mốc kill-timer 60 phút
 *          và fail. Fix gốc: mỗi brand CPS luôn dùng 1 page MỚI ngay từ đầu
 *          (không đợi lỗi/timeout mới tạo lại) — mỗi brand bắt đầu "sạch".
 *
 * FIX v3.4.3:
 *  [BUG13] CPS treo IM LẶNG (không throw, không reject, chỉ đứng im) ở
 *          brand thứ 3-4 (thường là HP) sau nhiều vòng "Load thêm" liên tiếp
 *          trên cùng 1 page — log dừng đột ngột ngay sau "→ N SP", không có
 *          "Fetched specs" nào, job treo tới hết 60 phút kill-timer mới thoát
 *          (2 lần liên tiếp trong ngày 22/07, luôn đúng lúc vào HP). Vì không
 *          có exception nào được ném ra, cả fix v3.4.1 (rethrow fatal error)
 *          và v3.4.2 (unhandledRejection guard) đều không cứu được trường hợp
 *          này. Fix: bọc mỗi brand CPS trong Promise.race với timeout riêng
 *          (10 phút/brand, giống pattern FPT_SCRAPE_TIMEOUT_MS đã có cho FPT)
 *          — treo quá lâu thì bỏ ngang, đóng page cũ, tạo page mới, tiếp tục
 *          brand sau. Thêm setDefaultTimeout/setDefaultNavigationTimeout cho
 *          page CPS (trước đây chỉ FPT có).
 *
 * FIX v3.4.2:
 *  [BUG12] Process crash hoàn toàn (exit code 1, mất sạch data lần chạy) do
 *          Puppeteer's internal FrameManager.initialize() (#createIsolatedWorld)
 *          ném ProtocolError "addScriptToEvaluateOnNewDocument timed out" khi 1
 *          iframe con (ads/chat widget) trên trang CPS bị treo. Lỗi này là
 *          unhandled rejection TÁCH BIỆT khỏi mọi await chain/try-catch của
 *          code này → Node 15+ tự kill process. Fix: process.on('unhandledRejection'/
 *          'uncaughtException') ở đầu file, log rồi tiếp tục thay vì crash.
 *
 * FIX v3.4.1:
 *  [BUG11] Process không exit sau khi xong — googleapis/puppeteer giữ event
 *          loop qua HTTP keep-alive + Chrome subprocess → thêm process.exit(0)
 *
 * FIX v3.4:
 *  [BUG10] FPT hung process khi Cloudflare chặn detail page → safeGoto retry
 *          loop không exit, toàn bộ job treo 45 phút rồi bị workflow kill.
 *          Fix:
 *           (a) FPT_DEADLINE_MS = 25 phút (riêng FPT, thay vì dùng chung DEADLINE_MS)
 *           (b) Promise.race timeout bọc ngoài scrapeFPT() → tự thoát sau 28 phút
 *           (c) FPT page setDefaultTimeout 20s (override 0=vô hạn của puppeteer)
 *           (d) process.exit(0) kill-timer 60 phút → safety net cuối
 *
 * FIX v2.9:
 *  [BUG7] Bỏ giới hạn 30 specs/lần → fetch tất cả SP chưa có specs
 *         Kiểm soát bằng DEADLINE (50 phút) thay vì đếm số lượng
 *  [BUG8] MBW specs hoán đổi CPU/Màn hình → dùng findSpec() theo keyword
 *  [BUG9] FPT/CPS mapSpecs cập nhật đủ fields theo bảng chuẩn
 *  [KEY]  Specs chỉ fetch 1 lần duy nhất, lưu vào cache (sheet)
 *
 * v3.0:
 *  [NEW]  FPT: đổi từ per-brand → 1 URL tổng /may-tinh-xach-tay (lấy đủ 400+)
 *  [NEW]  FPT: auto-detect brand từ tên sản phẩm (detectBrand)
 *  [NEW]  FPT_MAPPING_VERSION=3 → force re-fetch toàn bộ FPT specs lần đầu
 *         Các lần chạy sau: copy specs từ cache vào row mới tự động
 */

'use strict';

const puppeteer    = require('puppeteer');
const { google }   = require('googleapis');
const fs           = require('fs');
const path         = require('path');
const os           = require('os');

// ── FIX v3.4.2 [BUG12] ────────────────────────────────────
// Puppeteer tự khởi tạo "isolated world" ngầm cho MỌI frame con mới xuất
// hiện trên trang (iframe ads/chat widget/tracking...) qua FrameManager,
// KHÔNG nằm trong bất kỳ await chain nào của code này. Khi 1 frame con bị
// treo (VD trang CPS có nhiều iframe sau khi "Load thêm" 50+ lần), Puppeteer
// ném ra 1 unhandled rejection HOÀN TOÀN TÁCH BIỆT khỏi try/catch của mình
// (kể cả catch tổng ở cuối file) — Node 15+ mặc định CRASH TOÀN BỘ PROCESS
// khi gặp unhandled rejection, xóa sạch data đã scrape được trong lần chạy.
// Fix: chặn ở tầng process, log rồi bỏ qua thay vì để Node kill cả job.
process.on('unhandledRejection', (reason) => {
  const msg = (reason && reason.message) ? reason.message.substring(0, 150) : String(reason).substring(0, 150);
  console.log(`⚠️ Unhandled rejection (bỏ qua, tiếp tục chạy): ${msg}`);
});
process.on('uncaughtException', (err) => {
  console.log(`⚠️ Uncaught exception (bỏ qua, tiếp tục chạy): ${(err.message || String(err)).substring(0, 150)}`);
});

// ── Config ────────────────────────────────────────────────
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME   = 'Daily SRP Tracking'; // v3.6.1: doi ten tab tu "RAW DATA" (Phuc da rename thu cong)

// SCRAPE_DEALERS: danh sách dealer chạy trong job này, phân tách bởi dấu phẩy
// (vd: "MBW,CPS" hoặc "FPT"). Mặc định = cả 3 (chạy full như trước).
// Dùng khi tách workflow thành nhiều job song song (vd: MBW+CPS trên
// ubuntu-latest, FPT trên self-hosted) — mỗi job chỉ ghi đè dữ liệu của
// CHÍNH dealer mình phụ trách trong sheet hôm nay, không đụng tới dữ liệu
// dealer khác do job song song ghi (tránh race condition khi cả 2 job
// cùng đọc-sửa-ghi RAW DATA cùng lúc).
const DEALER_KEY_TO_NAME = { MBW: 'MBW', FPT: 'FPT Retail', CPS: 'CellPhone S' };
const SCRAPE_DEALERS_RAW = (process.env.SCRAPE_DEALERS || 'MBW,FPT,CPS')
  .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
const SCRAPE_DEALERS = new Set(SCRAPE_DEALERS_RAW);
// Tên dealer (giá trị cột D) tương ứng với các key trong SCRAPE_DEALERS
const SCRAPE_DEALER_NAMES = new Set(
  [...SCRAPE_DEALERS].map(k => DEALER_KEY_TO_NAME[k]).filter(Boolean)
);

// v3.5.0 [29/07/2026]: kien truc scrape song song + ghi Sheet 1 lan duy nhat.
// WRITE_MODE='file'  -> job nay chi scrape roi luu allProducts ra JSON local,
//                        KHONG dung tuc ghi Sheet. Dung khi 3 dealer (MBW/CPS/FPT)
//                        chay 3 job GitHub Actions song song that su (khong con
//                        needs: tuan tu) de tiet kiem thoi gian tong.
// COMBINE_MODE=true  -> job rieng, khong scrape gi ca, chi doc cac file JSON
//                        (tu artifact cua 3 job tren) roi goi writeToSheet() 1
//                        LAN DUY NHAT sau khi ca 3 da xong. Day la buoc bat
//                        buoc de tranh 2+ tien trinh cung ghi RAW DATA cung luc
//                        (chinh nguyen nhan gay fail lien tuc 28-29/07/2026).
const WRITE_MODE   = (process.env.WRITE_MODE || 'sheet').toLowerCase(); // 'sheet' | 'file'
const COMBINE_MODE = process.env.COMBINE_MODE === 'true';
const OUTPUT_DIR    = process.env.OUTPUT_DIR || './scrape-output';
const COMBINE_INPUT_DIR = process.env.COMBINE_INPUT_DIR || './scrape-artifacts';

const CREDS_PATH     = path.join(os.tmpdir(), 'scraper_gcp.json');
// Deadline: dừng fetch specs sau 50 phút kể từ lúc start
// Đảm bảo còn đủ thời gian ghi sheet trước khi GitHub Actions timeout (6h)
const DEADLINE_MS    = 75 * 60 * 1000;
// FPT-specific deadline cho enrichSpecs: 25 phút (FPT detail page hay bị CF chặn → chạy lâu)
const FPT_DEADLINE_MS = 25 * 60 * 1000;
// Timeout bọc ngoài scrapeFPT(): nếu toàn bộ FPT scrape treo quá 28 phút → reject
const FPT_SCRAPE_TIMEOUT_MS = 28 * 60 * 1000;
// Tăng version này mỗi khi thay đổi mapping FPT → force re-fetch toàn bộ FPT specs
// CPS cache giữ nguyên (không bị ảnh hưởng)
const FPT_MAPPING_VERSION = 3; // v3.0: scrape tất cả laptop FPT (1 URL duy nhất thay vì per-brand)

// FPT: scrape toàn bộ laptop qua 1 URL tổng thay vì loop per-brand
// Lợi ích: (1) lấy đủ 400+ products, (2) không bỏ sót brand nào,
//           (3) pagination "Xem thêm" load hết không giới hạn
const FPT_ALL_URL = 'https://fptshop.com.vn/may-tinh-xach-tay';

// MBW: scrape trang tổng /laptop để lấy đủ ~464 SP (thay vì per-brand chỉ ~150)
// FPT và CPS: vẫn scrape per-brand như cũ
//
// Cả 3 dealer đều có thể bị chặn/challenge IP của GitHub-hosted runners:
//  - MBW (thegioididong.com): ERR_CONNECTION_RESET → fix bằng Cloudflare Worker proxy
//  - FPT (fptshop.com.vn): Cloudflare "Just a moment..." bot-challenge — Worker
//    proxy KHÔNG bypass được (Cloudflare Worker → origin cũng do Cloudflare bảo vệ
//    bị chặn ở edge-to-edge level) → vẫn gọi trực tiếp, có thể trả 0 SP trên CI.
//  - CPS (cellphones.com.vn): không bị chặn → gọi trực tiếp.
// PROXY_HOST (vd: "https://mbw-proxy.<account>.workers.dev") là 1 Cloudflare
// Worker reverse-proxy đa-target — forward request tới đúng site qua đường dẫn
// /__proxy/<mbw|fpt|cps>/<path> bằng IP Cloudflare edge.
// Nếu không set PROXY_HOST, MBW gọi trực tiếp thegioididong.com (cần self-hosted).
const PROXY_HOST = (process.env.MBW_PROXY_HOST || '').replace(/\/$/, '');

const MBW_REAL_HOST = 'www.thegioididong.com';

const MBW_BASE = PROXY_HOST ? `${PROXY_HOST}/__proxy/mbw` : `https://${MBW_REAL_HOST}`;

const MBW_URL = `${MBW_BASE}/laptop`;

// FIX v3.4.9 [REVERT BUG15/v3.4.6]: v3.4.6 route CPS qua Cloudflare Worker
// proxy để test giả thuyết "site chặn IP runner" — KẾT QUẢ: không chỉ không
// fix được hang, mà số lần "Load thêm" mỗi brand tăng vọt lên ~125-126 lần
// GIỐNG NHAU bất thường giữa các brand khác nhau (Acer/HP/Lenovo/MSI), trong
// khi trước đó mỗi brand có số lần load hợp lý và KHÁC NHAU theo quy mô thật
// (Asus 51, Acer 15, Dell 24, HP 24, Lenovo 34, MSI 16). Số liệu giống nhau
// bất thường giữa nhiều brand là dấu hiệu proxy làm hỏng cookie/session lọc
// theo brand của CPS (Worker rewrite Host/Origin/Referer + xóa cf-* headers,
// rewrite Set-Cookie domain) → có thể khiến origin trả về 1 view fallback
// chung (không lọc đúng brand) thay vì trang brand-cụ thể, hoặc khiến AJAX
// "Load thêm" thất bại im lặng mà nút vẫn hiện ra để bấm tiếp vô hạn.
// MBW dùng CÙNG cơ chế proxy vẫn ổn — khác site, khác cách site đó dùng
// cookie/session, không có gì mâu thuẫn.
// REVERT: CPS quay lại gọi trực tiếp cellphones.com.vn như trước 15/06.
// KHÔNG dùng PROXY_HOST cho CPS nữa, dù env var vẫn set (chỉ áp dụng cho MBW).
const CPS_REAL_HOST = 'cellphones.com.vn';
const CPS_BASE = `https://${CPS_REAL_HOST}`; // luôn trực tiếp — không proxy

// Helper: gắn request interception lên 1 page để rewrite mọi request tới
// `realHost` sang `proxyBase + /__proxy/<key>` + path gốc — cho phép các AJAX
// call tuyệt đối (load-more, API nội bộ...) cũng đi qua proxy.
// Idempotent: nếu page đã enable interception rồi thì bỏ qua, tránh add 2
// listener cùng gọi req.continue() trên 1 request → "Request is already handled!"
function enableProxyInterception(page, realHost, proxyKey) {
  if (!PROXY_HOST) return Promise.resolve();
  if (page.__proxyInterceptionEnabled) return Promise.resolve();
  page.__proxyInterceptionEnabled = true;
  const proxyPrefix = `${PROXY_HOST}/__proxy/${proxyKey}`;
  return page.setRequestInterception(true).then(() => {
    page.on('request', (req) => {
      try {
        const reqUrl = new URL(req.url());
        if (reqUrl.hostname === realHost) {
          const proxied = proxyPrefix + reqUrl.pathname + reqUrl.search;
          req.continue({ url: proxied });
          return;
        }
      } catch (_) { /* fall through */ }
      req.continue();
    });
  });
}

const BRANDS = [

  { name: 'Asus',     fptUrl: 'https://fptshop.com.vn/may-tinh-xach-tay/asus',     cpsUrl: 'https://cellphones.com.vn/laptop/asus.html'     },
  { name: 'Acer',     fptUrl: 'https://fptshop.com.vn/may-tinh-xach-tay/acer',     cpsUrl: 'https://cellphones.com.vn/laptop/acer.html'     },
  { name: 'Dell',     fptUrl: 'https://fptshop.com.vn/may-tinh-xach-tay/dell',     cpsUrl: 'https://cellphones.com.vn/laptop/dell.html'     },
  { name: 'HP',       fptUrl: 'https://fptshop.com.vn/may-tinh-xach-tay/hp',       cpsUrl: 'https://cellphones.com.vn/laptop/hp.html'       },
  { name: 'Lenovo',   fptUrl: 'https://fptshop.com.vn/may-tinh-xach-tay/lenovo',   cpsUrl: 'https://cellphones.com.vn/laptop/lenovo.html'   },
  { name: 'MSI',      fptUrl: 'https://fptshop.com.vn/may-tinh-xach-tay/msi',      cpsUrl: 'https://cellphones.com.vn/laptop/msi.html'      },
  { name: 'Samsung',  fptUrl: 'https://fptshop.com.vn/may-tinh-xach-tay/samsung',  cpsUrl: 'https://cellphones.com.vn/laptop/samsung.html'  },
  { name: 'MacBook',  fptUrl: 'https://fptshop.com.vn/may-tinh-xach-tay/macbook',  cpsUrl: 'https://cellphones.com.vn/macbook.html'          },
  { name: 'Gigabyte', fptUrl: 'https://fptshop.com.vn/may-tinh-xach-tay/gigabyte', cpsUrl: 'https://cellphones.com.vn/laptop/gigabyte.html' },
];

const HEADERS = [
  'Date', 'Time', 'No', 'Dealer', 'Model Name', 'Brand',
  'CPU (Listed)', 'RAM (Listed)', 'Storage', 'Screen Size', 'GPU (Listed)', 'Weight',
  'Original Price', 'Sale Price', 'Discount %', 'Units Sold', 'Rating', 'Product Link',
  'Availability',
];
// v3.6: cot rieng "Availability" (S) = tinh trang con/het hang LUC SCRAPE,
// khac voi "Status" (T, xem duoi) la tinh trang SAN PHAM tra tu Part # (vd
// EOL) — 2 khai niem khac nhau, tranh nham ten.

// v3.6: 12 cot enrich T→AE, tra cuu bang CODE (khong con formula) tu tab
// "Part #" theo Model Name (cot E) khop voi Part #!A (Product Name). Chay
// tu dong moi lan scrape — xem enrichRawDataRows() + buildPartLookupMap().
const ENRICHMENT_HEADERS = [
  'Status', 'Series Group', 'Segment', 'CPU Segment', 'CPU', 'RAM', 'SSD',
  'Screen', 'GPU', 'V-RAM', 'Part #', 'Focus Model',
];
const PART_TAB = 'Part #';
const SEGMENT_TAB = 'Segment';

// ── Helpers ───────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

// FIX v3.4.7 [BUG16]: page.evaluate() dùng để đọc/thao tác DOM (bấm nút
// "Load thêm", scroll, trích xuất listing) từ trước tới giờ CHỈ có .catch()
// bắt lỗi REJECT — không bắt được HANG (evaluate treo không bao giờ resolve
// lẫn reject nếu CDP session bị đơ). Thực tế 22-23/07 đã thấy TẤT CẢ brand
// CPS treo ngay trong bước "Load thêm"/extract listing (không phải goto tới
// trang chi tiết như nghi ban đầu) — kể cả sau khi đã route qua Cloudflare
// proxy (loại được giả thuyết site chặn IP). Vì cả 6/6 brand treo liên tiếp,
// nghi CDP session hoặc cả browser bị đơ toàn bộ từ 1 điểm nào đó, không chỉ
// riêng 1 trang. Helper này bọc timeout cho MỌI page.evaluate() ở bước
// listing-scrape, tương tự cách đã làm cho fetch specs (v3.4.5).
function evalWithTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]).catch(() => fallback);
}

function formatDate(d) {
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}
function formatTime(d) {
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

async function scrollToBottom(page) {
  // BUG FIX v3.2: async evaluate với long-running Promise → CDP timeout trên trang lớn
  // Fix: scroll nhiều bước nhỏ từ Node.js thay vì 1 evaluate async block lớn
  let lastHeight = 0;
  for (let i = 0; i < 40; i++) {
    const height = await evalWithTimeout(page.evaluate(() => document.body.scrollHeight), 8000, 0);
    if (height === lastHeight && i > 0) break;
    lastHeight = height;
    const steps = Math.ceil(height / 1500);
    for (let s = 0; s <= steps; s++) {
      await evalWithTimeout(page.evaluate((y) => window.scrollTo(0, y), s * 1500), 8000, null);
    }
    await sleep(400);
    const newHeight = await evalWithTimeout(page.evaluate(() => document.body.scrollHeight), 8000, 0);
    if (newHeight === height) break;
  }
}

// Lỗi "fatal" nghĩa là page/frame/browser đã chết hẳn — retry thêm là vô ích,
// phải ném lên để caller đóng page cũ + tạo page mới (xem main loop CPS/FPT).
function isFatalPageError(e) {
  return /detached Frame|Session closed|Target closed|Protocol error|Connection closed/i.test(e.message || '');
}

// v3.4.14: Lightweight HTTP stock check — KHÔNG dùng Puppeteer, chỉ fetch HTML
// rồi regex tìm "TẠM HẾT HÀNG" trên detail page. Dùng cho SP không có trong
// spec cache (SP mới, chưa biết tình trạng) để lọc EOL/OOS mà không cần điều
// hướng Puppeteer (giữ nguyên tính ổn định v3.4.10).
const HTTP_STOCK_CHECK_TIMEOUT = 6000;
const HTTP_STOCK_CHECK_CONCURRENCY = 5;
const HTTP_STOCK_CHECK_CAP = 80; // tối đa SP check/brand để không kéo dài job

async function checkStockHTTP(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HTTP_STOCK_CHECK_TIMEOUT);
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);
    const html = await res.text();
    if (/tạm\s*hết\s*hàng|hết\s*hàng/i.test(html)) return 'Tạm hết hàng';
    if (/ngừng\s*kinh\s*doanh|sản phẩm không tồn tại|không tìm thấy/i.test(html)) return 'Ngừng KD';
    return 'Còn hàng';
  } catch {
    return 'Chưa rõ'; // FIX 05/08/2026: loi mang -> khong ro, khong mac dinh con hang (tung gay sai lech Availability)
  }
}

async function batchCheckStockHTTP(products, specCache) {
  // Chỉ check SP không có trong spec cache
  const uncached = products.filter(p => !specCache.has(p.link));
  if (uncached.length === 0) return { filtered: 0, checked: 0 };

  const toCheck = uncached.slice(0, HTTP_STOCK_CHECK_CAP);
  if (uncached.length > HTTP_STOCK_CHECK_CAP) {
    console.log(`    ℹ ${uncached.length} SP mới, chỉ HTTP check ${HTTP_STOCK_CHECK_CAP} SP/brand`);
  }

  let filtered = 0;
  for (let i = 0; i < toCheck.length; i += HTTP_STOCK_CHECK_CONCURRENCY) {
    const batch = toCheck.slice(i, i + HTTP_STOCK_CHECK_CONCURRENCY);
    const results = await Promise.all(batch.map(p => checkStockHTTP(p.link)));
    results.forEach((status, idx) => {
      if (status !== 'Còn hàng') {
        batch[idx].stockStatus = status;
        filtered++;
      }
    });
    if (i + HTTP_STOCK_CHECK_CONCURRENCY < toCheck.length) await sleep(300);
  }
  return { filtered, checked: toCheck.length };
}

async function safeGoto(page, url) {
  for (let i = 0; i <= 2; i++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
      return true;
    } catch (e) {
      if (isFatalPageError(e)) {
        console.log(`    💀 fatal page error, ngừng retry: ${e.message.substring(0,60)}`);
        throw e; // propagate lên để scrapeCPS/scrapeFPT caller tạo page mới
      }
      if (i === 2) { console.log(`    ⚠ goto failed: ${e.message.substring(0,60)}`); return false; }
      await sleep(2000);
    }
  }
}

// ── FPT: fetch specs từ detail page ──────────────────────
async function fetchSpecsFPT(page, url) {
  try {
    const ok = await safeGoto(page, url);
    if (!ok) return {};
    await sleep(1200);
    // Detect stock status TRƯỚC khi click "Xem tất cả thông số"
    const stockStatus = await page.evaluate(() => {
      const body = document.body.innerText || '';
      // "Hàng sắp về" — button/div đặc biệt trên FPT
      if (/hàng sắp về/i.test(body)) return 'Hàng sắp về';
      // "Ngừng kinh doanh" / "Ngừng bán"
      if (/ngừng kinh doanh|ngừng bán|stop.*sell/i.test(body)) return 'Ngừng KD';
      // "Hết hàng"
      if (/hết hàng/i.test(body)) return 'Hết hàng';
      // "Liên hệ" thay vì giá
      const priceEl = document.querySelector('[class*="b1-semibold"],[class*="price"]');
      if (priceEl && /liên hệ/i.test(priceEl.innerText || '')) return 'Liên hệ';
      return 'Còn hàng';
    }).catch(() => 'Chưa rõ'); // FIX 05/08/2026: loi ky thuat -> khong ro, khong mac dinh con hang

    const clicked = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('span, button, a')]
        .find(b => b.innerText?.trim() === 'Xem tất cả thông số');
      if (btn) { btn.click(); return true; }
      return false;
    }).catch(() => false);
    if (clicked) await sleep(700);
    const raw = await page.evaluate(() => {
      const specs = {};
      document.querySelectorAll('.flex.gap-2.border-b').forEach(row => {
        const ch = [...row.children];
        if (ch.length >= 2) {
          const label = ch[0].innerText?.trim();
          const value = ch[1].innerText?.trim().replace(/\n+/g, ' ');
          if (label && value) specs[label] = value;
        }
      });
      return specs;
    }).catch(() => ({}));
    const result = mapSpecsFPT(raw);
    result.stockStatus = stockStatus;
    return result;
  } catch (e) {
    if (isFatalPageError(e)) throw e; // page chết hẳn → propagate, không nuốt lỗi
    return {};
  }
}

function mapSpecsFPT(raw) {
  // CPU: Công nghệ CPU + Loại CPU
  const cpu = [raw['Công nghệ CPU'], raw['Loại CPU']].filter(Boolean).join(' ')
              + (raw['Tốc độ tối đa'] ? ` - Max Turbo: ${raw['Tốc độ tối đa']}` : '');
  // RAM: Dung lượng + Loại (VD: "16GB DDR5")
  const ram = [raw['Dung lượng RAM'], raw['Loại RAM']].filter(Boolean).join(' ');
  // Ổ cứng: Kiểu + Dung lượng SSD (VD: "SSD 512GB")
  const storage = [raw['Kiểu ổ cứng'], raw['Dung lượng SSD']].filter(Boolean).join(' ');
  // Màn hình: Kích thước + Độ phân giải + Tần số quét + Độ phủ màu
  const screen = [
    raw['Kích thước màn hình'],
    raw['Độ phân giải'],
    raw['Tần số quét'] ? raw['Tần số quét'] + 'Hz' : '',
    raw['Độ phủ màu'],
  ].filter(Boolean).join(', ');
  // GPU: Nếu có cả card rời lẫn onboard → ghi cả 2 (VD: "RTX 5060 8GB / Intel Graphics")
  //       Nếu chỉ có 1 loại → ghi loại đó
  const gpuDiscrete = raw['Tên đầy đủ (Card rời)'] || raw['Hãng (Card rời)'] || '';
  const gpuOnboard  = raw['Tên đầy đủ (Card onbroad)'] || raw['Hãng (Card Oboard)'] || '';
  const gpu = gpuDiscrete && gpuOnboard
    ? `${gpuDiscrete} / ${gpuOnboard}`  // Cả 2: card rời trước
    : gpuDiscrete || gpuOnboard;        // Chỉ 1 loại
  // Trọng lượng
  const weight = raw['Trọng lượng sản phẩm'] || raw['Khối lượng'] || raw['Trọng lượng'] || '';
  return { cpu, ram, storage, screen, gpu, weight };
}

// ── CPS: fetch specs từ detail page ──────────────────────
async function fetchSpecsCPS(page, url) {
  try {
    // v3.4.9: REVERT v3.4.6 — gọi trực tiếp, không qua proxy
    const ok = await safeGoto(page, url);
    if (!ok) return {};
    await sleep(1200);
    // Detect stock status từ CPS detail page
    const stockStatus = await page.evaluate(() => {
      const body = document.body.innerText || '';
      if (/ngừng kinh doanh|ngừng bán|không còn bán/i.test(body)) return 'Ngừng KD';
      if (/hết hàng|out of stock/i.test(body)) return 'Hết hàng';
      if (/sắp về|pre.?order|đặt trước/i.test(body)) return 'Hàng sắp về';
      // CPS: nếu không có giá hiển thị → Liên hệ
      const priceEl = document.querySelector('.product__price--show,.tpt-price,.price-show');
      if (!priceEl || !/\d/.test(priceEl.innerText || '')) return 'Liên hệ';
      return 'Còn hàng';
    }).catch(() => 'Chưa rõ'); // FIX 05/08/2026: loi ky thuat -> khong ro, khong mac dinh con hang

    const raw = await page.evaluate(() => {
      const specs = {};
      document.querySelectorAll('tr.technical-content-item').forEach(row => {
        const tds = row.querySelectorAll('td');
        if (tds.length >= 2) {
          const label = tds[0].innerText?.trim();
          const value = tds[1].innerText?.trim().replace(/\n+/g, ' ');
          if (label && value) specs[label] = value;
        }
      });
      // FIX v3.4.11 [học từ bản v2 thử nghiệm]: nếu CPS đổi class CSS khiến
      // selector trên trả về rỗng, fallback tìm khối chứa heading "Thông số
      // kỹ thuật" rồi quét mọi <tr> có đúng 2 <td> bên trong — không phụ
      // thuộc tên class cụ thể, chỉ chạy khi selector chính không ra gì nên
      // không ảnh hưởng hành vi hiện tại.
      if (Object.keys(specs).length === 0) {
        const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
        const container = Array.from(document.querySelectorAll('section,div')).find(el => {
          const t = clean(el.innerText);
          return t.startsWith('Thông số kỹ thuật') && t.length < 6000;
        });
        if (container) {
          container.querySelectorAll('tr').forEach(row => {
            const tds = row.querySelectorAll('td');
            if (tds.length >= 2) {
              const label = tds[0].innerText?.trim();
              const value = tds[1].innerText?.trim().replace(/\n+/g, ' ');
              if (label && value) specs[label] = value;
            }
          });
        }
      }
      return specs;
    }).catch(() => ({}));
    const result = mapSpecsCPS(raw);
    result.stockStatus = stockStatus;
    return result;
  } catch (e) {
    if (isFatalPageError(e)) throw e; // page chết hẳn → propagate, không nuốt lỗi
    return {};
  }
}

function mapSpecsCPS(raw) {
  // CPU: Loại CPU
  const cpu = raw['Loại CPU'] || '';
  // RAM: Dung lượng + Loại RAM (VD: "16GB DDR5 4800MHz")
  const ram = [raw['Dung lượng RAM'], raw['Loại RAM']].filter(Boolean).join(' ');
  // Ổ cứng
  const storage = raw['Ổ cứng'] || '';
  // Màn hình: Kích thước + Công nghệ màn hình
  const screen = [raw['Kích thước màn hình'], raw['Công nghệ màn hình']].filter(Boolean).join(', ');
  // GPU: Loại card đồ họa
  const gpu = raw['Loại card đồ họa'] || '';
  // Trọng lượng
  const weight = raw['Trọng lượng'] || raw['Khối lượng'] || '';
  return { cpu, ram, storage, screen, gpu, weight };
}

// ── enrichSpecs: fetch specs cho SP chưa có, dừng khi hết deadline ──
async function enrichSpecs(products, specCache, fetchFn, page, startTime, deadlineMs, skipNewFetch) {
  const effectiveDeadline = deadlineMs || DEADLINE_MS;
  // FIX v3.4.5 [BUG15]: v3.4.3/v3.4.4 chỉ có timeout ở CẤP BRAND (10 phút) —
  // khi 1 SP treo câm (không lỗi, không phản hồi — nghi do site rate-limit/
  // chặn IP runner, KHÔNG phải do browser/DOM vì đã test page hoàn toàn mới
  // vẫn treo), phải đợi hết 10 phút mới "cứu" được VÀ MẤT LUÔN TOÀN BỘ SP
  // của brand đó (kể cả data listing cơ bản đã lấy xong). Thực tế 22-23/07 đã
  // thấy 4-5/6 brand CPS treo liên tiếp → gần cạn hết 60 phút kill-timer.
  // Fix: timeout riêng ở CẤP TỪNG SẢN PHẨM (25s) — treo thì bỏ qua đúng 1 SP
  // đó (không cache để mai thử lại), tiếp tục ngay SP kế tiếp bằng CÙNG page,
  // không đợi tới brand-level timeout mới xử lý.
  //
  // FIX v3.4.10 [BUG16 — dừng điều tra, phục hồi ổn định, 23/07/2026]: đã xác
  // nhận "detached Frame" xảy ra GIỐNG NHAU trên mọi hạ tầng (ubuntu-latest,
  // proxy/không proxy, page mới/relaunch browser, VÀ CẢ self-hosted MSI —
  // máy nhiều tài nguyên hơn hẳn vẫn treo sau ~50 phút, FPT chạy sau đó cũng
  // dính lỗi giống hệt). Vậy đây KHÔNG phải do hạ tầng (cloud yếu, IP bị
  // chặn, hay máy yếu) — nghi là vấn đề nội tại của việc điều hướng liên tục
  // hàng trăm lần tới trang chi tiết SP trong 1 session Puppeteer kéo dài.
  // Theo yêu cầu: dừng vá thêm, ưu tiên ỔN ĐỊNH — skipNewFetch=true sẽ tắt
  // hẳn việc fetch specs MỚI (không điều hướng sang trang chi tiết nữa), chỉ
  // áp dụng specs đã có trong cache cho SP đã biết. SP mới sẽ thiếu specs
  // (cpu/ram/gpu/...) cho tới khi vấn đề gốc được xử lý dứt điểm, nhưng đổi
  // lại: listing (giá/tên/link/tình trạng) luôn lấy được đầy đủ, ổn định.
  const PER_PRODUCT_TIMEOUT_MS = 25000;
  let fetched = 0;
  let skipped = 0;
  for (const p of products) {
    if (specCache.has(p.link)) {
      // Copy specs từ cache NHƯNG KHÔNG override stockStatus:
      // stockStatus đã được detect chính xác từ listing/detail page HÔM NAY.
      // Cache chỉ lưu specs tĩnh (cpu/ram/...) — stockStatus thay đổi hàng ngày.
      const { stockStatus: _skip, ...cachedSpecs } = specCache.get(p.link);
      Object.assign(p, cachedSpecs);
    } else if (skipNewFetch) {
      skipped++;
      continue; // v3.4.10: không điều hướng sang trang chi tiết — bỏ qua SP mới
    } else {
      // Kiểm tra deadline trước khi fetch
      if (Date.now() - startTime > effectiveDeadline) {
        console.log(`    ⏱ Deadline reached (${Math.round(effectiveDeadline/60000)}m) — dừng fetch specs`);
        break;
      }
      const productTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('per-product timeout')), PER_PRODUCT_TIMEOUT_MS)
      );
      let specs;
      try {
        specs = await Promise.race([fetchFn(page, p.link), productTimeout]);
      } catch (e) {
        skipped++;
        await sleep(600);
        continue; // bỏ qua đúng 1 SP này, KHÔNG cache, KHÔNG mất cả brand
      }
      // Khi fetch detail page: stockStatus từ detail page chính xác hơn listing
      // → dùng stockStatus từ detail page (override listing status)
      Object.assign(p, specs);
      // Lưu vào cache: chỉ lưu specs tĩnh, KHÔNG lưu stockStatus
      // (tránh cache stockStatus cũ gây lỗi ngày hôm sau)
      const { stockStatus: _skip2, ...specsToCache } = specs;
      specCache.set(p.link, specsToCache);
      fetched++;
      await sleep(600);
    }
  }
  if (fetched > 0) console.log(`    → Fetched specs: ${fetched} SP mới`);
  if (skipped > 0) {
    if (skipNewFetch) console.log(`    ⏭ Bỏ qua ${skipped} SP mới (v3.4.10: tạm tắt fetch specs trang chi tiết CPS, chỉ dùng cache)`);
    else console.log(`    ⏭ Bỏ qua ${skipped} SP (treo/timeout ${PER_PRODUCT_TIMEOUT_MS/1000}s mỗi SP, sẽ thử lại lần sau)`);
  }
}

// ── FIX #2: SKU rớt khỏi listing hôm nay (mọi dealer) — thay vì im lặng ────
// biến mất, ghé thẳng trang chi tiết để phân biệt 3 trường hợp:
//   (a) Ngừng kinh doanh / hết hàng thật  → đúng như kỳ vọng, không phải bug
//   (b) SP vẫn còn bán bình thường trên web → XÁC NHẬN đây là lỗi scrape thật
//       (vd: FPT B85LNPA 06/07 — web vẫn bán nhưng bị bỏ sót ở trang listing)
//   (c) Trang lỗi/không tải được → cần soát lại thủ công
const MISSING_CHECK_CAP = 20; // giới hạn số SP check/lần/dealer để không kéo dài job

async function getMissingCandidates(sheets, dealerName, todayLinks) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A2:S`,
      valueRenderOption: 'FORMULA', // A:S toàn data thô, tránh kích hoạt tính toán
    });
    const rows = res.data.values || [];
    const parseVN = (d) => {
      const [dd, mm, yyyy] = (d || '').split('/').map(Number);
      return (dd && mm && yyyy) ? new Date(yyyy, mm - 1, dd) : null;
    };
    // SKU đã từng được xác nhận "Ngừng kinh doanh"/"Hết hàng" → bỏ qua, không
    // check lại mỗi ngày nữa (đỡ tốn thời gian job). SKU dạng "bị bỏ sót khi
    // scrape" thì VẪN check lại mỗi ngày vì đó là lỗi cần theo dõi tiếp.
    const confirmedGone = new Set(
      rows.filter(r => r[3] === dealerName && ['Ngừng kinh doanh','Hết hàng'].includes(r[18]))
          .map(r => r[17])
    );
    let latestDate = null, latestDt = null;
    rows.forEach(r => {
      if (r[3] !== dealerName || !r[0]) return;
      const dt = parseVN(r[0]);
      if (dt && (!latestDt || dt > latestDt)) { latestDt = dt; latestDate = r[0]; }
    });
    if (!latestDate) return [];
    const candidates = [];
    const seen = new Set();
    rows.forEach(r => {
      if (r[3] !== dealerName || r[0] !== latestDate) return;
      const link = r[17];
      if (!link || seen.has(link)) return;
      seen.add(link);
      if (todayLinks.has(link)) return;
      if (confirmedGone.has(link)) return;
      candidates.push({ link, name: r[4] || '', brand: r[5] || '' });
    });
    return candidates;
  } catch (e) {
    console.log(`⚠ getMissingCandidates(${dealerName}) lỗi: ${e.message}`);
    return [];
  }
}

async function checkMissingProducts(browser, dealerName, candidates, specCache) {
  if (candidates.length === 0) return [];
  const toCheck = candidates.slice(0, MISSING_CHECK_CAP);
  if (candidates.length > MISSING_CHECK_CAP) {
    console.log(`    ℹ [${dealerName}] ${candidates.length} SP mất khỏi listing, chỉ check ${MISSING_CHECK_CAP} SP/lần (còn lại check ở lần chạy sau)`);
  }
  const out = [];
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36');
  const isMBW = dealerName === 'MBW';
  if (isMBW) await enableProxyInterception(page, MBW_REAL_HOST, 'mbw');
  // v3.4.9: CPS KHÔNG dùng proxy nữa (revert v3.4.6 — xem comment CPS_BASE)

  for (const c of toCheck) {
    let url = c.link;
    if (isMBW && PROXY_HOST) url = c.link.replace(`https://${MBW_REAL_HOST}`, MBW_BASE);
    let status = 'Trang không tải đủ nội dung - cần kiểm tra thủ công';
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await sleep(1200);
      const bodyText = await page.evaluate(() => document.body.innerText || '').catch(() => '');
      if (/ngừng\s*kinh\s*doanh|ngừng sản xuất|không tìm thấy sản phẩm|sản phẩm không tồn tại/i.test(bodyText)) {
        status = 'Ngừng kinh doanh';
      } else if (/tạm hết hàng|đã hết hàng|hàng sắp về/i.test(bodyText)) {
        status = 'Hết hàng';
      } else if (bodyText.length >= 300) {
        // Trang tải bình thường, không thấy dấu hiệu ngừng bán/hết hàng
        // → SP thực sự vẫn đang bán, chứng tỏ đây là lỗi scrape THẬT
        status = 'Còn hàng - bị bỏ sót khi scrape (lỗi thật, cần kiểm tra thuật toán tải trang)';
      }
    } catch (e) {
      status = 'Không tải được trang - cần kiểm tra thủ công';
    }
    const spec = specCache.get(c.link) || {};
    out.push({
      dealer: dealerName, name: c.name, brand: c.brand,
      cpu: spec.cpu || '', screen: spec.screen || '', gpu: spec.gpu || '', weight: spec.weight || '',
      ram: spec.ram || '', storage: spec.storage || '',
      origPrice: 0, salePrice: 0, discount: '', sold: '', rating: '',
      link: c.link, stockStatus: status,
    });
    await sleep(600);
  }
  await page.close().catch(() => {});
  const realMiss = out.filter(p => p.stockStatus.startsWith('Còn hàng - bị bỏ sót')).length;
  const gone     = out.filter(p => p.stockStatus === 'Ngừng kinh doanh' || p.stockStatus === 'Hết hàng').length;
  console.log(`    → [${dealerName}] Đã kiểm tra ${toCheck.length} SP mất khỏi listing: ${gone} ngừng/hết hàng thật, ${realMiss} LỖI SCRAPE THẬT (vẫn còn bán), ${toCheck.length-gone-realMiss} cần kiểm tra thêm`);
  return out;
}

// ── SCRAPER 1 — MBW ──────────────────────────────────────
async function scrapeMBW(page) {
  console.log('  [MBW] Trang tổng /laptop');

  // Khi dùng proxy: trang chính được load qua PROXY_HOST, nhưng các AJAX call
  // ("Xem thêm" load more) mà page tự phát ra vẫn có thể trỏ thẳng tới
  // thegioididong.com (URL tuyệt đối trong JS bundle) → cần rewrite sang proxy.
  await enableProxyInterception(page, MBW_REAL_HOST, 'mbw');

  try {
    // Qua proxy: networkidle2 hay bị timeout (1 request nền không bao giờ "idle"
    // khi đi qua Worker). domcontentloaded + sleep ổn định hơn, giống FPT/CPS.
    const waitUntil = PROXY_HOST ? 'domcontentloaded' : 'networkidle2';
    await page.goto(MBW_URL, { waitUntil, timeout: 90000 });
    if (PROXY_HOST) await sleep(3000);
  } catch(e) {
    console.log(`    ⚠ Load failed: ${e.message.substring(0,60)}`);
    return [];
  }
  await sleep(2000);

  // Loop: scroll xuống để "Xem thêm" visible → click → chờ load → repeat
  let clicks = 0;
  let prevCount = 0;
  let stagnant = 0;
  while (true) {
    // Scroll đến cuối trang để trigger lazy load và đưa button vào viewport
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(1500);

    const result = await page.evaluate(() => {
      // 1) CSS selectors — chú ý: class "view-more" nằm trên DIV bọc ngoài,
      //    thẻ <a> click được nằm BÊN TRONG → cần ".view-more a" (descendant)
      const selectors = [
        '.view-more a', 'div.view-more a', '[class*="view-more"] a',
        'a.view-more', 'button.view-more', '.view-more-btn',
        'a[class*="view-more"]', 'button[class*="view-more"]',
        '.btn-view-more', 'a.btn-more', '.show-more', '.see-more a',
      ];
      for (const sel of selectors) {
        const btn = document.querySelector(sel);
        if (btn && btn.offsetParent !== null) {
          btn.scrollIntoView({ block: 'center' });
          btn.click();
          return { clicked: true, selector: sel };
        }
      }
      // 2) Fallback: tìm theo text "Xem thêm" — chống chịu khi site đổi class
      const els = [...document.querySelectorAll('a, button')];
      const btn = els.find(el =>
        /xem\s*thêm/i.test(el.textContent || '') &&
        (el.textContent || '').trim().length < 80 &&
        el.offsetParent !== null
      );
      if (btn) {
        btn.scrollIntoView({ block: 'center' });
        btn.click();
        return { clicked: true, selector: 'text:Xem thêm' };
      }
      return { clicked: false };
    }).catch(() => ({ clicked: false }));

    if (!result.clicked) break;
    clicks++;
    await sleep(3500); // tăng wait: proxy AJAX render cần thêm thời gian

    // BUG FIX: đếm a.main-contain (product thực) không đếm banner/skeleton
    // Tăng threshold 2→3 để chịu được 1 lần proxy lag.
    const count = await page.evaluate(() =>
      document.querySelectorAll('ul.listproduct li.item a.main-contain').length
    );
    if (count === prevCount) {
      stagnant++;
      if (stagnant >= 3) break;
    } else {
      stagnant = 0;
      prevCount = count;
    }
  }
  console.log(`    → Clicked "Xem thêm": ${clicks} lần`);

  const totalItems = await page.evaluate(() =>
    document.querySelectorAll('ul.listproduct li.item').length
  );
  const productItems = await page.evaluate(() =>
    document.querySelectorAll('ul.listproduct li.item a.main-contain').length
  );
  console.log(`    → Tổng items trên trang: ${totalItems} (products: ${productItems})`);

  if (totalItems === 0) {
    const diag = await page.evaluate(() => ({
      title: document.title,
      url: location.href,
      bodyLen: document.body.innerHTML.length,
      bodySnippet: (document.body.innerText || '').slice(0, 200).replace(/\s+/g, ' '),
    })).catch(() => null);
    if (diag) {
      console.log(`    🔍 diag: title="${diag.title}" url=${diag.url} bodyLen=${diag.bodyLen}`);
      console.log(`    🔍 body: ${diag.bodySnippet}`);
    }
  }

  return page.evaluate((BASE) => {
    const out  = [];
    const seen = new Set();
    document.querySelectorAll('ul.listproduct li.item').forEach(item => {
      const aEl = item.querySelector('a.main-contain');
      if (!aEl) return;
      const href = aEl.getAttribute('href') || '';
      const link = href.startsWith('http') ? href : BASE + href;
      if (!href || seen.has(link)) return;
      seen.add(link);

      const name      = aEl.getAttribute('data-name') || aEl.querySelector('h3')?.innerText?.trim() || '';
      // data-brand từ data attribute hoặc từ tên model
      const brandName = aEl.getAttribute('data-brand') || aEl.getAttribute('data-trademark') || '';
      // data-price trên MBW là float string (VD: "16790000.0") → dùng parseFloat+Math.round, KHÔNG dùng parseInt+replace (sẽ xóa dấu . → sai x10)
      const salePrice = Math.round(parseFloat(aEl.getAttribute('data-price') || '0')) || 0;
      const origPrice = parseInt((item.querySelector('p.price-old')?.innerText || '').replace(/\D/g,'')) || 0;
      const discount  = item.querySelector('span.percent')?.innerText?.trim() || '';
      const specs     = [...item.querySelectorAll('div.utility p')].map(p => p.innerText.trim());
      const compare   = [...item.querySelectorAll('div.item-compare span')].map(s => s.innerText.trim());
      const rating    = item.querySelector('div.vote-txt b')?.innerText?.trim() || '';
      const sold      = item.querySelector('div.rating_Compare span')?.innerText?.trim() || '';

      // MBW listing: mỗi spec có label prefix rõ ràng (VD: "Công nghệ CPU: i5-...")
      // Hàm parseSpec: tìm spec chứa keyword, trả về phần sau dấu ":"
      const parseSpec = (kw) => {
        const s = specs.find(s => s.toLowerCase().includes(kw.toLowerCase()));
        if (!s) return '';
        const colonIdx = s.indexOf(':');
        return colonIdx >= 0 ? s.substring(colonIdx + 1).trim() : s.trim();
      };
      // Fallback findSpec nếu không có dấu ":"
      const findSpec = (kw) => specs.find(s => s.toLowerCase().includes(kw.toLowerCase())) || '';

      const cpu    = parseSpec('Công nghệ CPU') || parseSpec('cpu') || findSpec('Core') || findSpec('Ryzen') || findSpec('Celeron') || findSpec('Snapdragon') || '';
      // RAM từ compare (div.item-compare) là chính xác nhất
      // Màn hình từ spec listing
      const screen = parseSpec('Kích thước màn hình') || parseSpec('màn hình') || findSpec('inch') || '';
      // GPU
      const gpu    = parseSpec('Card màn hình') || parseSpec('card') || findSpec('RTX') || findSpec('GTX') || findSpec('Radeon') || findSpec('Arc') || '';
      // Trọng lượng: từ "Kích thước:" có chứa kg, hoặc tìm theo kg
      const weightRaw = parseSpec('Kích thước') || parseSpec('trọng lượng') || findSpec('kg') || '';
      const weight = weightRaw;

      // MBW: detect stock status từ listing page
      // FIX 05/08/2026: truoc day chi check gia (thieu gia -> Chua ro, con
      // lai luon mac dinh "Con hang") — KHONG doc chu "het hang"/"tam het
      // hang" tren card, gay sai lech nghiem trong (site ghi het hang nhung
      // Availability van "Con hang"). Vi enrichSpecs hien khong con fetch
      // trang chi tiet cho SP da cache (tat tu 23/07 de on dinh), day RA
      // TUYEN PHONG THU DUY NHAT cho Availability — phai kiem tra ky nhu CPS.
      const mbwStatus = (() => {
        const cardText = (item.innerText || '').toLowerCase();
        if (/tạm hết hàng|hết hàng|out of stock/.test(cardText)) return 'Tạm hết hàng';
        if (/ngừng kinh doanh|ngừng bán/.test(cardText)) return 'Ngừng KD';
        if (/sắp về|hàng sắp về|pre.?order|đặt trước/.test(cardText)) return 'Hàng sắp về';
        if (!origPrice && !salePrice) return 'Chưa rõ';
        return 'Còn hàng';
      })();
      out.push({
        dealer: 'MBW', name, brand: brandName,
        cpu, screen, gpu, weight,
        ram: compare[0]||'', storage: compare[1]||'',
        origPrice, salePrice, discount, sold, rating, link,
        stockStatus: mbwStatus,
      });
    });
    return out;
  }, 'https://www.thegioididong.com');
}

// ── SCRAPER 2 — FPT Retail ────────────────────────────────
async function scrapeFPT(page, brand, specCache, startTime) {
  console.log(`  [FPT] ${brand.name}`);
  // FPT bị Cloudflare bot-challenge ngay cả qua Worker proxy (Cloudflare Worker
  // → Cloudflare-protected origin bị chặn ở edge-to-edge level) → gọi trực tiếp.
  try {
    await page.goto(brand.fptUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForSelector('div.cardInfo', { timeout: 15000 }).catch(() => {});
  } catch(e) {
    console.log(`    ⚠ Load failed: ${e.message.substring(0,60)}`);
    return [];
  }
  await sleep(2000);

  // Simple scroll để trigger lazy load đầu trang
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await sleep(2000);
  }

  // FPT Shop giới hạn ~15-20 SP/trang qua lazy-load cuộn — cần click nút
  // "Xem thêm sản phẩm" để load hết toàn bộ danh mục (giống MBW/CPS).
  let clicks = 0;
  while (true) {
    const clicked = await page.evaluate(() => {
      // FPT button: "Xem thêm N kết quả" — match by text pattern /xem thêm \d+ kết quả/i
      // Must exclude product-card overlay buttons (short "Xem thêm" without digit)
      const allBtns = [...document.querySelectorAll('button, a')];
      
      // Primary: "Xem thêm N kết quả" (load more results button)
      const loadMoreBtn = allBtns.find(el =>
        /xem\s*thêm\s+\d+/i.test(el.textContent || '') &&
        el.offsetParent !== null
      );
      if (loadMoreBtn) {
        loadMoreBtn.scrollIntoView({block:'center'});
        loadMoreBtn.click();
        return true;
      }
      
      // Fallback: any visible button/link with "xem thêm" NOT in product card overlay
      // Exclude buttons inside cardInfo (those are card-level overlays)
      const fallbackBtn = allBtns.find(el => {
        if (!/xem\s*thêm/i.test(el.textContent || '')) return false;
        if ((el.textContent || '').trim().length > 80) return false;
        if (el.closest('div.cardInfo')) return false; // skip card overlays
        if (!el.offsetParent) return false;
        return true;
      });
      if (fallbackBtn) {
        fallbackBtn.scrollIntoView({block:'center'});
        fallbackBtn.click();
        return true;
      }
      return false;
    }).catch(() => false);
    if (!clicked) break;
    clicks++;
    await sleep(2000);
    // Simple scroll: KHÔNG dùng scrollToBottom() vì CDP timeout trên trang 400+ products
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await sleep(1500);
    if (clicks > 50) break; // safety cap
  }
  if (clicks) console.log(`    → Xem thêm: ${clicks} lần`);

  const products = await page.evaluate((BASE) => {
    const out  = [];
    const seen = new Set();
    // Auto-detect brand từ tên sản phẩm
    function detectBrand(name) {
      const n = (name || '').toLowerCase();
      if (n.includes('msi'))     return 'MSI';
      if (n.includes('asus') || n.includes('vivobook') || n.includes('zenbook') || n.includes('rog') || n.includes('tuf')) return 'Asus';
      if (n.includes('acer') || n.includes('aspire') || n.includes('predator') || n.includes('nitro') || n.includes('swift')) return 'Acer';
      if (n.includes('dell') || n.includes('inspiron') || n.includes('xps') || n.includes('alienware') || n.includes('latitude') || n.includes('vostro')) return 'Dell';
      if (n.includes('hp ') || n.includes('pavilion') || n.includes('envy') || n.includes('spectre') || n.includes('omen') || n.includes('elitebook') || n.includes('probook') || n.includes('victus')) return 'HP';
      if (n.includes('lenovo') || n.includes('ideapad') || n.includes('thinkpad') || n.includes('legion') || n.includes('yoga') || n.includes('loq')) return 'Lenovo';
      if (n.includes('samsung') || n.includes('galaxy book')) return 'Samsung';
      if (n.includes('macbook') || n.includes('apple')) return 'MacBook';
      if (n.includes('gigabyte') || n.includes('aorus')) return 'Gigabyte';
      if (n.includes('lg ') || n.includes('gram')) return 'LG';
      if (n.includes('huawei') || n.includes('matebook')) return 'Huawei';
      if (n.includes('microsoft') || n.includes('surface')) return 'Microsoft';
      return 'Other';
    }
    document.querySelectorAll('div.cardInfo').forEach(card => {
      const linkEl = card.querySelector('a[href*="may-tinh-xach-tay/"]');
      if (!linkEl) return;
      const href = linkEl.getAttribute('href') || '';
      const link = href.startsWith('http') ? href : BASE + href;
      if (!href || seen.has(link)) return;
      seen.add(link);
      const name      = card.querySelector('h3, h2')?.textContent?.trim() || '';
      const salePrice = parseInt((card.querySelector('p.b1-semibold,[class*="b1-semibold"]')?.textContent||'').replace(/\D/g,'')) || 0;
      const origPrice = parseInt((card.querySelector('span[class*="line-through"]')?.textContent||'').replace(/\D/g,'')) || 0;
      const discount  = card.querySelector('[class*="discount"],[class*="percent"]')?.innerText?.trim() || '';
      if (!name || name.length < 5) return;
      // FPT listing: detect stock status tu card text
      // FIX 05/08/2026: truoc day CHI check "hang sap ve"/"ngung", THIEU HAN
      // "het hang"/"tam het hang" — cung ly do nhu MBW o tren, day la tuyen
      // phong thu duy nhat vi detail-page fetch da tat (23/07).
      const fptStatus = (() => {
        const cardText = (card.innerText || '').toLowerCase();
        if (/tạm hết hàng|hết hàng/.test(cardText)) return 'Tạm hết hàng';
        if (/hàng sắp về/.test(cardText)) return 'Hàng sắp về';
        if (/ngừng kinh doanh|ngừng bán|ngừng/.test(cardText)) return 'Ngừng KD';
        if (!salePrice && !origPrice) return 'Chưa rõ';
        return 'Còn hàng';
      })();
      out.push({
        dealer:'FPT Retail', name, brand: detectBrand(name),
        cpu:'', ram:'', storage:'', screen:'', gpu:'', weight:'',
        origPrice, salePrice, discount, sold:'', rating:'', link,
        stockStatus: fptStatus,
      });
    });
    return out;
  }, 'https://fptshop.com.vn');

  console.log(`    → ${products.length} SP`);
  if (products.length === 0) {
    // Chẩn đoán: trang trả 0 SP có thể do (a) bị chặn/redirect sang trang
    // block, hoặc (b) selector "div.cardInfo" đã đổi. Log title + URL + đoạn
    // đầu body để phân biệt 2 trường hợp ở lần chạy sau.
    const diag = await page.evaluate(() => ({
      title: document.title,
      url: location.href,
      cardInfoCount: document.querySelectorAll('div.cardInfo').length,
      bodyLen: document.body.innerHTML.length,
      bodySnippet: (document.body.innerText || '').slice(0, 200).replace(/\s+/g, ' '),
    })).catch(() => null);
    if (diag) {
      console.log(`    🔍 diag: title="${diag.title}" url=${diag.url} cardInfo=${diag.cardInfoCount} bodyLen=${diag.bodyLen}`);
      console.log(`    🔍 body: ${diag.bodySnippet}`);
    }
  }
  // v3.4.10: FPT cũng gặp "detached Frame" ngay sau khi CPS chạy quá lâu trên
  // cùng máy self-hosted (23/07/2026) — tạm tắt fetch specs mới, chỉ dùng
  // cache, đồng bộ với CPS, ưu tiên ổn định trong lúc điều tra nguyên nhân gốc.
  await enrichSpecs(products, specCache, fetchSpecsFPT, page, startTime, FPT_DEADLINE_MS, true);
  return products;
}

// ── SCRAPER 3 — CellPhone S ───────────────────────────────
async function scrapeCPS(page, brand, specCache, startTime) {
  console.log(`  [CPS] ${brand.name}`);
  // v3.4.9: REVERT v3.4.6 — CPS gọi trực tiếp cellphones.com.vn, KHÔNG qua
  // proxy nữa (xem comment CPS_BASE ở đầu file: proxy làm "Load thêm" chạy
  // loạn ~125-126 lần giống nhau ở mọi brand, nghi hỏng cookie/session lọc
  // brand — regression, không phải fix).
  try {
    await page.goto(brand.cpsUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch(e) {
    console.log(`    ⚠ Load failed: ${e.message.substring(0,60)}`);
    return [];
  }
  await sleep(2000);

  // v3.4.13: REVERT v3.4.12 filter "Sẵn hàng" — quá hung dữ, lọc theo "có hàng
  // tại cửa hàng gần" thay vì "còn bán online", làm mất ~75% SP hợp lệ (143/590).
  // Chỉ giữ lớp (b) card-text detection + lớp (c) post-filter.

  // v3.4.15→v3.4.16: giảm cap từ 15 → 8. Run #363 vẫn 1523 SP CPS (cap 15
  // quá rộng). MSI page = 52 SP (~3 clicks), brand lớn nhất ~100 SP (~5 clicks).
  // Cap 8 = tối đa ~180 SP/brand, 9 brands × 100 ≈ ~700 SP max — gần ~590.
  const CPS_MAX_CLICKS = 8;
  let clicks = 0;
  while (clicks < CPS_MAX_CLICKS) {
    await scrollToBottom(page);
    await sleep(1800);
    const clicked = await evalWithTimeout(page.evaluate(() => {
      const sels = ['.btn-show-more','button.btn-show-more','.loadmore-btn',
                    'button[class*="loadmore"]','a[class*="loadmore"]','.load-more-button'];
      for (const sel of sels) {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) { el.click(); return true; }
      }
      return false;
    }), 12000, false);
    if (!clicked) break;
    clicks++;
    await sleep(2500);
  }
  if (clicks >= CPS_MAX_CLICKS) console.log(`    ⚠ Đạt giới hạn ${CPS_MAX_CLICKS} lần Load thêm — dừng để tránh load SP ngoài brand`);
  if (clicks) console.log(`    → Load thêm: ${clicks} lần`);

  const products = await evalWithTimeout(page.evaluate((brandName, BASE) => {
    const out  = [];
    const seen = new Set();
    document.querySelectorAll('.product-item').forEach(card => {
      const linkEl = card.querySelector('a[href]');
      if (!linkEl) return;
      const href = linkEl.getAttribute('href') || '';
      const link = href.startsWith('http') ? href : BASE + href;
      if (!link.includes('.html') || seen.has(link)) return;
      seen.add(link);
      const name      = card.querySelector('h3, h2')?.innerText?.trim() || '';
      const salePrice = parseInt((card.querySelector('.product__price--show')?.innerText||'').replace(/\D/g,'')) || 0;
      const origPrice = parseInt((card.querySelector('.product__price--through')?.innerText||'').replace(/\D/g,'')) || 0;
      const discount  = card.querySelector('[class*="percent"],[class*="discount"]')?.innerText?.trim() || '';
      const rating    = card.querySelector('[class*="rating"] b, .rating b')?.innerText?.trim() || '';
      const soldEl    = [...card.querySelectorAll('span,p')].find(el => /[Đđ]ã bán/.test(el.innerText));
      const sold      = soldEl?.innerText?.replace(/[Đđ]ã bán\s*/i,'')?.trim() || '';
      if (!name || name.length < 5) return;
      // v3.4.12: Detect out-of-stock từ card text (safety net bổ sung filter "Sẵn hàng")
      const cardText = card.innerText || '';
      let cpsStatus;
      if (/tạm hết hàng|hết hàng|out of stock/i.test(cardText)) cpsStatus = 'Tạm hết hàng';
      else if (/ngừng kinh doanh|ngừng bán/i.test(cardText)) cpsStatus = 'Ngừng KD';
      else if (!salePrice && !origPrice) cpsStatus = 'Chưa rõ';
      else cpsStatus = 'Còn hàng';
      out.push({
        dealer:'CellPhone S', name, brand:brandName,
        cpu:'', ram:'', storage:'', screen:'', gpu:'', weight:'',
        origPrice, salePrice, discount, sold, rating, link,
        stockStatus: cpsStatus,
      });
    });
    return out;
  }, brand.name, 'https://cellphones.com.vn'), 15000, []);

  if (products.length === 0) {
    console.log(`    ⚠ Extract listing timeout/lỗi (0 SP) — CDP session có thể đã đơ, bỏ ngang brand này`);
    return [];
  }

  // v3.4.12: Lọc bỏ SP hết hàng/ngừng KD khỏi kết quả (card-text detection)
  const oosCardText = products.filter(p => p.stockStatus !== 'Còn hàng' && p.stockStatus !== 'Chưa rõ');
  let inStock       = products.filter(p => p.stockStatus === 'Còn hàng' || p.stockStatus === 'Chưa rõ');
  if (oosCardText.length > 0) {
    console.log(`    🚫 Card-text lọc ${oosCardText.length}/${products.length} SP hết hàng/ngừng KD`);
    oosCardText.slice(0, 3).forEach(p =>
      console.log(`       ↳ [${p.stockStatus}] ${p.name.substring(0,60)}`)
    );
  }

  // v3.4.14: HTTP stock check — cho SP KHÔNG có trong cache, fetch detail page
  // HTML rồi regex tìm "TẠM HẾT HÀNG". Không dùng Puppeteer → giữ ổn định.
  const { filtered: httpFiltered, checked: httpChecked } = await batchCheckStockHTTP(inStock, specCache);
  if (httpFiltered > 0) {
    const httpOos = inStock.filter(p => p.stockStatus !== 'Còn hàng' && p.stockStatus !== 'Chưa rõ');
    console.log(`    🚫 HTTP check lọc thêm ${httpFiltered}/${httpChecked} SP (detail page "Tạm hết hàng")`);
    httpOos.slice(0, 5).forEach(p =>
      console.log(`       ↳ [${p.stockStatus}] ${p.name.substring(0,60)}`)
    );
    if (httpOos.length > 5) console.log(`       ↳ ... và ${httpOos.length - 5} SP khác`);
    inStock = inStock.filter(p => p.stockStatus === 'Còn hàng' || p.stockStatus === 'Chưa rõ');
  } else if (httpChecked > 0) {
    console.log(`    ✅ HTTP check ${httpChecked} SP mới → tất cả còn hàng`);
  }

  console.log(`    → ${inStock.length} SP (còn hàng, sau lọc)`);
  // v3.4.10: tạm tắt fetch specs mới cho CPS (skipNewFetch=true) — xem comment
  // dài trong enrichSpecs(). Chỉ áp dụng cache cho SP đã biết.
  await enrichSpecs(inStock, specCache, fetchSpecsCPS, page, startTime, undefined, true);
  return inStock;
}

// ── Google Sheets: load spec cache ───────────────────────
async function loadSpecCacheFromSheet(sheets) {
  const cache = new Map();
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A2:S`,
      valueRenderOption: 'FORMULA', // A:S toàn data thô, tránh kích hoạt tính toán
    });
    let savedVersion = 0;
    try {
      const vRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!AG1`,  // v3.6: doi tu T1 sang AG1, nhuong T cho cot "Status" (Part# enrichment)
      });
      savedVersion = parseInt(vRes.data.values?.[0]?.[0] || '0') || 0;
    } catch(e) {}

    const fptCacheValid = savedVersion >= FPT_MAPPING_VERSION;
    if (!fptCacheValid) {
      console.log(`🔄 FPT mapping v${FPT_MAPPING_VERSION} (sheet: v${savedVersion}) → Re-fetch toàn bộ FPT specs`);
    }

    (res.data.values || []).forEach(row => {
      const link = row[17];
      if (!link) return;
      const dealer = row[3] || '';
      // Skip FPT cache nếu mapping version cũ → sẽ fetch lại với mapping mới
      if (dealer === 'FPT Retail' && !fptCacheValid) return;

      const cpu=row[6]||'', ram=row[7]||'', storage=row[8]||'';
      const screen=row[9]||'', gpu=row[10]||'', weight=row[11]||'';
      // Cache specs + stockStatus (col S = index 18)
      // KHONG load stockStatus vào cache — stockStatus thay đổi hàng ngày,
      // phải detect lại từ listing/detail page mỗi lần scrape.
      if (cpu||ram||storage||screen||gpu||weight) {
        cache.set(link, { cpu, ram, storage, screen, gpu, weight });
      }
    });

    const fptCount  = (res.data.values||[]).filter(r => r[3]==='FPT Retail' && r[17]).length;
    const cpsCount  = cache.size - [...cache.keys()].filter(k => k.includes('fptshop')).length;
    console.log(`📋 Spec cache: ${cache.size} SP (FPT: ${fptCacheValid ? 'từ cache' : 'sẽ re-fetch'}, CPS: từ cache)`);
  } catch(e) {
    console.log(`⚠ Spec cache load failed: ${e.message}`);
  }
  return cache;
}

// ── FIX #1: cảnh báo khi số SP scrape được giảm bất thường so với ────────
// ngày gần nhất (dấu hiệu vòng lặp "Xem thêm" dừng sớm / site load chậm)
function buildScrapeHealthNotes(existingRows, newRows, scrapeDealerNames) {
  const notes = [];
  const parseVN = (d) => {
    const [dd, mm, yyyy] = (d || '').split('/').map(Number);
    return (dd && mm && yyyy) ? new Date(yyyy, mm - 1, dd) : null;
  };
  for (const dealerName of scrapeDealerNames) {
    const countByDate = {};
    existingRows.forEach(r => {
      if (r[3] !== dealerName || !r[0]) return;
      countByDate[r[0]] = (countByDate[r[0]] || 0) + 1;
    });
    const dates = Object.keys(countByDate)
      .map(d => ({ d, dt: parseVN(d) }))
      .filter(x => x.dt)
      .sort((a, b) => a.dt - b.dt);
    if (dates.length === 0) continue;
    const latestDate  = dates[dates.length - 1].d;
    const latestCount = countByDate[latestDate];
    const todayCount  = newRows.filter(r => r[3] === dealerName).length;
    // Chỉ cảnh báo khi baseline đủ lớn (tránh false-positive lúc mới có ít data)
    // và giảm ≥15% — ngưỡng ước tính cho phép dao động tự nhiên (SP hết hàng lẻ tẻ)
    if (latestCount >= 5 && todayCount < latestCount * 0.85) {
      const pct = Math.round((1 - todayCount / latestCount) * 100);
      notes.push(`⚠ ${dealerName}: ${todayCount} SP hôm nay vs ${latestCount} SP ngày ${latestDate} (giảm ${pct}%) — kiểm tra xem có bị dừng sớm khi load "Xem thêm" không`);
    }
  }
  return notes;
}

// ── Google Sheets: ghi data ───────────────────────────────
// v3.5.1 [29/07/2026]: run #354 — write-sheet job fail sau ~6.5 phut (bat
// thuong, cac lenh Sheets API thuong tra ve trong vai giay). Chua biet chac
// nguyen nhan (nghi ngo: quota Sheets API bi dung do test lien tuc trong
// ngay, hoac RAW DATA qua lon do chua chay archive). Them retry-with-backoff
// cho MOI request Sheets API + log day du err.stack de lan sau biet chinh
// xac loi gi thay vi chi thay "failure".
async function withRetry(fn, { retries = 3, baseDelayMs = 2000, label = '' } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const code = e.code || e.response?.status || '?';
      console.log(`   ⚠ [${label}] lỗi lần ${attempt}/${retries} (code ${code}): ${e.message}`);
      if (attempt < retries) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        console.log(`   ⏳ Chờ ${delay/1000}s rồi thử lại...`);
        await sleep(delay);
      }
    }
  }
  throw lastErr;
}

// v3.6: doc tab "Part #" 1 lan, xay Map tra cuu theo Product Name (cot A)
// -> cac field enrichment. Doc bang FORMULA mode de tranh kich hoat cac cot
// cong thuc khac cua Part # (L→S co MAP/LAMBDA rieng, khong lien quan).
// Cot T cua Part # (Focus Model) la cot moi, co the chua co du lieu — van
// doc binh thuong, chi la gia tri se trong cho toi khi duoc dien.
// v3.6.2: doc header (dong 1) truoc, tra ve object { ten cot (chuan hoa) ->
// vi tri cot 0-indexed }. Dung de tra cuu CAC COT CAN THIET theo TEN, khong
// theo vi tri co dinh — Phuc co the chen/doi vi tri cot trong Part # bat cu
// luc nao ma khong lam vo code.
function buildHeaderIndex(headerRow) {
  const idx = {};
  (headerRow || []).forEach((h, i) => {
    const key = String(h || '').trim();
    if (key) idx[key] = i;
  });
  return idx;
}

function colLetter(n) {
  // 0-indexed -> ky tu cot Sheets (A, B, ..., Z, AA, AB, ...)
  let s = '';
  let num = n + 1;
  while (num > 0) {
    const rem = (num - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    num = Math.floor((num - 1) / 26);
  }
  return s;
}

async function buildPartLookupMap(sheets) {
  const meta = await withRetry(() => sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets(properties(title,gridProperties))',
  }), { label: 'get Part # metadata' });
  const partSheet = meta.data.sheets.find(s => s.properties.title === PART_TAB);
  if (!partSheet) { console.log(`   ⚠ Không tìm thấy tab "${PART_TAB}" — bỏ qua enrichment`); return { partMap: new Map(), segmentRefs: [] }; }
  const totalRows = partSheet.properties.gridProperties.rowCount;
  const totalCols = partSheet.properties.gridProperties.columnCount;
  const lastCol = colLetter(totalCols - 1);

  // Doc header truoc de biet vi tri THAT SU cua tung cot can, khong doan mo.
  const headerRes = await withRetry(() => sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${PART_TAB}'!A1:${lastCol}1`,
    valueRenderOption: 'FORMULA',
  }), { label: 'đọc header Part #' });
  const hIdx = buildHeaderIndex((headerRes.data.values || [[]])[0]);

  const REQUIRED = ['Product Name', 'Part #', 'CPU Segment', 'CPU', 'RAM', 'SSD', 'Screen', 'GPU', 'V-RAM', 'Status', 'Focus Model'];
  const missing = REQUIRED.filter(name => !(name in hIdx));
  if (missing.length > 0) {
    console.log(`   ⚠ Part # thiếu cột: ${missing.join(', ')} — các field này sẽ để trống. Kiểm tra lại tên cột nếu không phải cố ý.`);
  }
  const iName = hIdx['Product Name'];
  const iPart = hIdx['Part #'];
  const iCpuSeg = hIdx['CPU Segment'];
  const iCpu = hIdx['CPU'];
  const iRam = hIdx['RAM'];
  const iSsd = hIdx['SSD'];
  const iScreen = hIdx['Screen'];
  const iGpu = hIdx['GPU'];
  const iVram = hIdx['V-RAM'];
  const iStatus = hIdx['Status'];
  const iFocus = hIdx['Focus Model'];

  if (iName === undefined) { console.log('   ⚠ Không tìm thấy cột "Product Name" — không thể enrich, bỏ qua.'); return { partMap: new Map(), segmentRefs: [] }; }

  const map = new Map();
  const CHUNK = 5000;
  for (let start = 2; start <= totalRows; start += CHUNK) {
    const end = Math.min(start + CHUNK - 1, totalRows);
    const res = await withRetry(() => sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${PART_TAB}'!A${start}:${lastCol}${end}`,
      valueRenderOption: 'FORMULA',
    }), { label: `đọc Part # ${start}-${end}` });
    const rows = res.data.values || [];
    for (const r of rows) {
      const name = (r[iName] || '').trim();
      if (!name) continue;
      map.set(name, {
        status:       iStatus  !== undefined ? safeVal(r[iStatus])  : '',
        cpuSegment:   iCpuSeg  !== undefined ? safeVal(r[iCpuSeg])  : '',
        cpu:          iCpu     !== undefined ? safeVal(r[iCpu])     : '',
        ram:          iRam     !== undefined ? safeVal(r[iRam])     : '',
        ssd:          iSsd     !== undefined ? safeVal(r[iSsd])     : '',
        screen:       iScreen  !== undefined ? safeVal(r[iScreen])  : '',
        gpu:          iGpu     !== undefined ? safeVal(r[iGpu])     : '',
        vram:         iVram    !== undefined ? safeVal(r[iVram])    : '',
        partNumber:   iPart    !== undefined ? safeVal(r[iPart])    : '',
        focusModel:   iFocus   !== undefined ? safeVal(r[iFocus])   : '',
        // Series Group, Segment KHONG doc tu day — la formula song trong
        // Part #, tra qua tab "Segment". Tinh truc tiep bang code o duoi
        // (buildSegmentRefs + matchSegment).
      });
    }
  }
  console.log(`   📋 Đã đọc ${map.size} Product Name từ "${PART_TAB}" (tra theo tên cột, không theo vị trí cố định)`);

  // v3.6.1: doc tab "Segment" (tra theo ten cot: Brand, Segment, Series
  // Group) de tinh Series Group/Segment bang code — thay cho cong thuc
  // song L/M cua Part # (MAP + BYROW/REGEXMATCH tra qua tab nay).
  const segmentSheet = meta.data.sheets.find(s => s.properties.title === SEGMENT_TAB);
  let segmentRefs = [];
  if (segmentSheet) {
    const segHeaderRes = await withRetry(() => sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID, range: `'${SEGMENT_TAB}'!A1:${colLetter(segmentSheet.properties.gridProperties.columnCount - 1)}1`,
    }), { label: 'đọc header Segment' });
    const sIdx = buildHeaderIndex((segHeaderRes.data.values || [[]])[0]);
    const iSegKeyword = sIdx['Segment'];
    const iSeriesGroup = sIdx['Series Group'];
    if (iSegKeyword === undefined || iSeriesGroup === undefined) {
      console.log(`   ⚠ Tab "${SEGMENT_TAB}" thiếu cột "Segment" hoặc "Series Group" — bỏ qua tra cứu Series Group/Segment.`);
    } else {
      const segRes = await withRetry(() => sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${SEGMENT_TAB}'!A2:${colLetter(segmentSheet.properties.gridProperties.columnCount - 1)}${segmentSheet.properties.gridProperties.rowCount}`,
      }), { label: 'đọc Segment tab' });
      segmentRefs = (segRes.data.values || [])
        .filter(r => r[iSegKeyword])
        .map(r => ({ keyword: String(r[iSegKeyword]).trim(), keywordLower: String(r[iSegKeyword]).trim().toLowerCase(), seriesGroup: r[iSeriesGroup] || '' }));
      console.log(`   📋 Đã đọc ${segmentRefs.length} từ khoá Segment từ tab "${SEGMENT_TAB}" (tra theo tên cột)`);
    }
  } else {
    console.log(`   ⚠ Không tìm thấy tab "${SEGMENT_TAB}" — Series Group/Segment sẽ để trống`);
  }

  return { partMap: map, segmentRefs };
}

function safeVal(v) {
  // Bo qua neu vo tinh doc duoc formula text (khong nen xay ra voi cac cot
  // nay nhung phong ho) — tra ve rong thay vi ghi formula-text vao RAW DATA.
  if (typeof v === 'string' && v.startsWith('=')) return '';
  return v ?? '';
}

// Thay cho cong thuc BYROW+REGEXMATCH cua Part # cot M, roi MAP+INDEX cua
// cot L: tim tu khoa Segment (tab Segment cot C) DAI NHAT xuat hien trong
// ten san pham (khong phan biet hoa/thuong), tra ve chinh tu khoa do
// (=Segment) va Series Group tuong ung (cot D).
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

// row: 1 dong cua allRows (19 phan tu, khop HEADERS A:S). Tra ve array 12
// phan tu khop ENRICHMENT_HEADERS (T:AE).
function enrichOneRow(row, partMap, segmentRefs) {
  const modelName = (row[4] || '').trim(); // cot E = Model Name
  const info = partMap.get(modelName);
  const { segment, seriesGroup } = matchSegment(modelName, segmentRefs);
  if (!info) return ['', seriesGroup, segment, '', '', '', '', '', '', '', '', ''];
  return [
    info.status, seriesGroup, segment, info.cpuSegment, info.cpu,
    info.ram, info.ssd, info.screen, info.gpu, info.vram, info.partNumber,
    info.focusModel,
  ];
}

async function writeToSheet(sheets, allProducts) {
  const today   = new Date();
  const dateStr = formatDate(today);
  const timeStr = formatTime(today);

  let existingRows = [];
  let existingReadFailed = false;
  try {
    const res = await withRetry(() => sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A2:R`,
      // FIX 03/08/2026, cập nhật v3.6: cột A:R toàn data thô do scraper ghi,
      // không có formula nào (cột V formula cũ đã xoá, thay bằng enrich code
      // ở T→AE). Vẫn dùng FORMULA render để tránh kích hoạt tính toán như
      // FORMATTED_VALUE (default) — tránh timeout do spreadsheet quá tải,
      // là nguyên nhân gốc khiến lần đọc này lỗi và gây mất data trước đó.
      valueRenderOption: 'FORMULA',
    }), { label: 'read existing rows' });
    // Chỉ loại bỏ rows hôm nay thuộc dealer mà JOB NÀY phụ trách.
    // Rows hôm nay của dealer khác (do job song song ghi) được giữ lại,
    // tránh race condition khi 2 job cùng đọc-sửa-ghi RAW DATA.
    existingRows = (res.data.values||[]).filter(row => {
      if (!row[0]) return false; // bỏ rows trống/lỗi
      if (row[0] !== dateStr) return true; // ngày khác → giữ
      const dealer = row[3];
      return !SCRAPE_DEALER_NAMES.has(dealer); // hôm nay nhưng dealer khác → giữ
    });
  } catch(e) {
    console.log('⚠ Read existing rows failed:', e.message);
    existingReadFailed = true;
  }

  // FIX KHẨN 03/08/2026: BUG NGHIÊM TRỌNG vừa gây mất ~68k dòng lịch sử —
  // khi đọc existingRows lỗi (sheet quá tải/timeout), code CŨ vẫn tiếp tục
  // clear() + ghi allRows=[...existingRows(rỗng),...newRows] → xóa mất hết
  // data cũ chỉ còn lại data hôm nay. GIỜ: đọc lỗi → DỪNG NGAY, không đụng
  // gì tới sheet, để lần chạy sau tự retry thay vì ghi đè mất data.
  if (existingReadFailed) {
    console.log('💥 DỪNG: đọc existing rows lỗi — KHÔNG clear/ghi sheet để tránh mất data cũ. Sẽ tự thử lại ở lần chạy kế tiếp.');
    return;
  }
  // Safety guard bổ sung: existingRows đọc "thành công" nhưng trả về 0 dòng
  // là bất thường (RAW DATA luôn có lịch sử tích lũy) — cũng dừng để tránh
  // xóa nhầm nếu API trả rỗng bất thường mà không throw lỗi.
  if (existingRows.length === 0 && process.env.ALLOW_EMPTY_EXISTING !== 'true') {
    console.log('💥 DỪNG: existingRows đọc được nhưng = 0 dòng — bất thường (RAW DATA luôn có lịch sử). KHÔNG clear/ghi để tránh mất data, cần kiểm tra thủ công. (Nếu đây là reset có chủ đích, set env ALLOW_EMPTY_EXISTING=true để bỏ qua guard này.)');
    return;
  }


  const newRows = allProducts.map((p, i) => [
    dateStr, timeStr, i+1,
    p.dealer, p.name, p.brand,
    p.cpu, p.ram, p.storage, p.screen, p.gpu, p.weight,
    p.origPrice||'', p.salePrice||'', p.discount,
    p.sold, p.rating, p.link,
    p.stockStatus || 'Còn hàng',
  ]);

  // Safety guard: nếu scrape được 0 SP thì KHÔNG clear sheet
  // (tránh xóa mất data cũ khi proxy lỗi / site thay đổi selector)
  if (newRows.length === 0) {
    console.log(`⚠ SKIP ghi sheet: 0 SP scrape được (dealer: ${[...SCRAPE_DEALER_NAMES].join(',')}). Giữ nguyên data cũ.`);
    return;
  }

  // FIX #1: kiểm tra tụt số lượng SP bất thường trước khi ghi (vẫn ghi bình
  // thường — chỉ cảnh báo để không bị bỏ sót âm thầm như trước đây)
  const healthNotes = buildScrapeHealthNotes(existingRows, newRows, SCRAPE_DEALER_NAMES);
  if (healthNotes.length > 0) {
    console.log('\n🚨 CẢNH BÁO SỐ LƯỢNG SP GIẢM BẤT THƯỜNG:');
    healthNotes.forEach(n => console.log('   ' + n));
  } else {
    console.log(`✅ Health check: số lượng SP mỗi dealer bình thường (${[...SCRAPE_DEALER_NAMES].join(', ')})`);
  }

  await withRetry(() => sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A2:R`,
  }), { label: 'clear A2:R' });

  const allRows = [...existingRows, ...newRows];

  // v3.4.16: Auto-expand sheet nếu tổng rows vượt grid limit.
  // Lỗi Run #362/#363: "Range ('RAW DATA'!A45002) exceeds grid limits. Max rows: 45001"
  // do data tích lũy quá 45k rows. Fix: kiểm tra + mở rộng grid trước khi ghi.
  const totalRowsNeeded = allRows.length + 1; // +1 for header
  // v3.6.2: tuong tu cho COT — can toi thieu 34 cot (den AH, noi ghi
  // AG1=mapping version, AH1=health note). Sheets KHONG tu mo rong cot nhu
  // no tu mo rong dong khi ghi vuot pham vi — phai mo rong thu cong truoc,
  // neu khong values.update se loi "exceeds grid limits" (gap y het loi
  // gay fail 2 lan chay ngay 05/08/2026 sau khi doi T1/U1 sang AG1/AH1).
  const MIN_COLS_NEEDED = 34; // A..AH
  try {
    const sheetMeta = await withRetry(() => sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
      fields: 'sheets(properties(sheetId,title,gridProperties))',
    }), { label: 'get sheet metadata' });
    const rawSheet = sheetMeta.data.sheets.find(s => s.properties.title === SHEET_NAME);
    if (rawSheet) {
      const currentMaxRows = rawSheet.properties.gridProperties.rowCount;
      const currentMaxCols = rawSheet.properties.gridProperties.columnCount;
      const gridProperties = {};
      const fields = [];
      if (totalRowsNeeded > currentMaxRows) {
        const newMaxRows = totalRowsNeeded + 5000; // buffer 5k rows cho lần sau
        console.log(`   📐 Mở rộng sheet từ ${currentMaxRows} → ${newMaxRows} rows (cần ${totalRowsNeeded})`);
        gridProperties.rowCount = newMaxRows;
        fields.push('gridProperties.rowCount');
      }
      if (currentMaxCols < MIN_COLS_NEEDED) {
        console.log(`   📐 Mở rộng sheet từ ${currentMaxCols} → ${MIN_COLS_NEEDED} cột (cần ghi tới cột AH)`);
        gridProperties.columnCount = MIN_COLS_NEEDED;
        fields.push('gridProperties.columnCount');
      }
      if (fields.length > 0) {
        await withRetry(() => sheets.spreadsheets.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          requestBody: {
            requests: [{
              updateSheetProperties: {
                properties: { sheetId: rawSheet.properties.sheetId, gridProperties },
                fields: fields.join(','),
              },
            }],
          },
        }), { label: 'expand grid rows/cols' });
      }
    }
  } catch (e) {
    console.log(`   ⚠ Auto-expand check failed: ${e.message} — tiếp tục ghi, có thể lỗi nếu vượt grid limit`);
  }

  // v3.5.1: chia nho thanh tung lo ~5000 dong/lan thay vi 1 request khong lo —
  // giam rui ro request qua lon/qua lau khi RAW DATA da tich luy hang chuc
  // nghin dong lich su (chua chay archive). Moi lo van co retry rieng.
  const CHUNK_SIZE = 5000;
  for (let i = 0; i < allRows.length; i += CHUNK_SIZE) {
    const chunk = allRows.slice(i, i + CHUNK_SIZE);
    const startRow = 2 + i; // A2 là dòng bắt đầu
    await withRetry(() => sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A${startRow}`,
      valueInputOption: 'RAW',
      requestBody: { values: chunk },
    }), { label: `update rows ${startRow}-${startRow+chunk.length-1}` });
    console.log(`   📤 Đã ghi lô ${i/CHUNK_SIZE + 1}: dòng ${startRow}–${startRow+chunk.length-1} (${chunk.length} dòng)`);
  }

  await withRetry(() => sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A1:S1`,
    valueInputOption: 'RAW',
    requestBody: { values: [HEADERS] },
  }), { label: 'update header row' });

  // v3.6: enrich T→AE tu Part # (Status, Series Group, Segment, CPU
  // Segment, CPU, RAM, SSD, Screen, GPU, V-RAM, Part #, Focus Model) —
  // tinh bang CODE, khong con formula. Chay sau khi ghi xong A:S de dam bao
  // enrichment khop dung voi du lieu vua ghi (existingRows + newRows).
  try {
    console.log('🔎 Đang tra cứu Part # để enrich cột T→AE...');
    const { partMap, segmentRefs } = await buildPartLookupMap(sheets);
    const enrichRows = allRows.map(row => enrichOneRow(row, partMap, segmentRefs));
    await withRetry(() => sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!T1:AE1`,
      valueInputOption: 'RAW',
      requestBody: { values: [ENRICHMENT_HEADERS] },
    }), { label: 'update enrichment header T1:AE1' });
    for (let i = 0; i < enrichRows.length; i += CHUNK_SIZE) {
      const chunk = enrichRows.slice(i, i + CHUNK_SIZE);
      const startRow = 2 + i;
      await withRetry(() => sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!T${startRow}`,
        valueInputOption: 'RAW',
        requestBody: { values: chunk },
      }), { label: `update enrichment T${startRow}-${startRow+chunk.length-1}` });
    }
    const matchedCount = enrichRows.filter(r => r[0] || r[10]).length; // co Status hoac Part #
    console.log(`✅ Enrich xong: ${matchedCount}/${enrichRows.length} dòng khớp được với Part # (theo Model Name)`);
  } catch (e) {
    console.log(`   ⚠ Enrich T→AE lỗi (bỏ qua, không ảnh hưởng A:S): ${e.message}`);
  }

  // v3.6: doi tu T1/U1 sang AG1/AH1 — nhuong T cho cot "Status" enrichment
  await withRetry(() => sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!AG1`,  // AG1: FPT mapping version (truoc day o T1)
    valueInputOption: 'RAW',
    requestBody: { values: [[FPT_MAPPING_VERSION]] },
  }), { label: 'update AG1 mapping version' });

  // FIX #1: ghi health note vào AH1 — mở sheet lên là thấy ngay lần chạy gần nhất
  // có bị tụt số lượng SP bất thường không, khỏi phải mò log GitHub Actions
  const healthNote = healthNotes.length > 0
    ? `[${dateStr} ${timeStr}] ${healthNotes.join(' | ')}`
    : `[${dateStr} ${timeStr}] ✅ OK — số lượng SP bình thường`;
  await withRetry(() => sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!AH1`,  // AH1: Scrape health note (truoc day o U1)
    valueInputOption: 'RAW',
    requestBody: { values: [[healthNote]] },
  }), { label: 'update AH1 health note' });

  const missingSpecs = newRows.filter(r => !r[6] && !r[7]).length;
  console.log(`✅ Ghi ${newRows.length} dòng mới | Giữ ${existingRows.length} dòng cũ`);
  if (missingSpecs > 0) console.log(`⚠ ${missingSpecs} SP chưa có specs — sẽ fetch lần sau`);
}

// ── MAIN ──────────────────────────────────────────────────
// Safety net: nếu toàn bộ process treo quá 60 phút → force exit
// Ngăn workflow GitHub Actions bị hang 90 phút rồi fail do timeout
//
// FIX v3.4.8 [BUG17]: TRƯỚC ĐÂY writeToSheet() chỉ gọi 1 LẦN Ở CUỐI script,
// sau khi MBW+CPS đều xong. Khi CPS treo dẫn tới kill-timer force exit, quá
// trình bị process.exit() giết NGAY LẬP TỨC (không chạy finally/cleanup nào
// cả) → MẤT LUÔN CẢ DATA MBW đã scrape thành công trước đó, không ghi được
// gì vào sheet cả — đây là lý do sheet không có data mới. Fix: killTimer giờ
// có quyền truy cập allProducts/sheets qua biến global, cố ghi best-effort
// (deadline riêng 30s) TRƯỚC KHI exit — dù CPS thất bại, MBW/data đã có vẫn
// được lưu.
let globalAllProducts = [];
let globalSheets = null;
const PROCESS_KILL_TIMEOUT_MS = 60 * 60 * 1000;
const killTimer = setTimeout(async () => {
  console.error(`\n💀 Process kill-timer (${PROCESS_KILL_TIMEOUT_MS/60000} phút) — thử ghi best-effort trước khi force exit`);
  try {
    if (globalSheets && globalAllProducts.length > 0) {
      await Promise.race([
        writeToSheet(globalSheets, globalAllProducts),
        new Promise((_, reject) => setTimeout(() => reject(new Error('write timeout 30s')), 30000)),
      ]);
      console.error(`   ✅ Đã ghi best-effort ${globalAllProducts.length} SP trước khi exit`);
    } else {
      console.error('   ⚠ Không có data để ghi (globalSheets/allProducts trống)');
    }
  } catch (e) {
    console.error(`   ⚠ Ghi best-effort thất bại: ${(e.message||String(e)).substring(0,150)}`);
  }
  process.exit(1);
}, PROCESS_KILL_TIMEOUT_MS);
killTimer.unref(); // Không giữ event loop nếu process kết thúc bình thường trước đó

async function runScrapeMode() {
  const startTime = Date.now();
  console.log('🚀 Multi-Dealer Scraper v3.5.0');
  console.log(`📅 ${new Date().toLocaleString('vi-VN')}`);
  console.log(`⏱ Deadline fetch specs: ${DEADLINE_MS/60000} phút`);

  fs.writeFileSync(CREDS_PATH, process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({
    keyFile: CREDS_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  globalSheets = sheets; // cho killTimer truy cập để ghi best-effort
  const specCache = await loadSpecCacheFromSheet(sheets);

  const PUPPETEER_LAUNCH_OPTS = {
    headless: true,
    protocolTimeout: 300000, // 300s — ubuntu-latest đôi khi CDP chậm bất thường (đã gặp Network.setCacheDisabled timeout ở 180s)
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage',
           '--disable-gpu','--window-size=1280,900'],
  };
  let browser = await puppeteer.launch(PUPPETEER_LAUNCH_OPTS);
  // FIX v3.4.7 [BUG16]: khi CDP/browser bị đơ toàn bộ (không chỉ 1 tab — thấy
  // rõ khi 6/6 brand CPS liên tiếp treo ngay ở page.evaluate(), kể cả page
  // hoàn toàn mới), tạo page mới KHÔNG đủ — phải khởi động lại CẢ browser.
  async function relaunchBrowser(oldBrowser) {
    console.log('    🔄 Relaunch cả browser (nghi CDP session bị đơ toàn bộ)...');
    try { await oldBrowser.close(); } catch(_) {}
    return await puppeteer.launch(PUPPETEER_LAUNCH_OPTS);
  }

  const allProducts = globalAllProducts; // CÙNG reference — killTimer thấy được data ngay khi push()

  try {
    // ── MBW ── scrape 1 lần từ trang tổng /laptop
    if (SCRAPE_DEALERS.has('MBW')) {
      console.log('\n═══ MBW ═══');
      try {
        const pageMBW = await browser.newPage();
        await pageMBW.setViewport({ width: 1280, height: 900 });
        await pageMBW.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36');
        const mbwProducts = await scrapeMBW(pageMBW);
        console.log(`    → ${mbwProducts.length} SP tổng MBW`);
        allProducts.push(...mbwProducts);
        await pageMBW.close();

        // FIX #2: SP nào hôm qua có mà hôm nay không thấy trong listing nữa
        // → ghé trang chi tiết xác nhận Ngừng kinh doanh thay vì để im lặng mất tích
        const todayLinksMBW = new Set(mbwProducts.map(p => p.link));
        const missingCandidatesMBW = await getMissingCandidates(sheets, 'MBW', todayLinksMBW);
        if (missingCandidatesMBW.length > 0) {
          console.log(`    🔍 ${missingCandidatesMBW.length} SP MBW mất khỏi listing hôm nay — đang kiểm tra...`);
          const missingCheckedMBW = await checkMissingProducts(browser, 'MBW', missingCandidatesMBW, specCache);
          allProducts.push(...missingCheckedMBW);
        }
      } catch (e) {
        console.log(`    💥 MBW lỗi: ${e.message.substring(0,100)}`);
      }
    } else {
      console.log('\n═══ MBW ═══ (skip — không trong SCRAPE_DEALERS)');
    }

    // ── FPT ──
    if (SCRAPE_DEALERS.has('FPT')) {
      console.log('\n═══ FPT Retail ═══');
      let pageFPT = await browser.newPage();
      await pageFPT.setViewport({ width: 1280, height: 900 });
      await pageFPT.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36');
      // v3.4: đặt timeout mặc định cho tất cả operation trên FPT page
      // Puppeteer default = 0 (vô hạn) → nếu CF chặn 1 page.evaluate/waitForSelector
      // thì block mãi mãi. 20s đủ cho normal page, bắt buộc timeout nếu bị chặn.
      pageFPT.setDefaultTimeout(20000);
      pageFPT.setDefaultNavigationTimeout(30000);
      // v3.0: scrape TẤT CẢ laptop qua 1 URL tổng thay vì loop per-brand
      // → lấy đủ 400+ products, không bỏ sót brand, pagination hoạt động tốt hơn
      // v3.4: Promise.race với FPT_SCRAPE_TIMEOUT_MS → nếu toàn bộ FPT treo thì tự thoát
      try {
        const fptAllBrand = { name: 'All', fptUrl: FPT_ALL_URL };
        const fptTimeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`FPT scrape timeout sau ${FPT_SCRAPE_TIMEOUT_MS/60000} phút`)), FPT_SCRAPE_TIMEOUT_MS)
        );
        const products = await Promise.race([
          scrapeFPT(pageFPT, fptAllBrand, specCache, startTime),
          fptTimeoutPromise,
        ]);
        allProducts.push(...products);

        // FIX #2: SP FPT nào hôm qua có mà hôm nay không thấy trong listing
        const todayLinksFPT = new Set(products.map(p => p.link));
        const missingCandidatesFPT = await getMissingCandidates(sheets, 'FPT Retail', todayLinksFPT);
        if (missingCandidatesFPT.length > 0) {
          console.log(`    🔍 ${missingCandidatesFPT.length} SP FPT mất khỏi listing hôm nay — đang kiểm tra...`);
          const missingCheckedFPT = await checkMissingProducts(browser, 'FPT Retail', missingCandidatesFPT, specCache);
          allProducts.push(...missingCheckedFPT);
        }
      } catch (e) {
        console.log(`    💥 FPT All lỗi: ${e.message.substring(0,100)}`);
      }
      await pageFPT.close().catch(() => {});
    } else {
      console.log('\n═══ FPT Retail ═══ (skip — không trong SCRAPE_DEALERS)');
    }

    // ── CPS ──
    if (SCRAPE_DEALERS.has('CPS')) {
      console.log('\n═══ CellPhone S ═══');
      const todayLinksCPS = new Set();
      // FIX v3.4.3 [BUG13]: CPS hay treo IM LẶNG (không throw, không timeout) —
      // log dừng đột ngột sau "→ N SP", không có "Fetched specs" nào, job treo
      // tới hết kill-timer 60 phút. Fix ban đầu: Promise.race timeout 10 phút/brand.
      // FIX v3.4.4 [BUG14]: v3.4.3 chỉ chữa TRIỆU CHỨNG — vẫn dùng 1 page CPS
      // xuyên suốt cả 4 brand (Asus→Acer→Dell→HP), nên DOM/memory tích lũy dần
      // qua hàng trăm lần "Load thêm" + điều hướng trang chi tiết → tới brand
      // thứ 3-4 trình duyệt bắt đầu treo. Thực tế đã thấy Dell VÀ HP treo liên
      // tiếp cùng 1 lần chạy → 2×10 phút cộng dồn với thời gian Asus/Acer suýt
      // chạm luôn mốc kill-timer 60 phút, job vẫn fail. Fix gốc: mỗi brand luôn
      // dùng 1 page MỚI từ đầu (không đợi lỗi mới tạo lại) — mỗi brand bắt đầu
      // "sạch", giảm hẳn khả năng tích lũy dẫn đến treo.
      const CPS_BRAND_TIMEOUT_MS = 10 * 60 * 1000; // 10 phút/brand
      let consecutiveFails = 0;
      for (const brand of BRANDS) {
        const pageCPS = await browser.newPage();
        await pageCPS.setViewport({ width: 1280, height: 900 });
        await pageCPS.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36');
        pageCPS.setDefaultTimeout(20000);
        pageCPS.setDefaultNavigationTimeout(30000);
        let brandFailed = false;
        try {
          const cpsBrandTimeout = new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`CPS ${brand.name} timeout sau ${CPS_BRAND_TIMEOUT_MS/60000} phút — page có thể đã treo`)), CPS_BRAND_TIMEOUT_MS)
          );
          const products = await Promise.race([
            scrapeCPS(pageCPS, brand, specCache, startTime),
            cpsBrandTimeout,
          ]);
          allProducts.push(...products);
          products.forEach(p => todayLinksCPS.add(p.link));
          brandFailed = products.length === 0;
        } catch (e) {
          console.log(`    💥 ${brand.name} lỗi: ${e.message.substring(0,100)}`);
          brandFailed = true;
        } finally {
          try { await pageCPS.close(); } catch(_) {}
        }
        if (brandFailed) {
          consecutiveFails++;
          // 2 brand liên tiếp treo/0 SP → nghi cả browser bị đơ, không chỉ 1 page.
          // Relaunch browser trước khi thử brand kế tiếp.
          if (consecutiveFails >= 2) {
            browser = await relaunchBrowser(browser);
            consecutiveFails = 0;
          }
        } else {
          consecutiveFails = 0;
        }
        await sleep(800);
      }

      // FIX #2: SP CPS nào hôm qua có mà hôm nay không thấy trong listing
      const missingCandidatesCPS = await getMissingCandidates(sheets, 'CellPhone S', todayLinksCPS);
      if (missingCandidatesCPS.length > 0) {
        console.log(`    🔍 ${missingCandidatesCPS.length} SP CPS mất khỏi listing hôm nay — đang kiểm tra...`);
        const missingCheckedCPS = await checkMissingProducts(browser, 'CellPhone S', missingCandidatesCPS, specCache);
        allProducts.push(...missingCheckedCPS);
      }
    } else {
      console.log('\n═══ CellPhone S ═══ (skip — không trong SCRAPE_DEALERS)');
    }

  } finally {
    await browser.close();
  }

  const byDealer = { MBW:0, 'FPT Retail':0, 'CellPhone S':0 };
  allProducts.forEach(p => { if (p.dealer in byDealer) byDealer[p.dealer]++; });
  console.log('\n📊 Kết quả:');
  Object.entries(byDealer).forEach(([d,c]) => console.log(`   ${d}: ${c} SP`));
  console.log(`   TỔNG: ${allProducts.length} SP`);
  console.log(`   Thời gian đã dùng: ${Math.round((Date.now()-startTime)/60000)} phút`);

  if (WRITE_MODE === 'file') {
    // v3.5.0: che do scrape song song — luu ra file, KHONG ghi Sheet o day.
    // 1 job "combine" rieng se doc file nay + 2 file con lai roi ghi 1 lan.
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const tag = [...SCRAPE_DEALERS].join('-') || 'unknown';
    const outPath = path.join(OUTPUT_DIR, `products-${tag}.json`);
    fs.writeFileSync(outPath, JSON.stringify(allProducts));
    console.log(`\n💾 Đã lưu ${allProducts.length} SP ra ${outPath} (WRITE_MODE=file — chưa ghi Sheet, chờ job combine)`);
  } else {
    console.log('\n📝 Ghi Sheets...');
    await writeToSheet(sheets, allProducts);
  }

  const elapsed = Math.round((Date.now()-startTime)/1000);
  console.log(`\n✅ Xong trong ${Math.floor(elapsed/60)}p${elapsed%60}s`);
  fs.unlinkSync(CREDS_PATH);
  // v3.4.1: force exit sau khi xong — googleapis/puppeteer giữ event loop
  // sống vô thời hạn qua HTTP keep-alive connections và Chrome subprocess.
  process.exit(0);
}

/**
 * v3.5.0 — COMBINE MODE (chay rieng, khong scrape):
 * Doc tat ca file *.json trong COMBINE_INPUT_DIR (tai ve tu artifact cua 3
 * job scrape-mbw / scrape-cps / scrape-fpt chay song song), gop lai, roi goi
 * writeToSheet() DUY NHAT 1 LAN. Neu 1 dealer bi fail/thieu file, van ghi
 * best-effort voi cac dealer con lai thay vi bo het (giu triet ly "listing
 * luon on dinh" tu STOP-AND-STABILIZE v3.4.10).
 */
async function runCombineMode() {
  console.log('🔗 COMBINE MODE — gộp kết quả từ các job scrape song song, ghi Sheet 1 lần duy nhất');
  console.log(`📂 Đọc artifact từ: ${COMBINE_INPUT_DIR}`);

  fs.writeFileSync(CREDS_PATH, process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({
    keyFile: CREDS_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  function listJsonFilesRecursive(dir) {
    let results = [];
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) { console.error(`💥 Không đọc được thư mục ${dir}: ${e.message}`); return results; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) results = results.concat(listJsonFilesRecursive(full));
      else if (entry.name.endsWith('.json')) results.push(full);
    }
    return results;
  }

  const files = listJsonFilesRecursive(COMBINE_INPUT_DIR);
  let allProducts = [];
  for (const f of files) {
    try {
      const arr = JSON.parse(fs.readFileSync(f, 'utf8'));
      console.log(`   📄 ${f}: ${arr.length} SP`);
      allProducts = allProducts.concat(arr);
    } catch (e) {
      console.error(`   ⚠ Lỗi đọc ${f}: ${e.message}`);
    }
  }

  if (allProducts.length === 0) {
    console.error('💥 Không có dữ liệu nào để ghi (0 file hợp lệ) — DỪNG, không ghi Sheet để tránh xóa nhầm data cũ.');
    fs.unlinkSync(CREDS_PATH);
    process.exit(1);
  }

  const byDealer = { MBW:0, 'FPT Retail':0, 'CellPhone S':0 };
  allProducts.forEach(p => { if (p.dealer in byDealer) byDealer[p.dealer]++; });
  console.log(`\n📊 Tổng hợp từ ${files.length} file:`);
  Object.entries(byDealer).forEach(([d,c]) => console.log(`   ${d}: ${c} SP`));
  console.log(`   TỔNG: ${allProducts.length} SP`);

  console.log('\n📝 Ghi Sheets...');
  await writeToSheet(sheets, allProducts);

  fs.unlinkSync(CREDS_PATH);
  console.log('\n✅ Combine + ghi Sheet xong.');
  process.exit(0);
}

if (COMBINE_MODE) {
  runCombineMode().catch(err => {
    console.error('💥 Fatal (combine mode):', err && err.stack ? err.stack : err);
    if (err && err.response && err.response.data) {
      console.error('   API response data:', JSON.stringify(err.response.data).substring(0, 2000));
    }
    process.exit(1);
  });
} else {
  runScrapeMode().catch(err => {
    console.error('💥 Fatal:', err && err.stack ? err.stack : err);
    process.exit(1);
  });
}





