# Hướng dẫn Kiến trúc & Đặc tả cho Coding Agent (`srs-tool`)

> **Tài liệu gốc (Single Source of Truth về Nghiệp vụ & Kiến trúc):**
> - Phân tích yêu cầu (94 Musts = 58 FR + 36 NFR): `../Phân_tích_yêu_cầu_công_cụ_chuẩn_hoá_SRS.md`
> - Thiết kế kiến trúc hệ thống: `../Kiến_trúc_công_cụ_SRS (1).md`
>
> **Quy tắc bắt buộc cho Coding Agent:** Trước khi sửa bất kỳ tệp nào trong một package hoặc module, **PHẢI đọc tệp `FEATURE.md` đặt trực tiếp trong thư mục đó** để nắm rõ hợp đồng dữ liệu, quyền sở hữu bảng CSDL, các bất biến không được phép phá vỡ và danh sách lỗi cần xử lý.

---

## 1. Tổng quan Hệ thống

`srs-tool` là nền tảng web đa người dùng song ngữ Việt–Anh (`vi` / `en`) hỗ trợ:
1. **Tiếp nhận tài liệu thô** (`.pdf`, `.docx`, `.md`, `.txt`, `.eml`, hoặc dán văn bản) cho các hệ thống thuộc 3 nền tảng chính (`web`, `mobile`, `iot` + `shared`).
2. **Chuẩn hoá, làm rõ & rút gọn yêu cầu** qua Pipeline bất đồng bộ 8 giai đoạn (`S1 → S8`) theo chuẩn **EARS + INCOSE**, điều phối bởi **Bộ quyết định 3 bậc (`DecisionRouter`)** nhằm giảm `>= 60%` chi phí token LLM mà vẫn bảo toàn 100% thông tin đầu vào qua **Sổ phủ (`CoverageLedger`)**.
3. **Tổng hợp mô hình kiến trúc hệ thống (`ArchitectureModel` JSON)**, gợi ý công nghệ có chấm điểm từ YAML Catalog, sinh sơ đồ **C4 PlantUML** trong sandbox không có mạng ngoài, hỗ trợ sửa hai chế độ (`model` / `detached`) và **AI Agent đề xuất bản vá (`ModelPatch`)**.

---

## 2. 5 Bất biến Cốt lõi Không được Vi phạm (Non-Negotiable Invariants)

1. **Bảo toàn Sổ phủ (`CoverageLedger` — `FR-ING-006`, `FR-REQ-010..011`, `NFR-QUAL-003..004`):**
   - Bảng `segments` là **bất biến** về mặt nội dung gốc; không bao giờ được xoá ngầm một đoạn văn bản nguồn khi gộp hoặc từ chối yêu cầu.
   - Luôn thoả mãn phương trình: `total_segments == mapped + not_requirement + unresolved + unmapped`.
   - Hệ thống **chặn khoá mốc (baseline lock)** nếu `unresolved > 0` hoặc `unmapped > 0`.
2. **Kiểm soát Nguồn gốc & Bảo toàn Định lượng (`Origin` & `Preservation` — `FR-REQ-007..009`, `FR-REQ-020`):**
   - Mọi yêu cầu do hệ thống tự gợi ý từ checklist/mặc định phải mang `origin = 'inferred'` và **không được chuyển sang `approved`** nếu chưa có xác nhận tường minh của người dùng.
   - Câu hỏi làm rõ bị bỏ qua (`skip = true`) phải sinh bản ghi/cập nhật yêu cầu mang `origin = 'assumption'`.
   - Chuẩn hoá (`S6`) và Gộp trùng (`S7`) **tuyệt đối không được gộp tự động** hai yêu cầu khác nhau về con số, đơn vị đo, chủ thể hoặc từ phủ định (`không`/`not`/`never`), và không được làm yếu mức độ bắt buộc (`phải`/`shall` sang `nên`/`should`).
3. **Kiến trúc Quyết định 3 Bậc (`DecisionRouter` — `FR-REQ-017..018`, `NFR-LLM-001..003`):**
   - Mọi quyết định ở `S2 → S8` phải đi qua `DecisionRouter`: **Tier 0** (Luật tất định, 0ms, 0 token) → **Tier 1** (Local CPU ML qua `LocalModelPort`) → **Tier 2** (Batched LLM qua `LlmGateway`).
   - Ở chế độ `eco` (hoặc khi hết quota / chạm cầu chì ngân sách), toàn bộ `S1 → S8` **phải hoàn tất với 0 lời gọi LLM**; các mục độ tin cậy thấp được gắn `needs_review` / `pending_llm` để có thể nâng cấp sau qua `POST /api/v1/runs/:id/escalate`.
   - Mọi quyết định đều phải ghi vào `decision_log` kèm `tier`, `confidence`, `version`.
4. **Một Nguồn Sự thật cho Kiến trúc & Agent Chỉ-Vá (`FR-ARC-001..007`, `FR-DIA-005..007`, `FR-AGT-002..003`, `NFR-SEC-003`):**
   - `arch_models.body` (`ArchitectureModel` JSON) là nguồn sự thật duy nhất. Mọi cập nhật phải qua `ModelPatch` có kiểm tra khoá lạc quan `expected_version` và kiểm tra toàn vẹn tham chiếu (không có `relationship` trỏ tới phần tử không tồn tại).
   - AI Agent **không bao giờ** được ghi trực tiếp vào `arch_models` hay `requirements`; Agent chỉ được gọi tool chỉ-đọc và trả về `agent_patches` (`status = 'pending'`) kèm ảnh SVG nháp để người dùng bấm `accept` hoặc `reject`.
   - Sơ đồ đang ở `mode = 'detached'` không bao giờ bị ghi đè tự động khi `arch_models` thay đổi, trừ khi người dùng gọi tường minh `POST /api/v1/diagrams/:id/reset`.
5. **Không Nuốt lỗi SQL & An toàn Sandbox (`NFR-SEC-002`, `NFR-SEC-004`):**
   - **Cấm dùng `try { ... } catch {}` rỗng** để nuốt lỗi PostgreSQL và rơi ngầm về `Map` in-memory khi `DatabaseService.isConnected === true` (vì API và Worker là 2 tiến trình độc lập). In-memory fallback chỉ dùng khi chạy unit test offline (`isConnected === false`).
   - PlantUML bắt buộc render trong container mạng nội bộ (`internal: true`), tuyệt đối không dùng `!include https://...` ra Internet mà phải dùng stdlib nội bộ `!include <C4/...>`.

---

## 3. Ranh giới Monorepo & Quyền sở hữu Bảng CSDL (Modular Monolith)

```text
srs-tool/
├── packages/
│   ├── schemas/        # @srs-tool/schemas      — Zod schemas & TypeScript types dùng chung toàn hệ thống
│   ├── db/             # @srs-tool/db           — Drizzle schema (19 bảng), migrations, RLS, connection pool
│   ├── knowledge/      # @srs-tool/knowledge    — YAML profiles (web/mobile/iot/shared), tech & tactics catalogs
│   ├── llm/            # @srs-tool/llm          — LlmGateway (Gemini + OpenAI-compatible), PromptRegistry, Cache, Budget
│   ├── pipeline/       # @srs-tool/pipeline     — Thuần logic S1→S8, DecisionRouter, LocalModelPort, CoverageLedger
│   └── plantuml-gen/   # @srs-tool/plantuml-gen — Thuần TS biến ArchitectureModel JSON -> mã .puml chuẩn C4
└── apps/
    ├── api/            # @srs-tool/api          — NestJS + Fastify REST/SSE API (/api/v1), 9 domain modules + Ports/Guards
    ├── worker/         # @srs-tool/worker       — BullMQ Worker chạy nền (pipeline, arch, export processors)
    └── web/            # @srs-tool/web          — React 18 + Vite + Tailwind + Lucide + CodeMirror 6 SPA (VI/EN)
```

### Quy tắc Phụ thuộc Giữa các Gói
- `@srs-tool/schemas`: Không phụ thuộc gói nội bộ nào.
- `@srs-tool/knowledge`, `@srs-tool/plantuml-gen`: Chỉ phụ thuộc `@srs-tool/schemas`.
- `@srs-tool/db`: Phụ thuộc `drizzle-orm`, `pg`; không chứa logic nghiệp vụ.
- `@srs-tool/llm`: Phụ thuộc `@srs-tool/schemas`; không truy cập trực tiếp DB (ghi ledger qua interface `UsageRecorder`).
- `@srs-tool/pipeline`: Phụ thuộc `@srs-tool/schemas`, `@srs-tool/knowledge`, `@srs-tool/llm`; **không phụ thuộc `@srs-tool/db`** (mọi thao tác đọc/ghi PostgreSQL do `@srs-tool/worker` hoặc `@srs-tool/api` đảm nhiệm).
- Trong `@srs-tool/api`: Mỗi module chỉ ghi vào các bảng thuộc quyền sở hữu của mình; khi cần dữ liệu chéo phải gọi qua Service được `exports` của module kia:

| Module / App | Bảng CSDL được phép GHI (Write Ownership) |
| :--- | :--- |
| `modules/auth` | `users` |
| `modules/projects` | `projects`, `runs`, `issues` *(mục checklist `not_applicable`)* |
| `modules/ingestion` | `documents` |
| `modules/requirements` | `requirements`, `requirement_versions`, `requirement_sources`, `questions`, `glossary_terms`, `segments` *(chỉ đoạn câu trả lời `document_id = NULL`)*, `issues` *(trạng thái sau khi trả lời)* |
| `modules/architecture` | `arch_models`, `tech_recommendations` |
| `modules/diagrams` | `diagrams` |
| `modules/agent` | `agent_sessions`, `agent_patches` *(khi `accept` phải gọi `ArchitectureService.applyPatch`)* |
| `modules/exports` | `exports` |
| `modules/usage` | `usage_ledger` |
| `apps/worker` | `runs`, `segments`, `requirements`, `requirement_versions`, `requirement_sources`, `issues`, `questions`, `glossary_terms`, `decision_log`, `arch_models`, `tech_recommendations`, `exports` |

---

## 4. Chỉ mục Tài liệu Chi tiết theo từng Tính năng (`FEATURE.md`)

### Tầng Thư viện Dùng chung (`packages/*`)
1. `packages/schemas/FEATURE.md` — Lược đồ Zod dùng chung, DTO kiểm tra đầu vào/đầu ra runtime và `ModelPatch`.
2. `packages/db/FEATURE.md` — 19 thực thể PostgreSQL + `pgvector(384)`, RLS Policies toàn phần, `withProjectContext` và migrations.
3. `packages/knowledge/FEATURE.md` — Hồ sơ nền tảng YAML (`web`, `mobile`, `iot`, `shared`), `tech-catalog.yaml`, `tactics-catalog.yaml`, `prompts/`.
4. `packages/llm/FEATURE.md` — Cổng `LlmGateway` đa nhà cung cấp (Google Gemini + OpenAI-compatible), Zod structured output, Redis cache, cầu chì ngân sách.
5. `packages/pipeline/FEATURE.md` — Pipeline chuẩn hoá 8 giai đoạn (`S1 → S8`), trích xuất PDF/DOCX, `DecisionRouter`, `LocalModelPort`, `CoverageLedger`.
6. `packages/plantuml-gen/FEATURE.md` — Bộ sinh mã C4 PlantUML tất định (Context, Container, Component, Sequence, ER) tương thích môi trường cô lập mạng.

### Tầng Hạ tầng & Nghiệp vụ API (`apps/api/src/*`)
7. `apps/api/src/ports/FEATURE.md` — Các cổng `StoragePort` (+ route tải file `/api/v1/storage/files/*`), `QueuePort` (BullMQ + SSE), `RenderPort` (PlantUML + fallback SVG) và các Guard (`JwtAuthGuard`, `QuotaGuard`, `RateLimitGuard`).
8. `apps/api/src/modules/auth/FEATURE.md` — Xác thực OAuth (`Google`/`GitHub`), phiên JWT, khoá `dev-token` ở production, hồ sơ & ngôn ngữ người dùng.
9. `apps/api/src/modules/projects/FEATURE.md` — Quản lý dự án, tính toán Sổ phủ (`Coverage`), đối chiếu Checklist nền tảng, khởi chạy/theo dõi SSE/escalate `Runs`, và cổng khoá Baseline.
10. `apps/api/src/modules/ingestion/FEATURE.md` — Tiếp nhận đa định dạng (`.pdf`, `.docx`, `.md`, `.txt`, `.eml`, văn bản dán), giới hạn 20MB, băm SHA-256 bất biến.
11. `apps/api/src/modules/requirements/FEATURE.md` — Quản lý yêu cầu, lịch sử phiên bản (`diff`/`revert`), vòng lặp hỏi đáp làm rõ `S5` (`answer`/`skip`), kiểm soát `origin` và bảng thuật ngữ song ngữ (`Glossary`).
12. `apps/api/src/modules/architecture/FEATURE.md` — Tổng hợp kiến trúc từ YAML Catalog & ASR Tactics, chấm điểm Tech Stack, áp bản vá khoá lạc quan `expected_version`, và `CommandParser` song ngữ 0-token.
13. `apps/api/src/modules/diagrams/FEATURE.md` — Quản lý sơ đồ 2 chế độ (`model` / `detached`), render SVG/PNG, báo dòng lỗi cú pháp PlantUML và khôi phục về mô hình.
14. `apps/api/src/modules/agent/FEATURE.md` — Trợ lý AI đề xuất `ModelPatch` có giới hạn bước/token, render SVG nháp trên bản sao mô hình và luồng duyệt `accept`/`reject`.
15. `apps/api/src/modules/exports/FEATURE.md` — Đóng gói kết quả xuất (`.md`, `.csv`, `.puml`, `.svg`, `.png`, `.zip`) kèm báo cáo độ phủ và liên kết tải có thời hạn 24h.
16. `apps/api/src/modules/usage/FEATURE.md` — Sổ cái hạn ngạch token theo ngày UTC (`reserve` / `actual` / `refund`) và cầu chì ngân sách toàn hệ thống.

### Tầng Tiến trình Nền & Giao diện Người dùng (`apps/worker`, `apps/web`)
17. `apps/worker/FEATURE.md` — Kiến trúc BullMQ Worker, `PipelineProcessor` chạy trọn vẹn `S1 → S8` có lưu điểm dừng, `ArchProcessor` và `ExportProcessor`.
18. `apps/web/FEATURE.md` — Ứng dụng React SPA (`Tailwind CSS + Lucide + CodeMirror 6`), từ điển song ngữ `VI/EN` tức thì, và thiết kế chi tiết 5 màn hình nghiệp vụ.

---

## 5. Lộ trình Thực thi 4 Phase Đã Chốt

| Phase | Phạm vi Trọng tâm | Điều kiện Hoàn thành (Definition of Done) |
| :--- | :--- | :--- |
| **Phase 1** | **Nền tảng P0, DB/RLS, PDF/DOCX, Khép kín `S1–S8` Tier-0 (`Eco`), PlantUML & Knowledge Arch** | Sửa dứt điểm lỗi DB (`session_id`, RLS 18 bảng, nullable `segments.document_id`), bỏ nuốt lỗi `catch {}`, đọc được `.pdf`/`.docx`, chạy thông `S1 → S8` trên PostgreSQL + Worker, tổng hợp kiến trúc từ YAML Catalog, render C4 offline `<C4/...>`, tải được file/ZIP thật. |
| **Phase 2** | **Giao diện Web SPA (`@srs-tool/web`)** | Hoàn thiện 5 trang React với Tailwind + Lucide + CodeMirror 6, đổi ngôn ngữ `VI/EN` tức thì, theo dõi tiến độ chạy qua SSE, trả lời câu hỏi `S5`, sửa sơ đồ 2 chế độ và duyệt patch Agent. |
| **Phase 3** | **Cổng `LlmGateway` (Gemini + OpenAI-compatible), Tier-2 Batch & AI Agent thật** | Cài đặt adapter Gemini & OpenAI-compatible chọn qua `LLM_PROVIDER`, Zod structured output, Redis cache, nối Tier-2 batch cho `S2/S3/S6/S7/S8` và tool-calling thật cho `AgentService`. |
| **Phase 4** | **Tier-1 Local CPU ML (`LocalModelPort`), OAuth Production & Benchmark KLTN** | Nối `@huggingface/transformers` (embedding 384 chiều + NLI) với `pgvector`, khoá bảo mật OAuth/Ownership cho production, cấu hình ESLint và dựng bộ đánh giá thực nghiệm cho khoá luận. |

---

## 6. Các Lệnh Làm việc Chuẩn (Chạy từ thư mục gốc workspace hoặc `srs-tool`)

```powershell
# Biên dịch toàn bộ 9 packages theo thứ tự phụ thuộc Turborepo
pnpm --dir srs-tool build

# Kiểm tra kiểu dữ liệu TypeScript nghiêm ngặt
pnpm --dir srs-tool typecheck

# Chạy toàn bộ Unit Tests (Vitest)
pnpm --dir srs-tool test

# Chạy Smoke Test đầu-cuối trên Worker với PostgreSQL (cần bật Docker Postgres)
pnpm --dir srs-tool --filter @srs-tool/worker smoke

# Khởi động hạ tầng cục bộ (PostgreSQL pgvector + Redis + MinIO + PlantUML internal)
docker compose -f srs-tool/docker/docker-compose.yml up -d postgres redis minio plantuml
```
