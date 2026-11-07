# Đặc tả Tính năng: Bộ Sinh Mã Sơ đồ Kiến trúc C4 PlantUML (`@srs-tool/plantuml-gen`)

## 1. Mục tiêu & Mã Yêu cầu Liên quan
- **Vai trò:** Thư viện **thuần TypeScript tất định (0 LLM token)** biến đổi `ArchitectureModel` JSON thành mã nguồn `.puml` chuẩn C4-PlantUML và PlantUML UML/ER để hiển thị trực tiếp hoặc gửi sang container PlantUML Server render ra SVG/PNG.
- **Mã yêu cầu đặc tả:**
  - `FR-DIA-001` *(Must)*: Sinh tối thiểu sơ đồ **C4 System Context** và **C4 Container** từ `ArchitectureModel`.
  - `FR-DIA-002`, `FR-DIA-003` *(Hỗ trợ mở rộng)*: Sinh sơ đồ C4 Component, Sequence và Entity-Relationship (ER).
  - `FR-DIA-004`, `NFR-SEC-004`: Mã `.puml` sinh ra **bắt buộc chạy được trong môi trường sandbox hoàn toàn không có kết nối Internet** (`internal: true` trong Docker Compose) — cấm mọi chỉ thị `!include https://...`, `%getenv`, đọc tệp cục bộ.
  - `NFR-COMP-002`: Mã `.puml` xuất ra phải tương thích chuẩn với PlantUML chính thức.

---

## 2. Cấu trúc Thư mục & Phụ thuộc
- **Đường dẫn:** `srs-tool/packages/plantuml-gen`
  - `src/generators.ts`: Các hàm sinh `.puml` (`generateContextDiagram`, `generateContainerDiagram`, `generateComponentDiagram`, `generateSequenceDiagram`, `generateErDiagram`, `generateDiagram`) và hàm kiểm tra an toàn mã `.puml` do người dùng sửa tay (`sanitizeOrValidateUserPuml`).
  - `src/index.ts`: Điểm xuất công khai.
- **Phụ thuộc cho phép:** Chỉ `@srs-tool/schemas`. Không phụ thuộc mạng, file system hay CSDL.

---

## 3. Hợp đồng Sinh Mã & Quy tắc An toàn Cú pháp

### 3.1. Chỉ thị Thư viện Chuẩn Nội bộ (Air-gapped Stdlib)
PlantUML Server chính thức đóng gói sẵn thư viện C4 trong JAR nội bộ. Mọi hàm sinh C4 **bắt buộc** dùng cú pháp `<C4/...>`:
- Context: `!include <C4/C4_Context>`
- Container: `!include <C4/C4_Container>`
- Component: `!include <C4/C4_Component>`

### 3.2. Quy tắc Ánh xạ Phần tử trong `generateContainerDiagram(model)`
1. **Phân nhóm Phần tử:**
   - Tác nhân ngoài: `kind === 'person'` → `Person(alias, "Name", "Desc")`.
   - Hệ thống trung tâm (`System_Boundary`):
     - Nếu `model.elements` có phần tử `kind === 'system'`, dùng phần tử đầu tiên (hoặc từng `system`) làm khung `System_Boundary(sys_alias, "System Name") { ... }`.
     - Nếu `model.elements` chưa khai báo tường minh phần tử `kind === 'system'` nhưng có `container` / `datastore`, **vẫn bắt buộc tạo một `System_Boundary(target_system, ...)` mặc định** (`"Hệ thống mục tiêu"` khi `language === 'vi'`, `"Target System"` khi `'en'`) bao quanh các phần tử nội bộ thay vì bỏ rơi chúng!
   - Bên trong `System_Boundary`:
     - `kind === 'container'` → `Container(alias, "Name", "Tech", "Desc")`.
     - `kind === 'datastore'` → `ContainerDb(alias, "Name", "Tech", "Desc")`.
   - Bên ngoài `System_Boundary` (thiết bị biên / IoT):
     - `kind === 'device'` → `Container(alias, "Name", "IoT / Edge Device", "Desc")` (hoặc `System_Ext` ngoài ranh giới cloud để thể hiện rõ kết nối MQTT/HTTPS từ thiết bị vật lý vào Cloud).
2. **Bảo toàn Toàn vẹn Quan hệ (`Rel`):**
   - Tập hợp `declaredIds = Set<string>` lưu toàn bộ `element.id` đã thực sự được khai báo macro trong sơ đồ hiện tại.
   - Chỉ sinh dòng `Rel(srcAlias, tgtAlias, "Label", "Protocol")` khi **cả `rel.source_id` lẫn `rel.target_id` đều nằm trong `declaredIds`** (hoặc ở Context diagram: nếu một quan hệ nối từ `person`/`device` vào một `container` nội bộ thuộc `system`, tự động quy chiếu đích về `system.id` và khử trùng lặp cạnh!).
3. **Chuẩn hoá Định danh & Chuỗi ký tự:**
   - `sanitizeId(id)`: Thay mọi ký tự ngoài `[a-zA-Z0-9_]` thành `_`, nếu bắt đầu bằng chữ số thì tiền tố `el_`.
   - `escapeLabel(text)`: Chuyển dấu `"` thành `""` hoặc `'`, loại bỏ ký tự xuống dòng thô bằng `\n` để không bao giờ làm vỡ cú pháp macro C4 đối với tiếng Việt có dấu hoặc mô tả dài.
4. **Hàm Kiểm tra Bảo mật cho Chế độ `detached` (`validateSafePuml(puml)` — `NFR-SEC-004`):**
   - Xuất thêm hàm `validateSafePuml(puml: string): { valid: boolean; reason?: string; line?: number }` để `DiagramsService` kiểm tra mã `.puml` do người dùng sửa tay: chặn ngay các chỉ thị nguy hiểm như `!include http://`, `!include https://`, `!include /`, `!include ..`, `!import`, `%getenv`, `!log`.

---

## 4. Thực trạng Code Hiện tại & Các Bug Nghiêm trọng Cần Sửa

### Trạng thái hiện tại (`~55%`)
1. **BUG P0 — Dùng `!include https://raw.githubusercontent.com/...` bị chết trong Docker:**
   - Tại `src/generators.ts` dòng `34`, `70`, `145`, cả 3 hàm C4 đều gọi URL GitHub ngoài Internet. Khi chạy trong `docker-compose.yml` (mạng `internal: true`), PlantUML Server không thể tải file include và luôn báo lỗi cú pháp.
2. **BUG P0 — `generateContainerDiagram` làm mất trắng toàn bộ `container`, `datastore` và `device`:**
   - Dòng `76–97` của `src/generators.ts` chỉ lặp qua `for (const sys of systems)` — khi `systems.length === 0` (như output hiện tại của `ArchitectureService`), không một `Container(...)` nào được sinh ra!
   - Tệ hơn, biến `datastores` (dòng 65) và các phần tử `device` hoàn toàn không được xuất macro nào, nhưng vòng lặp `relationships` ở dòng `100–103` vẫn xuất mọi `Rel(...)` dẫn tới lỗi tham chiếu alias chưa khai báo.
3. **BUG P1 — `generateContextDiagram` thiếu ánh xạ quan hệ mức Context:**
   - Nếu `relationships` trong model nối từ `user` (`person`) tới `webapp` (`container`) thay vì nối trực tiếp tới `system`, sơ đồ Context hiện tại không vẽ được mũi tên tương tác giữa `User` và `System`.
4. **Chưa có unit test:** Package hiện có `0` file test.

### Kế hoạch theo Phase
- **Phase 1:**
  - Đổi toàn bộ `!include` sang `<C4/C4_Context>`, `<C4/C4_Container>`, `<C4/C4_Component>`.
  - Viết lại `generateContextDiagram` và `generateContainerDiagram` xử lý trọn vẹn `system`, `container`, `datastore` (`ContainerDb`), `device`, tự động quy chiếu quan hệ về mức Context và lọc `declaredIds`.
  - Bổ sung hàm `validateSafePuml(puml)` chặn `!include` từ xa/tệp nội bộ trái phép và xuất ra qua `src/index.ts`.
  - Viết `src/generators.spec.ts` kiểm thử tất cả 5 loại sơ đồ và bộ lọc bảo mật `validateSafePuml`.

---

## 5. Tiêu chí Nghiệm thu & Kịch bản Kiểm thử
- [ ] Đầu ra của tất cả các hàm trong `generators.ts` không chứa bất kỳ chuỗi `http://` hay `https://` nào.
- [ ] Với một `ArchitectureModel` gồm `person`, `device` (IoT sensor), `container` (API, Worker) và `datastore` (PostgreSQL, Redis) — dù có hay không có phần tử `system` — `generateContainerDiagram` vẫn xuất đầy đủ `Person`, `System_Boundary`, `Container`, `ContainerDb` và mọi dòng `Rel(...)` chỉ tham chiếu tới các alias đã khai báo phía trên.
- [ ] `validateSafePuml('!include https://evil.com/x.puml')` trả về `{ valid: false }` kèm số dòng vi phạm, trong khi `validateSafePuml('!include <C4/C4_Container>')` trả về `{ valid: true }`.
