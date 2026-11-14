import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowRight,
  Boxes,
  Cpu,
  Database,
  FileCode2,
  RefreshCw,
  Terminal,
  User,
} from 'lucide-react';
import type { ArchitectureModel } from '@srs-tool/schemas';
import {
  api,
  formatApiError,
  type DiagramSummary,
  type ProjectRecord,
  type TechRecommendationRecord,
} from '../api/client';
import { AppShell } from '../components/AppShell';
import { useI18n } from '../i18n/I18nProvider';

export function ArchitecturePage() {
  const { id: projectId } = useParams<{ id: string }>();
  const { locale, t } = useI18n();

  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [model, setModel] = useState<ArchitectureModel | null>(null);
  const [stack, setStack] = useState<TechRecommendationRecord[]>([]);
  const [diagrams, setDiagrams] = useState<DiagramSummary[]>([]);
  const [command, setCommand] = useState('');

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<{ title: string; hint?: string } | null>(null);

  const loadData = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const [proj, arch, recs] = await Promise.all([
        api.projects.get(projectId),
        api.projects.getArchitecture(projectId),
        api.projects.getStack(projectId).catch(() => []),
      ]);
      setProject(proj);
      setModel(arch);
      setStack(recs);
      const diags = await api.diagrams.listByModel(arch.id).catch(() => []);
      setDiagrams(diags);
      setError(null);
    } catch (err) {
      setError(formatApiError(err, locale));
    } finally {
      setLoading(false);
    }
  }, [projectId, locale]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSynthesize = async () => {
    if (!projectId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const synthesized = await api.projects.synthesizeArchitecture(projectId);
      setModel(synthesized);
      setStack(await api.projects.getStack(projectId).catch(() => []));
      setDiagrams(await api.diagrams.listByModel(synthesized.id).catch(() => []));
    } catch (err) {
      setError(formatApiError(err, locale));
    } finally {
      setBusy(false);
    }
  };

  const handleCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!model || !command.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.models.command(model.id, command.trim());
      if (res.model) setModel(res.model);
      else await loadData();
      setNotice(res.explanation || t.architecture.commandSuccess);
      setCommand('');
    } catch (err) {
      setError(formatApiError(err, locale));
    } finally {
      setBusy(false);
    }
  };

  const elementIcon = (kind: string) => {
    if (kind === 'datastore') return <Database className="h-4 w-4 text-emerald-400" />;
    if (kind === 'person') return <User className="h-4 w-4 text-sky-400" />;
    if (kind === 'device') return <Cpu className="h-4 w-4 text-amber-400" />;
    return <Boxes className="h-4 w-4 text-indigo-400" />;
  };

  const quickCommands =
    locale === 'vi'
      ? ['thêm cache Redis', 'thêm hàng đợi message queue', 'đổi tên api_server thành API Gateway']
      : ['add cache', 'add queue', 'rename api_server to API Gateway'];

  const firstDiagramId = diagrams[0]?.id;

  return (
    <AppShell projectName={project?.name} defaultDiagramId={firstDiagramId}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-bold text-slate-100">{t.architecture.title}</h1>
              {model && (
                <span className="rounded-md border border-indigo-500/40 bg-indigo-500/15 px-2 py-0.5 font-mono text-xs text-indigo-300">
                  {t.architecture.modelVersion} v{model.version}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {diagrams.map((d) => (
              <Link
                key={d.id}
                to={`/projects/${projectId}/diagrams/${d.id}`}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium uppercase text-slate-200 hover:border-indigo-500/50"
              >
                <FileCode2 className="h-3.5 w-3.5 text-indigo-400" />
                {d.type}
              </Link>
            ))}
            <button
              type="button"
              disabled={busy}
              onClick={handleSynthesize}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
              {busy ? t.architecture.synthesizing : t.architecture.synthesizeBtn}
            </button>
          </div>
        </div>

        {/* 0-Token Quick Command Bar */}
        {model && (
          <div className="rounded-2xl border border-slate-800 bg-[#111623] p-4 space-y-2.5">
            <form onSubmit={handleCommand} className="flex flex-wrap gap-2">
              <div className="relative flex-1 min-w-[260px]">
                <Terminal className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-emerald-400" />
                <input
                  type="text"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder={t.architecture.commandPlaceholder}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-xs text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={busy || !command.trim()}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {t.architecture.runCommand}
              </button>
            </form>
            <div className="flex flex-wrap gap-1.5">
              {quickCommands.map((cmd) => (
                <button
                  key={cmd}
                  type="button"
                  onClick={() => setCommand(cmd)}
                  className="rounded-md border border-slate-800 bg-slate-900 px-2 py-0.5 font-mono text-[11px] text-slate-400 hover:border-slate-600 hover:text-slate-200"
                >
                  {cmd}
                </button>
              ))}
            </div>
          </div>
        )}

        {notice && (
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/15 p-3 text-xs text-emerald-200">
            {notice}
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
            <div className="font-medium">{error.title}</div>
            {error.hint && <div className="mt-1 text-rose-300/90">{error.hint}</div>}
          </div>
        )}

        {loading ? (
          <div className="p-10 text-center text-sm text-slate-400">{t.common.loading}</div>
        ) : (
          <>
            {/* Elements Grid */}
            <section className="rounded-2xl border border-slate-800 bg-[#111623] p-5 space-y-4">
              <h2 className="text-base font-semibold text-slate-100">
                {t.architecture.elementsTitle} ({model?.elements.length ?? 0})
              </h2>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {(model?.elements ?? []).map((el) => (
                  <div
                    key={el.id}
                    className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-2.5"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {elementIcon(el.kind)}
                          <span className="text-sm font-semibold text-slate-100">{el.name}</span>
                        </div>
                        <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] uppercase text-slate-400">
                          {el.kind}
                        </span>
                      </div>
                      {el.technology && (
                        <div className="font-mono text-xs text-indigo-300">{el.technology}</div>
                      )}
                      {el.description && (
                        <p className="text-xs text-slate-400 leading-relaxed">{el.description}</p>
                      )}
                    </div>

                    {el.requirement_ids && el.requirement_ids.length > 0 && (
                      <div className="flex flex-wrap gap-1 border-t border-slate-800/80 pt-2">
                        {el.requirement_ids.map((rid) => (
                          <Link
                            key={rid}
                            to={`/projects/${projectId}/requirements`}
                            className="rounded bg-indigo-500/15 px-1.5 py-0.5 font-mono text-[10px] text-indigo-300 hover:bg-indigo-500/25"
                          >
                            {rid}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* Relationships */}
            <section className="rounded-2xl border border-slate-800 bg-[#111623] p-5 space-y-3">
              <h2 className="text-base font-semibold text-slate-100">
                {t.architecture.relationshipsTitle} ({model?.relationships.length ?? 0})
              </h2>
              <div className="flex flex-wrap gap-2">
                {(model?.relationships ?? []).map((rel) => (
                  <div
                    key={rel.id}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-1.5 text-xs"
                  >
                    <span className="font-mono font-medium text-slate-200">{rel.source_id}</span>
                    <ArrowRight className="h-3 w-3 text-indigo-400" />
                    <span className="font-mono font-medium text-slate-200">{rel.target_id}</span>
                    {rel.label && <span className="text-slate-400">· {rel.label}</span>}
                    {rel.protocol && (
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-cyan-300">
                        {rel.protocol}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* Tech Stack Recommendations Table */}
            <section className="rounded-2xl border border-slate-800 bg-[#111623] p-5 space-y-4">
              <h2 className="text-base font-semibold text-slate-100">
                {t.architecture.stackTitle} ({stack.length})
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-800 text-slate-400">
                    <tr>
                      <th className="py-2 pr-4">{t.architecture.layer}</th>
                      <th className="py-2 pr-4">{t.architecture.choice}</th>
                      <th className="py-2 pr-4">{t.architecture.score}</th>
                      <th className="py-2 pr-4">{t.architecture.alternatives}</th>
                      <th className="py-2 pr-4">{t.architecture.rationale}</th>
                      <th className="py-2">{t.architecture.tracedReqs}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {stack.map((item, idx) => {
                      const reqIds = item.requirementIds ?? item.requirement_ids ?? [];
                      return (
                        <tr key={item.id ?? `${item.layer}-${idx}`}>
                          <td className="py-3 pr-4 font-mono uppercase text-slate-300">{item.layer}</td>
                          <td className="py-3 pr-4 font-semibold text-indigo-300">{item.choice}</td>
                          <td className="py-3 pr-4 font-mono text-emerald-300">
                            {typeof item.score === 'number' ? item.score : '—'}
                          </td>
                          <td className="py-3 pr-4 text-slate-400">
                            {(item.alternatives || []).join(', ') || '—'}
                          </td>
                          <td className="py-3 pr-4 max-w-md text-slate-300">{item.rationale}</td>
                          <td className="py-3">
                            <div className="flex flex-wrap gap-1">
                              {reqIds.map((r) => (
                                <span
                                  key={r}
                                  className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300"
                                >
                                  {r}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
