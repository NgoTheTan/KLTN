# Đặc tả Tính năng: Quản lý Hạn ngạch Token & Ngân sách (`apps/api/src/modules/usage`)

## 1. Mục tiêu & Mã Yêu cầu Liên quan
- **Vai trò:** Kế toán trung tâm cho mọi chi tiêu token LLM của từng người dùng và toàn hệ thống theo chu kỳ **ngày UTC (`00:00:00Z → 23:59:59Z`)**. Hỗ trợ cơ chế kế toán 3 bước (`reserve` giữ chỗ trước khi chạy → `actual` ghi nhận thực tế → `refund` hoàn trả phần dư) và cầu chì ngắt mạch khi tổng chi phí ngày vượt ngân sách chủ sản phẩm.
- **Mã yêu cầu đặc tả:**
  - `FR-ACC-005`: Người dùng xem được hạn mức token trong ngày (`daily_limit_tokens`), lượng đã dùng (`used_tokens`), lượng còn lại (`remaining_tokens`) và thời điểm đặt lại (`resets_at`).
  - `FR-ADM-001`: Giới hạn token/ngày theo từng người dùng, chặn gọi LLM khi vượt hạn mức.
  - `FR-ADM-002`: Ghi sổ chi tiết từng giao dịch vào `usage_ledger` gắn với `user_id`, `run_id`, `model`, `input_tokens`, `output_tokens`, `cost_usd`.
  - `FR-ADM-003`: Cầu chì ngân sách ngày toàn hệ thống (`GLOBAL_DAILY_BUDGET_USD`); khi chạm trần, tự động hạ mọi tác vụ về chế độ `eco` (luật + mô hình cục bộ, 0 LLM token) thay vì làm sập hệ thống (`NFR-LLM-002`).

---

## 2. Ranh giới Module & Quyền sở hữu CSDL
- **Đường dẫn:** `srs-tool/apps/api/src/modules/usage` (`usage.module.ts`, `usage.controller.ts`, `usage.service.ts`).
- **Bảng CSDL được phép GHI:** Duy nhất bảng `usage_ledger`.
- **Bảng CSDL được phép ĐỌC:** `users` (đọc cột `daily_limit_tokens`), `usage_ledger`.
- **Triển khai giao diện:** `UsageService` cài đặt trực tiếp interface `UsageRecorder` của `@srs-tool/llm` để truyền vào `LlmGateway`.

---

## 3. Hợp đồng REST Endpoints & Công thức Kế toán (Tiền tố `/api/v1`)

| Phương thức & Đường dẫn | Guard | Response Chuẩn | Ghi chú |
| :--- | :---: | :--- | :--- |
| `GET /me/usage` | `JwtAuthGuard` *(Bắt buộc!)* | `Usage` (`{ user_id, daily_limit_tokens, used_tokens, remaining_tokens, resets_at, global_budget_tripped }`) | Tính toán trong cửa sổ ngày UTC hiện tại. |
| `GET /me/usage/ledger` | `JwtAuthGuard` *(Bắt buộc!)* | `UsageLedgerEntry[]` | Tối đa 100 giao dịch gần nhất của `req.user.id`, sắp xếp `createdAt DESC`. |

### Công thức Tính Hạn ngạch Chuẩn trong Ngày UTC
1. **Mốc thời gian:**
   - `startOfTodayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0))`
   - `resetsAt = new Date(startOfTodayUtc.getTime() + 86_400_000).toISOString()`
2. **Đọc hạn mức cá nhân:**
   - Lấy `user.dailyLimitTokens` từ bảng `users` (fallback `100_000` chỉ khi chạy offline test không có DB).
3. **Tính `used_tokens` từ các dòng `usage_ledger` có `created_at >= startOfTodayUtc`:**
   - Với mỗi dòng: `totalRowTokens = inputTokens + outputTokens`.
   - Cộng các dòng `kind === 'actual'` và các dòng `kind === 'reserve'` (đang giữ chỗ chưa quyết toán), trừ đi các dòng `kind === 'refund'`:
     `used_tokens = Math.max(0, sum(actual) + sum(reserve) - sum(refund))`.
   - `remaining_tokens = Math.max(0, daily_limit_tokens - used_tokens)`.
4. **Kiểm tra Cầu chì Ngân sách Toàn hệ thống (`isGlobalBudgetTripped()`):**
   - Tính `SELECT COALESCE(SUM(cost_usd), 0) FROM usage_ledger WHERE kind = 'actual' AND created_at >= startOfTodayUtc`.
   - Nếu tổng chi phí `>= Number(process.env.GLOBAL_DAILY_BUDGET_USD ?? 10)` → trả `true` để `QuotaGuard` / `LlmGateway` tự chuyển về chế độ `eco`.

---

## 4. Thực trạng Code Hiện tại & Các Bug Nghiêm trọng Cần Sửa

### Trạng thái hiện tại (`~50%`)
1. **BUG Bảo mật P0 — `UsageController` quên gắn `@UseGuards(JwtAuthGuard)`:**
   - Trong `usage.controller.ts` (dòng 3 & 5–7), `JwtAuthGuard` được import ở đầu file nhưng **không được gắn vào `@UseGuards(...)`**, khiến `req.user` luôn là `undefined` và mọi request đều rơi về UUID cứng `00000000-0000-0000-0000-000000000001`!
2. **BUG Nghiệp vụ P0 — Cộng dồn token vĩnh viễn không lọc theo ngày UTC:**
   - Tại `usage.service.ts:34–45`, `getCurrentUsage` lấy toàn bộ các dòng `usage_ledger` từ lúc tạo tài khoản mà không có điều kiện `gte(usageLedger.createdAt, startOfTodayUtc)`, khiến quota ngày không bao giờ được đặt lại sau 00:00 UTC!
3. **BUG Nghiệp vụ P1 — Bỏ qua `reserve`, hardcode `100_000` và thiếu kiểm tra ngân sách toàn cục:**
   - `getCurrentUsage` không đọc `users.dailyLimitTokens`, bỏ qua các bản ghi `kind = 'reserve'` (cho phép bắn 10 request song song vượt trần trước khi request đầu tiên kịp ghi `actual`), và chưa có hàm kiểm tra `GLOBAL_DAILY_BUDGET_USD`.

### Kế hoạch theo Phase
- **Phase 1:**
  - Gắn `@UseGuards(JwtAuthGuard)` lên `UsageController`.
  - Sửa `getCurrentUsage` lọc đúng `createdAt >= startOfTodayUtc`, đọc `dailyLimitTokens` từ bảng `users`, tính đủ `actual + reserve - refund` và bổ sung hàm `isGlobalBudgetExceeded()`.
  - Xoá các khối `catch {}` nuốt lỗi SQL khi `db.isConnected === true`.
- **Phase 3:**
  - Kết nối `UsageService` làm `UsageRecorder` chính thức cho `LlmGateway` ở cả tiến trình API (cho Agent) và tiến trình Worker (cho Tier-2 Pipeline).

---

## 5. Tiêu chí Nghiệm thu & Kịch bản Kiểm thử
- [ ] Một bản ghi `usage_ledger` có `created_at` thuộc ngày hôm qua (UTC) không bị tính vào `used_tokens` của ngày hôm nay.
- [ ] Quy trình `reserve(5000)` → `recordActual(3200)` → `refund(5000)` làm `used_tokens` tăng đúng `3200` tokens.
- [ ] Gọi `GET /api/v1/me/usage` với Bearer JWT của User B trả về đúng `user_id` và hạn mức riêng của User B (không trả về UUID mặc định `...0001`).
