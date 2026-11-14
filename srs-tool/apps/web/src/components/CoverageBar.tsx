import type { CoverageReport } from '@srs-tool/schemas';
import { useI18n } from '../i18n/I18nProvider';

export function CoverageBar({ coverage }: { coverage?: CoverageReport | null }) {
  const { t } = useI18n();
  if (!coverage) return null;

  const total = coverage.total_segments || 0;
  const pct = (val: number) => (total > 0 ? Math.round((val / total) * 1000) / 10 : 0);

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-medium text-slate-200">
          {t.projects.coverage}: <span className="font-mono text-indigo-300">{coverage.coverage_pct}%</span>
          <span className="ml-2 text-xs text-slate-400">({total} segments)</span>
        </span>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1.5 text-emerald-300">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
            {t.projectDetail.filterMapped}: <strong className="font-mono">{coverage.mapped}</strong>
          </span>
          <span className="inline-flex items-center gap-1.5 text-slate-300">
            <span className="h-2.5 w-2.5 rounded-full bg-slate-500" />
            {t.projectDetail.filterNotReq}: <strong className="font-mono">{coverage.not_requirement}</strong>
          </span>
          <span className="inline-flex items-center gap-1.5 text-amber-300">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
            {t.projectDetail.filterUnresolved}: <strong className="font-mono">{coverage.unresolved}</strong>
          </span>
          <span className="inline-flex items-center gap-1.5 text-rose-300">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
            {t.projectDetail.filterUnmapped}: <strong className="font-mono">{coverage.unmapped}</strong>
          </span>
        </div>
      </div>

      <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-800/90 ring-1 ring-slate-700/60">
        {total === 0 ? (
          <div className="h-full w-full bg-slate-700/40" />
        ) : (
          <>
            {coverage.mapped > 0 && (
              <div
                style={{ width: `${pct(coverage.mapped)}%` }}
                className="h-full bg-emerald-500 transition-all"
                title={`${t.projectDetail.filterMapped}: ${coverage.mapped}`}
              />
            )}
            {coverage.not_requirement > 0 && (
              <div
                style={{ width: `${pct(coverage.not_requirement)}%` }}
                className="h-full bg-slate-500 transition-all"
                title={`${t.projectDetail.filterNotReq}: ${coverage.not_requirement}`}
              />
            )}
            {coverage.unresolved > 0 && (
              <div
                style={{ width: `${pct(coverage.unresolved)}%` }}
                className="h-full bg-amber-500 transition-all"
                title={`${t.projectDetail.filterUnresolved}: ${coverage.unresolved}`}
              />
            )}
            {coverage.unmapped > 0 && (
              <div
                style={{ width: `${pct(coverage.unmapped)}%` }}
                className="h-full bg-rose-500 transition-all"
                title={`${t.projectDetail.filterUnmapped}: ${coverage.unmapped}`}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
