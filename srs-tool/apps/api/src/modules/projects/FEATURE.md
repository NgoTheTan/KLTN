# Đặc tả Tính năng: Quản lý Dự án, Sổ phủ, Checklist & Tiến trình Chạy (`apps/api/src/modules/projects`)

## 1. Mục tiêu & Mã Yêu cầu Liên quan
- **Vai trò:** Trung tâm điều phối cấp Dự án (`Project`): quản lý thông tin dự án & nền tảng mục tiêu (`web`, `mobile`, `iot`), tổng hợp báo cáo **Sổ phủ (`CoverageReport`)**, đối chiếu **Checklist nền tảng** từ `@srs-tool/knowledge`, khởi chạy/theo dõi SSE/nâng bậc (`escalate`) các **Tiến trình Pipeline (`Runs`)**, và kiểm soát cổng **Khoá Mốc Yêu cầu (`Baseline Lock`)**.
- **Mã yêu cầu đặc tả:**
  - `FR-ACC-002`, `FR-ACC-004`, `NFR-PRIV-002`: Quản lý vòng đời dự án theo chủ sở hữu; xoá dự án xoá sạch toàn bộ tài liệu, đoạn nguồn, yêu cầu, sơ đồ và tệp lưu trữ liên quan (`ON DELETE CASCADE` + xoá tệp vật lý).
  - `FR-ING-006`, `FR-REQ-010`, `FR-REQ-011`, `NFR-QUAL-003..004`: Báo cáo độ phủ từng đoạn nguồn và chặn duyệt khoá mốc khi còn đoạn `unresolved` hoặc `unmapped`.
  - `FR-REQ-008`: Chặn duyệt khoá mốc nếu còn yêu cầu `origin = 'inferred'` chưa được người dùng xác nhận tường minh.
  - `FR-ARC-002`, `FR-ARC-006..007`: Hiển thị trạng thái đủ/thiếu của từng mục checklist nền tảng và cho phép đánh dấu `not_applicable` có lý do.
  - `FR-REQ-017`, `FR-RVW-007`, `NFR-LLM-002..003`, `NFR-PERF-003`: Khởi chạy pipeline (`eco`, `standard`, `thorough`), phát SSE tiến độ thực, thống kê tỷ lệ quyết định theo 3 bậc (`rule`, `local`, `llm`) và chạy bù các mục `pending_llm` (`escalate`).

---

## 2. Ranh giới Module & Quyền sở hữu CSDL
- **Đường dẫn:** `srs-tool/apps/api/src/modules/projects` (`projects.module.ts`, `projects.controller.ts`, `projects.service.ts`).
- **Bảng CSDL được phép GHI:** `projects`, `runs`, `issues` *(riêng các dòng trạng thái `not_applicable` của checklist)*.
- **Bảng CSDL được phép ĐỌC để tổng hợp báo cáo:** `documents`, `segments`, `requirements`, `requirement_sources`, `issues`, `questions`, `decision_log`.
- **Phụ thuộc nội bộ:** `DatabaseService`, `QUEUE_PORT`, `STORAGE_PORT`, `@srs-tool/knowledge`, `@srs-tool/schemas`.

---

## 3. Hợp đồng REST Endpoints (Tiền tố `/api/v1`)

| Phương thức & Đường dẫn | Request / Params | Response Chuẩn | Bất biến & Quy tắc Nghiệp vụ |
| :--- | :--- | :--- | :--- |
| `POST /projects` | `{ name, platforms, outputLanguage?, constraints? }` | `Project` | `platforms` phải có ít nhất 1 giá trị thuộc `['web','mobile','iot','shared']`. |
| `GET /projects` | — | `Project[]` | Chỉ trả về các dự án có `ownerId === req.user.id`. |
| `GET /projects/:id` | `id: UUID` | `Project & { counts }` | Kiểm tra quyền sở hữu `ownerId === req.user.id` (`403`/`404` nếu khác). |
| `PATCH /projects/:id` | `Partial<CreateProjectDto>` | `Project` | Kiểm tra quyền sở hữu. |
| `DELETE /projects/:id` | `id: UUID` | `{ deleted: true }` | Xoá các tệp vật lý trong `StoragePort` thuộc `documents` & `exports` của dự án trước khi xoá dòng `projects` (`FR-ACC-004`). |
| `GET /projects/:id/coverage` | `id: UUID` | `CoverageReport & { segments }` | Lọc chặt `requirement_sources` theo danh sách `segment.id` của chính `projectId`. Đảm bảo `mapped + not_requirement + unresolved + unmapped === total_segments`. |
| `GET /projects/:id/checklist` | `id: UUID` | `ChecklistItemStatus[]` | Nạp trực tiếp từ `loadCombinedChecklist(project.platforms)` của `@srs-tool/knowledge` (tự gồm cả `shared.yaml`). |
| `PATCH /projects/:id/checklist/:itemId` | `{ not_applicable: boolean, reason?: string }` | `{ itemId, status, reason }` | Lưu/cập nhật bảng `issues` với `id = crypto.randomUUID()` (tra cứu dòng hiện có theo `(projectId, ruleId = 'CHECKLIST:' + itemId)`). **Cấm truyền chuỗi `'iss_chk_...'` vào cột UUID!** |
| `POST /projects/:id/lock-baseline` *(Mới Phase 1)* | — | `{ locked: true, lockedAt }` hoặc `409 Conflict` | **Chặn `409`** kèm danh sách chi tiết nếu: (1) `unresolved > 0 || unmapped > 0`, (2) còn câu hỏi `pending` mức `error`, hoặc (3) còn yêu cầu `origin === 'inferred'` chưa được người dùng duyệt xác nhận (`FR-REQ-008`, `FR-REQ-011`). |
| `POST /projects/:id/runs` | `{ mode?: 'eco'\|'standard'\|'thorough', from_stage?: 1..8 }` | `Run` | Tạo bản ghi `runs` (`status = 'queued'`) và đẩy job vào hàng đợi `pipeline` của `QUEUE_PORT`. |
| `GET /runs/:id` | `id: UUID` | `Run` | Trả trạng thái, `progress` (`0..100`) và `errorMessage` nếu có. |
| `GET /runs/:id/events` | SSE Stream | `Observable<MessageEvent>` | Phát sự kiện tiến độ thời gian thực; gửi ngay trạng thái hiện tại lúc vừa mở kết nối để tránh race condition nếu job đã xong nhanh. |
| `GET /runs/:id/decisions` | `id: UUID` | `{ summaryByStage, byTierPct, logs }` | Báo cáo tỷ lệ % quyết định ở từng bậc `rule`, `local`, `llm` cho từng giai đoạn (`NFR-LLM-003`). |
| `POST /runs/:id/escalate` | `id: UUID` | `Run` | Tạo job nâng bậc (`escalate: true`, `mode: 'standard'`) chỉ xử lý tiếp các mục đang mang trạng thái `pending_llm` / `needs_review`, **không xoá kết quả `S1/S2` đã làm**. |
| `POST /runs/:id/cancel` *(Mới Phase 1)* | `id: UUID` | `Run` | Đánh dấu `status = 'cancelled'` để Worker dừng an toàn ở ranh giới giai đoạn kế tiếp (`FR-RVW-007`). |

---

## 4. Thực trạng Code Hiện tại & Các Bug Nghiêm trọng Cần Sửa

### Trạng thái hiện tại (`~60%`)
1. **BUG P0 — Truyền chuỗi phi-UUID `'iss_chk_...'` vào cột `issues.id`:**
   - Tại `projects.service.ts:319–340`, `updateChecklistItem` gán `const issueId = 'iss_chk_' + projectId + '_' + itemId` rồi `db.insert(issues).values({ id: issueId, ... })`. PostgreSQL từ chối ngay vì `issues.id` là kiểu `UUID`, nhưng khối `catch {}` rỗng ở dòng 341 đã nuốt mất lỗi này!
2. **BUG P0 — Truy vấn toàn bảng `SELECT * FROM requirement_sources` không lọc dự án:**
   - Tại `projects.service.ts:191`, `getCoverage` gọi `await this.db.db.select().from(schema.requirementSources)` không có mệnh đề `WHERE` / `inArray`, gây rò rỉ hiệu năng và kéo toàn bộ bảng nối của mọi dự án vào bộ nhớ.
3. **BUG P1 — Trùng lặp mảng Checklist cứng (`SHARED_CHECKLIST`):**
   - `projects.service.ts` đang khai báo mảng checklist dùng chung cứng trong code thay vì đọc thống nhất từ `packages/knowledge/profiles/shared.yaml` qua `loadCombinedChecklist`.
4. **BUG P1 — Thiếu kiểm tra chủ sở hữu dự án (`ownerId`) & thiếu cổng `lockBaseline` / `cancelRun`:**
   - `findOne`, `update`, `delete`, `getCoverage`, `getChecklist`, `startRun` hiện chỉ nhận `projectId` mà chưa đối chiếu `project.ownerId === userId`.
   - Chưa có hàm kiểm tra điều kiện khoá mốc (`FR-REQ-011`, `FR-REQ-008`) và huỷ lần chạy (`FR-RVW-007`).

### Kế hoạch theo Phase
- **Phase 1:**
  - Xoá mọi khối `catch {}` rỗng nuốt lỗi SQL khi `this.db.isConnected === true`.
  - Sửa `updateChecklistItem` tra cứu theo `and(eq(issues.projectId, projectId), eq(issues.ruleId, ruleId))` và sinh `crypto.randomUUID()` khi tạo mới.
  - Sửa `getCoverage` dùng `inArray(requirementSources.segmentId, segIds)` (chỉ truy vấn khi `segIds.length > 0`).
  - Xoá checklist hardcode, dùng duy nhất `loadCombinedChecklist(project.platforms)` từ `@srs-tool/knowledge`.
  - Bổ sung kiểm tra `assertProjectOwner(projectId, userId)` cùng 2 endpoint `POST /projects/:id/lock-baseline` và `POST /runs/:id/cancel`.

---

## 5. Tiêu chí Nghiệm thu & Kịch bản Kiểm thử
- [ ] Đánh dấu một mục checklist là `not_applicable` ghi thành công dòng hợp lệ vào bảng `issues` trên PostgreSQL thật (không rơi vào `catch`), tải lại `GET /projects/:id/checklist` vẫn giữ nguyên trạng thái `not_applicable`.
- [ ] Gọi `POST /projects/:id/lock-baseline` khi dự án còn 1 đoạn `unresolved` hoặc còn 1 yêu cầu `origin = 'inferred'` chưa xác nhận sẽ nhận `409 Conflict` kèm thông báo chỉ rõ mục nào đang chặn.
- [ ] Người dùng B gọi `GET /api/v1/projects/<id_cua_user_A>` nhận `403 Forbidden` hoặc `404 Not Found`.
