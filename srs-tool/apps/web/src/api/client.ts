import type {
  ArchitectureModel,
  CoverageReport,
  Language,
  ModelPatch,
  Platform,
  ProcessingMode,
  ViewType,
} from '@srs-tool/schemas';

const BASE = '/api/v1';
const TOKEN_KEY = 'srs_tool_token';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function getAuthToken(): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;
  } catch {
    return null;
  }
}

export function setAuthToken(token: string | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Ignore storage errors in restricted contexts
  }
}

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function request<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init?.headers as Record<string, string>) || {}),
  };
  if (token && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ message: res.statusText }));
    const rawMsg = (errBody as { message?: string | string[] })?.message;
    const msg = Array.isArray(rawMsg) ? rawMsg.join('; ') : rawMsg;
    throw new ApiError(msg ?? `HTTP ${res.status}`, res.status, errBody);
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json() as Promise<T>;
  }
  return (await res.text()) as unknown as T;
}

export function formatApiError(err: unknown, locale: Language): { title: string; hint?: string } {
  if (err instanceof ApiError) {
    const msg = err.message;
    if (err.status === 422 || /scanned|image-only|pdf/i.test(msg)) {
      return {
        title: msg,
        hint:
          locale === 'vi'
            ? 'Gợi ý: Tệp PDF dạng ảnh scan chưa có lớp chữ. Hãy chuyển sang PDF có thể bôi đen chữ, hoặc tải lên .docx / .md / .txt.'
            : 'Hint: This PDF appears to be scanned/image-only. Please upload a text-selectable PDF, or convert to .docx / .md / .txt.',
      };
    }
    if (err.status === 403 && /quota|budget|token|eco/i.test(msg)) {
      return {
        title: msg,
        hint:
          locale === 'vi'
            ? 'Gợi ý: Đã hết hạn mức token hôm nay. Hãy chuyển sang chế độ "Tiết kiệm (Eco - 0 LLM)" để chạy miễn phí không tốn token.'
            : 'Hint: Daily token quota reached. Switch to "Eco (0 LLM)" mode to run the pipeline completely offline at 0 token cost.',
      };
    }
    if (err.status === 409) {
      return {
        title: msg,
        hint:
          locale === 'vi'
            ? 'Gợi ý: Hãy hoàn tất các mục đang chặn (câu hỏi S5, đoạn chưa gán hoặc yêu cầu Inferred chưa xác nhận) rồi thử lại.'
            : 'Hint: Resolve the blocking items (pending S5 questions, unmapped segments, or unconfirmed Inferred requirements) and try again.',
      };
    }
    if (err.status === 401) {
      return {
        title: msg,
        hint:
          locale === 'vi'
            ? 'Gợi ý: Phiên đăng nhập đã hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại.'
            : 'Hint: Your session has expired or is invalid. Please sign in again.',
      };
    }
    return { title: msg };
  }
  if (err instanceof Error) {
    return { title: err.message };
  }
  return {
    title: locale === 'vi' ? 'Đã xảy ra lỗi không xác định.' : 'An unexpected error occurred.',
  };
}

// ============================================================================
// Domain Types matching Backend API responses
// ============================================================================

export interface UserProfile {
  id: string;
  email: string;
  plan: string;
  locale: Language;
  dailyLimitTokens?: number;
}

export interface UsageSummary {
  userId: string;
  dailyLimitTokens: number;
  usedTokens: number;
  remainingTokens: number;
  resetsAt: string;
}

export interface UsageLedgerEntry {
  id: string;
  userId: string;
  runId: string | null;
  kind: 'reserve' | 'actual' | 'refund';
  inputTokens: number;
  outputTokens: number;
  model: string;
  costUsd: number;
  createdAt: string;
}

export interface ProjectRecord {
  id: string;
  ownerId: string;
  name: string;
  platforms: Platform[];
  outputLanguage: Language;
  constraints?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  coverage_summary?: CoverageReport;
}

export interface SegmentRecord {
  id: string;
  documentId: string | null;
  projectId: string;
  ordinal: number;
  text: string;
  locator: Record<string, unknown>;
  language: Language;
  coverageStatus: 'unmapped' | 'mapped' | 'not_requirement' | 'unresolved';
  resolvedBy?: 'rule' | 'local' | 'llm' | null;
  document_filename?: string | null;
  linked_requirements?: Array<{
    id: string;
    code: string;
    statement: string;
    status: string;
  }>;
}

export interface ChecklistItemStatus {
  id: string;
  platform: string;
  topic: { vi: string; en: string };
  keywords: { vi: string[]; en: string[] };
  quality: string;
  level: 'required' | 'recommended' | 'conditional';
  question: { vi: string; en: string };
  status: 'covered' | 'mentioned' | 'missing' | 'not_applicable';
  matchedRequirementId?: string;
  reason?: string;
}

export interface DocumentRecord {
  id: string;
  projectId: string;
  kind: 'srs' | 'text' | 'email';
  s3Key: string;
  sha256: string;
  filename: string;
  mimeType: string;
  sizeBytes?: number;
  createdAt: string;
}

export interface RunRecord {
  id: string;
  projectId: string;
  kind: string;
  mode: ProcessingMode;
  fromStage: number;
  status: 'queued' | 'running' | 'waiting_input' | 'over_budget' | 'succeeded' | 'failed' | 'cancelled' | 'expired';
  progress: number;
  errorMessage?: string | null;
  queue_status?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DecisionLogEntry {
  id: string;
  runId: string;
  stage: number;
  subjectType: string;
  subjectId: string;
  tier: 'rule' | 'local' | 'llm';
  confidence: number;
  version: string;
  status: 'decided' | 'pending_llm' | 'needs_review';
  decidedAt: string;
}

export interface RunDecisionsReport {
  run_id: string;
  total_decisions: number;
  tier_breakdown: {
    tier0_rule_pct: number;
    tier1_local_pct: number;
    tier2_llm_pct: number;
  };
  pending_llm_items: DecisionLogEntry[];
  needs_review_items: DecisionLogEntry[];
}

export interface RequirementSourceLink {
  requirementId: string;
  segmentId: string;
  quote: string | null;
  createdAt: string;
  segment?: {
    id: string;
    ordinal: number;
    text: string;
    locator: Record<string, unknown>;
    language: Language;
    coverageStatus: string;
    documentId: string | null;
  } | null;
}

export interface RequirementVersionRecord {
  requirementId: string;
  version: number;
  snapshot: Record<string, unknown>;
  changedBy: string;
  createdAt: string;
}

export interface RequirementRecord {
  id: string;
  projectId: string;
  code: string;
  type: 'functional' | 'non-functional' | 'constraint' | 'interface' | 'assumption';
  platforms: Platform[];
  earsPattern: 'ubiquitous' | 'event-driven' | 'state-driven' | 'optional' | 'unwanted' | 'complex';
  statement: string;
  statementOriginal: string;
  language: Language;
  rationale?: string | null;
  acceptanceCriteria?: string | null;
  verificationMethod: 'test' | 'analysis' | 'inspection' | 'demonstration';
  priority: 'must' | 'should' | 'could' | 'wont';
  metric?: Record<string, unknown> | null;
  isAsr: boolean;
  origin: 'explicit' | 'inferred' | 'assumption';
  status: string;
  qualityScore: number;
  issues: string[];
  resolvedBy: 'rule' | 'local' | 'llm';
  confidence: number;
  createdAt: string;
  updatedAt: string;
  sources?: RequirementSourceLink[];
  versions?: RequirementVersionRecord[];
}

export interface ClarificationQuestion {
  id: string;
  projectId: string;
  issueId?: string | null;
  ruleId?: string | null;
  topicGroup?: string | null;
  text: string;
  proposedValue?: string | null;
  answer?: string | null;
  answerSegmentId?: string | null;
  status: 'pending' | 'answered' | 'skipped';
  createdAt: string;
}

export interface GlossaryTerm {
  id: string;
  projectId: string;
  termVi: string;
  termEn: string;
  definition: string;
  createdAt: string;
}

export interface TechRecommendationRecord {
  id?: string;
  modelId?: string;
  layer: string;
  choice: string;
  score?: number;
  alternatives: string[];
  rationale: string;
  requirementIds?: string[];
  requirement_ids?: string[];
  catalogUpdatedAt?: string;
}

export interface DiagramSummary {
  id: string;
  modelId: string;
  type: ViewType;
  mode: 'model' | 'detached';
}

export interface DiagramDetail {
  id: string;
  modelId: string;
  type: ViewType;
  mode: 'model' | 'detached';
  format?: string;
  puml?: string;
  content?: string;
  svg?: string;
  error?: string;
  syntax_error?: string;
}

export interface AgentPatchRecord {
  id: string;
  sessionId: string;
  modelId: string;
  patch: ModelPatch;
  status: 'pending' | 'accepted' | 'rejected';
  reason?: string;
  createdAt: string;
}

export interface AgentSessionDetail {
  id: string;
  projectId: string;
  userId: string;
  createdAt: string;
  patches: AgentPatchRecord[];
}

export interface AgentPatchProposal {
  patch_id: string;
  status: string;
  explanation: string;
  token_cost: number;
  operations_count: number;
  patch: ModelPatch;
  preview_puml: string;
  preview_svg?: string;
}

export interface ExportRecord {
  export_id: string;
  projectId: string;
  status: 'ready' | 'expired' | 'queued' | 'failed';
  formats: string[];
  size_bytes?: number;
  expires_at: string;
  created_at?: string;
  download_url: string | null;
}

// ============================================================================
// Typed API Client
// ============================================================================

export const api = {
  auth: {
    devToken: async (email?: string) => {
      const res = await request<{ accessToken: string; user: UserProfile }>('/auth/dev-token', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      if (res.accessToken) setAuthToken(res.accessToken);
      return res;
    },
    login: async (email: string, provider?: 'google' | 'github') => {
      const res = await request<{ accessToken: string; user: UserProfile }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, provider }),
      });
      if (res.accessToken) setAuthToken(res.accessToken);
      return res;
    },
    me: () => request<UserProfile>('/auth/me'),
    updateLocale: (locale: Language) =>
      request<UserProfile>('/auth/me', { method: 'PATCH', body: JSON.stringify({ locale }) }),
  },

  projects: {
    list: () => request<ProjectRecord[]>('/projects'),
    create: (data: {
      name: string;
      platforms: Platform[];
      output_language?: Language;
      constraints?: Record<string, unknown>;
    }) => request<ProjectRecord>('/projects', { method: 'POST', body: JSON.stringify(data) }),
    get: (id: string) => request<ProjectRecord>(`/projects/${id}`),
    update: (id: string, data: Record<string, unknown>) =>
      request<ProjectRecord>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: string) => request<{ success: boolean; id: string }>(`/projects/${id}`, { method: 'DELETE' }),
    getCoverage: (id: string) => request<CoverageReport>(`/projects/${id}/coverage`),
    getSegments: (id: string) => request<SegmentRecord[]>(`/projects/${id}/segments`),
    getChecklist: (id: string) => request<ChecklistItemStatus[]>(`/projects/${id}/checklist`),
    updateChecklistItem: (id: string, itemId: string, data: { not_applicable: boolean; reason?: string }) =>
      request(`/projects/${id}/checklist/${encodeURIComponent(itemId)}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    lockBaseline: (id: string) =>
      request<{ project_id: string; status: string; locked_requirements: number; locked_at: string }>(
        `/projects/${id}/lock-baseline`,
        { method: 'POST' },
      ),

    listDocuments: (id: string) => request<DocumentRecord[]>(`/projects/${id}/documents`),
    uploadDocument: async (
      id: string,
      input: File | { text: string; filename?: string; kind?: 'srs' | 'text' | 'email' },
      kind?: 'srs' | 'text' | 'email',
    ) => {
      if (typeof File !== 'undefined' && input instanceof File) {
        const contentBase64 = await fileToBase64(input);
        return request<DocumentRecord>(`/projects/${id}/documents`, {
          method: 'POST',
          body: JSON.stringify({
            contentBase64,
            filename: input.name,
            mimeType: input.type || 'application/octet-stream',
            kind,
          }),
        });
      }
      return request<DocumentRecord>(`/projects/${id}/documents`, {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    deleteDocument: (docId: string) => request(`/documents/${docId}`, { method: 'DELETE' }),

    listRuns: (id: string) => request<RunRecord[]>(`/projects/${id}/runs`),
    startRun: (id: string, opts: { mode?: ProcessingMode; from_stage?: number }) =>
      request<{ run_id: string; projectId: string; mode: ProcessingMode; from_stage: number; status: string }>(
        `/projects/${id}/runs`,
        { method: 'POST', body: JSON.stringify(opts) },
      ),
    getRun: (runId: string) => request<RunRecord>(`/runs/${runId}`),
    getRunDecisions: (runId: string) => request<RunDecisionsReport>(`/runs/${runId}/decisions`),
    escalateRun: (runId: string) => request<{ run_id: string; status: string }>(`/runs/${runId}/escalate`, { method: 'POST' }),
    cancelRun: (runId: string) => request<{ run_id: string; status: string }>(`/runs/${runId}/cancel`, { method: 'POST' }),

    getArchitecture: (id: string) => request<ArchitectureModel>(`/projects/${id}/architecture`),
    synthesizeArchitecture: (id: string) =>
      request<ArchitectureModel>(`/projects/${id}/architecture`, { method: 'POST' }),
    getStack: (id: string) => request<TechRecommendationRecord[]>(`/projects/${id}/stack`),

    createExport: (id: string, formats?: string[]) =>
      request<ExportRecord>(`/projects/${id}/exports`, { method: 'POST', body: JSON.stringify({ formats }) }),
    listExports: (id: string) => request<ExportRecord[]>(`/projects/${id}/exports`),
    getExport: (exportId: string) => request<ExportRecord>(`/exports/${exportId}`),
  },

  requirements: {
    list: (projectId: string, filters?: Record<string, string>) => {
      const cleaned: Record<string, string> = {};
      if (filters) {
        for (const [k, v] of Object.entries(filters)) {
          if (v !== undefined && v !== '') cleaned[k] = v;
        }
      }
      const qs = Object.keys(cleaned).length > 0 ? '?' + new URLSearchParams(cleaned).toString() : '';
      return request<RequirementRecord[]>(`/projects/${projectId}/requirements${qs}`);
    },
    get: (projectId: string, reqId: string) =>
      request<RequirementRecord>(`/projects/${projectId}/requirements/${reqId}`),
    create: (projectId: string, data: Record<string, unknown>) =>
      request<RequirementRecord>(`/projects/${projectId}/requirements`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (projectId: string, reqId: string, data: Record<string, unknown>) =>
      request<RequirementRecord>(`/projects/${projectId}/requirements/${reqId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    revert: (projectId: string, reqId: string, version: number) =>
      request<RequirementRecord>(`/requirements/${reqId}/revert`, {
        method: 'POST',
        body: JSON.stringify({ projectId, version }),
      }),
    diff: (projectId: string, reqId: string, v1: number, v2: number) =>
      request<{
        requirement_id: string;
        version_1: RequirementVersionRecord;
        version_2: RequirementVersionRecord;
        statement_changed: boolean;
        diff: { v1_statement: string; v2_statement: string };
      }>(`/requirements/${reqId}/diff?projectId=${encodeURIComponent(projectId)}&v1=${v1}&v2=${v2}`),
    listQuestions: (projectId: string) =>
      request<ClarificationQuestion[]>(`/projects/${projectId}/questions`),
    answerQuestion: (questionId: string, data: { answer?: string; skip?: boolean }) =>
      request<{
        question_id: string;
        status: string;
        answer_segment_id: string | null;
        requirement_id: string | null;
        re_run_id: string;
      }>(`/questions/${questionId}/answer`, { method: 'POST', body: JSON.stringify(data) }),
    listGlossary: (projectId: string) => request<GlossaryTerm[]>(`/projects/${projectId}/glossary`),
    addGlossary: (projectId: string, data: { term_vi: string; term_en: string; definition: string }) =>
      request<GlossaryTerm>(`/projects/${projectId}/glossary`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },

  diagrams: {
    listByModel: (modelId: string) => request<DiagramSummary[]>(`/models/${modelId}/diagrams`),
    get: (id: string, format: 'json' | 'puml' = 'json') =>
      request<DiagramDetail>(`/diagrams/${id}?format=${format}`),
    updatePuml: (id: string, puml: string) =>
      request<DiagramDetail>(`/diagrams/${id}/puml`, { method: 'PUT', body: JSON.stringify({ puml }) }),
    reset: (id: string) => request<DiagramDetail>(`/diagrams/${id}/reset`, { method: 'POST' }),
  },

  models: {
    get: (id: string) => request<ArchitectureModel>(`/models/${id}`),
    applyPatch: (id: string, patch: ModelPatch) =>
      request<ArchitectureModel>(`/models/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    command: (id: string, command: string) =>
      request<{ model: ArchitectureModel; explanation?: string; matched?: boolean }>(
        `/models/${id}/commands`,
        { method: 'POST', body: JSON.stringify({ command }) },
      ),
  },

  agent: {
    createSession: (projectId: string) =>
      request<AgentSessionDetail>('/agent/sessions', {
        method: 'POST',
        body: JSON.stringify({ projectId }),
      }),
    getSession: (sessionId: string) => request<AgentSessionDetail>(`/agent/sessions/${sessionId}`),
    sendMessage: (sessionId: string, message: string) =>
      request<AgentPatchProposal>(`/agent/sessions/${sessionId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ message }),
      }),
    acceptPatch: (patchId: string) =>
      request<{ patch_id: string; status: string; model_id: string; new_version: number; model: ArchitectureModel }>(
        `/agent/patches/${patchId}/accept`,
        { method: 'POST' },
      ),
    rejectPatch: (patchId: string) =>
      request<{ patch_id: string; status: string }>(`/agent/patches/${patchId}/reject`, { method: 'POST' }),
  },

  usage: {
    get: () => request<UsageSummary>('/me/usage'),
    ledger: () => request<UsageLedgerEntry[]>('/me/usage/ledger'),
  },

  /** Subscribe to SSE progress events for a run */
  subscribeToRun: (runId: string, onEvent: (event: MessageEvent) => void): EventSource => {
    const token = getAuthToken();
    const qs = token ? `?token=${encodeURIComponent(token)}` : '';
    const es = new EventSource(`${BASE}/runs/${runId}/events${qs}`);
    es.onmessage = onEvent;
    return es;
  },
};
