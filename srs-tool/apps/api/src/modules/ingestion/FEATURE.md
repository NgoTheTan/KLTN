# Đặc tả Tính năng: Tiếp nhận Tài liệu Đa Định dạng (`apps/api/src/modules/ingestion`)

## 1. Mục tiêu & Mã Yêu cầu Liên quan
- **Vai trò:** Tiếp nhận các nguồn thông tin đầu vào chưa chuẩn hoá của dự án (tệp `.pdf`, `.docx`, `.md`, `.txt`, `.eml` hoặc văn bản/chuỗi email dán trực tiếp), kiểm tra tính hợp lệ, tính mã băm bất biến `SHA-256`, lưu tệp gốc qua `STORAGE_PORT` và ghi siêu dữ liệu vào bảng `documents` để sẵn sàng cho giai đoạn `S1` của Pipeline.
- **Mã yêu cầu đặc tả:**
  - `FR-ING-001`: Nhận tệp `.pdf` (có lớp văn bản), `.docx`, `.md`, `.txt` với dung lượng tối đa **20 MB / tệp**.
  - `FR-ING-002`: Nhận nội dung văn bản thuần hoặc biên bản họp dán trực tiếp trên giao diện.
  - `FR-ING-003`: Nhận tệp thư điện tử `.eml` hoặc chuỗi email dán trực tiếp.
  - `FR-ING-005`: Lưu bản gốc bất biến kèm `sha256` để đối chiếu về sau.
  - `FR-ING-008`: Phát hiện sớm và trả thông báo hướng dẫn hành động rõ ràng nếu người dùng tải tệp PDF dạng ảnh quét (scanned PDF không có lớp văn bản) hoặc tệp rỗng/sai định dạng (`NFR-USA-005`).
  - `NFR-SCAL-001` / Giới hạn dự án: Tối đa **10 tài liệu / dự án** ở cấu hình tiêu chuẩn để bảo vệ tài nguyên.

---

## 2. Ranh giới Module & Quyền sở hữu CSDL
- **Đường dẫn:** `srs-tool/apps/api/src/modules/ingestion` (`ingestion.module.ts`, `ingestion.controller.ts`, `ingestion.service.ts`).
- **Bảng CSDL được phép GHI:** Duy nhất bảng `documents`.
- **Phụ thuộc nội bộ:** `DatabaseService`, `STORAGE_PORT`, `ProjectsService` (kiểm tra tồn tại & quyền sở hữu dự án), `unpdf` (kiểm tra nhanh lớp văn bản PDF nếu cần phản hồi tức thì ngay lúc upload).

---

## 3. Hợp đồng REST Endpoints (Tiền tố `/api/v1`)

| Phương thức & Đường dẫn | Payload Hỗ trợ | Response Chuẩn | Quy tắc Kiểm tra |
| :--- | :--- | :--- | :--- |
| `POST /projects/:projectId/documents` | JSON `{ contentBase64, filename, mimeType, kind? }` **HOẶC** `{ text, filename?, kind? }` *(hỗ trợ thêm `multipart/form-data` nếu gửi trực tiếp)* | `Document` (`201 Created`) | 1. Kích thước tệp giải mã `<= 20 * 1024 * 1024` bytes (`413 Payload Too Large` nếu vượt).<br>2. Đuôi tệp / MIME chỉ thuộc `.pdf`, `.docx`, `.md`, `.txt`, `.eml` (`400 Bad Request` nếu là `.exe`, `.zip`, `.png`...).<br>3. Tối đa 10 tài liệu trên mỗi `projectId`.<br>4. Chống trùng lặp: nếu cùng `projectId` đã có tài liệu trùng hệt `sha256`, trả về bản ghi hiện có hoặc cảnh báo rõ ràng. |
| `GET /projects/:projectId/documents` | — | `Document[]` | Sắp xếp theo `createdAt DESC`, kèm `downloadUrl` qua `/api/v1/storage/files/...`. |
| `GET /documents/:id` | `id: UUID` | `Document & { downloadUrl }` | Kiểm tra quyền sở hữu qua dự án cha. |
| `DELETE /documents/:id` *(Mới Phase 1)* | `id: UUID` | `{ deleted: true }` | Xoá tệp trên `StoragePort` và xoá dòng `documents` (`ON DELETE CASCADE` sẽ tự dọn các `segments` thuộc tài liệu đó). |

### Cấu hình Bắt buộc ở `apps/api/src/main.ts`
- Mặc định `FastifyAdapter` chỉ cho phép `bodyLimit = 1_048_576` (1 MB) — trong khi tệp `.pdf`/`.docx` mã hoá Base64 tới 20 MB sẽ chiếm `~27 MB` JSON payload!
- Do đó `main.ts` **bắt buộc** khởi tạo `new FastifyAdapter({ logger: true, bodyLimit: 30 * 1024 * 1024 })` và bật `app.enableCors({ origin: true, credentials: true })`.

---

## 4. Thực trạng Code Hiện tại & Các Bug Nghiêm trọng Cần Sửa

### Trạng thái hiện tại (`~55%`)
1. **BUG P0 — Bất tương thích Upload giữa Web Client và API + Chặn 1 MB ở Fastify:**
   - `apps/web/src/api/client.ts` (dòng 28–31) gửi `FormData` (`multipart/form-data`), nhưng `IngestionController` chỉ đọc `@Body() { text, contentBase64 }` dạng JSON.
   - `apps/api/src/main.ts` chưa bật CORS và giữ `bodyLimit` mặc định 1 MB khiến mọi file `> 750 KB` bị Fastify từ chối `413` trước khi chạm tới `IngestionController`.
2. **BUG P1 — Chưa kiểm tra PDF scan ngay lúc tiếp nhận / S1 và chưa có nút xoá tài liệu nhầm:**
   - Khi người dùng lỡ tải nhầm tài liệu hoặc tải PDF ảnh scan, hiện chưa có `DELETE /api/v1/documents/:id` và chưa trả mã lỗi hướng dẫn cụ thể theo `FR-ING-008` & `NFR-USA-005`.
3. **BUG Đồng bộ DB — Khối `catch {}` rỗng trong `IngestionService`:**
   - Nuốt lỗi SQL nếu `projectId` không hợp lệ và vẫn ghi file rác vào `.uploads`.

### Kế hoạch theo Phase
- **Phase 1:**
  - Cập nhật `main.ts`: bật `enableCors` và nâng `bodyLimit` lên `30 * 1024 * 1024`.
  - Đồng bộ `apps/web/src/api/client.ts` chuyển `File` sang Base64 + `filename` + `mimeType` khớp chặt với `POST /api/v1/projects/:projectId/documents` (và hỗ trợ cả nhận diện tự động `kind: 'email'` khi đuôi file là `.eml`).
  - Trong `IngestionService.ingestFile`: kiểm tra `projectId` tồn tại trước khi ghi đĩa; nếu là `.pdf`, dùng nhanh `unpdf` kiểm tra lớp văn bản ngay khi tiếp nhận — nếu tổng ký tự chữ `< 20`, từ chối ngay với `422 Unprocessable Entity` kèm thông báo song ngữ rõ hành động cần làm (`FR-ING-008`).
  - Thêm endpoint `DELETE /api/v1/documents/:id` và xoá bỏ các khối `catch {}` nuốt lỗi SQL.

---

## 5. Tiêu chí Nghiệm thu & Kịch bản Kiểm thử
- [ ] Upload tệp `.docx` hoặc `.pdf` (có lớp văn bản, nặng 5 MB) qua API trả về `201 Created` kèm `sha256` chuẩn 64 ký tự hex và lưu bản ghi thật trong bảng `documents`.
- [ ] Upload tệp `.pdf` chỉ chứa ảnh quét (0 ký tự text) nhận ngay `422 Unprocessable Entity` với thông báo giải thích hệ thống không hỗ trợ OCR và hướng dẫn tải bản PDF gốc / `.docx`.
- [ ] Upload tệp `> 20 MB` hoặc đuôi `.exe` bị từ chối rõ ràng (`413` / `400`), không để lại tệp rác trong `.uploads`.
