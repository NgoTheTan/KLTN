import React, { useEffect, useState } from 'react';
import { Bot, Check, Send, Sparkles, X } from 'lucide-react';
import {
  api,
  formatApiError,
  type AgentPatchProposal,
  type AgentSessionDetail,
} from '../api/client';
import { useI18n } from '../i18n/I18nProvider';

export function AgentPatchSidebar({
  projectId,
  onModelUpdated,
}: {
  projectId: string;
  onModelUpdated: () => Promise<void> | void;
}) {
  const { locale, t } = useI18n();
  const [session, setSession] = useState<AgentSessionDetail | null>(null);
  const [prompt, setPrompt] = useState('');
  const [latestProposal, setLatestProposal] = useState<AgentPatchProposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<{ title: string; hint?: string } | null>(null);

  useEffect(() => {
    let active = true;
    api.agent
      .createSession(projectId)
      .then((s) => {
        if (active) setSession(s);
      })
      .catch(() => {
        // Session will be created on demand if needed
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    setStatusMessage(null);
    try {
      let activeSession = session;
      if (!activeSession) {
        activeSession = await api.agent.createSession(projectId);
        setSession(activeSession);
      }
      const proposal = await api.agent.sendMessage(activeSession.id, trimmed);
      setLatestProposal(proposal);
      setPrompt('');
      const refreshed = await api.agent.getSession(activeSession.id);
      setSession(refreshed);
    } catch (err) {
      setError(formatApiError(err, locale));
    } finally {
      setBusy(false);
    }
  };

  const handleAccept = async (patchId: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.agent.acceptPatch(patchId);
      setStatusMessage(t.diagramEditor.patchAccepted);
      setLatestProposal(null);
      if (session) {
        setSession(await api.agent.getSession(session.id));
      }
      await onModelUpdated();
    } catch (err) {
      setError(formatApiError(err, locale));
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async (patchId: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.agent.rejectPatch(patchId);
      setStatusMessage(t.diagramEditor.patchRejected);
      setLatestProposal(null);
      if (session) {
        setSession(await api.agent.getSession(session.id));
      }
    } catch (err) {
      setError(formatApiError(err, locale));
    } finally {
      setBusy(false);
    }
  };

  const quickExamples =
    locale === 'vi'
      ? ['thêm cache Redis cho API', 'thêm hàng đợi message queue']
      : ['add Redis cache', 'add message queue'];

  return (
    <aside className="flex h-full flex-col rounded-xl border border-slate-800 bg-[#101521]">
      <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-3">
        <Bot className="h-4 w-4 text-indigo-400" />
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-200">
          {t.diagramEditor.agentTitle}
        </h3>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3.5">
        <p className="text-xs leading-relaxed text-slate-400">{t.diagramEditor.agentHint}</p>

        <div className="flex flex-wrap gap-1.5">
          {quickExamples.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setPrompt(ex)}
              className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-300 hover:border-indigo-500/50 hover:text-indigo-200"
            >
              + {ex}
            </button>
          ))}
        </div>

        {statusMessage && (
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-2.5 text-xs text-emerald-300">
            {statusMessage}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-2.5 text-xs text-rose-200">
            <div className="font-medium">{error.title}</div>
            {error.hint && <div className="mt-1 text-rose-300/90">{error.hint}</div>}
          </div>
        )}

        {latestProposal && (
          <div className="space-y-2.5 rounded-xl border border-indigo-500/40 bg-indigo-950/20 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-200">
                <Sparkles className="h-3.5 w-3.5" />
                {latestProposal.operations_count} ops
              </span>
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">
                {t.diagramEditor.tokenCost}: {latestProposal.token_cost} tokens
              </span>
            </div>

            <p className="text-xs text-slate-200">{latestProposal.explanation}</p>

            <div className="space-y-1 rounded-lg bg-slate-950/80 p-2 font-mono text-[11px] text-slate-300">
              {latestProposal.patch.operations.map((op, idx) => (
                <div key={idx} className="truncate">
                  • {op.op}{' '}
                  {'element' in op
                    ? op.element.id
                    : 'element_id' in op
                      ? op.element_id
                      : 'relationship' in op
                        ? `${op.relationship.source_id}→${op.relationship.target_id}`
                        : ''}
                </div>
              ))}
            </div>

            {latestProposal.preview_svg && (
              <div className="space-y-1">
                <div className="text-[11px] font-medium text-slate-400">
                  {t.diagramEditor.draftPreview}
                </div>
                <div
                  className="max-h-56 overflow-auto rounded-lg border border-slate-700 bg-white p-2 [&_svg]:h-auto [&_svg]:max-w-full"
                  dangerouslySetInnerHTML={{ __html: latestProposal.preview_svg }}
                />
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                disabled={busy}
                onClick={() => handleAccept(latestProposal.patch_id)}
                className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" />
                {t.diagramEditor.acceptPatch}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => handleReject(latestProposal.patch_id)}
                className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" />
                {t.diagramEditor.rejectPatch}
              </button>
            </div>
          </div>
        )}

        {session && session.patches.length > 0 && (
          <div className="space-y-1.5 border-t border-slate-800 pt-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Patch History ({session.patches.length})
            </div>
            {session.patches.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-slate-800/80 bg-slate-900/50 px-2.5 py-1.5 text-[11px]"
              >
                <span className="truncate text-slate-300">{p.reason || p.id.slice(0, 8)}</span>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase ${
                    p.status === 'accepted'
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : p.status === 'rejected'
                        ? 'bg-rose-500/15 text-rose-300'
                        : 'bg-amber-500/15 text-amber-300'
                  }`}
                >
                  {p.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <form onSubmit={handleSend} className="border-t border-slate-800 p-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t.diagramEditor.agentInputPlaceholder}
            className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy || !prompt.trim()}
            className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" />
            {t.diagramEditor.sendAgent}
          </button>
        </div>
      </form>
    </aside>
  );
}
