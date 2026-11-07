# Đặc tả Tính năng: Lược đồ Dữ liệu Dùng chung (`@srs-tool/schemas`)

## 1. Mục tiêu & Mã Yêu cầu Liên quan
- **Vai trò:** Cung cấp tập hợp duy nhất các lược đồ **Zod** và kiểu dữ liệu **TypeScript** (`z.infer`) dùng chung xuyên suốt giữa Giao diện Web (`@srs-tool/web`), REST API (`@srs-tool/api`), Pipeline (`@srs-tool/pipeline`), Bộ sinh sơ đồ (`@srs-tool/plantuml-gen`) và kiểm chứng đầu ra có cấu trúc của LLM (`@srs-tool/llm`).
- **Mã yêu cầu đặc tả:**
  - `NFR-MNT-001`: Phát triển bằng TypeScript với một gói schema dùng chung cho giao diện, API và đầu ra LLM.
  - `FR-REQ-003`, `FR-REQ-013`: Cấu trúc yêu cầu chuẩn EARS + thuộc tính chất lượng (`QualityMetric`), tiêu chí chấp nhận (`acceptance_criteria`), phương pháp kiểm chứng (`verification_method`).
  - `FR-DIA-005`, `FR-AGT-002`, `NFR-SEC-003`: Cấu trúc `ArchitectureModel` JSON và phép biến đổi `ModelPatch` (`PatchOperation` có kiểm tra kiểu chặt).
  - `FR-ING-006`, `FR-ADM-001`: Cấu trúc báo cáo độ phủ (`CoverageReport`) và hạn ngạch (`Usage`).

---

## 2. Ranh giới Package & Phụ thuộc
- **Đường dẫn:** `srs-tool/packages/schemas` (`src/index.ts`).
- **Phụ thuộc cho phép:** Chỉ phụ thuộc `zod` (tuyệt đối **không** import bất kỳ package nội bộ `@srs-tool/*`, thư viện Node-only như `fs`/`crypto`, hay NestJS/React để đảm bảo chạy được cả trên trình duyệt lẫn Node.js).
- **Bảng CSDL sở hữu:** Không truy cập CSDL.

---

## 3. Hợp đồng Lược đồ & Bất biến Dữ liệu

### 3.1. Các Enum Nghiệp vụ Cốt lõi
| Schema | Giá trị Hợp lệ | Ý nghĩa Nghiệp vụ |
| :--- | :--- | :--- |
| `LanguageSchema` | `'vi' \| 'en'` | Ngôn ngữ đầu vào / đầu ra (`FR-ING-007`, `NFR-USA-001`). |
| `PlatformSchema` | `'web' \| 'mobile' \| 'iot' \| 'shared'` | Nền tảng mục tiêu của dự án/yêu cầu (`FR-ARC-002`). |
| `ProcessingModeSchema` | `'eco' \| 'standard' \| 'thorough'` | Chế độ định tuyến của `DecisionRouter` (`FR-REQ-017`). |
| `DecisionTierSchema` | `'rule' \| 'local' \| 'llm'` | Bậc xử lý đã ra quyết định (`NFR-LLM-003`). |
| `EarsPatternSchema` | `'ubiquitous' \| 'event-driven' \| 'state-driven' \| 'optional' \| 'unwanted' \| 'complex'` | 6 mẫu câu chuẩn EARS (`FR-REQ-003`). |
| `RequirementTypeSchema` | `'functional' \| 'non-functional' \| 'constraint' \| 'interface' \| 'assumption'` | Phân loại yêu cầu (`FR-REQ-002`). |
| `OriginSchema` | `'explicit' \| 'inferred' \| 'assumption'` | Nguồn gốc yêu cầu: từ tài liệu gốc, hệ thống gợi ý mặc định, hoặc giả định do bỏ qua câu hỏi (`FR-REQ-007..008`). |
| `SegmentCoverageStatusSchema` | `'unmapped' \| 'mapped' \| 'not_requirement' \| 'unresolved'` | Trạng thái Sổ phủ của từng đoạn nguồn (`FR-ING-006`). |
| `RequirementStatusSchema` | `'candidate' \| 'classified' \| 'needs_clarification' \| 'normalized' \| 'approved' \| 'merged' \| 'rejected' \| 'deprecated'` | Vòng đời của một yêu cầu. |
| `RunStatusSchema` | `'queued' \| 'running' \| 'waiting_input' \| 'over_budget' \| 'succeeded' \| 'failed' \| 'cancelled' \| 'expired'` | Trạng thái tiến trình chạy pipeline (`FR-RVW-007`). |

### 3.2. Các Thực thể & Hợp đồng Chính
1. **`SegmentSchema`:**
   - Lưu ý quan trọng cho **Phase 1**: `document_id` cần hỗ trợ `z.string().uuid().nullable()` để biểu diễn hợp lệ cả đoạn văn bản trích từ tài liệu tải lên lẫn đoạn văn bản sinh từ câu trả lời làm rõ của người dùng ở `S5` (`questions.answer_segment_id`).
2. **`RequirementSchema` & `QualityMetricSchema`:**
   - Ràng buộc `quality_score` là số nguyên `0..100`, `confidence` thuộc `[0, 1]`.
   - `QualityMetricSchema` biểu diễn kịch bản thuộc tính chất lượng 6 phần (nguồn kích thích, kích thích, môi trường, đối tượng, phản hồi, `response_measure` chứa con số + đơn vị).
3. **`ArchitectureModelSchema` & `ModelPatchSchema`:**
   - `ArchElementKindSchema`: `'person' | 'system' | 'container' | 'component' | 'device' | 'datastore'`.
   - `ViewTypeSchema`: `'context' | 'container' | 'component' | 'deployment' | 'sequence' | 'dataflow' | 'er'`.
   - `PatchOperationSchema` (`discriminatedUnion('op', ...)`): Chỉ cho phép đúng 6 thao tác nguyên tử: `add_element`, `remove_element`, `update_element`, `add_relationship`, `remove_relationship`, `add_tech_choice`.
   - `ModelPatchSchema`: Bắt buộc có `expected_version: z.number().int()` để kiểm tra khoá lạc quan.
4. **Lược đồ DTO cho API & LLM Structured Output (Bổ sung theo lộ trình):**
   - Các schema kiểm chứng body request của REST API (`CreateProjectDtoSchema`, `AnswerQuestionDtoSchema`, `StartRunDtoSchema`, `CreateExportDtoSchema`) và schema đầu ra theo lô của LLM ở Phase 3 (`LlmExtractionBatchSchema`, `LlmClassificationBatchSchema`, `LlmNormalizationBatchSchema`, `LlmMergeVerdictSchema`).

---

## 4. Thực trạng Code Hiện tại & Lộ trình Triển khai

### Trạng thái hiện tại (`~85%`)
- Đã định nghĩa đầy đủ 28 schemas & types cốt lõi trong `src/index.ts`, biên dịch sạch sẽ sang CommonJS/DTS.
- **Tồn tại cần khắc phục:**
  1. `SegmentSchema.document_id` hiện đang là `z.string().uuid()` (chưa `.nullable()`), chưa khớp với nhu cầu tạo `Segment` từ câu trả lời làm rõ không thuộc file tài liệu nào.
  2. Chưa có các DTO Zod schemas dùng cho runtime validation tại các Controller của `@srs-tool/api` (hiện các Controller đang ép kiểu bằng `interface` TypeScript thuần nên không chặn được payload sai định dạng lúc chạy).
  3. Chưa có bộ unit test `src/index.spec.ts`.

### Kế hoạch theo Phase
- **Phase 1:**
  - Cập nhật `SegmentSchema` cho phép `document_id: z.string().uuid().nullable()`.
  - Bổ sung các Request DTO Schemas cơ bản (`CreateProjectDtoSchema`, `AnswerQuestionDtoSchema`, `UpdateChecklistDtoSchema`, `StartRunDtoSchema`) để `@srs-tool/api` validate tại runtime.
  - Viết `src/index.spec.ts` kiểm thử các trường hợp hợp lệ/không hợp lệ của `ModelPatchSchema`, `RequirementSchema`, `CoverageReportSchema`.
- **Phase 3:**
  - Bổ sung các Zod Schemas cho đầu ra JSON của LLM (`S2`, `S3`, `S6`, `S7`, `S8` và `AgentToolCall`) để truyền trực tiếp vào `LlmGateway.generate({ schema })`.

---

## 5. Tiêu chí Nghiệm thu & Kịch bản Kiểm thử
- [ ] `ModelPatchSchema.safeParse(...)` từ chối mọi thao tác `op` nằm ngoài 6 thao tác cho phép hoặc thiếu `expected_version`.
- [ ] `SegmentSchema.safeParse(...)` chấp nhận cả `document_id` là UUID hợp lệ lẫn `null`, nhưng từ chối chuỗi rác như `"iss_chk_123"`.
- [ ] Gói `@srs-tool/schemas` biên dịch thành công (`pnpm --filter @srs-tool/schemas build && pnpm --filter @srs-tool/schemas test`) mà không kéo theo bất kỳ dependency phía server nào vào bundle của `@srs-tool/web`.
