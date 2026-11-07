# Đặc tả Tính năng: Xác thực & Hồ sơ Người dùng (`apps/api/src/modules/auth`)

## 1. Mục tiêu & Mã Yêu cầu Liên quan
- **Vai trò:** Quản lý đăng nhập người dùng (OAuth 2.0 với Google/GitHub ở môi trường triển khai & Dev Token khi phát triển cục bộ), phát hành JWT, tự động khởi tạo bản ghi `users` trong PostgreSQL và lưu tuỳ chọn ngôn ngữ giao diện (`locale`: `'vi' | 'en'`).
- **Mã yêu cầu đặc tả:**
  - `FR-ACC-001`: Cho phép người dùng đăng ký và đăng nhập bằng OAuth (Google hoặc GitHub).
  - `FR-ACC-002`: Gắn định danh `user.id` (UUID) nhất quán vào phiên JWT để phục vụ cô lập dữ liệu đa người dùng.
  - `FR-ACC-003`, `NFR-USA-001`: Lưu ngôn ngữ giao diện ưa thích (`vi` / `en`) trong hồ sơ người dùng.
  - `NFR-SEC-001`: Truyền tải an toàn, chữ ký JWT dùng `JWT_SECRET` bắt buộc từ biến môi trường khi chạy production.

---

## 2. Ranh giới Module & Quyền sở hữu CSDL
- **Đường dẫn:** `srs-tool/apps/api/src/modules/auth` (`auth.module.ts`, `auth.controller.ts`, `auth.service.ts`).
- **Bảng CSDL được phép GHI:** Duy nhất bảng `users`.
- **Phụ thuộc nội bộ:** `DatabaseService` (`@srs-tool/db`), `@nestjs/jwt`, `@srs-tool/schemas`.

---

## 3. Hợp đồng REST Endpoints (Tiền tố `/api/v1`)

| Phương thức & Đường dẫn | Guard | Request Body / Query | Response Chuẩn | Ghi chú Nghiệp vụ |
| :--- | :---: | :--- | :--- | :--- |
| `POST /auth/dev-token` | Public *(Chỉ Dev/Test)* | `{ email?: string }` | `{ access_token, user }` | **Bắt buộc trả `403 Forbidden` khi `NODE_ENV === 'production'`**. |
| `POST /auth/login` | Public | `{ email, provider?, oauthCode? }` | `{ access_token, user }` | Tìm hoặc tạo mới dòng trong bảng `users`, ký JWT hạn 7 ngày. |
| `GET /auth/google` & `/callback` | Public *(Phase 4)* | OAuth2 PKCE / Code | Redirect kèm JWT / Cookie | Luồng OAuth thật với Google. |
| `GET /auth/github` & `/callback` | Public *(Phase 4)* | OAuth2 Code | Redirect kèm JWT / Cookie | Luồng OAuth thật với GitHub. |
| `GET /auth/me` | `JwtAuthGuard` | — | `{ id, email, plan, locale, dailyLimitTokens }` | Đọc trực tiếp từ bảng `users`. |
| `PATCH /auth/me` | `JwtAuthGuard` | `{ locale?: 'vi' \| 'en' }` | `{ id, email, plan, locale, dailyLimitTokens }` | Không cho phép người dùng thường tự nâng `plan` hoặc `dailyLimitTokens` qua endpoint này! |

---

## 4. Thực trạng Code Hiện tại & Các Bug Cần Sửa

### Trạng thái hiện tại (`~60%`)
1. **BUG Bảo mật P1 — Lộ `POST /auth/dev-token` và tự nâng gói `plan`:**
   - `AuthController.devToken` chưa chặn khi `NODE_ENV === 'production'`.
   - `AuthController.updateProfile` (`auth.controller.ts:39`) nhận `{ locale?: string; plan?: string }` cho phép bất kỳ user nào tự gửi `{ "plan": "pro" }`.
2. **BUG Đồng bộ DB — Nuốt lỗi SQL trong `AuthService`:**
   - Nếu kết nối PostgreSQL gặp lỗi tạm thời, `AuthService` bắt `catch {}` rỗng và tạo user giả trên RAM với UUID không tồn tại trong bảng `users`, dẫn tới lỗi khoá ngoại `projects.owner_id -> users.id` khi tạo dự án tiếp theo.
3. **OAuth thật (`Google` / `GitHub`):** Hiện `POST /auth/login` mới mô phỏng đăng nhập theo `email`, chưa trao đổi `authorization_code` thật với Google/GitHub API.

### Kế hoạch theo Phase
- **Phase 1:**
  - Chặn `POST /auth/dev-token` khi `NODE_ENV === 'production'`.
  - Giới hạn `PATCH /auth/me` chỉ cho phép cập nhật trường `locale` hợp lệ (`'vi' | 'en'`), kiểm chứng bằng `LanguageSchema`.
  - Đảm bảo khi `db.isConnected === true`, `loginDev` thực hiện `INSERT INTO users ... ON CONFLICT (email) DO UPDATE` thật vào PostgreSQL (không nuốt lỗi SQL) để `owner_id` luôn tồn tại hợp lệ trong bảng `users`.
- **Phase 2:**
  - Tích hợp thanh đăng nhập nhanh & chuyển ngôn ngữ `VI/EN` trên Header của `@srs-tool/web` đồng bộ với `PATCH /api/v1/auth/me`.
- **Phase 4:**
  - Bổ sung trao đổi OAuth2 `code -> userinfo` thật cho Google & GitHub qua biến môi trường `GOOGLE_CLIENT_ID`/`SECRET` và `GITHUB_CLIENT_ID`/`SECRET`, bắt buộc `JWT_SECRET` mạnh khi `NODE_ENV === 'production'`.

---

## 5. Tiêu chí Nghiệm thu & Kịch bản Kiểm thử
- [ ] Đăng nhập với một email mới tự động tạo bản ghi trong bảng `users` trên PostgreSQL và trả về `access_token` hợp lệ; tạo tiếp Project bằng user này không gặp lỗi FK `owner_id`.
- [ ] `PATCH /api/v1/auth/me` với `{ "locale": "en", "plan": "pro" }` chỉ cập nhật `locale = "en"` và giữ nguyên `plan` hiện tại.
- [ ] Khi `NODE_ENV=production`, gọi `POST /api/v1/auth/dev-token` nhận `403 Forbidden`.
