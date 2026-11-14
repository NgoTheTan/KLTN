import { useEffect, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Loader2,
  Sparkles,
  Square,
  XCircle,
  AlertCircle,
} from 'lucide-react';
import { api, formatApiError, type RunDecisionsReport, type RunRecord } from '../api/client';
import { useI18n } from '../i18n/I18nProvider';

interface RunProgressPanelProps {
  run: RunRecord | null;
  onRunFinished?: () => void;
  onRunUpdated?: (run: RunRecord) => void;
}

export function RunProgressDrawer({ run, onRunFinished, onRunUpdated }: RunProgressPanelProps) {
  const { locale, t } = useI18n();
  const [liveRun, setLiveRun] = useState<RunRecord | null>(run);
  const [decisions, setDecisions] = useState<RunDecisionsReport | null>(null);
  const [actionError, setActionError] = useState<{ title: string; hint?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setLiveRun(run);
    setDecisions(null);
  }, [run?.id]);

  useEffect(() => {
    if (!run?.id) return;
    let active = true;
    const runId = run.id;

    const loadDecisions = async () => {
      try {
        const rep = await api.projects.getRunDecisions(runId);
        if (active) setDecisions(rep);
      } catch {
        // Decisions may not exist yet
      }
    };

    const refreshRun = async () => {
      try {
        const fresh = await api.projects.getRun(runId);
        if (!active) return;
        setLiveRun(fresh);
        onRunUpdated?.(fresh);
        if (fresh.status === 'succeeded' || fresh.status === 'failed' || fresh.status === 'cancelled') {
          await loadDecisions();
          onRunFinished?.();
        }
      } catch {
        // Ignore transient poll error
      }
    };

    loadDecisions();

    const isTerminal =
      run.status === 'succeeded' || run.status === 'failed' || run.status === 'cancelled';

    if (isTerminal) return;

    const es = api.subscribeToRun(runId, (ev) => {
      try {
        const payload = JSON.parse(ev.data) as {
          type?: string;
          status?: RunRecord['status'];
          progress?: number;
          message?: string;
        };
        setLiveRun((prev) =>
          prev
            ? {
                ...prev,
                status: payload.status ?? prev.status,
                progress: typeof payload.progress === 'number' ? payload.progress : prev.progress,
                errorMessage: payload.type === 'error' ? payload.message ?? prev.errorMessage : prev.errorMessage,
              }
            : prev,
        );
        if (
          payload.status === 'succeeded' ||
          payload.status === 'failed' ||
          payload.status === 'cancelled'
        ) {
          refreshRun();
        }
      } catch {
        // Ignore malformed SSE payload
      }
    });

    const interval = setInterval(refreshRun, 2000);

    return () => {
      active = false;
      es.close();
      clearInterval(interval);
    };
  }, [run?.id, run?.status]);

  if (!liveRun) return null;

  const stages = [
    { num: 1, label: t.runStages.s1, pct: 12 },
    { num: 2, label: t.runStages.s2, pct: 25 },
    { num: 3, label: t.runStages.s3, pct: 37 },
    { num: 4, label: t.runStages.s4, pct: 50 },
    { num: 5, label: t.runStages.s5, pct: 62 },
    { num: 6, label: t.runStages.s6, pct: 75 },
    { num: 7, label: t.runStages.s7, pct: 87 },
    { num: 8, label: t.runStages.s8, pct: 100 },
  ];

  const isRunning = liveRun.status === 'queued' || liveRun.status === 'running';

  const handleCancel = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await api.projects.cancelRun(liveRun.id);
      const fresh = await api.projects.getRun(liveRun.id);
      setLiveRun(fresh);
      onRunUpdated?.(fresh);
    } catch (err) {
      setActionError(formatApiError(err, locale));
    } finally {
      setBusy(false);
    }
  };

  const handleEscalate = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await api.projects.escalateRun(liveRun.id);
      const fresh = await api.projects.getRun(liveRun.id);
      setLiveRun(fresh);
      onRunUpdated?.(fresh);
    } catch (err) {
      setActionError(formatApiError(err, locale));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {isRunning ? (
            <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />
          ) : liveRun.status === 'succeeded' ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          ) : (
            <XCircle className="h-4 w-4 text-rose-400" />
          )}
          <span className="text-sm font-medium text-slate-200">
            Run <code className="text-xs text-indigo-300">{liveRun.id.slice(0, 8)}</code>
          </span>
          <span className="rounded-md border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] uppercase tracking-wide text-slate-300">
            {liveRun.mode}
          </span>
          <span className="rounded-md border border-slate-700 bg-slate-900 px-2 py-0.5 font-mono text-[11px] text-slate-300">
            {liveRun.status} · {liveRun.progress}%
          </span>
        </div>

        <div className="flex items-center gap-2">
          {isRunning && (
            <button
              type="button"
              disabled={busy}
              onClick={handleCancel}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
            >
              <Square className="h-3 w-3" />
              {t.projectDetail.cancelRun}
            </button>
          )}
          {decisions && decisions.pending_llm_items.length > 0 && !isRunning && (
            <button
              type="button"
              disabled={busy}
              onClick={handleEscalate}
              className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/40 bg-violet-500/15 px-2.5 py-1 text-xs font-medium text-violet-200 hover:bg-violet-500/25 disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {t.projectDetail.escalateRun} ({decisions.pending_llm_items.length})
            </button>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
        <div
          style={{ width: `${Math.max(4, liveRun.progress)}%` }}
          className={`h-full transition-all duration-300 ${
            liveRun.status === 'failed'
              ? 'bg-rose-500'
              : liveRun.status === 'succeeded'
                ? 'bg-emerald-500'
                : 'bg-indigo-500'
          }`}
        />
      </div>

      {/* 8-Stage Stepper */}
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-8">
        {stages.map((s) => {
          const done = liveRun.status === 'succeeded' || liveRun.progress >= s.pct;
          const active =
            isRunning && !done && liveRun.progress >= s.pct - 13 && liveRun.progress < s.pct;
          return (
            <div
              key={s.num}
              className={`rounded-lg border px-2 py-1.5 text-[11px] transition ${
                done
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : active
                    ? 'border-indigo-500/50 bg-indigo-500/15 text-indigo-200'
                    : 'border-slate-800 bg-slate-900/60 text-slate-500'
              }`}
            >
              <div className="truncate font-medium">{s.label}</div>
            </div>
          );
        })}
      </div>

      {liveRun.errorMessage && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
          <div>{liveRun.errorMessage}</div>
        </div>
      )}

      {actionError && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
          <div className="font-medium">{actionError.title}</div>
          {actionError.hint && <div className="mt-1 text-amber-300/90">{actionError.hint}</div>}
        </div>
      )}

      {/* Decision Tier Breakdown Chart */}
      {decisions && decisions.total_decisions > 0 && (
        <div className="border-t border-slate-800 pt-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 font-medium text-slate-300">
              <Activity className="h-3.5 w-3.5 text-emerald-400" />
              {t.projectDetail.tierBreakdownTitle}
            </span>
            <span className="text-slate-400">
              {t.projectDetail.decisionsTotal}: <strong className="font-mono text-slate-200">{decisions.total_decisions}</strong>
            </span>
          </div>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-800">
            {decisions.tier_breakdown.tier0_rule_pct > 0 && (
              <div
                style={{ width: `${decisions.tier_breakdown.tier0_rule_pct}%` }}
                className="bg-emerald-500"
                title={`Rule: ${decisions.tier_breakdown.tier0_rule_pct}%`}
              />
            )}
            {decisions.tier_breakdown.tier1_local_pct > 0 && (
              <div
                style={{ width: `${decisions.tier_breakdown.tier1_local_pct}%` }}
                className="bg-cyan-500"
                title={`Local ML: ${decisions.tier_breakdown.tier1_local_pct}%`}
              />
            )}
            {decisions.tier_breakdown.tier2_llm_pct > 0 && (
              <div
                style={{ width: `${decisions.tier_breakdown.tier2_llm_pct}%` }}
                className="bg-violet-500"
                title={`LLM: ${decisions.tier_breakdown.tier2_llm_pct}%`}
              />
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-300">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Rule (Tier 0): <strong className="font-mono">{decisions.tier_breakdown.tier0_rule_pct}%</strong>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-cyan-500" />
              Local ML (Tier 1): <strong className="font-mono">{decisions.tier_breakdown.tier1_local_pct}%</strong>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-violet-500" />
              LLM (Tier 2): <strong className="font-mono">{decisions.tier_breakdown.tier2_llm_pct}%</strong>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
