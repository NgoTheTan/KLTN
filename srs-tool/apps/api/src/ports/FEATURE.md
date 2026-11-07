# Đặc tả Tính năng: Tầng Cổng Hạ tầng & Bộ Chặn Bảo vệ (`apps/api/src/ports` & `guards`)

## 1. Mục tiêu & Mã Yêu cầu Liên quan
- **Vai trò:** Tách biệt toàn bộ logic nghiệp vụ của `@srs-tool/api` khỏi hạ tầng vật lý thông qua 3 cổng Hexagonal (`STORAGE_PORT`, `QUEUE_PORT`, `RENDER_PORT`) được đăng ký toàn cục (`@Global()`) và 3 Guard bảo vệ (`JwtAuthGuard`, `QuotaGuard`, `RateLimitGuard`).
- **Mã yêu cầu đặc tả:**
  - `FR-ING-005`, `FR-EXP-005`, `NFR-SEC-005`, `NFR-PRIV-002`: Lưu trữ tệp gốc & gói xuất, tạo liên kết tải có thời hạn 24 giờ (`expires`) và xoá tệp khi hết hạn.
  - `FR-RVW-007`, `NFR-PERF-003`, `NFR-REL-003`: Đẩy tác vụ bất đồng bộ sang BullMQ / Redis và chuyển tiếp sự kiện tiến độ về trình duyệt qua SSE.
  - `FR-DIA-004`, `NFR-SEC-004`: Gửi mã `.puml` tới dịch vụ PlantUML cô lập mạng có giới hạn timeout, giữ nguyên bản SVG hợp lệ gần nhất và cung cấp SVG dự phòng cục bộ khi không bật Docker PlantUML.
  - `FR-ACC-002`, `FR-ADM-001`, `NFR-SEC-001`: Kiểm tra xác thực JWT, hạn ngạch token ngày và giới hạn tốc độ gọi API (Rate Limit).

---

## 2. Cấu trúc Thư mục & Hợp đồng DI (`PortsModule`)
- **Đường dẫn:**
  - `apps/api/src/ports/index.ts`: Định nghĩa các interface `StoragePort`, `QueuePort`, `RenderPort`.
  - `apps/api/src/ports/ports.module.ts`: Đăng ký `@Global()` cho `STORAGE_PORT`, `QUEUE_PORT`, `RENDER_PORT` (và `StorageController` ở Phase 1).
  - `apps/api/src/ports/storage.adapter.ts`: `LocalStorageAdapter` (hỗ trợ mở rộng sang S3/MinIO qua `S3_ENDPOINT`).
  - `apps/api/src/ports/storage.controller.ts` *(Tạo mới ở Phase 1)*: Phục vụ tải tệp qua `GET /api/v1/storage/files/:key`.
  - `apps/api/src/ports/queue.adapter.ts`: `BullMQQueueAdapter` kết nối Redis (`pipeline`, `arch`, `export` queues) + `QueueEvents` phát RxJS stream cho SSE; tự lùi về in-memory event bus khi không có `REDIS_URL`.
  - `apps/api/src/ports/render.adapter.ts`: `PlantUMLRenderAdapter` gọi HTTP `PLANTUML_URL` (`/svg/...`, `/png/...` bằng nén Deflate chuẩn PlantUML) + bộ vẽ SVG dự phòng cục bộ (`generateFallbackSvg`).
  - `apps/api/src/guards/`:
    - `jwt-auth.guard.ts`: Giải mã Bearer JWT / Cookie `jwt`, gắn `req.user`.
    - `quota.guard.ts`: Chặn sớm `POST /projects/:id/runs` ở chế độ dùng LLM nếu người dùng đã hết hạn ngạch ngày (nhưng **luôn cho phép chạy chế độ `eco`** theo `NFR-LLM-002`!).
    - `rate-limit.guard.ts`: Giới hạn số request/phút theo `userId` hoặc IP.

---

## 3. Đặc tả Kỹ thuật & Bất biến An toàn

### 3.1. Đồng bộ Thư mục Lưu trữ Giữa Tiến trình API và Worker (Quan trọng!)
- Khi chạy phát triển cục bộ bằng Turborepo (`pnpm dev`), `process.cwd()` của `@srs-tool/api` là `srs-tool/apps/api`, còn `process.cwd()` của `@srs-tool/worker` là `srs-tool/apps/worker`.
- **Quy tắc bắt buộc:** Nếu biến môi trường `UPLOAD_DIR` không được truyền tường minh, cả `LocalStorageAdapter` lẫn `PipelineProcessor`/`ExportProcessor` của Worker **phải quy chiếu thư mục mặc định về gốc monorepo `srs-tool/.uploads`** (VD: tính từ `__dirname` đi lên thư mục chứa `pnpm-workspace.yaml` hoặc `path.resolve(__dirname, '../../../../.uploads')`), tuyệt đối không dùng `path.join(process.cwd(), '.uploads')` gây lệch thư mục giữa 2 tiến trình!

### 3.2. Endpoint Tải Tệp An toàn (`StorageController` — `NFR-SEC-005`)
- **Route:** `GET /api/v1/storage/files/:key` (Query: `?expires=<unix_seconds>&sig=<hmac_optional>`).
- **Quy tắc bảo vệ:**
  1. Chống leo thang thư mục (`Path Traversal`): Chuẩn hoá `key`, từ chối ngay (`400 Bad Request`) nếu chứa `..`, `/` hoặc `\` thoát ra ngoài `uploadDir` (`!resolvedPath.startsWith(uploadDir + path.sep)`).
  2. Kiểm tra thời hạn (`TTL`): Nếu query có `expires` và `Math.floor(Date.now() / 1000) > Number(expires)` → trả `410 Gone` hoặc `403 Forbidden` (`Link tải đã hết hạn 24 giờ`).
  3. Suy luận đúng `Content-Type` (`application/zip`, `text/markdown; charset=utf-8`, `text/csv; charset=utf-8`, `image/svg+xml`, `image/png`, `application/pdf`, `text/plain; charset=utf-8`) và gắn header `Content-Disposition: attachment; filename="..."` cùng `X-Content-Type-Options: nosniff`.

### 3.3. Quy tắc Bảo vệ của `JwtAuthGuard` và `QuotaGuard`
- **`JwtAuthGuard`:**
  - Nếu `NODE_ENV === 'production'` (hoặc `ALLOW_DEV_AUTH === 'false'`): Mọi request thiếu JWT hợp lệ **bắt buộc ném `401 Unauthorized`** — tuyệt đối không gán tài khoản mặc định `dev@srs-tool.local`.
  - Ở môi trường `development` / `test`: Cho phép fallback về `dev@srs-tool.local` khi không truyền header `Authorization`, nhưng nếu có truyền Bearer token sai/hết hạn thì vẫn phải trả `401 Unauthorized`.
- **`QuotaGuard`:**
  - Nếu `req.body?.mode === 'eco'`, **luôn cho qua (`return true`)** kể cả khi `remaining_tokens <= 0`, vì chế độ `eco` cam kết chạy 0 LLM token (`NFR-LLM-002`).

---

## 4. Thực trạng Code Hiện tại & Các Bug Cần Sửa

### Trạng thái hiện tại (`~65%`)
1. **BUG P0 — Thiếu hoàn toàn `StorageController` (`404` mọi link tải):**
   - `LocalStorageAdapter` trả URL `/api/v1/storage/files/...` nhưng không có Controller nào lắng nghe đường dẫn này.
2. **BUG P0 — Lệch đường dẫn `.uploads` giữa API và Worker:**
   - Cả `storage.adapter.ts:14` và `pipeline.processor.ts:422` đều dùng `path.join(process.cwd(), '.uploads')`, khiến Worker không tìm thấy file vừa upload qua API khi chạy 2 terminal riêng.
3. **BUG P1 — `Fallback SVG` trong `PlantUMLRenderAdapter` bỏ sót phần tử C4:**
   - Khi chạy máy cá nhân không bật Docker PlantUML, `generateFallbackSvg` trong `render.adapter.ts` mới bắt regex `Person(...)` và `Container(...)`, bỏ sót `System(...)`, `System_Ext(...)`, `ContainerDb(...)` và chưa vẽ mũi tên nối `Rel(...)`.
4. **BUG Bảo mật — `JwtAuthGuard` mở cửa tự do ở Production:**
   - Dòng `34–40` của `jwt-auth.guard.ts` gán cứng `dev@srs-tool.local` không kiểm tra `NODE_ENV`.

### Kế hoạch theo Phase
- **Phase 1:**
  - Tạo `storage.controller.ts` và đăng ký vào `ports.module.ts`.
  - Chuẩn hoá đường dẫn mặc định `srs-tool/.uploads` nhất quán giữa `LocalStorageAdapter` và Worker.
  - Nâng cấp `generateFallbackSvg` trong `render.adapter.ts` nhận diện đầy đủ `Person`, `System`, `System_Ext`, `Container`, `ContainerDb`, `Component` và vẽ cạnh `Rel(...)` kèm nhãn giao thức trực quan.
  - Sửa `QuotaGuard` luôn mở cho `mode === 'eco'` và sửa `JwtAuthGuard` chặn truy cập ẩn danh khi `NODE_ENV === 'production'`.
- **Phase 4:**
  - Bổ sung `S3StorageAdapter` tương thích MinIO / AWS S3 khi cấu hình `S3_ENDPOINT` cho môi trường triển khai thật, và cron job dọn dẹp file quá hạn 30 ngày (`NFR-PRIV-002`).

---

## 5. Tiêu chí Nghiệm thu & Kịch bản Kiểm thử
- [ ] Gọi `LocalStorageAdapter.upload(...)` rồi gọi `GET /api/v1/storage/files/<s3Key>` tải về đúng byte nội dung gốc; gọi với `?expires=1000` (đã quá hạn) nhận mã lỗi `403`/`410`; gọi với `../package.json` nhận mã lỗi `400`.
- [ ] Khi không bật container PlantUML, `PlantUMLRenderAdapter.renderSvg(puml)` vẫn trả về ảnh SVG có đầy đủ khối hộp `System`, `Container`, `ContainerDb` và mũi tên `Rel`.
- [ ] Khi `NODE_ENV=production` và không gửi JWT, mọi endpoint gắn `@UseGuards(JwtAuthGuard)` đều trả về `401 Unauthorized`.
