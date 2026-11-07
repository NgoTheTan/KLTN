# Đặc tả Tính năng: Trợ lý AI Đề xuất Bản vá Kiến trúc (`apps/api/src/modules/agent`)

## 1. Mục tiêu & Mã Yêu cầu Liên quan
- **Vai trò:** Cung cấp trợ lý hội thoại thông minh hỗ trợ người dùng điều chỉnh kiến trúc hệ thống bằng ngôn ngữ tự nhiên (tiếng Việt / tiếng Anh). Để đảm bảo an toàn tuyệt đối và tính toàn vẹn của mô hình, Agent hoạt động theo nguyên tắc **Chỉ-Đề-Xuất-Bản-Vá (`Patch-Only Agent`)**: chỉ được dùng các công cụ đọc ngữ cảnh, sinh ra một `ModelPatch` hợp lệ kèm bản xem trước SVG nháp, và chờ người dùng bấm **Chấp nhận (`accept`)** hoặc **Từ chối (`reject`)**.
- **Mã yêu cầu đặc tả:**
  - `FR-AGT-001`: Hiểu yêu cầu chỉnh sửa kiến trúc bằng tiếng Việt hoặc tiếng Anh tự nhiên.
  - `FR-AGT-002`, `NFR-SEC-003`: Agent **tuyệt đối không được ghi trực tiếp** vào `arch_models` hay CSDL; mọi đề xuất thay đổi bắt buộc đóng gói thành `ModelPatch` kiểm chứng qua `ModelPatchSchema`.
  - `FR-AGT-003`: Trả về tóm tắt các thao tác thay đổi + ảnh SVG nháp (render trên bản sao tạm trong bộ nhớ) để người dùng xem trước rồi bấm `accept` hoặc `reject`.
  - `FR-AGT-005`: Giới hạn cứng số bước suy luận/tool-call (tối đa **3 vòng**) và trần token mỗi lượt chat (tối đa **4.000 tokens**) để chống vòng lặp vô hạn.

---

## 2. Ranh giới Module & Quyền sở hữu CSDL
- **Đường dẫn:** `srs-tool/apps/api/src/modules/agent` (`agent.module.ts`, `agent.controller.ts`, `agent.service.ts`).
- **Bảng CSDL được phép GHI:** `agent_sessions`, `agent_patches`.
- **Phụ thuộc nội bộ:** `ArchitectureService` (đọc model hiện tại, thử nghiệm `CommandParser` 0-token trước, và gọi `applyPatch` duy nhất khi người dùng bấm `accept`), `RequirementsService` (tra cứu yêu cầu liên quan), `RENDER_PORT` (render SVG xem trước cho bản nháp), `UsageService`, và `LlmGateway` (ở Phase 3).

---

## 3. Hợp đồng REST Endpoints & Luồng Xử lý (Tiền tố `/api/v1`)

| Phương thức & Đường dẫn | Payload | Response Chuẩn | Quy tắc Nghiệp vụ |
| :--- | :--- | :--- | :--- |
| `POST /agent/sessions` | `{ projectId: UUID }` | `{ id, projectId, userId, createdAt }` | Kiểm tra `projectId` tồn tại và thuộc quyền sở hữu của `req.user.id`. |
| `GET /agent/sessions/:id` *(Mới Phase 1)* | — | `{ session, patches }` | Lấy lịch sử các bản vá `pending`/`accepted`/`rejected` của phiên để hiển thị lại trên Sidebar. |
| `POST /agent/sessions/:id/messages` | `{ message: string }` | `{ reply, patchRecord?: { id, status: 'pending', patch, summary, previewSvg }, resolvedBy: 'rule' \| 'llm' }` | Xem luồng 4 bước mục **3.1**. |
| `POST /agent/patches/:id/accept` | — | `{ patchId, status: 'accepted', updatedModel }` | Kiểm tra `patch.status === 'pending'`, gọi `ArchitectureService.applyPatch(modelId, patch)` (có kiểm tra `expected_version`), cập nhật `agent_patches.status = 'accepted'`. |
| `POST /agent/patches/:id/reject` | `{ reason?: string }` | `{ patchId, status: 'rejected' }` | Đánh dấu `agent_patches.status = 'rejected'`, giữ nguyên 100% `ArchitectureModel` hiện tại. |

### 3.1. Luồng Xử lý Tin nhắn Ưu tiên Tiết kiệm Token (`sendMessage`)
1. **Tra cứu Phiên (`agent_sessions`):** Đọc đúng bản ghi `session` theo `sessionId` từ PostgreSQL để lấy `session.projectId`. Nếu không tồn tại → ném `404 Not Found` (tuyệt đối không lấy `sessionId` truyền nhầm làm `projectId`!).
2. **Bậc 0 — Thử Khớp Lệnh Cố định / Mẫu Chiến thuật Cục bộ (0 LLM token):**
   - Thử đưa `message` qua `CommandParser` hoặc bộ nhận diện mẫu kiến trúc song ngữ mở rộng (thêm/xoá thành phần, thêm Redis cache, thêm hàng đợi Kafka/RabbitMQ, thêm CDN, thêm cổng thanh toán/thông báo, thêm dịch vụ OTA...).
   - Nếu khớp rõ ràng → tạo ngay `ModelPatch` với `resolvedBy: 'rule'` và **không ghi nhận bất kỳ token LLM nào** vào `usage_ledger`!
3. **Bậc 2 — Gọi `LlmGateway` với Read-Only Tools (Phase 3):**
   - Khi câu yêu cầu phức tạp/tự do và hệ thống có cấu hình LLM + còn quota: cung cấp cho mô hình danh sách tóm tắt các phần tử của `ArchitectureModel` hiện hành + tối đa 3 lượt gọi công cụ chỉ-đọc (`search_requirements`, `get_tech_catalog_options`), ép đầu ra cuối cùng theo `AgentResponseSchema` (`{ reply, operations }`), giới hạn `maxOutputTokens: 1500`.
4. **Kiểm chứng Bản sao Nháp & Tạo Xem trước SVG (`FR-AGT-003`):**
   - Áp thử `ModelPatch` lên một **bản sao sâu (`structuredClone(currentModel)`) trong RAM** (không ghi vào `arch_models`):
     - Nếu bản sao vi phạm schema hoặc sinh quan hệ treo → từ chối/sửa trước khi trả về.
     - Sinh mã PlantUML Container từ bản sao nháp bằng `generateContainerDiagram(draftModel)` và gọi `renderPort.renderSvg(...)` để lấy `previewSvg`.
   - Lưu bản vá vào bảng `agent_patches` (`status = 'pending'`) và trả về cho người dùng duyệt.

---

## 4. Thực trạng Code Hiện tại & Các Bug Nghiêm trọng Cần Sửa

### Trạng thái hiện tại (`~45%`)
1. **BUG P0 — Truyền nhầm `sessionId` vào tham số `projectId`:**
   - Tại `agent.service.ts:57`, khi không tìm thấy `session` trong `memSessions` (do vừa khởi động lại server hoặc chạy nhiều request), hàm gọi `await this.createSession(sessionId, userId)` — truyền `sessionId` vào vị trí của `projectId`! Sau đó truy vấn kiến trúc theo `projectId = sessionId` luôn thất bại hoặc vi phạm khoá ngoại `projects.id`.
2. **BUG P0 — Lỗi cột `session_id` trên bảng `agent_patches`:**
   - Kết hợp với lỗi `sessionId` vs `session_id` trong SQL migration, không một bản ghi `agent_patches` nào lưu được xuống PostgreSQL (đều bị `catch {}` nuốt mất).
3. **BUG P1 — Ghi khống Token LLM giả lập (`gpt-4o-mini`):**
   - Trong `agent.service.ts`, mặc dù mới chỉ chạy `if/else` bắt từ khoá cục bộ, code lại gọi `usageService.recordActual(..., 'gpt-4o-mini', ...)` làm sai lệch sổ cái hạn ngạch token (`usage_ledger`) của người dùng!

### Kế hoạch theo Phase
- **Phase 1:**
  - Sửa `sendMessage` đọc `agent_sessions` và `agent_patches` thật từ PostgreSQL (sau khi sửa cột `session_id`), trả `404` chuẩn nếu `sessionId` không tồn tại.
  - Bỏ hoàn toàn việc ghi khống token `gpt-4o-mini` khi xử lý bằng luật Bậc 0.
  - Tích hợp `CommandParser` + mở rộng bộ mẫu chiến thuật cục bộ song ngữ Việt/Anh để ngay ở chế độ `Eco` (Phase 1 & 2) người dùng đã có thể yêu cầu thêm/sửa/xoá thành phần kiến trúc và duyệt `previewSvg` mượt mà.
  - Thêm endpoint `GET /agent/sessions/:id` lấy lịch sử phiên.
- **Phase 3:**
  - Nối `LlmGateway` với giới hạn cứng `maxSteps = 3`, `maxTokens = 4000` và bộ công cụ chỉ-đọc cho các câu hội thoại tự do phức tạp.

---

## 5. Tiêu chí Nghiệm thu & Kịch bản Kiểm thử
- [ ] Tạo phiên `POST /agent/sessions` → gửi yêu cầu `"Thêm Redis cache đứng trước PostgreSQL cho API"` → lưu bản ghi thật vào `agent_patches` (`status = 'pending'`), trả về `previewSvg` có khối Redis mới, nhưng `GET /projects/:id/architecture` vẫn giữ `version` cũ chưa bị sửa!
- [ ] Bấm `POST /agent/patches/:id/accept` làm `ArchitectureModel.version` tăng thêm `1` và sơ đồ chính thức có thêm phần tử Redis; nếu bấm `reject` thì `ArchitectureModel` giữ nguyên không đổi.
- [ ] Khi chạy bằng bộ xử lý Bậc 0 (không gọi LLM thật), `usage_ledger` không phát sinh dòng chi tiêu giả nào.
