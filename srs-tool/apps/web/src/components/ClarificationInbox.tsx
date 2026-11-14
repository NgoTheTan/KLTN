import { useState } from 'react';
import { CheckCircle2, HelpCircle, SkipForward, Sparkles, X } from 'lucide-react';
import { api, formatApiError, type ClarificationQuestion } from '../api/client';
import { useI18n } from '../i18n/I18nProvider';

export function ClarificationInbox({
  open,
  questions,
  onClose,
  onAnswered,
}: {
  open: boolean;
  questions: ClarificationQuestion[];
  onClose: () => void;
  onAnswered: () => Promise<void> | void;
}) {
  const { locale, t } = useI18n();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [error, setError] = useState<{ title: string; hint?: string } | null>(null);

  if (!open) return null;

  const pending = questions.filter((q) => q.status === 'pending');
  const resolved = questions.filter((q) => q.status !== 'pending');

  // Group pending questions by topicGroup or ruleId
  const groups = new Map<string, ClarificationQuestion[]>();
  for (const q of pending) {
    const key = q.topicGroup || q.ruleId || 'General';
    const arr = groups.get(key) || [];
    arr.push(q);
    groups.set(key, arr);
  }

  const handleSubmit = async (q: ClarificationQuestion, skip: boolean) => {
    const answerText = (answers[q.id] ?? '').trim();
    if (!skip && !answerText) return;
    setSubmittingId(q.id);
    setError(null);
    try {
      await api.requirements.answerQuestion(q.id, {
        answer: answerText || undefined,
        skip,
      });
      await onAnswered();
    } catch (err) {
      setError(formatApiError(err, locale));
    } finally {
      setSubmittingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm">
      <div className="flex h-full w-full max-w-xl flex-col border-l border-slate-800 bg-[#0f131d] shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5 text-amber-400" />
            <h2 className="text-base font-semibold text-slate-100">{t.requirements.inboxTitle}</h2>
            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 font-mono text-xs text-amber-300">
              {pending.length}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {error && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
              <div className="font-medium">{error.title}</div>
              {error.hint && <div className="mt-1 text-rose-300/90">{error.hint}</div>}
            </div>
          )}

          {pending.length === 0 ? (
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 text-center text-sm text-slate-400">
              <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-400" />
              {t.requirements.inboxEmpty}
            </div>
          ) : (
            Array.from(groups.entries()).map(([groupName, items]) => (
              <div key={groupName} className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-indigo-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
                  {groupName} ({items.length})
                </div>

                {items.map((q) => (
                  <div
                    key={q.id}
                    className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/70 p-4"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-slate-100">{q.text}</p>
                      {q.ruleId && (
                        <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                          {q.ruleId}
                        </span>
                      )}
                    </div>

                    {q.proposedValue && (
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-slate-400">{t.requirements.proposedValue}:</span>
                        <button
                          type="button"
                          onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: q.proposedValue || '' }))}
                          className="inline-flex items-center gap-1 rounded-md border border-indigo-500/40 bg-indigo-500/15 px-2 py-0.5 text-indigo-200 hover:bg-indigo-500/25"
                        >
                          <Sparkles className="h-3 w-3" />
                          {q.proposedValue} · {t.requirements.useProposed}
                        </button>
                      </div>
                    )}

                    <textarea
                      rows={2}
                      value={answers[q.id] ?? ''}
                      onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                      placeholder={t.requirements.answerPlaceholder}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
                    />

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={submittingId === q.id || !(answers[q.id] ?? '').trim()}
                        onClick={() => handleSubmit(q, false)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {t.requirements.submitAnswer}
                      </button>

                      <button
                        type="button"
                        disabled={submittingId === q.id}
                        onClick={() => handleSubmit(q, true)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-purple-500/40 bg-purple-500/15 px-3 py-1.5 text-xs font-medium text-purple-200 hover:bg-purple-500/25 disabled:opacity-50"
                      >
                        <SkipForward className="h-3.5 w-3.5" />
                        {t.requirements.skipAsAssumption}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}

          {resolved.length > 0 && (
            <div className="border-t border-slate-800 pt-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                Resolved ({resolved.length})
              </div>
              <div className="space-y-2">
                {resolved.map((q) => (
                  <div
                    key={q.id}
                    className="rounded-lg border border-slate-800/70 bg-slate-900/40 px-3 py-2 text-xs text-slate-400"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-300">{q.text}</span>
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase">
                        {q.status}
                      </span>
                    </div>
                    {q.answer && <div className="mt-1 text-emerald-300/90">→ {q.answer}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
