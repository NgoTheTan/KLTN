import { CheckCircle2, Cpu, FileText, HelpCircle, Sparkles, AlertTriangle } from 'lucide-react';
import { useI18n } from '../i18n/I18nProvider';

export function OriginBadge({
  origin,
  showTooltip = true,
}: {
  origin: 'explicit' | 'inferred' | 'assumption' | string;
  showTooltip?: boolean;
}) {
  const { t } = useI18n();

  if (origin === 'inferred') {
    return (
      <span
        title={showTooltip ? t.origin.inferredDesc : undefined}
        className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-300"
      >
        <AlertTriangle className="h-3 w-3 shrink-0" />
        {t.origin.inferred}
      </span>
    );
  }

  if (origin === 'assumption') {
    return (
      <span
        title={showTooltip ? t.origin.assumptionDesc : undefined}
        className="inline-flex items-center gap-1 rounded-full border border-purple-500/40 bg-purple-500/15 px-2 py-0.5 text-[11px] font-medium text-purple-300"
      >
        <HelpCircle className="h-3 w-3 shrink-0" />
        {t.origin.assumption}
      </span>
    );
  }

  return (
    <span
      title={showTooltip ? t.origin.explicitDesc : undefined}
      className="inline-flex items-center gap-1 rounded-full border border-sky-500/40 bg-sky-500/15 px-2 py-0.5 text-[11px] font-medium text-sky-300"
    >
      <FileText className="h-3 w-3 shrink-0" />
      {t.origin.explicit}
    </span>
  );
}

export function TierBadge({ tier }: { tier: 'rule' | 'local' | 'llm' | string }) {
  const { t } = useI18n();

  if (tier === 'llm') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[11px] font-medium text-violet-300">
        <Sparkles className="h-3 w-3" />
        {t.tier.llm}
      </span>
    );
  }

  if (tier === 'local') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[11px] font-medium text-cyan-300">
        <Cpu className="h-3 w-3" />
        {t.tier.local}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-300">
      <CheckCircle2 className="h-3 w-3" />
      {t.tier.rule}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  const label = (t.status as Record<string, string>)[status] ?? status;

  const styles: Record<string, string> = {
    approved: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
    baseline: 'border-emerald-400/50 bg-emerald-500/20 text-emerald-200',
    normalized: 'border-indigo-500/40 bg-indigo-500/15 text-indigo-300',
    needs_clarification: 'border-amber-500/40 bg-amber-500/15 text-amber-300',
    rejected: 'border-rose-500/40 bg-rose-500/15 text-rose-300',
    merged: 'border-slate-500/40 bg-slate-500/15 text-slate-300',
    classified: 'border-sky-500/40 bg-sky-500/15 text-sky-300',
    candidate: 'border-slate-600 bg-slate-800 text-slate-300',
  };

  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${
        styles[status] ?? 'border-slate-600 bg-slate-800 text-slate-300'
      }`}
    >
      {label}
    </span>
  );
}
