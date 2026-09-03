# Kiểm tra tab `Segment`

Cập nhật: **07:33:28 3/9/2026** — tự sinh bởi job `segment-audit` (ops-tools).
Chỉ đọc Sheet, không ghi. Chạy lại: Actions → Ops Tools → tick `run_segment_audit`.

| File | Nội dung |
|---|---|
| [`segment-fixlist.csv`](segment-fixlist.csv) | **Bắt đầu từ đây.** Ô cần sửa kèm giá trị đúng. Cột `Dòng` là số dòng thật trong tab `Segment`. |
| [`segment-audit.csv`](segment-audit.csv) | Toàn bộ vấn đề, phân theo loại. |
| [`segment-normalized.csv`](segment-normalized.csv) | Danh sách giá trị chuẩn, kèm mọi cách viết đang có. |

## Các loại vấn đề

- **Ánh xạ lệch** — luật dẫn chuỗi gốc về giá trị khác với ô chuẩn ghi cạnh nó. Sửa ô **dạng chuẩn** (cột `CPU`/`GPU`), không sửa ô chuỗi gốc.
- **Ánh xạ hỏng** — luật không đọc được chuỗi gốc, dòng ánh xạ đó vô dụng.
- **Trùng lặp** — hai cách viết của cùng một thứ cùng tồn tại. Phải bỏ bớt một.
- **Lệch trong cùng dòng** — `CPU Segment` hoặc `CPU Platform` không khớp `CPU` cùng dòng.
- **Ô rác** — `#N/A`, `Đang cập nhật`, `Graphics` chung chung.
- **Luật chưa nhận ra** — dữ liệu scraper sẽ không bao giờ khớp vào dòng này. Đây là việc cần sửa **luật**, không phải sửa Sheet.

Tổng: **330** vấn đề, trong đó **209** ô có đích rõ ràng.

Sửa tới đâu, lần scrape sau áp tới đó — không cần làm hết một lượt.
