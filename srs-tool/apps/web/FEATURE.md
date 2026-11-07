# Đặc tả Tính năng: Giao diện Người dùng Web SPA (`@srs-tool/web`)

## 1. Mục tiêu & Mã Yêu cầu Liên quan
- **Vai trò:** Ứng dụng Single-Page Application (React 18 + Vite) cung cấp không gian làm việc trực quan, hiện đại và phản hồi tức thì cho kỹ sư phân tích nghiệp vụ / sinh viên / kiến trúc sư phần mềm từ khâu tạo dự án, nạp tài liệu thô, theo dõi pipeline thời gian thực, trả lời câu hỏi làm rõ, rà soát truy vết 2 chiều tới thiết kế kiến trúc C4 và xuất hồ sơ SRS.
- **Ngăn xếp Công nghệ Đã Chốt (Phase 2):**
  - **UI & Layout:** `Tailwind CSS` + `lucide-react` (thiết kế sạch, mật độ thông tin kỹ thuật cao, hỗ trợ badge trực quan).
  - **Trình soạn thảo mã PlantUML:** `CodeMirror 6` (`@codemirror/view`, `@codemirror/state`) hỗ trợ đánh số dòng, highlight dòng lỗi cú pháp và xem trước SVG song song (`split-pane` có phóng to/thu nhỏ).
  - **Đa ngôn ngữ (`i18n`):** Context song ngữ `vi` / `en` chuyển đổi tức thì trên toàn bộ nhãn giao diện **mà không tải lại trang** (`NFR-USA-001`).
- **Mã yêu cầu đặc tả:**
  - `NFR-USA-001`: Giao diện hỗ trợ đầy đủ tiếng Việt và tiếng Anh, chuyển đổi tức thì không reload.
  - `NFR-USA-005`: Mọi thông báo lỗi đều giải thích nguyên nhân và hướng dẫn hành động tiếp theo (VD: tệp PDF scan, hết quota ngày → gợi ý bấm chạy chế độ `Tiết kiệm / Eco`).
  - `NFR-USA-006`: Gắn huy hiệu nguồn gốc (`Origin Badge`) phân biệt rõ bằng màu sắc & biểu tượng cho mọi yêu cầu: **Nêu rõ (`Explicit`)**, **Hệ thống suy ra (`Inferred` — cần bấm xác nhận)**, và **Giả định (`Assumption`)**, cùng huy hiệu bậc xử lý (`Rule` / `Local ML` / `LLM`).
  - `FR-RVW-001..003`, `FR-RVW-007`, `FR-DIA-004..007`, `FR-AGT-003`, `FR-ACC-005`.

---

## 2. Cấu trúc Thư mục Đích (`srs-tool/apps/web/src`)
```text
apps/web/src/
├── api/
│   └── client.ts              # Typed HTTP + SSE client gắn Bearer JWT & xử lý lỗi chuẩn hoá
├── i18n/
│   ├── locales/vi.ts          # Từ điển tiếng Việt đầy đủ
│   ├── locales/en.ts          # Từ điển tiếng Anh đầy đủ
│   └── I18nProvider.tsx       # Hook useI18n() đổi ngôn ngữ tức thì + đồng bộ PATCH /auth/me
├── auth/
│   └── AuthProvider.tsx       # Quản lý phiên JWT, hồ sơ người dùng & đăng nhập nhanh/OAuth
├── components/
│   ├── AppShell.tsx           # Thanh điều hướng đỉnh, chuyển đổi VI/EN, đồng hồ Quota Token ngày
│   ├── CoverageBar.tsx        # Thanh tiến độ Sổ phủ 4 màu (Mapped / Not-Req / Unresolved / Unmapped)
│   ├── RunProgressDrawer.tsx  # Theo dõi tiến độ 8 giai đoạn S1→S8 thời gian thực qua EventSource (SSE)
│   ├── ClarificationInbox.tsx # Hộp thư câu hỏi làm rõ S5 gom theo chủ đề + chọn gợi ý / bỏ qua
│   ├── OriginBadge.tsx        # Huy hiệu phân biệt Explicit / Inferred / Assumption & Tier 0/1/2
│   ├── VersionDiffModal.tsx   # Xem lịch sử phiên bản yêu cầu, so sánh diff & bấm Revert
│   ├── CodeMirrorPuml.tsx     # Trình sửa PlantUML trên nền CodeMirror 6 có đánh dấu dòng lỗi
│   └── AgentPatchSidebar.tsx  # Khung chat AI Agent + xem trước ảnh SVG nháp + nút Accept / Reject
└── pages/
    ├── ProjectsPage.tsx       # Màn hình 1: Danh sách dự án, Tạo dự án mới (chọn Web/Mobile/IoT), Quota
    ├── ProjectDetailPage.tsx  # Màn hình 2: Nạp tài liệu (kéo thả + dán text/email), Checklist, Sổ phủ, Chạy S1→S8 & Xuất gói ZIP
    ├── RequirementsPage.tsx   # Màn hình 3: Bàn làm việc rà soát EARS/INCOSE song song đoạn nguồn + Hộp thư S5 + Glossary
    ├── ArchitecturePage.tsx   # Màn hình 4: Khám phá Kiến trúc tổng hợp, Bảng điểm Tech Stack & Thanh lệnh nhanh 0-token
    └── DiagramEditorPage.tsx  # Màn hình 5: Studio sơ đồ C4 hai chế độ (Model / Detached) + AI Agent Sidebar
```

---

## 3. Đặc tả Chi tiết 5 Màn hình Nghiệp vụ & Hợp đồng API

### 3.1. `api/client.ts` (Hợp đồng Kết nối Backend)
- Tự động đọc và đính kèm `Authorization: Bearer <token>` từ `localStorage` cho mọi request tới `/api/v1` (và truyền `?token=` hoặc header tương thích khi mở SSE nếu cần).
- Bổ sung đầy đủ các nhóm phương thức có kiểu dữ liệu chặt từ `@srs-tool/schemas`:
  - `auth`: `devLogin`, `login`, `me`, `updateLocale`
  - `usage`: `getCurrent`, `getLedger`
  - `projects`: `list`, `get`, `create`, `update`, `delete`, `getCoverage`, `getChecklist`, `updateChecklistItem`, `lockBaseline`, `startRun`, `getRun`, `getRunDecisions`, `escalateRun`, `cancelRun`, `subscribeRunEvents`
  - `documents`: `uploadFile` *(đọc `File` bằng `FileReader` sang Base64 gửi JSON chuẩn `{ contentBase64, filename, mimeType, kind }` khớp `IngestionController`)*, `ingestText`, `list`, `delete`
  - `requirements`: `list`, `get`, `create`, `update`, `revert`, `diff`, `listQuestions`, `answerQuestion`, `listGlossary`, `addGlossaryTerm`
  - `architecture`: `getByProject`, `synthesize`, `applyPatch`, `executeCommand`
  - `diagrams`: `listByModel`, `getJson`, `updatePuml`, `resetToModel`
  - `agent`: `createSession`, `getSession`, `sendMessage`, `acceptPatch`, `rejectPatch`
  - `exports`: `create`, `listByProject`, `get`

### 3.2. Đặc tả Chức năng Từng Trang
1. **`ProjectsPage` (`/projects`):**
   - Thẻ tổng quan hạn ngạch token trong ngày (`used / daily_limit` + đồng hồ đếm ngược tới 00:00 UTC).
   - Modal tạo dự án mới: nhập tên, chọn một hoặc nhiều nền tảng (`Web`, `Mobile`, `IoT`), ngôn ngữ đầu ra (`Tiếng Việt` / `English`), và ràng buộc kỹ thuật (quy mô nhóm, ngân sách, ưu tiên mã nguồn mở).
   - Nút tạo nhanh **"Dự án mẫu Song ngữ"** để giảng viên / người chấm KLTN trải nghiệm ngay chỉ với 1 cú nhấp chuột.
2. **`ProjectDetailPage` (`/projects/:id`):**
   - Khu vực nạp liệu 2 tab: **Tải tệp lên** (`.pdf`, `.docx`, `.md`, `.txt`, `.eml` tối đa 20 MB) và **Dán văn bản / Chuỗi Email**.
   - Thanh điều khiển chạy Pipeline: chọn chế độ **`Tiết kiệm (Eco - 0 LLM)`**, **`Chuẩn (Standard)`**, **`Kỹ lưỡng (Thorough)`**; hiển thị thanh tiến độ 8 bước `S1 → S8` qua SSE kèm biểu đồ tỷ lệ bậc quyết định (`% Rule / % Local / % LLM` — số liệu trực quan phục vụ bảo vệ KLTN!).
   - Bảng **Sổ phủ (`Coverage Ledger`)** cho phép bấm vào từng đoạn văn bản nguồn xem nó đã sinh ra yêu cầu nào hoặc vì sao bị loại, kèm nút **Khoá Mốc Yêu cầu (`Lock Baseline`)** và nút **Xuất Gói Hồ sơ (`.zip` / `.md` / `.csv` / `.svg`)**.
   - Bảng **Checklist Nền tảng** (`Web` / `Mobile` / `IoT` / `Shared`): hiển thị các chủ đề Đã phủ / Còn thiếu và nút đánh dấu *"Không áp dụng"* kèm lý do.
3. **`RequirementsPage` (`/projects/:id/requirements`):**
   - Bộ lọc đa chiều: Loại yêu cầu, Nền tảng, Mẫu EARS, Trạng thái, Nguồn gốc (`Explicit`/`Inferred`/`Assumption`), Chỉ xem ASR, Tìm kiếm từ khoá.
   - Bố cục 2 cột (Master–Detail): bên trái là danh sách yêu cầu kèm điểm chất lượng INCOSE (`0–100`) và huy hiệu `OriginBadge`; bên phải là khung đối chiếu **Câu chuẩn hoá EARS** cạnh **Đoạn văn bản gốc được tô sáng**, tiêu chí `Given/When/Then`, nút **Xác nhận giá trị suy luận** (cho mục `inferred`), lịch sử phiên bản (`Diff` / `Revert`), cùng ngăn kéo **Hộp thư Câu hỏi Làm rõ (`S5`)** và **Bảng Thuật ngữ (`Glossary`)**.
4. **`ArchitecturePage` (`/projects/:id/architecture`):**
   - Nút **Tổng hợp / Cập nhật Kiến trúc từ Yêu cầu**; danh sách các thành phần C4 (`System`, `Container`, `Datastore`, `Device`) có gắn thẻ truy vết ngược tới các mã yêu cầu (`FR-*` / `NFR-*`) đã sinh ra chúng.
   - Bảng **Đề xuất Công nghệ (`Tech Stack`)** theo từng tầng hiển thị điểm số, đánh đổi (`tradeoffs`), phương án thay thế (`alternatives`) và ngày cập nhật catalog.
   - Thanh **Lệnh Kiến trúc Nhanh (0-token Command Bar)** hỗ trợ gõ lệnh tiếng Việt/Anh (VD: `thêm cache Redis cho API`).
5. **`DiagramEditorPage` (`/diagrams/:id`):**
   - Chuyển đổi nhanh giữa các góc nhìn (`Context`, `Container`, `Component`, `Sequence`, `ER`).
   - Huy hiệu trạng thái chế độ nổi bật: **`Đồng bộ Mô hình (Model Mode)`** (xanh lá) vs **`Tách rời / Sửa tự do (Detached Mode)`** (vàng hổ phách kèm cảnh báo và nút *Khôi phục từ Mô hình*).
   - Khung trái: **CodeMirror 6** sửa mã `.puml` (báo lỗi đúng dòng nếu sai cú pháp); Khung giữa: **SVG Canvas** có zoom/pan và tải ảnh `.svg`/`.png`/`.puml` (giữ ảnh hợp lệ gần nhất khi mã đang gõ dở bị lỗi); Khung phải: **AI Agent Sidebar** hiển thị bản xem trước SVG nháp của `ModelPatch` để bấm `Chấp nhận` hoặc `Từ chối`.

---

## 4. Thực trạng Code Hiện tại & Lộ trình Triển khai

### Trạng thái hiện tại (`~5%`)
- Đã có cấu hình Vite (`vite.config.ts` proxy `/api` về `localhost:3001`), bộ định tuyến `App.tsx` và khung `client.ts` sơ khai (mới có 9 hàm, hàm `uploadDocument` đang lệch định dạng với API và chưa gắn JWT header).
- Cả 5 tệp trong `src/pages/*.tsx` hiện chỉ chứa 3–5 dòng `<h1>...</h1>{/* TODO */}`.

### Kế hoạch theo Phase
- **Phase 1:**
  - Cập nhật trước `src/api/client.ts` để sửa lỗi `uploadDocument` (gửi JSON Base64 chuẩn thay vì `FormData` trần) và gắn `Authorization: Bearer` header để các bài kiểm tra tích hợp API ↔ Client đồng bộ 100%.
- **Phase 2 (Trọng tâm xây dựng toàn bộ `@srs-tool/web`):**
  - Cài đặt `tailwindcss`, `@tailwindcss/vite` (hoặc PostCSS), `lucide-react`, `@codemirror/view`, `@codemirror/state`, `@codemirror/commands` *(nhớ chạy `pnpm add` với quyền ngoài sandbox trên Windows theo quy tắc môi trường)*.
  - Hiện thực hoá đầy đủ hệ thống `I18nProvider` (`vi`/`en`), `AuthProvider`, `AppShell`, các component dùng chung và trọn vẹn cả 5 màn hình nghiệp vụ ở trên.

---

## 5. Tiêu chí Nghiệm thu & Kịch bản Kiểm thử
- [ ] Bấm nút chuyển ngôn ngữ `VI ↔ EN` trên thanh Header đổi tức thì 100% nhãn menu, nút bấm, bộ lọc và thông báo mà không reload trang hay làm mất dữ liệu form đang nhập (`NFR-USA-001`).
- [ ] Mọi yêu cầu hiển thị trên `RequirementsPage` đều có huy hiệu phân biệt rõ `Explicit` / `Inferred` / `Assumption` (`NFR-USA-006`) và bấm vào đoạn nguồn mở đúng vị trí trích dẫn.
- [ ] Trên `DiagramEditorPage`, khi gõ sửa mã `.puml` trong CodeMirror 6 và lưu: chế độ chuyển sang `Detached` có banner cảnh báo rõ ràng; nếu gõ sai cú pháp PlantUML, dòng lỗi được báo rõ và khung bên phải vẫn giữ nguyên bức ảnh SVG hợp lệ liền trước (`FR-DIA-004`, `FR-DIA-006`).
- [ ] `pnpm --dir srs-tool --filter @srs-tool/web build` và `typecheck` hoàn tất 0 lỗi.
