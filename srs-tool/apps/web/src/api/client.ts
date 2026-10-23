/**
 * API client — typed fetch wrapper for the SRS Tool REST API.
 * All calls go to /api/v1/...
 */

const BASE = '/api/v1';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// Projects

export const api = {
  projects: {
    list: () => request<unknown[]>('/projects'),
    create: (data: { name: string; platforms: string[]; output_language: string }) =>
      request('/projects', { method: 'POST', body: JSON.stringify(data) }),
    get: (id: string) => request(`/projects/${id}`),
    getCoverage: (id: string) => request(`/projects/${id}/coverage`),
    getChecklist: (id: string) => request(`/projects/${id}/checklist`),
    uploadDocument: (id: string, formData: FormData) =>
      fetch(`${BASE}/projects/${id}/documents`, { method: 'POST', body: formData }).then(r => r.json()),
    startRun: (id: string, opts: { mode?: string; from_stage?: number }) =>
      request(`/projects/${id}/runs`, { method: 'POST', body: JSON.stringify(opts) }),
    synthesizeArchitecture: (id: string) =>
      request(`/projects/${id}/architecture`, { method: 'POST' }),
    createExport: (id: string, formats: string[]) =>
      request(`/projects/${id}/exports`, { method: 'POST', body: JSON.stringify({ formats }) }),
  },

  requirements: {
    list: (projectId: string, filters?: Record<string, string>) => {
      const qs = filters ? '?' + new URLSearchParams(filters).toString() : '';
      return request<unknown[]>(`/projects/${projectId}/requirements${qs}`);
    },
    get: (projectId: string, reqId: string) =>
      request(`/projects/${projectId}/requirements/${reqId}`),
  },

  diagrams: {
    get: (id: string, format: 'svg' | 'png' | 'puml' = 'svg') =>
      request(`/diagrams/${id}?format=${format}`),
  },

  models: {
    get: (id: string) => request(`/models/${id}`),
    applyPatch: (id: string, patch: unknown) =>
      request(`/models/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    command: (id: string, command: string, args: unknown) =>
      request(`/models/${id}/commands`, { method: 'POST', body: JSON.stringify({ command, args }) }),
  },

  agent: {
    sendMessage: (sessionId: string, message: string) =>
      request(`/agent/sessions/${sessionId}/messages`, { method: 'POST', body: JSON.stringify({ message }) }),
  },

  usage: {
    get: () => request('/me/usage'),
  },

  /** Subscribe to SSE progress events for a run */
  subscribeToRun: (runId: string, onEvent: (event: MessageEvent) => void): EventSource => {
    const es = new EventSource(`${BASE}/runs/${runId}/events`);
    es.onmessage = onEvent;
    return es;
  },
};
