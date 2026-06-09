# Multi-Dealer Laptop Scraper

Tự động scrape giá laptop từ **3 dealers** vào 1 Google Sheet duy nhất, chạy **9:00 sáng mỗi ngày** (giờ VN).

## Dealers
| Dealer | Tên cột | Website |
|--------|---------|---------|
| Mobile World | `MBW` | thegioididong.com |
| FPT Retail | `FPT Retail` | fptshop.com.vn |
| CellPhones | `CellPhone S` | cellphones.com.vn |

## Cấu trúc cột trong Sheet

| Cột | Nội dung |
|-----|----------|
| A | Ngày |
| B | Giờ |
| C | STT |
| D | **Dealer** ← mới |
| E | Tên Model |
| F | Hãng |
| G | CPU |
| H | RAM |
| I | Ổ cứng |
| J | Màn hình |
| K | Card đồ họa |
| L | Trọng lượng |
| M | Giá gốc (₫) |
| N | Giá KM (₫) |
| O | Giảm (%) |
| P | Đã bán |
| Q | Rating (★) |
| R | Link sản phẩm |

> **Lưu ý:** CPU/RAM/Storage/Screen/GPU/Weight hiện chỉ có data từ MBW (TGDĐ). FPT và CellPhones không expose các thông số này ở trang danh sách.

## Setup (5 phút)

### Bước 1 — Upload lên GitHub
1. Tạo repo GitHub mới (có thể private)
2. Upload toàn bộ thư mục này

### Bước 2 — Thêm Secrets
Vào repo → **Settings → Secrets and variables → Actions → New repository secret**

**`SPREADSHEET_ID`**
```
1VQAHqU3FaVfEOzVmp9nqLlkVokN0s9JkkJwLDscvr6w
```

**`GOOGLE_CREDENTIALS`**
```json
{"type":"service_account","project_id":"...","private_key":"...",...}
```

### Bước 3 — Bật Actions
Vào repo → tab **Actions** → nhấn **Enable GitHub Actions**

### Xong! 🎉
- Tự động **9:00 sáng mỗi ngày** (giờ VN)
- Chạy thủ công: **Actions → Run workflow**
- Mỗi ngày chạy ~25-35 phút (3 dealers × 9 brands)

## Thời gian chạy ước tính
- MBW: ~15 phút
- FPT Shop: ~8 phút
- CellPhones: ~8 phút
- **Tổng: ~30-35 phút/ngày**

GitHub Actions miễn phí 2000 phút/tháng → ~35 phút × 30 ngày = **~1050 phút/tháng** ✅
