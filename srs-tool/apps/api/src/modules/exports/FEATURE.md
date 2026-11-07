# Đặc tả Tính năng: Xuất Gói Tài liệu & Sơ đồ (`apps/api/src/modules/exports`)

## 1. Mục tiêu & Mã Yêu cầu Liên quan
- **Vai trò:** Đóng gói toàn bộ thành quả chuẩn hoá của dự án (Tài liệu đặc tả SRS chuẩn EARS/INCOSE kèm Báo cáo Sổ phủ, Ma trận truy vết CSV, Mã nguồn `.puml`, Ảnh sơ đồ `.svg`/`.png`, và Gói nén trọn bộ `.zip`) lưu vào `STORAGE_PORT` và cấp liên kết tải về có thời hạn 24 giờ.
- **Mã yêu cầu đặc tả:**
  - `FR-EXP-001`: Xuất từng sơ đồ hoặc toàn bộ sơ đồ ở các định dạng `.puml`, `.svg`, `.png`.
  - `FR-EXP-003`: Xuất danh sách yêu cầu đã chuẩn hoá ở định dạng **Markdown (`.md`)** và **CSV (`.csv`)** có kèm mã yêu cầu, mẫu EARS, tiêu chí chấp nhận, nguồn gốc (`origin`) và danh sách đoạn nguồn truy vết.
  - `FR-EXP-005`, `NFR-SEC-005`: Liên kết tải về có thời hạn **24 giờ** (`expires_at = now + 24h`) và tải xuống được thật qua HTTP.
  - `NFR-COMP-002`: Các tệp xuất phải mở được chuẩn xác bằng công cụ phổ biến (Excel/UTF-8 BOM cho CSV tiếng Việt, trình duyệt cho SVG, PlantUML chuẩn cho `.puml`, trình giải nén chuẩn cho `.zip`).

---

## 2. Ranh giới Module & Quyền sở hữu CSDL
- **Đường dẫn:** `srs-tool/apps/api/src/modules/exports` (`exports.module.ts`, `exports.controller.ts`, `exports.service.ts`) — phối hợp cùng `apps/worker/src/processors/export.processor.ts` cho các gói xuất nặng.
- **Bảng CSDL được phép GHI:** Duy nhất bảng `exports`.
- **Phụ thuộc nội bộ:** `DatabaseService`, `STORAGE_PORT`, `RENDER_PORT`, `ProjectsService` (lấy `CoverageReport` & `Checklist`), `RequirementsService` (lấy yêu cầu + nguồn + thuật ngữ), `ArchitectureService` & `DiagramsService` (lấy mô hình, khuyến nghị công nghệ & sơ đồ).

---

## 3. Hợp đồng REST Endpoints & Cấu trúc Gói Xuất (Tiền tố `/api/v1`)

| Phương thức & Đường dẫn | Payload | Response Chuẩn | Quy tắc Nghiệp vụ |
| :--- | :--- | :--- | :--- |
| `POST /projects/:projectId/exports` | `{ formats?: Array<'md' \| 'csv' \| 'puml' \| 'svg' \| 'png' \| 'zip'> }` | `{ id, projectId, formats, status, downloadUrl, expiresAt }` | Mặc định nếu không truyền `formats`: xuất trọn gói `['md', 'csv', 'puml', 'svg']` nén thành 1 tệp `.zip`. Nếu chỉ chọn đúng 1 định dạng đơn lẻ (`['md']` hoặc `['csv']`), trả thẳng tệp đơn đó (hoặc `.zip` khi chọn `>= 2` định dạng). |
| `GET /projects/:projectId/exports` *(Mới Phase 1)* | — | `ExportRecord[]` | Liệt kê các lần xuất gần đây của dự án để người dùng tải lại trong vòng 24 giờ. |
| `GET /exports/:id` | — | `{ id, status, formats, downloadUrl, expiresAt }` | Nếu `now > expiresAt`, trả `status = 'expired'` và ẩn `downloadUrl` (`FR-EXP-005`). |

### Quy cách Nội dung Từng Tệp trong Gói Xuất (Đảm bảo Chất lượng Báo cáo KLTN)
1. **`SRS-Specification.md`:**
   - Thông tin dự án, nền tảng mục tiêu, ngôn ngữ.
   - **Mục 1 — Báo cáo Sổ phủ (`Coverage Ledger Summary`):** Tổng số đoạn nguồn, số đoạn đã ánh xạ (`mapped`), phi yêu cầu (`not_requirement`), chưa giải quyết (`unresolved`), tỷ lệ phủ `%` (chứng minh không bỏ sót đầu vào).
   - **Mục 2 — Bảng Thuật ngữ Song ngữ (`Glossary`).**
   - **Mục 3 — Danh sách Yêu cầu Chuẩn hoá** (nhóm theo Chức năng / Phi chức năng / Ràng buộc / Giả định): hiển thị rõ mã `code`, nhãn `origin`, `priority`, `ears_pattern`, câu chuẩn hoá, câu gốc, tiêu chí `Given/When/Then`, phương pháp kiểm chứng và ID đoạn nguồn.
   - **Mục 4 — Đề xuất Kiến trúc & Bảng Điểm Công nghệ (`Tech Stack & Tradeoffs`).**
2. **`Requirements-Traceability.csv`:**
   - **Bắt buộc gắn UTF-8 BOM (`\uFEFF`) ở đầu tệp** để mở bằng Microsoft Excel trên Windows hiển thị đúng 100% tiếng Việt có dấu!
   - Escape chuẩn RFC 4180 cho các ô chứa dấu phẩy, dấu ngoặc kép và ký tự xuống dòng.
3. **`diagrams/<type>.puml` & `diagrams/<type>.svg` (và `.png` khi yêu cầu):**
   - Xuất toàn bộ sơ đồ hiện có của mô hình kiến trúc dự án.
4. **Đóng gói `.zip` thật:**
   - Nén không phụ thuộc công cụ dòng lệnh ngoài (sử dụng thư viện thuần JS/TS nhẹ như `fflate` hoặc bộ tạo ZIP chuẩn CRC32/Store-Deflate nội bộ chạy trên `Buffer`) để hoạt động ổn định trên cả Windows lẫn Linux container.

---

## 4. Thực trạng Code Hiện tại & Các Bug Nghiêm trọng Cần Sửa

### Trạng thái hiện tại (`~35%`)
1. **BUG P0 — Bỏ rơi `csvContent`, không tạo tệp `.zip` và URL tải về bị `404`:**
   - Tại `exports.service.ts:52`, hàm `createExport` dựng chuỗi `csvContent` xong nhưng **bỏ không dùng tới**, chỉ ghi duy nhất một tệp `.md` thô sơ lên `StoragePort`!
   - Toàn bộ các định dạng `.puml`, `.svg`, `.png`, `.zip` đều chưa được đưa vào gói xuất.
   - `downloadUrl` trả về `/api/v1/storage/files/...` trước đây luôn lỗi `404` vì thiếu `StorageController`.
2. **BUG P1 — `ExportProcessor` trong `apps/worker` đang là stub rỗng 100%.**

### Kế hoạch theo Phase
- **Phase 1:**
  - Hoàn thiện `ExportsService` sinh đủ `SRS-Specification.md` (có bảng Coverage Ledger & Tech Stack), `Requirements-Traceability.csv` (có UTF-8 BOM `\uFEFF`), `diagrams/*.puml`, `diagrams/*.svg` và đóng gói thành tệp `.zip` chuẩn mở được ngay trên Windows Explorer / macOS / Linux.
  - Bổ sung `GET /projects/:projectId/exports`, kiểm tra hạn 24 giờ trong `getExport`, xoá `catch {}` rỗng nuốt lỗi SQL, và đồng bộ `ExportProcessor` trên Worker.

---

## 5. Tiêu chí Nghiệm thu & Kịch bản Kiểm thử
- [ ] Gọi `POST /api/v1/projects/:projectId/exports` với `formats: ['md', 'csv', 'puml', 'svg']` trả về `downloadUrl` tải được tệp `.zip` thật qua `GET /api/v1/storage/files/...`.
- [ ] Giải nén tệp `.zip` thấy đủ `SRS-Specification.md`, `Requirements-Traceability.csv` (bắt đầu bằng `\uFEFF`), `diagrams/context.puml`, `diagrams/context.svg`, `diagrams/container.puml`, `diagrams/container.svg`.
- [ ] Khi `expiresAt` đã qua, gọi `GET /api/v1/exports/:id` trả `status: 'expired'` và gọi vào URL tải cũ nhận lỗi hết hạn (`403`/`410`).
