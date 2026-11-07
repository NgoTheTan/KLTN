# Đặc tả Tính năng: Tầng Cơ sở Dữ liệu & Cô lập Đa người dùng (`@srs-tool/db`)

## 1. Mục tiêu & Mã Yêu cầu Liên quan
- **Vai trò:** Định nghĩa lược đồ **Drizzle ORM** cho 19 bảng trên PostgreSQL 16 + `pgvector(384)`, quản lý script SQL khởi tạo/di trú (`migrations/0000_initial_schema.sql` và đồng bộ với `docker/init.sql`), cung cấp connection pool và hàm thực thi giao dịch có ngữ cảnh **Row-Level Security (`withProjectContext`)**.
- **Mã yêu cầu đặc tả:**
  - `FR-ACC-002`, `NFR-SEC-002`: Cô lập hoàn toàn dữ liệu giữa những người dùng khác nhau bằng PostgreSQL Row-Level Security (RLS).
  - `FR-ING-006`, `FR-REQ-009`, `FR-RVW-003`: Lưu vết bất biến `segments`, bảng nối nhiều-nhiều `requirement_sources` và lịch sử phiên bản `requirement_versions`.
  - `FR-REQ-006..008`: Lưu câu hỏi làm rõ (`questions`) và nối câu trả lời về một `segment` (`answer_segment_id`).
  - `FR-ADM-001`, `NFR-OBS-001`, `NFR-LLM-003`: Sổ cái hạn ngạch `usage_ledger` và nhật ký quyết định `decision_log`.

---

## 2. Cấu trúc Thư mục & Phụ thuộc
- **Đường dẫn:** `srs-tool/packages/db`
  - `src/schema.ts`: Khai báo 19 bảng Drizzle ORM, chỉ mục (`index`), khoá chính tổng hợp (`primaryKey`), kiểu vector `vector('embedding', { dimensions: 384 })` và `relations`.
  - `src/connection.ts`: `createDbPool`, `createDb`, `runMigrations` và `withProjectContext`.
  - `src/index.ts`: Điểm xuất công khai của package.
  - `migrations/0000_initial_schema.sql`: DDL khởi tạo bảng, chỉ mục và RLS Policies (phải luôn đồng bộ 100% với `srs-tool/docker/init.sql`).
- **Phụ thuộc cho phép:** `drizzle-orm`, `pg`. Không import các package nghiệp vụ ở tầng trên.

---

## 3. Lược đồ 19 Bảng & Quy tắc Toàn vẹn

### 3.1. Danh sách 19 Thực thể
1. `users`: Hồ sơ người dùng, `locale`, `plan`, `daily_limit_tokens` (mặc định `100000`).
2. `projects`: Dự án, `owner_id -> users.id`, `platforms` (`jsonb`), `output_language`, `constraints` (`jsonb`).
3. `documents`: Siêu dữ liệu tệp gốc bất biến (`s3_key`, `sha256`, `kind`, `mime_type`, `size_bytes`).
4. `segments`: Đoạn văn bản nguồn (`document_id -> documents.id` **nullable**, `project_id -> projects.id`, `ordinal`, `text`, `locator`, `coverage_status`, `resolved_by`).
   - **Bất biến quan trọng:** Khi đoạn văn bản đến từ tệp tải lên, `document_id` khác `NULL`. Khi đoạn văn bản sinh ra từ câu trả lời làm rõ của người dùng ở `S5`, `document_id` bằng `NULL`. Khi chạy lại `S1`, Worker chỉ được xoá các dòng có `document_id IS NOT NULL`!
5. `requirements`: Yêu cầu chuẩn hoá (`code`, `type`, `platforms`, `ears_pattern`, `statement`, `statement_original`, `origin`, `status`, `quality_score`, `resolved_by`, `confidence`, `embedding vector(384)`).
6. `requirement_versions`: PK `(requirement_id, version)`, bản chụp `snapshot` (`jsonb`) bất biến, `changed_by` (`'pipeline' | 'user' | 'agent'`), `run_id`.
7. `requirement_sources`: PK `(requirement_id, segment_id)`, `quote` — cầu nối truy vết 2 chiều giữa yêu cầu và đoạn nguồn.
8. `issues`: Lỗi phát hiện từ `S4` hoặc kiểm tra ngược `S8` (`kind`, `rule_id`, `severity`, `status`).
9. `questions`: Câu hỏi làm rõ sinh ở `S5` (`project_id`, `issue_id`, `topic_group`, `rule_id`, `text`, `options`, `proposed_value`, `answer`, `answer_segment_id`, `status`).
10. `glossary_terms`: Từ điển thuật ngữ song ngữ (`term_vi`, `term_en`, `definition`).
11. `arch_models`: Mô hình kiến trúc JSON (`project_id`, `version`, `language`, `body`).
12. `diagrams`: Mã `.puml` và khoá cache SVG (`model_id`, `type`, `mode`, `puml`, `svg_s3_key`).
13. `tech_recommendations`: Đề xuất công nghệ chấm điểm cho từng tầng (`model_id`, `layer`, `choice`, `alternatives`, `rationale`).
14. `runs`: Tiến trình chạy nền (`project_id`, `kind`, `mode`, `from_stage`, `status`, `progress`, `error_message`).
15. `usage_ledger`: Giao dịch token (`user_id`, `run_id`, `kind` = `'reserve' | 'actual' | 'refund'`, `input_tokens`, `output_tokens`, `model`, `cost_usd`).
16. `exports`: Yêu cầu xuất gói tài liệu (`project_id`, `formats`, `s3_key`, `status`, `expires_at`).
17. `agent_sessions`: Phiên hội thoại với AI Agent (`project_id`, `user_id`).
18. `agent_patches`: Đề xuất bản vá của Agent (`session_id -> agent_sessions.id`, `model_id -> arch_models.id`, `patch`, `status`, `reason`).
19. `decision_log`: Nhật ký bậc quyết định (`run_id`, `stage`, `subject_type`, `subject_id`, `tier`, `confidence`, `version`, `status`).

### 3.2. Quy tắc Row-Level Security (RLS)
- Biến ngữ cảnh phiên giao dịch PostgreSQL:
  - `SET LOCAL app.current_user_id = '<uuid>'`
  - `SET LOCAL app.current_project_id = '<uuid>'`
- **Bất biến RLS:** Mọi bảng được bật `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` **bắt buộc phải có `CREATE POLICY` tương ứng** (nếu bật RLS mà không có policy, PostgreSQL mặc định chặn 100% truy cập của mọi DB role không có cờ `BYPASSRLS`).
  - Các bảng gắn trực tiếp `project_id` (`documents`, `segments`, `requirements`, `issues`, `questions`, `glossary_terms`, `arch_models`, `runs`, `exports`, `agent_sessions`): kiểm tra `project_id = NULLIF(current_setting('app.current_project_id', true), '')::uuid` hoặc thuộc dự án có `owner_id = current_user_id`.
  - Các bảng con gián tiếp (`requirement_versions`, `requirement_sources`, `diagrams`, `tech_recommendations`, `agent_patches`, `decision_log`): kiểm tra `EXISTS (...)` qua bảng cha thuộc `current_project_id` / `current_user_id`.
  - Bảng `usage_ledger`: kiểm tra `user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid`.

---

## 4. Thực trạng Code Hiện tại & Các Bug Nghiêm trọng Cần Sửa

### Trạng thái hiện tại (`~75%`)
1. **BUG P0 — Lệch tên cột `agent_patches.session_id`:**
   - Trong `migrations/0000_initial_schema.sql` (dòng 247) và `docker/init.sql` (dòng 247), cột được viết là `sessionId UUID` không đặt trong dấu ngoặc kép, khiến PostgreSQL tạo cột tên `sessionid`. Trong khi đó `src/schema.ts` (dòng 353) ánh xạ `uuid('session_id')` → Gây lỗi SQL `column "session_id" does not exist` ngay khi thao tác với `agent_patches`.
2. **BUG P0 — `segments.document_id` đang `NOT NULL`:**
   - Cả `src/schema.ts` (dòng 69–71) và SQL migration đều đặt `document_id UUID NOT NULL REFERENCES documents(id)`. Khi người dùng trả lời câu hỏi làm rõ ở `RequirementsService.answerQuestion`, hệ thống cố chèn `q.issueId` vào `document_id` và bị lỗi vi phạm khoá ngoại `FK`.
3. **BUG P0 — Bật RLS trên 18 bảng nhưng bỏ quên Policy trên 10 bảng:**
   - Dòng 274–291 của `0000_initial_schema.sql` bật RLS cho 18 bảng nhưng chỉ khai báo policy cho 8 bảng; 10 bảng còn lại (`requirement_versions`, `requirement_sources`, `glossary_terms`, `diagrams`, `tech_recommendations`, `exports`, `agent_sessions`, `agent_patches`, `decision_log`, `usage_ledger`) bị thiếu policy hoàn toàn.
4. **Thiếu cột nhóm câu hỏi ở bảng `questions`:**
   - Cần bổ sung `topic_group TEXT` và `rule_id TEXT` vào `questions` để phục vụ gom nhóm câu hỏi làm rõ theo chủ đề (`FR-REQ-006`).

### Kế hoạch theo Phase
- **Phase 1:**
  - Sửa `src/schema.ts`: bỏ `.notNull()` trên `segments.documentId`; thêm `topicGroup: text('topic_group')` và `ruleId: text('rule_id')` vào `questions`.
  - Sửa `migrations/0000_initial_schema.sql` và đồng bộ sang `docker/init.sql`:
    - Đổi `sessionId` thành `session_id` trong `CREATE TABLE IF NOT EXISTS agent_patches`.
    - Bỏ `NOT NULL` ở `segments.document_id`; thêm cột `topic_group`, `rule_id` vào `questions`.
    - Thêm khối `DO $$ ... $$` idempotent để tự động nâng cấp các CSDL Docker đã khởi tạo sẵn (`RENAME COLUMN sessionid TO session_id`, `ALTER COLUMN document_id DROP NOT NULL`, `ADD COLUMN IF NOT EXISTS topic_group`, `ADD COLUMN IF NOT EXISTS rule_id`).
    - Bổ sung đầy đủ `DROP POLICY IF EXISTS ...; CREATE POLICY ...` cho toàn bộ 18 bảng bật RLS.
- **Phase 4:**
  - Thêm chỉ mục HNSW/IVFFlat trên `requirements.embedding` (`USING hnsw (embedding vector_cosine_ops)`) khi kích hoạt truy vấn tương đồng `pgvector` của Tier 1.
  - Bắt buộc các thao tác truy vấn nhạy cảm của API đi qua `withProjectContext(pool, userId, projectId, fn)`.

---

## 5. Tiêu chí Nghiệm thu & Kịch bản Kiểm thử
- [ ] Chạy `runMigrations(pool)` hai lần liên tiếp trên cùng một CSDL PostgreSQL đều thành công (idempotent 100%, không quăng lỗi trùng policy hay trùng cột).
- [ ] Chèn được bản ghi `segments` có `documentId: null` và nối thành công với `questions.answerSegmentId` + `requirement_sources`.
- [ ] Chèn và đọc được bản ghi `agent_patches` qua Drizzle ORM mà không gặp lỗi `session_id`.
- [ ] Mọi bảng có `rowsecurity = true` trong `pg_tables` đều có ít nhất 1 policy trong `pg_policies`.
