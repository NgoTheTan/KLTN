# Đặc tả Tính năng: Rà soát Yêu cầu, Hỏi đáp Làm rõ & Thuật ngữ (`apps/api/src/modules/requirements`)

## 1. Mục tiêu & Mã Yêu cầu Liên quan
- **Vai trò:** Quản lý toàn bộ vòng đời rà soát và tinh chỉnh của tập yêu cầu chuẩn hoá: truy vấn/lọc đa chiều, chỉnh sửa thủ công có lưu lịch sử phiên bản bất biến (`diff` / `revert`), vận hành **Vòng lặp Hỏi đáp Làm rõ Giai đoạn 5 (`Clarification Loop`)**, cưỡng chế quy tắc nguồn gốc (`origin`), và quản lý **Bảng Thuật ngữ Song ngữ (`Glossary`)**.
- **Mã yêu cầu đặc tả:**
  - `FR-RVW-001`, `FR-RVW-002`: Hiển thị yêu cầu đối chiếu song song với đoạn nguồn gốc (`requirement_sources -> segments`), lọc theo loại, nền tảng, trạng thái, mẫu EARS, cờ ASR, điểm chất lượng và từ khoá.
  - `FR-RVW-003`: Lưu lịch sử phiên bản bất biến (`requirement_versions`) cho mọi chỉnh sửa của pipeline hoặc người dùng; cho phép xem khác biệt (`diff`) và khôi phục (`revert`).
  - `FR-REQ-006`, `FR-REQ-007`, `FR-REQ-008`: Nhóm câu hỏi làm rõ theo chủ đề; khi người dùng trả lời → lưu thành `Segment` truy vết mới và kích hoạt chuẩn hoá lại; khi người dùng bỏ qua (`skip`) → ghi nhận thành giả định tường minh (`origin = 'assumption'`); chặn duyệt (`status = 'approved'`) đối với yêu cầu `origin = 'inferred'` nếu người dùng chưa xác nhận.
  - `FR-REQ-013`, `FR-REQ-015`: Đảm bảo đầy đủ trường EARS/INCOSE và duy trì nhất quán thuật ngữ qua bảng `glossary_terms`.

---

## 2. Ranh giới Module & Quyền sở hữu CSDL
- **Đường dẫn:** `srs-tool/apps/api/src/modules/requirements` (`requirements.module.ts`, `requirements.controller.ts`, `requirements.service.ts`).
- **Bảng CSDL được phép GHI:** `requirements`, `requirement_versions`, `requirement_sources`, `questions`, `glossary_terms`, `segments` *(chỉ các đoạn câu trả lời có `document_id = NULL`)*, và `issues` *(đóng issue sau khi câu hỏi tương ứng đã được giải quyết)*.
- **Phụ thuộc nội bộ:** `DatabaseService`, `QUEUE_PORT` (đẩy job chạy lại từng phần từ `fromStage: 3` hoặc `4` sau khi trả lời câu hỏi).

---

## 3. Hợp đồng REST Endpoints & Luồng Nghiệp vụ Chuẩn (Tiền tố `/api/v1`)

| Phương thức & Đường dẫn | Payload / Query | Response Chuẩn | Quy tắc & Bất biến |
| :--- | :--- | :--- | :--- |
| `GET /projects/:projectId/requirements` | `?type=&platform=&status=&ears_pattern=&is_asr=&origin=&min_quality_score=&search=` | `RequirementWithSources[]` | Kèm mảng `sourceSegments` để UI hiển thị truy vết 2 chiều tức thì. |
| `GET /projects/:projectId/requirements/:id` | — | `RequirementDetail` | Gồm chi tiết yêu cầu + `sources` + danh sách `versions` + `openIssues`. |
| `POST /projects/:projectId/requirements` | `CreateRequirementDto` | `Requirement` | Tạo thủ công mang `origin = 'explicit'`, `changedBy = user.email`, sinh bản chụp `version = 1`. |
| `PATCH /projects/:projectId/requirements/:id` | `Partial<CreateRequirementDto> & { confirm_inferred?: boolean }` | `Requirement` | Tăng `version = max + 1` trong `requirement_versions`. **Nếu yêu cầu đang có `origin === 'inferred'` mà cập nhật `status = 'approved'` nhưng thiếu `confirm_inferred: true` (hoặc chưa sửa nội dung xác nhận), phải từ chối `400` (`FR-REQ-008`)!** Khi xác nhận hợp lệ, chuyển `origin` hoặc ghi dấu xác nhận rõ ràng. |
| `POST /requirements/:id/revert` | `{ projectId, version }` | `Requirement` | Tạo bản chụp phiên bản mới mang nội dung khôi phục từ `version` cũ (không xoá lịch sử trung gian). |
| `GET /requirements/:id/diff` | `?projectId=&v1=&v2=` | `{ v1, v2, changes }` | Liệt kê từng trường thay đổi (`before` vs `after`). |
| `GET /projects/:projectId/questions` | `?status=pending\|answered\|skipped` | `QuestionWithContext[]` | Trả kèm `topicGroup`, `ruleId`, `issue` và `requirement` liên quan để gom nhóm trên UI (`FR-REQ-006`). |
| `POST /questions/:id/answer` | `{ answer?: string, skip?: boolean, autoRerun?: boolean }` | `{ question, updatedRequirementId, rerunJob? }` | Xem luồng chi tiết mục **3.1** bên dưới. |
| `GET /projects/:projectId/glossary` | — | `GlossaryTerm[]` | Danh sách thuật ngữ Việt–Anh của dự án. |
| `POST /projects/:projectId/glossary` | `{ term_vi, term_en, definition }` | `GlossaryTerm` | Chống trùng lặp cặp thuật ngữ trong cùng dự án. |

### 3.1. Luồng Chuẩn Xử lý `POST /questions/:id/answer` (Khắc phục Đứt mạch S5)
1. Đọc câu hỏi `q` từ bảng `questions` và bản ghi `issue` liên kết (`q.issueId`). Nếu không tồn tại → `404`.
2. **Trường hợp 1: Người dùng chọn Bỏ qua (`skip === true` — `FR-REQ-007`):**
   - Cập nhật `questions`: `status = 'skipped'`, `answer = q.proposedValue ?? 'Skipped by user'`.
   - Nếu `issue.requirementId` tồn tại: cập nhật yêu cầu đó sang `origin = 'assumption'`, nối thêm ghi chú giả định vào `rationale` (hoặc điền `q.proposedValue` vào câu nếu có), tạo bản chụp `requirement_versions`, đóng `issue` (`status = 'resolved'`).
   - Nếu `issue.requirementId === null` (lỗ hổng `CHECKLIST-*`): tạo một yêu cầu mới mang `type = 'assumption'`, `origin = 'assumption'`, `statement = q.proposedValue || ...`, đóng `issue`.
3. **Trường hợp 2: Người dùng nhập/chọn Câu trả lời (`skip !== true` — `FR-REQ-006`):**
   - Tạo bản ghi `Segment` mới trong bảng `segments` với **`documentId: null`**, `projectId: q.projectId`, `text: answer`, `locator: { source: 'clarification_answer', questionId: q.id, ruleId: issue?.ruleId }`, `coverageStatus: 'mapped'`, `resolvedBy: 'rule'`.
   - Cập nhật `questions`: `status = 'answered'`, `answer`, `answerSegmentId = newSegment.id`.
   - Đóng `issue` (`status = 'resolved'`).
   - **Nếu câu hỏi gắn với một yêu cầu có sẵn (`issue.requirementId`):**
     - Ghép thông tin làm rõ vào yêu cầu (VD: thay thế từ mơ hồ, bổ sung con số + đơn vị đo vào `statement` / `metric.response_measure`, hoặc chốt con số được chọn trong xung đột `CONFLICT-NUM`), đặt `origin = 'explicit'`, `status = 'classified'`.
     - Chèn dòng `(requirementId, newSegment.id)` vào `requirement_sources` để giữ truy vết đầy đủ!
     - Ghi bản chụp mới vào `requirement_versions` (`changedBy = user`).
     - Nếu `autoRerun !== false`: tạo `Run` mới chạy lại từ `fromStage: 4` (lint lại → chuẩn hoá EARS ở `S6` → kiểm chứng `S8`).
   - **Nếu câu hỏi đến từ lỗ hổng Checklist (`issue.requirementId === null`):**
     - Tạo yêu cầu ứng viên mới (`status = 'candidate'`, `origin = 'explicit'`, `statement = answer`, `statementOriginal = answer`), nối vào `requirement_sources` với `newSegment.id`, và nếu `autoRerun !== false` thì đẩy `Run` chạy từ `fromStage: 3` (phân loại cấp mã → lint → chuẩn hoá EARS).

---

## 4. Thực trạng Code Hiện tại & Các Bug Nghiêm trọng Cần Sửa

### Trạng thái hiện tại (`~55%`)
1. **BUG P0 — Vi phạm khoá ngoại `segments.document_id` làm hỏng toàn bộ `answerQuestion` trên PostgreSQL:**
   - Tại `requirements.service.ts:313–326`, hàm `answerQuestion` chèn `documentId: q.issueId || q.projectId` vào bảng `segments`. Vì `issueId` và `projectId` không tồn tại trong bảng `documents`, PostgreSQL ném lỗi vi phạm FK ngay lập tức, rồi bị khối `catch {}` nuốt mất!
2. **BUG P0 — Câu trả lời làm rõ bị "treo lơ lửng", không bao giờ cập nhật vào Yêu cầu:**
   - Ngay cả khi lưu được `Segment`, code hiện tại trong `answerQuestion` **không hề cập nhật `requirements`**, không nối `requirement_sources`, không đóng `issues` và đẩy `fromStage: 6` trên một yêu cầu vẫn giữ nguyên câu mơ hồ cũ!
3. **BUG P1 — Chưa cưỡng chế quy tắc `origin = 'inferred'` (`FR-REQ-008`):**
   - `update()` hiện cho phép chuyển thẳng bất kỳ yêu cầu `inferred` nào sang `approved` mà không kiểm tra xác nhận.

### Kế hoạch theo Phase
- **Phase 1:**
  - Xoá bỏ các khối `catch {}` rỗng nuốt lỗi SQL khi `db.isConnected === true`.
  - Viết lại hoàn chỉnh `answerQuestion` đúng chuẩn mục **3.1** (dùng `documentId: null` sau khi mở nullable ở `@srs-tool/db`, cập nhật yêu cầu / sinh yêu cầu mới từ checklist, nối `requirement_sources`, đóng `issue` và kích hoạt re-run đúng `fromStage`).
  - Bổ sung kiểm tra `origin` trong `update()` theo `FR-REQ-008` và bổ sung bộ lọc `origin` cho `findAll`.

---

## 5. Tiêu chí Nghiệm thu & Kịch bản Kiểm thử
- [ ] Trả lời một câu hỏi `INCOSE-005` (VD: bổ sung `"dưới 300 ms cho 95% truy vấn"`) trên PostgreSQL thật: tạo thành công `segment` (`document_id = NULL`), nối vào `requirement_sources`, cập nhật nội dung yêu cầu, đóng `issue` và sau khi Worker chạy lại `fromStage: 4`, điểm chất lượng INCOSE của yêu cầu tăng lên và trạng thái đạt `normalized`.
- [ ] Bấm `skip: true` trên một câu hỏi làm rõ chuyển yêu cầu liên quan sang `origin = 'assumption'` và đóng câu hỏi thành `skipped`.
- [ ] Cố gọi `PATCH` đặt `status: 'approved'` cho một yêu cầu đang mang `origin: 'inferred'` mà không truyền `confirm_inferred: true` bị từ chối `400 Bad Request`.
