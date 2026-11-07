# Đặc tả Tính năng: Tổng hợp Mô hình Kiến trúc & Đề xuất Stack (`apps/api/src/modules/architecture`)

## 1. Mục tiêu & Mã Yêu cầu Liên quan
- **Vai trò:** Quản lý **Nguồn sự thật duy nhất (`ArchitectureModel` JSON)** của kiến trúc hệ thống mục tiêu: tự động tổng hợp các phần tử C4 (`person`, `system`, `container`, `datastore`, `device`) và quan hệ (`relationships`) từ tập yêu cầu chuẩn hoá + **Kho tri thức YAML (`@srs-tool/knowledge`)** mà **không cần gọi LLM**, chấm điểm gợi ý công nghệ (`tech_recommendations`), thực thi bản vá có khoá lạc quan (`ModelPatch`), và phân tích lệnh sửa cố định 0-token (`CommandParser`).
- **Mã yêu cầu đặc tả:**
  - `FR-ARC-001`: Sinh mô hình kiến trúc cơ sở từ mẫu kiến trúc tham chiếu theo nền tảng + danh mục chiến thuật ASR (`tactics-catalog.yaml`) + bộ dò tính năng từ yêu cầu, truy vết ngược `requirement_ids` cho từng thành phần.
  - `FR-ARC-003`: Gợi ý công nghệ theo từng tầng (`layer`) bằng bảng chấm điểm đa tiêu chí (`scores` + `constraints` của dự án), kèm ít nhất 1 lựa chọn thay thế (`alternatives`) và lý do/đánh đổi (`rationale` / `tradeoffs`).
  - `FR-ARC-004`: Phiên bản, giấy phép và độ trưởng thành công nghệ đọc trực tiếp từ `tech-catalog.yaml` (có `updated_at`), không để LLM tự bịa.
  - `FR-DIA-005`, `NFR-SEC-003`: Mọi thay đổi lên `ArchitectureModel` phải đi qua `applyPatch` có kiểm tra `expected_version` và kiểm tra toàn vẹn đồ thị (không để lại quan hệ treo).

---

## 2. Ranh giới Module & Quyền sở hữu CSDL
- **Đường dẫn:** `srs-tool/apps/api/src/modules/architecture` (`architecture.module.ts`, `architecture.controller.ts`, `architecture.service.ts`, `command-parser.ts`).
- **Bảng CSDL được phép GHI:** `arch_models`, `tech_recommendations`.
- **Bảng CSDL được phép ĐỌC:** `projects`, `requirements` (lọc các yêu cầu hợp lệ, đặc biệt các yêu cầu có `isAsr = true`).
- **Được gọi bởi:** `AgentService` (khi người dùng bấm `accept` bản vá) và `DiagramsService` (lắng nghe cập nhật để tái sinh các sơ đồ đang ở chế độ `model`).

---

## 3. Hợp đồng REST Endpoints & Thuật toán Tổng hợp (Tiền tố `/api/v1`)

| Phương thức & Đường dẫn | Payload | Response Chuẩn | Quy tắc Nghiệp vụ |
| :--- | :--- | :--- | :--- |
| `POST /projects/:projectId/architecture` | — | `ArchitectureModel` | Chạy bộ tổng hợp tri thức 4 bước bên dưới, tăng `version` nếu dự án đã có model trước đó, lưu cả `arch_models` lẫn `tech_recommendations`, và thông báo cho `DiagramsService` cập nhật các view ở chế độ `model`. |
| `GET /projects/:projectId/architecture` | — | `ArchitectureModel & { catalog_updated_at }` | Trả về mô hình kiến trúc hiện hành của dự án. |
| `GET /models/:id` | — | `ArchitectureModel` | Đọc theo `model.id`. |
| `PATCH /models/:id` | `ModelPatch` (`{ operations, expected_version, reason? }`) | `ArchitectureModel` | Kiểm chứng bằng `ModelPatchSchema`. Nếu `expected_version !== model.version` → trả `409 Conflict`! Nếu sau khi áp patch có `relationship` trỏ tới `source_id`/`target_id` không tồn tại → trả `400 Bad Request`! Khi xoá `element`, tự động dọn các `relationship` nối vào nó hoặc báo lỗi rõ ràng. |
| `POST /models/:id/commands` | `{ command: string }` | `ArchitectureModel` | Phân tích câu lệnh cố định song ngữ Việt/Anh bằng `CommandParser` (0 LLM token) thành `ModelPatch` rồi gọi `applyPatch`. |

### Thuật toán 4 Bước Tổng hợp Kiến trúc Tất định (`synthesizeArchitecture`)
1. **Bước 1 — Khởi tạo Hệ thống Gốc & Khung Tham chiếu theo `project.platforms`:**
   - **Bắt buộc tạo phần tử gốc `kind: 'system'`** (`id: 'target_system'`, `name: project.name`) để sơ đồ C4 Context và `System_Boundary` của C4 Container luôn có hạt nhân trung tâm!
   - Thêm tác nhân `person` (`user`, và `admin` nếu có yêu cầu quản trị).
   - Dựa trên `project.platforms`:
     - `'web'` → thêm `webapp` (`container`), `api` (`container`), `db` (`datastore`).
     - `'mobile'` → thêm `mobile_app` (`container`), `api` (`container`), `db` (`datastore`).
     - `'iot'` → thêm `iot_device` (`device`), `mqtt_broker` (`container`), `iot_ingestion` (`container`), `timeseries_db` (`datastore`).
2. **Bước 2 — Áp Chiến thuật ASR từ `loadTacticsCatalog()` & Bộ Dò Tính năng:**
   - Duyệt toàn bộ yêu cầu của dự án (ưu tiên `is_asr = true` và từ khoá nghiệp vụ song ngữ):
     - Hiệu năng cao / độ trễ thấp (`< 500ms`, `cache`, `tốc độ`) → kích hoạt tactic `cache-aside`, thêm `cache` (`datastore: Redis`) kèm `requirement_ids` của các NFR kích hoạt nó.
     - Xử lý bất đồng bộ / thông lượng cao / gửi thông báo / xuất báo cáo → thêm `queue` + `worker` (`container`).
     - Lưu trữ tệp / ảnh / tài liệu → thêm `object_storage` (`datastore: MinIO / S3`).
     - Bảo mật cao / phân quyền OAuth / Rate limit → thêm `auth_gateway` / `api_gateway`.
     - Cập nhật firmware từ xa (`OTA`) cho IoT → thêm `ota_service` (`container`) + kho firmware.
3. **Bước 3 — Chấm điểm Chọn Công nghệ từ `loadTechCatalog()`:**
   - Với mỗi `layer` hiện diện trong kiến trúc, lọc các `TechEntry` hỗ trợ `platforms` của dự án.
   - Tính điểm trọng số dựa trên `entry.scores` cộng điểm thưởng nếu khớp `stack_tags` từ các chiến thuật ASR vừa kích hoạt hoặc khớp `project.constraints` (VD: ưu tiên mã nguồn mở `MIT`/`Apache-2.0`, độ khó học thấp `learning_curve: 'low'` cho nhóm nhỏ).
   - Chọn công nghệ điểm cao nhất gán vào `element.technology`, lấy các ứng viên xếp sau làm `alternatives`, sinh chuỗi giải thích song ngữ dựa trên điểm số + `tradeoffs` + `updated_at`, và ghi đồng bộ vào cả `model.tech_choices` lẫn bảng `tech_recommendations`.
4. **Bước 4 — Khởi tạo Views Chuẩn (`context`, `container`):**
   - Tạo danh sách `views` chứa đủ `include_ids` hợp lệ (giữ nguyên `mode = 'detached'` của những sơ đồ mà người dùng đã tách rời trước đó!).

---

## 4. Thực trạng Code Hiện tại & Các Bug Nghiêm trọng Cần Sửa

### Trạng thái hiện tại (`~50%`)
1. **BUG P0 — `synthesizeArchitecture` đang viết cứng (hardcode) 100% và thiếu phần tử `system`:**
   - Tại `architecture.service.ts:123–185`, hàm này không hề gọi `@srs-tool/knowledge`, không đọc `tactics-catalog.yaml` hay `tech-catalog.yaml`, luôn trả cứng `React + NestJS + PostgreSQL + Redis`, không ghi dòng nào vào bảng `tech_recommendations`, và **không tạo phần tử `kind: 'system'`** (gây gãy `generateContainerDiagram`).
2. **BUG P1 — Chưa tự động đồng bộ lại các sơ đồ `mode = 'model'` sau khi `applyPatch`:**
   - Khi mô hình kiến trúc tăng `version` qua `PATCH /models/:id` hoặc `POST /models/:id/commands`, các bản ghi `diagrams` đang ở `mode = 'model'` cần được tái sinh mã `.puml` mới để phản ánh thay đổi ngay lập tức (`FR-DIA-005`).

### Kế hoạch theo Phase
- **Phase 1:**
  - Hiện thực hoá đầy đủ thuật toán 4 bước dùng `loadTechCatalog()`, `loadTacticsCatalog()`, `loadPlatformProfile()` từ `@srs-tool/knowledge`.
  - Ghi đầy đủ vào bảng `arch_models` và `tech_recommendations` trên PostgreSQL (bỏ `catch {}` nuốt lỗi SQL).
  - Bổ sung kiểm tra không có `relationship` treo trong `applyPatch` và gọi hook tái sinh mã `.puml` cho các sơ đồ `mode = 'model'`.

---

## 5. Tiêu chí Nghiệm thu & Kịch bản Kiểm thử
- [ ] Một dự án chọn nền tảng `['iot', 'web']` có yêu cầu độ trễ `< 200ms` và cập nhật `OTA` khi gọi `POST /projects/:id/architecture` sẽ tự động sinh đủ `target_system` (`system`), `iot_device` (`device`), `mqtt_broker`, `timeseries_db`, `ota_service`, `cache`, có gán `requirement_ids` thật và lưu các dòng tương ứng vào bảng `tech_recommendations`.
- [ ] Gửi `PATCH /models/:id` với `expected_version` cũ trả về đúng `409 Conflict`; gửi `add_relationship` trỏ tới `target_id` không tồn tại trả về `400 Bad Request`.
- [ ] Gửi lệnh cố định tiếng Việt `"thêm hàng đợi Kafka giữa API và Worker"` qua `POST /models/:id/commands` cập nhật mô hình thành công với 0 LLM token.
