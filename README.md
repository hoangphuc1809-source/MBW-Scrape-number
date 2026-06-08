# TGDĐ Laptop Scraper — Tự động 9h sáng mỗi ngày

## Cách setup (5 phút)

### Bước 1 — Upload lên GitHub
1. Tạo repo GitHub mới (private) tại github.com/new
2. Upload toàn bộ thư mục này lên repo

### Bước 2 — Thêm 2 Secrets vào GitHub
Vào repo → **Settings → Secrets and variables → Actions → New repository secret**

**Secret 1:** `SPREADSHEET_ID`
- Value: ID của Google Sheet (lấy từ URL)
- Ví dụ: `1VQAHqU3FaVfEOzVmp9nqLlkVokN0s9JkkJwLDscvr6w`

**Secret 2:** `GOOGLE_CREDENTIALS`
- Value: **Toàn bộ nội dung** file credentials.json (copy paste hết)
- Ví dụ: `{"type":"service_account","project_id":"...","private_key":"...",...}`

### Bước 3 — Bật Actions
Vào repo → tab **Actions** → nhấn **Enable GitHub Actions**

### Xong! 🎉
- Tự động chạy **9:00 sáng mỗi ngày** (giờ VN)
- Xem log: repo → **Actions** → click run gần nhất
- Chạy thủ công: **Actions → Run workflow**

## Lưu ý
- GitHub Actions miễn phí 2000 phút/tháng (repo public) hoặc 2000 phút/tháng (private)
- Mỗi lần scrape ~15-20 phút → dùng khoảng 450-600 phút/tháng → vẫn trong giới hạn miễn phí
