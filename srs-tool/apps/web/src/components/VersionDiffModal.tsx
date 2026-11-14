import { useEffect, useState } from 'react';
import { History, RotateCcw, X } from 'lucide-react';
import { api, formatApiError, type RequirementVersionRecord } from '../api/client';
import { useI18n } from '../i18n/I18nProvider';

export function VersionDiffModal({
  open,
  projectId,
  requirementId,
  versions,
  onClose,
  onReverted,
}: {
  open: boolean;
  projectId: string;
  requirementId: string;
  versions: RequirementVersionRecord[];
  onClose: () => void;
  onReverted: () => Promise<void> | void;
}) {
  const { locale, t } = useI18n();
  const [v1, setV1] = useState<number>(1);
  const [v2, setV2] = useState<number>(1);
  const [diffData, setDiffData] = useState<{
    statement_changed: boolean;
    diff: { v1_statement: string; v2_statement: string };
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ title: string; hint?: string } | null>(null);

  useEffect(() => {
    if (!open || versions.length === 0) return;
    const nums = versions.map((v) => v.version).sort((a, b) => a - b);
    const latest = nums[nums.length - 1] ?? 1;
    const prev = nums.length > 1 ? nums[nums.length - 2]! : latest;
    setV1(prev);
    setV2(latest);
  }, [open, versions]);

  useEffect(() => {
    if (!open || !requirementId || versions.length === 0) return;
    let active = true;
    api.requirements
      .diff(projectId, requirementId, v1, v2)
      .then((res) => {
        if (active) setDiffData(res);
      })
      .catch(() => {
        if (active) setDiffData(null);
      });
    return () => {
      active = false;
    };
  }, [open, projectId, requirementId, v1, v2, versions.length]);

  if (!open) return null;

  const handleRevert = async (targetVersion: number) => {
    setBusy(true);
    setError(null);
    try {
      await api.requirements.revert(projectId, requirementId, targetVersion);
      await onReverted();
      onClose();
    } catch (err) {
      setError(formatApiError(err, locale));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl border border-slate-700 bg-[#0f131d] shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-indigo-400" />
            <h2 className="text-base font-semibold text-slate-100">{t.requirements.diffTitle}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {error && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
              {error.title}
            </div>
          )}

          {versions.length >= 1 && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className="font-medium text-slate-300">{t.requirements.compareVersions}:</span>
                <select
                  value={v1}
                  onChange={(e) => setV1(Number(e.target.value))}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-slate-200"
                >
                  {versions.map((ver) => (
                    <option key={ver.version} value={ver.version}>
                      v{ver.version} ({ver.changedBy})
                    </option>
                  ))}
                </select>
                <span className="text-slate-500">→</span>
                <select
                  value={v2}
                  onChange={(e) => setV2(Number(e.target.value))}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-slate-200"
                >
                  {versions.map((ver) => (
                    <option key={ver.version} value={ver.version}>
                      v{ver.version} ({ver.changedBy})
                    </option>
                  ))}
                </select>
              </div>

              {diffData && (
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border border-rose-500/30 bg-rose-950/20 p-3">
                    <div className="mb-1 font-mono text-[11px] text-rose-300">v{v1}</div>
                    <p className="text-xs leading-relaxed text-slate-200">{diffData.diff.v1_statement}</p>
                  </div>
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-3">
                    <div className="mb-1 font-mono text-[11px] text-emerald-300">v{v2}</div>
                    <p className="text-xs leading-relaxed text-slate-200">{diffData.diff.v2_statement}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            {versions.map((ver) => {
              const snap = ver.snapshot as { statement?: string; status?: string };
              return (
                <div
                  key={ver.version}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-3.5"
                >
                  <div className="space-y-1 flex-1 min-w-[200px]">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded bg-indigo-500/20 px-2 py-0.5 font-mono font-semibold text-indigo-300">
                        v{ver.version}
                      </span>
                      <span className="text-slate-400">
                        {t.requirements.changedBy}: <strong className="text-slate-200">{ver.changedBy}</strong>
                      </span>
                      {snap?.status && (
                        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">
                          {snap.status}
                        </span>
                      )}
                      <span className="text-[11px] text-slate-500">
                        {new Date(ver.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-xs text-slate-300">{snap?.statement}</p>
                  </div>

                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleRevert(ver.version)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:border-indigo-500/60 hover:text-white disabled:opacity-50"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    {t.requirements.revertToVersion}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
