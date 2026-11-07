# Đặc tả Tính năng: Cổng Kết nối LLM Đa Nhà cung cấp (`@srs-tool/llm`)

## 1. Mục tiêu & Mã Yêu cầu Liên quan
- **Vai trò:** Là **điểm đi ra duy nhất** của toàn hệ thống tới các nhà cung cấp mô hình ngôn ngữ lớn bên ngoài (**Tier 2** của Pipeline và **AI Agent**). Đảm nhiệm định tuyến mô hình (`llm-small` / `llm-large`), ép kiểu đầu ra theo lược đồ **Zod**, bộ nhớ đệm theo mã băm nội dung, tự động thử lại khi lỗi mạng/schema, ghi sổ token và ngắt mạch khi chạm trần ngân sách toàn cục.
- **Mã yêu cầu đặc tả:**
  - `FR-ADM-001..003`: Kiểm tra hạn ngạch người dùng trước khi gọi, ghi sổ thực tế (`usage_ledger`) và kích hoạt cầu chì ngân sách toàn hệ thống (`GlobalBudgetExceededError`).
  - `NFR-COST-002`: Tuyệt đối không gọi lại LLM cho cùng cặp `(input, prompt_version, model)` — phải trả kết quả từ cache.
  - `NFR-OBS-001`, `NFR-QUAL-008`: Ghi log mỗi lời gọi gồm `promptVersion`, `model`, `inputTokens`, `outputTokens`, `latencyMs`, `costUsd` và `runId`.
  - `NFR-REL-002`: Tự động thử lại tối đa 2 lần với backoff khi nhà cung cấp trả lỗi tạm thời (`429`/`5xx`) hoặc JSON không khớp Zod schema; nâng cấp từ `llm-small` lên `llm-large` khi vẫn lỗi schema.
  - `NFR-PRIV-001`: Đóng gói nội dung tài liệu nguồn trong thẻ dữ liệu tách biệt với chỉ dẫn hệ thống để giảm thiểu prompt injection.

---

## 2. Cấu trúc Thư mục & Phụ thuộc
- **Đường dẫn:** `srs-tool/packages/llm`
  - `src/types.ts`: Các kiểu `ModelAlias` (`'llm-small' | 'llm-large'`), `LlmCallOptions<T>`, `LlmCallResult<T>`, `PromptTemplate`, `UsageRecorder`, `LlmCacheStore`, và các lớp lỗi `QuotaExceededError`, `GlobalBudgetExceededError`, `LlmSchemaValidationError`.
  - `src/prompt-registry.ts`: Quản lý đăng ký và render mẫu prompt có phiên bản (`{{variable}}`).
  - `src/gateway.ts`: Lớp điều phối trung tâm `LlmGateway`.
  - `src/providers/` *(Tạo ở Phase 3)*:
    - `provider.port.ts`: Giao diện `LlmProviderAdapter` chung.
    - `gemini.adapter.ts`: Kết nối **Google Gemini API** (mặc định `gemini-2.5-flash` cho `llm-small`, `gemini-2.5-pro` cho `llm-large`, hỗ trợ `responseMimeType: 'application/json'` + JSON Schema).
    - `openai-compatible.adapter.ts`: Kết nối **OpenAI-compatible Chat Completions API** (`baseURL` tuỳ chỉnh dùng được cho OpenAI, Groq, OpenRouter, Ollama, vLLM).
  - `src/cache/` *(Tạo ở Phase 3)*: In-memory LRU + Redis SHA-256 cache adapter.
- **Phụ thuộc cho phép:** `zod`, `@srs-tool/schemas`, `ioredis` (tuỳ chọn cho cache), `fetch` chuẩn của Node 20+ (hoặc SDK mỏng). **Không** phụ thuộc `@srs-tool/db`.

---

## 3. Hợp đồng Giao diện & Luồng Xử lý Chuẩn

### 3.1. Cấu hình qua Biến Môi trường (Đã chốt kiến trúc Phase 3)
```env
LLM_PROVIDER=gemini                  # 'gemini' | 'openai-compatible' | 'disabled'
GEMINI_API_KEY=...
LLM_SMALL_MODEL=gemini-2.5-flash     # hoặc gpt-4o-mini / llama-3.3-70b-versatile
LLM_LARGE_MODEL=gemini-2.5-pro       # hoặc gpt-4o
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=...
GLOBAL_DAILY_BUDGET_USD=10.0         # Cầu chì ngân sách toàn hệ thống trong ngày UTC
```

### 3.2. Luồng 8 Bước bên trong `LlmGateway.generate<T>(options)`
1. **Kiểm tra trạng thái kích hoạt & Cầu chì ngân sách:** Nếu `LLM_PROVIDER === 'disabled'` hoặc tổng chi tiêu toàn hệ thống trong ngày UTC `>= globalDailyBudgetUsd` → ném `GlobalBudgetExceededError` ngay lập tức (để `DecisionRouter` tự hạ về kết quả Tier 0/1 kèm trạng thái `pending_llm` theo `NFR-LLM-002`).
2. **Tính khoá Cache tất định (`NFR-COST-002`):**
   - `cacheKey = sha256(JSON.stringify({ provider, resolvedModel, promptId, promptVersion, systemPrompt, userPrompt, temperature }))`.
   - Nếu trúng cache → trả về ngay `LlmCallResult<T>` với `cached: true`, `inputTokens: 0`, `outputTokens: 0`, `costUsd: 0` (không trừ quota người dùng).
3. **Kiểm tra & Giữ chỗ Hạn ngạch (`Quota`):** Gọi `usageRecorder.checkQuota(userId, maxOutputTokens + estimatedInputTokens)`. Nếu thiếu → ném `QuotaExceededError`.
4. **Gọi Adapter Nhà cung cấp (`Gemini` / `OpenAI-compatible`):** Truyền kèm JSON Schema sinh từ `options.schema` và timeout chặt (mặc định `30_000ms`).
5. **Kiểm chứng Zod Schema (`NFR-REL-002`):**
   - Parse chuỗi JSON và kiểm tra bằng `options.schema.safeParse(parsed)`.
   - Nếu lỗi cú pháp JSON hoặc sai schema: thử lại tối đa 2 lần (có đính kèm thông báo lỗi Zod ngắn gọn để mô hình tự sửa); nếu đang dùng `llm-small` mà vẫn thất bại ở lần cuối và cho phép nâng bậc, thử 1 lần với `llm-large`. Nếu vẫn thất bại → ném `LlmSchemaValidationError`.
6. **Tính Chi phí & Ghi Sổ (`NFR-OBS-001`):**
   - Quy đổi `costUsd` theo bảng đơn giá cấu hình trên 1 triệu input/output tokens của từng model.
   - Gọi `usageRecorder.recordUsage(...)` kèm đủ 6 trường quan sát bắt buộc (`runId`, `promptVersion`, `model`, `inputTokens`, `outputTokens`, `latencyMs`, `costUsd`).
7. **Lưu vào Cache:** Ghi kết quả hợp lệ vào Redis / Memory cache (TTL mặc định 7 ngày) sau khi đã qua bước kiểm chứng Zod.
8. **Xử lý Lô (`batchGenerate`):** Gộp tới `N` mục nhỏ (VD: 10–20 đoạn văn bản cần phân loại ở `S2`/`S3`) vào một lời gọi mảng JSON duy nhất để tiết kiệm tối đa token system prompt (`NFR-LLM-001`).

---

## 4. Thực trạng Code Hiện tại & Lộ trình Triển khai

### Trạng thái hiện tại (`~10%`)
- Đã có sẵn các file khung `src/types.ts`, `src/prompt-registry.ts`, `src/gateway.ts`, `src/index.ts`.
- Cả hai phương thức `LlmGateway.generate()` (`src/gateway.ts:87`) và `LlmGateway.batchGenerate()` (`src/gateway.ts:106`) hiện đang ném lỗi cứng `Error('LlmGateway.generate() not yet implemented — requires provider SDK configuration')`.
- Chưa có cache, chưa có bộ quy đổi `zod -> JSON Schema`, chưa có unit test.

### Kế hoạch theo Phase
- **Phase 1 & Phase 2:** Giữ nguyên giao diện `LlmGateway` và các lớp lỗi (`QuotaExceededError`, `GlobalBudgetExceededError`); đảm bảo khi `LlmGateway` chưa cấu hình API key hoặc ở chế độ `eco`, toàn bộ hệ thống xử lý mượt mà bằng Tier 0 mà không crash.
- **Phase 3 (Trọng tâm hiện thực hoá `@srs-tool/llm`):**
  - Viết `GeminiAdapter` và `OpenAiCompatibleAdapter` sử dụng `fetch` chuẩn (không phụ thuộc nặng SDK dễ xung đột phiên bản), hỗ trợ cả retry `429`/`503` có exponential backoff.
  - Viết bộ chuyển đổi nhẹ từ Zod Schema sang JSON Schema chuẩn cho Structured Outputs.
  - Cài đặt SHA-256 Cache (`Redis` có fallback sang `Map` khi chạy local/test) để đạt chuẩn `NFR-COST-002`.
  - Hoàn thiện `generate()` và `batchGenerate()`, kết nối với `UsageService` của API và Worker.
  - Viết bộ unit test `src/gateway.spec.ts` dùng mock HTTP transport để kiểm chứng: trúng cache lần gọi thứ 2, retry khi JSON sai schema, nâng cấp `llm-small -> llm-large`, và chặn bởi `GlobalBudgetExceededError`.

---

## 5. Tiêu chí Nghiệm thu & Kịch bản Kiểm thử
- [ ] Gọi `gateway.generate(...)` hai lần liên tiếp với cùng đầu vào, cùng `promptVersion` và cùng `model`: lần thứ 2 không phát sinh HTTP request nào và trả về `cached: true` (`NFR-COST-002`).
- [ ] Khi adapter giả lập trả về JSON thiếu trường bắt buộc ở lần 1 và trả đúng ở lần 2, `gateway.generate(...)` tự động retry và trả kết quả hợp lệ; nếu sai cả 3 lần thì ném `LlmSchemaValidationError`.
- [ ] Khi tổng `costUsd` trong ngày chạm `globalDailyBudgetUsd`, mọi lời gọi tiếp theo ném `GlobalBudgetExceededError` trước khi chạm tới mạng.
- [ ] Mọi lời gọi thành công đều kích hoạt `usageRecorder.recordUsage` với đủ `promptVersion`, `model`, `inputTokens`, `outputTokens`, `latencyMs`, `costUsd`, `runId` (`NFR-OBS-001`).
