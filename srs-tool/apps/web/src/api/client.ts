/**
 * API client — typed fetch wrapper for the SRS Tool REST API.
 * All calls go to /api/v1/...
 */

const BASE = '/api/v1';
const TOKEN_KEY = 'srs_tool_token';

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

async function request<T = any>(path: string, init?: RequestInit): Promise<T> {
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
    const err = await res.json().catch(() => ({ message: res.statusText }));
    const msg = Array.isArray(err.message) ? err.message.join('; ') : err.message;
    throw new Error(msg ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  auth: {
    devToken: async (email?: string) => {
      const res = await request<{ accessToken: string; user: any }>('/auth/dev-token', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      if (res.accessToken) setAuthToken(res.accessToken);
      return res;
    },
    me: () => request('/auth/me'),
    updateLocale: (locale: 'vi' | 'en') =>
      request('/auth/me', { method: 'PATCH', body: JSON.stringify({ locale }) }),
  },

  projects: {
    list: () => request<any[]>('/projects'),
    create: (data: {
      name: string;
      platforms: string[];
      output_language?: string;
      constraints?: Record<string, unknown>;
    }) => request('/projects', { method: 'POST', body: JSON.stringify(data) }),
    get: (id: string) => request(`/projects/${id}`),
    update: (id: string, data: Record<string, unknown>) =>
      request(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: string) => request(`/projects/${id}`, { method: 'DELETE' }),
    getCoverage: (id: string) => request(`/projects/${id}/coverage`),
    getChecklist: (id: string) => request<any[]>(`/projects/${id}/checklist`),
    updateChecklistItem: (id: string, itemId: string, data: { not_applicable: boolean; reason?: string }) =>
      request(`/projects/${id}/checklist/${itemId}`, { method: 'PATCH', body: JSON.stringify(data) }),
    lockBaseline: (id: string) => request(`/projects/${id}/lock-baseline`, { method: 'POST' }),

    listDocuments: (id: string) => request<any[]>(`/projects/${id}/documents`),
    uploadDocument: async (
      id: string,
      input: File | { text: string; filename?: string; kind?: 'srs' | 'text' | 'email' },
      kind?: 'srs' | 'text' | 'email',
    ) => {
      if (typeof File !== 'undefined' && input instanceof File) {
        const contentBase64 = await fileToBase64(input);
        return request(`/projects/${id}/documents`, {
          method: 'POST',
          body: JSON.stringify({
            contentBase64,
            filename: input.name,
            mimeType: input.type || 'application/octet-stream',
            kind,
          }),
        });
      }
      return request(`/projects/${id}/documents`, {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    deleteDocument: (docId: string) => request(`/documents/${docId}`, { method: 'DELETE' }),

    startRun: (id: string, opts: { mode?: 'eco' | 'standard' | 'thorough'; from_stage?: number }) =>
      request(`/projects/${id}/runs`, { method: 'POST', body: JSON.stringify(opts) }),
    getRun: (runId: string) => request(`/runs/${runId}`),
    getRunDecisions: (runId: string) => request(`/runs/${runId}/decisions`),
    escalateRun: (runId: string) => request(`/runs/${runId}/escalate`, { method: 'POST' }),
    cancelRun: (runId: string) => request(`/runs/${runId}/cancel`, { method: 'POST' }),

    getArchitecture: (id: string) => request(`/projects/${id}/architecture`),
    synthesizeArchitecture: (id: string) => request(`/projects/${id}/architecture`, { method: 'POST' }),
    getStack: (id: string) => request(`/projects/${id}/stack`),

    createExport: (id: string, formats?: string[]) =>
      request(`/projects/${id}/exports`, { method: 'POST', body: JSON.stringify({ formats }) }),
    listExports: (id: string) => request<any[]>(`/projects/${id}/exports`),
    getExport: (exportId: string) => request(`/exports/${exportId}`),
  },

  requirements: {
    list: (projectId: string, filters?: Record<string, string>) => {
      const qs = filters ? '?' + new URLSearchParams(filters).toString() : '';
      return request<any[]>(`/projects/${projectId}/requirements${qs}`);
    },
    get: (projectId: string, reqId: string) => request(`/projects/${projectId}/requirements/${reqId}`),
    create: (projectId: string, data: Record<string, unknown>) =>
      request(`/projects/${projectId}/requirements`, { method: 'POST', body: JSON.stringify(data) }),
    update: (projectId: string, reqId: string, data: Record<string, unknown>) =>
      request(`/projects/${projectId}/requirements/${reqId}`, { method: 'PATCH', body: JSON.stringify(data) }),
    revert: (projectId: string, reqId: string, version: number) =>
      request(`/requirements/${reqId}/revert`, { method: 'POST', body: JSON.stringify({ projectId, version }) }),
    diff: (projectId: string, reqId: string, v1: number, v2: number) =>
      request(`/requirements/${reqId}/diff?projectId=${encodeURIComponent(projectId)}&v1=${v1}&v2=${v2}`),
    listQuestions: (projectId: string) => request<any[]>(`/projects/${projectId}/questions`),
    answerQuestion: (questionId: string, data: { answer?: string; skip?: boolean }) =>
      request(`/questions/${questionId}/answer`, { method: 'POST', body: JSON.stringify(data) }),
    listGlossary: (projectId: string) => request<any[]>(`/projects/${projectId}/glossary`),
    addGlossary: (projectId: string, data: { term_vi: string; term_en: string; definition: string }) =>
      request(`/projects/${projectId}/glossary`, { method: 'POST', body: JSON.stringify(data) }),
  },

  diagrams: {
    listByModel: (modelId: string) => request<any[]>(`/models/${modelId}/diagrams`),
    get: (id: string, format: 'json' | 'puml' = 'json') => request(`/diagrams/${id}?format=${format}`),
    updatePuml: (id: string, puml: string) =>
      request(`/diagrams/${id}/puml`, { method: 'PUT', body: JSON.stringify({ puml }) }),
    reset: (id: string) => request(`/diagrams/${id}/reset`, { method: 'POST' }),
  },

  models: {
    get: (id: string) => request(`/models/${id}`),
    applyPatch: (id: string, patch: unknown) =>
      request(`/models/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    command: (id: string, command: string) =>
      request(`/models/${id}/commands`, { method: 'POST', body: JSON.stringify({ command }) }),
  },

  agent: {
    createSession: (projectId: string) =>
      request('/agent/sessions', { method: 'POST', body: JSON.stringify({ projectId }) }),
    getSession: (sessionId: string) => request(`/agent/sessions/${sessionId}`),
    sendMessage: (sessionId: string, message: string) =>
      request(`/agent/sessions/${sessionId}/messages`, { method: 'POST', body: JSON.stringify({ message }) }),
    acceptPatch: (patchId: string) => request(`/agent/patches/${patchId}/accept`, { method: 'POST' }),
    rejectPatch: (patchId: string) => request(`/agent/patches/${patchId}/reject`, { method: 'POST' }),
  },

  usage: {
    get: () => request('/me/usage'),
    ledger: () => request<any[]>('/me/usage/ledger'),
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
