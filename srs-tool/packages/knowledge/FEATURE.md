# Đặc tả Tính năng: Kho Tri thức Nền tảng & Danh mục Công nghệ (`@srs-tool/knowledge`)

## 1. Mục tiêu & Mã Yêu cầu Liên quan
- **Vai trò:** Đóng gói toàn bộ dữ liệu tri thức kỹ thuật ở dạng cấu hình ngoài mã nguồn (**YAML** + **Prompt Templates** có gắn phiên bản) và cung cấp bộ hàm nạp có kiểm kiểu TypeScript cho Pipeline (`S4`, `S5`) cũng như Bộ tổng hợp kiến trúc & stack (`ArchitectureService`).
- **Mã yêu cầu đặc tả:**
  - `FR-ARC-001`: Dựng mô hình kiến trúc cơ sở từ mẫu tham chiếu và danh mục chiến thuật kiến trúc (`tactics-catalog.yaml`), không phụ thuộc LLM.
  - `FR-ARC-002`, `FR-ARC-006`, `FR-ARC-007`: Hồ sơ nền tảng `web`, `mobile`, `iot` và `shared` nằm ở tệp cấu hình YAML để mở rộng nền tảng mà không sửa code pipeline.
  - `FR-ARC-003`, `FR-ARC-004`: Danh mục công nghệ (`tech-catalog.yaml`) lưu rõ `updated_at`, nguồn, điểm số theo tiêu chí, đánh đổi (`tradeoffs`) và phương án thay thế (`alternatives`); tuyệt đối không để LLM tự bịa phiên bản hay giá cả.
  - `FR-REQ-008`: Cung cấp bảng giá trị mặc định hợp lý (`default_values`) cho câu hỏi làm rõ `S5` (luôn đi kèm cờ `origin = 'inferred'`).
  - `NFR-QUAL-008`: Quản lý phiên bản các mẫu prompt (`prompts/*.yaml` / registry) phục vụ truy vết thực nghiệm.

---

## 2. Cấu trúc Thư mục & Phụ thuộc
- **Đường dẫn:** `srs-tool/packages/knowledge`
  - `profiles/web.yaml`: Hồ sơ checklist & mặc định cho ứng dụng Web (SEO/SSR, CORS/CSRF, Auth/Session, Browser Support, Rate Limit...).
  - `profiles/mobile.yaml`: Hồ sơ cho ứng dụng Di động (Offline Sync, Push Notification, Deep Link, Battery/Background, Store Compliance...).
  - `profiles/iot.yaml`: Hồ sơ cho hệ thống IoT (Device Provisioning, MQTT/CoAP Protocol, OTA Update, Store-and-Forward khi mất mạng, Power Budget, Device Security...).
  - `profiles/shared.yaml` *(Tạo mới ở Phase 1)*: Hồ sơ các chủ đề dùng chung mọi dự án (Sao lưu & khôi phục, Nhật ký kiểm toán/Audit, Quyền riêng tư dữ liệu, Đa ngôn ngữ/Múi giờ, Giám sát/Observability).
  - `catalog/tech-catalog.yaml`: Danh mục công nghệ chia theo `layer` (`frontend_web`, `mobile`, `backend_api`, `database_oltp`, `cache_queue`, `iot_broker`, `timeseries_db`, `storage`, `auth`...).
  - `catalog/tactics-catalog.yaml`: Danh mục chiến thuật kiến trúc ánh xạ từ thuộc tính chất lượng ASR (`performance`, `availability`, `security`, `scalability`, `iot_connectivity`, `iot_lifecycle`...) sang phần tử/quan hệ kiến trúc cần thêm.
  - `prompts/` *(Tạo ở Phase 3)*: Kho mẫu prompt có đánh số phiên bản cho `S2`, `S3`, `S6`, `S7`, `S8` và `Agent`.
  - `src/index.ts`: Trình nạp và cache trong bộ nhớ cho toàn bộ tệp YAML.
- **Phụ thuộc cho phép:** `yaml`, `@srs-tool/schemas` (hoặc thuần TypeScript + Node `fs`/`path`). Không phụ thuộc `@srs-tool/db` hay `@srs-tool/llm`.

---

## 3. Hợp đồng Dữ liệu & Giao diện Hàm (`src/index.ts`)

### 3.1. Kiểu dữ liệu Chuẩn hoá (Khớp 100% với tệp YAML)
```typescript
export interface ChecklistItem {
  id: string;                 // VD: 'web-auth', 'iot-ota', 'shared-backup'
  topic_vi: string;
  topic_en: string;
  keywords_vi: string[];
  keywords_en: string[];
  question_vi: string;
  question_en: string;
  severity: 'error' | 'warning' | 'info';
  suggested_default?: string; // Giá trị gợi ý cho S5 (nếu có)
}

export interface PlatformProfile {
  platform: 'web' | 'mobile' | 'iot' | 'shared';
  version: string;
  name_vi: string;
  name_en: string;
  checklist: ChecklistItem[];
  default_values?: Record<string, string | number | boolean>;
  architecture_hints?: {
    required_containers?: Array<{
      id: string;
      kind: 'container' | 'datastore' | 'device';
      name_vi: string;
      name_en: string;
      technology?: string;
      description_vi?: string;
      description_en?: string;
    }>;
  };
}

export interface TechEntry {
  id: string;
  name: string;
  layer: string;
  platforms: string[];
  tags?: string[];
  license: string;
  maturity: 'high' | 'medium' | 'low' | 'proven' | 'emerging' | 'niche';
  learning_curve?: 'low' | 'medium' | 'high';
  scores: Record<string, number>; // VD: { performance: 8, ecosystem: 10, dx: 9, cost_efficiency: 9 }
  tradeoffs: string | { pros: string[]; cons: string[] };
  alternatives: string[];
  source?: string;
}

export interface TechCatalog {
  version: string;
  updated_at: string;
  entries: TechEntry[];
  technologies: TechEntry[]; // Alias trỏ cùng mảng entries để tương thích ngược
}

export interface TacticItem {
  id: string;
  quality_attribute: string;
  name_vi: string;
  name_en: string;
  condition: string;
  keywords_vi?: string[];
  keywords_en?: string[];
  adds_elements: string[];
  adds_relationships: Array<{ from: string; to: string; label?: string; protocol?: string }>;
  stack_tags: string[];
  rationale_vi: string;
  rationale_en: string;
}
```

### 3.2. Các Hàm Xuất Công khai
- `loadPlatformProfile(platform: string): PlatformProfile` — Đọc và cache hồ sơ YAML tương ứng.
- `loadCombinedChecklist(platforms: string[]): ChecklistItem[]` — Tự động hợp nhất checklist của các `platforms` được chọn **cộng thêm `shared`** (khử trùng lặp theo `id`).
- `loadPlatformDefaults(platforms: string[]): Record<string, string | number | boolean>` — Hợp nhất `default_values` từ `shared` và các `platforms` của dự án để cấp cho `S5QuestionBuilder`.
- `loadTechCatalog(): TechCatalog` — Đọc `catalog/tech-catalog.yaml`, chuẩn hoá cả `entries` và `technologies`.
- `loadTacticsCatalog(): TacticsCatalog` — Đọc `catalog/tactics-catalog.yaml`.

---

## 4. Thực trạng Code Hiện tại & Các Bug Cần Sửa

### Trạng thái hiện tại (`~65%`)
1. **BUG P0 — Lệch lược đồ giữa `src/index.ts` và `catalog/tech-catalog.yaml`:**
   - Tệp `catalog/tech-catalog.yaml` khai báo `updated_at`, mảng gốc tên là `entries`, `maturity: high | medium`, `tradeoffs` kiểu `string` và có `scores` + `alternatives`.
   - Nhưng `src/index.ts` lại khai báo `last_updated`, đọc `technologies` (`catalog.technologies` trả về `undefined`!), và định nghĩa `tradeoffs: { pros: string[]; cons: string[] }`.
2. **Thiếu `profiles/shared.yaml`:**
   - Hiện tại các mục checklist dùng chung (`shared-backup`, `shared-audit`...) đang bị viết cứng (hardcode) rải rác trong `ProjectsService.getChecklist` thay vì nằm trong `packages/knowledge/profiles/shared.yaml` như đặc tả `FR-ARC-002`.
3. **Chưa đọc `default_values`:**
   - `web.yaml`, `mobile.yaml`, `iot.yaml` đã có mục `default_values` ở cuối file nhưng interface `PlatformProfile` trong `src/index.ts` bỏ qua trường này.
4. **Chưa có unit test:** Package hiện có `0` file test.

### Kế hoạch theo Phase
- **Phase 1:**
  - Tạo `profiles/shared.yaml` đầy đủ song ngữ Việt–Anh với `checklist` và `default_values`.
  - Sửa `src/index.ts` khớp hoàn toàn với `tech-catalog.yaml` và `tactics-catalog.yaml`, bổ sung `loadPlatformDefaults`, tự động gộp `shared` trong `loadCombinedChecklist`.
  - Bổ sung từ khoá nhận diện song ngữ (`keywords_vi`, `keywords_en`) rõ ràng cho `tactics-catalog.yaml` và thêm các lựa chọn công nghệ thiết yếu còn thiếu trong `tech-catalog.yaml` (nếu thiếu tầng IoT / Time-series / Storage / Auth) để bộ chấm điểm kiến trúc hoạt động phong phú cho cả `web`, `mobile`, `iot`.
  - Viết `src/index.spec.ts` kiểm tra tính hợp lệ của mọi file YAML trong kho tri thức.
- **Phase 3:**
  - Tạo thư mục `prompts/` chứa các file YAML khai báo system/user prompt song ngữ kèm `version` và nạp tự động vào `PromptRegistry`.

---

## 5. Tiêu chí Nghiệm thu & Kịch bản Kiểm thử
- [ ] `loadTechCatalog().entries.length > 0` và mọi phần tử đều có `id`, `name`, `layer`, `platforms`, `scores`, `alternatives` và `updated_at` hợp lệ.
- [ ] `loadCombinedChecklist(['web'])` trả về đầy đủ cả các mục `web-*` lẫn các mục `shared-*`, không bị trùng `id`.
- [ ] `loadPlatformDefaults(['iot'])` trả về từ điển giá trị mặc định của cả `shared` và `iot`.
- [ ] Mọi mục `ChecklistItem` trong cả 4 file profile đều có đủ cặp trường song ngữ (`*_vi` và `*_en`) không rỗng.
