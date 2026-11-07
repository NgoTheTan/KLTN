# Đặc tả Tính năng: Tiến trình Xử lý Nền Bất đồng bộ (`@srs-tool/worker`)

## 1. Mục tiêu & Mã Yêu cầu Liên quan
- **Vai trò:** Thực thi các tác vụ tốn thời gian và tài nguyên ở chế độ nền qua hàng đợi **BullMQ (Redis)**, tách biệt hoàn toàn khỏi luồng phản hồi HTTP của `@srs-tool/api`. Đảm nhiệm việc đọc/ghi trạng thái từng giai đoạn (`S1 → S8`) với PostgreSQL, phát tiến độ thời gian thực cho SSE, cho phép tạm dừng chờ người dùng làm rõ (`waiting_input`) và tiếp tục chạy từ bất kỳ giai đoạn nào (`fromStage`).
- **Mã yêu cầu đặc tả:**
  - `NFR-PERF-003`, `FR-RVW-007`: Chạy bất đồng bộ, lưu điểm dừng (checkpoint) vào PostgreSQL sau mỗi giai đoạn, báo tiến độ `%` và hỗ trợ huỷ giữa chừng (`cancelled`).
  - `NFR-REL-003`: Tính bất biến khi chạy lại (Idempotency) — khi một job thử lại hoặc chạy lại từ `fromStage = k`, không tạo trùng đoạn nguồn, không làm mất các yêu cầu đã được người dùng duyệt (`approved`) hoặc các đoạn câu trả lời làm rõ (`document_id IS NULL`).
  - `NFR-LLM-002`, `NFR-LLM-003`: Ở chế độ `eco` (hoặc khi chạm trần quota/ngân sách), hoàn tất trọn vẹn `S1 → S8` với 0 lời gọi LLM và ghi đầy đủ `decision_log`.

---

## 2. Cấu trúc Thư mục & Quyền sở hữu CSDL
- **Đường dẫn:** `srs-tool/apps/worker`
  - `src/main.ts`: Khởi tạo connection pool PostgreSQL, Redis và đăng ký 3 BullMQ Workers (`pipeline`, `arch`, `export`) kèm xử lý tín hiệu tắt an toàn (`SIGTERM`/`SIGINT`).
  - `src/processors/pipeline.processor.ts`: Điều phối 8 giai đoạn `S1 → S8` trên PostgreSQL.
  - `src/processors/arch.processor.ts`: Tổng hợp kiến trúc & đề xuất công nghệ bất đồng bộ cho các dự án lớn.
  - `src/processors/export.processor.ts`: Kết xuất sơ đồ hàng loạt & nén gói `.zip` nền.
  - `src/scripts/smoke-pipeline.ts`: Kịch bản kiểm thử tích hợp đầu-cuối `S1 → S8` trực tiếp với PostgreSQL.
- **Phụ thuộc cho phép:** `bullmq`, `ioredis`, `@srs-tool/db`, `@srs-tool/pipeline`, `@srs-tool/knowledge`, `@srs-tool/plantuml-gen`, `@srs-tool/llm`, `@srs-tool/schemas`.

---

## 3. Đặc tả Chi tiết `PipelineProcessor` (`S1 → S8` trên PostgreSQL)

### 3.1. Quản lý Trạng thái & Điểm Dừng (`Checkpointing` & `Cancellation`)
Trước khi bước vào mỗi giai đoạn `Sk` (`k = 1..8`), Worker kiểm tra nhanh dòng `runs` trong DB: nếu `run.status === 'cancelled'` thì dừng ngay lập tức mà không chạy giai đoạn tiếp theo (`FR-RVW-007`).

| Giai đoạn | Tiến độ | Thao tác Đọc/Ghi PostgreSQL Chuẩn xác |
| :---: | :---: | :--- |
| **`S1`** | `12%` | Đọc mọi `documents` của dự án từ thư mục gốc `srs-tool/.uploads` (dạng `Buffer` cho `.pdf`/`.docx`, UTF-8 cho `.txt`/`.md`/`.eml`). **Chỉ xoá các `segments` cũ có `documentId IS NOT NULL`** (tuyệt đối giữ lại các `segments` câu trả lời làm rõ có `documentId IS NULL`!). Ghi loạt `segments` mới với `coverageStatus = 'unmapped'`. |
| **`S2`** | `25%` | Đọc `segments` (`documentId IS NOT NULL`), gọi `runExtraction(...)`. Cập nhật `segments.coverageStatus` (`'mapped'` / `'not_requirement'` / `'unresolved'`). Xoá các yêu cầu tự động cũ thuộc `REGENERABLE_STATUSES` (giữ nguyên các yêu cầu `approved`, `rejected` hoặc do người dùng tự tạo), chèn các yêu cầu ứng viên `status = 'candidate'` + nối `requirement_sources` + chụp `requirement_versions (v1)`. |
| **`S3`** | `38%` | Gọi `runClassification(...)` gán `type`, `platforms` (giới hạn theo `project.platforms`), `isAsr`, `priority` và cấp mã tuần tự không trùng (`FR-WEB-001`, `NFR-IOT-001`...). Trích xuất thuật ngữ song ngữ lưu bổ sung vào `glossary_terms` (không ghi đè thuật ngữ người dùng đã định nghĩa). |
| **`S4`** | `50%` | Đọc checklist từ `loadCombinedChecklist(ctx.platforms)` (bỏ qua các mục người dùng đã đánh dấu `not_applicable` trong bảng `issues`). Gọi `runIssueDetection(...)` phát hiện lỗi EARS/INCOSE, xung đột số học (`CONFLICT-NUM`) và thiếu hụt checklist (`CHECKLIST-*`); lưu vào bảng `issues` và cập nhật `qualityScore`. |
| **`S5`** | `58%` | Gọi `runQuestionBuilding(...)` cho mọi `issues` đang `open` kèm giá trị mặc định từ `loadPlatformDefaults(ctx.platforms)`. Xoá các câu hỏi `pending` mồ côi cũ và chèn câu hỏi mới (gồm `topicGroup`, `ruleId`, `options`, `proposedValue`) vào bảng `questions`. |
| **`S6`** | `72%` | Gọi `runNormalization(...)` chuẩn hoá các yêu cầu ứng viên/đã phân loại sang câu **EARS** hoàn chỉnh, điền `earsPattern`, `acceptanceCriteria` (`Cho trước/Khi/Thì` hoặc `Given/When/Then`), `verificationMethod`, `metric`, chuyển `status = 'normalized'` (trừ các câu còn lỗi mức `error` giữ `needs_clarification`), và ghi bản chụp mới vào `requirement_versions`. |
| **`S7`** | `86%` | Gọi `runMergeAndReduce(...)` trên tập yêu cầu hiện hành. Với các cặp được phép gộp tự động (không vướng bộ chặn số liệu/phủ định): chuyển toàn bộ liên kết `requirement_sources` từ bản trùng sang bản chính (`ON CONFLICT DO NOTHING`), đánh dấu bản trùng `status = 'merged'`, ghi `requirement_versions`. Với cặp vùng mơ hồ: tạo `issue` gợi ý gộp để người dùng duyệt tay. |
| **`S8`** | `100%` | Gọi `runCoverageAndPreservation(...)`:<br>1. Nếu phát hiện yêu cầu nào sau `S6` bị rơi số liệu / đơn vị / từ phủ định / hạ mức bắt buộc (`FR-REQ-020`), khôi phục an toàn câu gốc hoặc gắn `issue` `PRESERVATION-001` (`severity: 'error'`) và đặt `status = 'needs_clarification'`.<br>2. Kiểm toán `CoverageLedger` trên toàn bộ `segments` của dự án.<br>3. Nếu dự án đang còn câu hỏi `questions` ở trạng thái `pending` gắn với lỗi nghiêm trọng → đặt `runs.status = 'waiting_input'`; ngược lại đặt `runs.status = 'succeeded'`. |

### 3.2. Xử lý Cờ Nâng bậc `escalate: true` (`POST /runs/:id/escalate`)
Khi `job.data.escalate === true`:
- Worker **không chạy lại `S1`** và không xoá dữ liệu đã duyệt; chỉ lọc các `segments` đang `unresolved` (hoặc có `decision_log.status = 'pending_llm'`) và các `requirements` có độ tin cậy thấp để đưa qua `DecisionRouter` ở chế độ `standard`/`thorough`, cập nhật kết quả và giữ nguyên lịch sử phiên bản.

---

## 4. Thực trạng Code Hiện tại & Các Bug Nghiêm trọng Cần Sửa

### Trạng thái hiện tại (`~40%`)
1. **BUG P0 — Bỏ qua hoàn toàn `.pdf` và `.docx`:**
   - Tại `pipeline.processor.ts:415–416`, `resolveContentType` trả cứng `null` cho `.pdf` và `.docx`, khiến `runS1` bỏ qua tài liệu!
2. **BUG P0 — Bỏ trống `S5` và để `runS6`, `runS7`, `runS8` làm hàm `console.log` rỗng:**
   - Dòng `99–111` và `397–407` của `pipeline.processor.ts` chưa gọi `S5QuestionBuilder`, còn `S6–S8` chỉ in log ra màn hình nên không một câu hỏi, câu chuẩn hoá EARS hay phép gộp nào được ghi vào CSDL!
3. **BUG P0 — Xoá mất `segments` câu trả lời làm rõ khi chạy lại `S1` & Lệch thư mục `.uploads`:**
   - `runS1` hiện xoá toàn bộ `segments` theo `projectId` mà chưa lọc `isNotNull(segments.documentId)`.
   - `readDocument` dùng `path.join(process.cwd(), '.uploads')` lệch với tiến trình `apps/api`.
4. **BUG P1 — `ArchProcessor` và `ExportProcessor` đang là TODO rỗng 100%.**

### Kế hoạch theo Phase
- **Phase 1:**
  - Mở đọc Buffer cho `.pdf` (`application/pdf`) và `.docx` (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`) trong `PipelineProcessor`.
  - Chuẩn hoá đường dẫn gốc `srs-tool/.uploads` dùng chung với `apps/api`.
  - Hiện thực hoá trọn vẹn `runS5`, `runS6`, `runS7`, `runS8`, trích `glossary_terms` ở `runS3`, kiểm tra `cancelled` và xử lý cờ `escalate: true`.
  - Hoàn thiện `ArchProcessor` và `ExportProcessor`, cập nhật `smoke-pipeline.ts` kiểm chứng trọn luồng `S1 → S8`.
- **Phase 3 & Phase 4:**
  - Truyền `LlmGateway` (Phase 3) và `LocalModelAdapter` (Phase 4, khởi tạo 1 lần khi Worker boot) vào `DecisionRouter` của `PipelineProcessor`.

---

## 5. Tiêu chí Nghiệm thu & Kịch bản Kiểm thử
- [ ] Chạy `pnpm --dir srs-tool --filter @srs-tool/worker smoke` trên PostgreSQL thực thi trọn vẹn từ `S1` đến `S8`, in ra bảng kết quả có: các câu hỏi làm rõ trong bảng `questions` (`S5`), các yêu cầu đã chuyển sang cấu trúc EARS + `Given/When/Then` và `requirement_versions >= 2` (`S6`), cặp yêu cầu trùng bị đánh dấu `merged` giữ đủ `requirement_sources` (`S7`), và báo cáo kiểm chứng bảo toàn thông tin + Sổ phủ 100% (`S8`).
- [ ] Tải tệp `.docx` và `.pdf` qua API rồi bấm chạy Pipeline trên Worker trích xuất đầy đủ các đoạn văn bản và yêu cầu tương ứng.
