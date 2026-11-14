import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Archive,
  Boxes,
  CheckCircle2,
  CheckSquare,
  Download,
  FileCode2,
  FileText,
  Lock,
  Play,
  ShieldAlert,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import type { CoverageReport, ProcessingMode } from '@srs-tool/schemas';
import {
  api,
  formatApiError,
  type ChecklistItemStatus,
  type DocumentRecord,
  type ExportRecord,
  type ProjectRecord,
  type RunRecord,
  type SegmentRecord,
} from '../api/client';
import { AppShell } from '../components/AppShell';
import { CoverageBar } from '../components/CoverageBar';
import { RunProgressDrawer } from '../components/RunProgressDrawer';
import { useAuth } from '../auth/AuthProvider';
import { useI18n } from '../i18n/I18nProvider';

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { locale, t } = useI18n();
  const { refreshUsage } = useAuth();

  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [docs, setDocs] = useState<DocumentRecord[]>([]);
  const [coverage, setCoverage] = useState<CoverageReport | null>(null);
  const [segments, setSegments] = useState<SegmentRecord[]>([]);
  const [checklist, setChecklist] = useState<ChecklistItemStatus[]>([]);
  const [exportsList, setExportsList] = useState<ExportRecord[]>([]);
  const [activeRun, setActiveRun] = useState<RunRecord | null>(null);
  const [defaultDiagramId, setDefaultDiagramId] = useState<string | undefined>(undefined);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ title: string; hint?: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Ingestion state
  const [ingestTab, setIngestTab] = useState<'upload' | 'paste'>('upload');
  const [docKind, setDocKind] = useState<'auto' | 'srs' | 'text' | 'email'>('auto');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [pasteFilename, setPasteFilename] = useState('');
  const [ingesting, setIngesting] = useState(false);

  // Pipeline controls
  const [mode, setMode] = useState<ProcessingMode>('eco');
  const [fromStage, setFromStage] = useState<number>(1);
  const [startingRun, setStartingRun] = useState(false);

  // Segment filter & selected segment
  const [segFilter, setSegFilter] = useState<'all' | 'mapped' | 'not_requirement' | 'unresolved' | 'unmapped'>('all');
  const [selectedSegId, setSelectedSegId] = useState<string | null>(null);

  // Baseline lock & Exports
  const [locking, setLocking] = useState(false);
  const [exportFormats, setExportFormats] = useState<string[]>(['zip', 'markdown', 'csv', 'puml', 'svg']);
  const [exporting, setExporting] = useState(false);

  const loadAll = useCallback(async () => {
    if (!id) return;
    try {
      const [proj, docRows, cov, segRows, chkRows, expRows, runRows] = await Promise.all([
        api.projects.get(id),
        api.projects.listDocuments(id),
        api.projects.getCoverage(id),
        api.projects.getSegments(id).catch(() => [] as SegmentRecord[]),
        api.projects.getChecklist(id).catch(() => [] as ChecklistItemStatus[]),
        api.projects.listExports(id).catch(() => [] as ExportRecord[]),
        api.projects.listRuns(id).catch(() => [] as RunRecord[]),
      ]);
      setProject(proj);
      setDocs(docRows);
      setCoverage(cov);
      setSegments(segRows);
      setChecklist(chkRows);
      setExportsList(expRows);
      if (runRows.length > 0 && !activeRun) {
        setActiveRun(runRows[0]!);
      }

      // Resolve default diagram ID gracefully if model exists
      api.projects
        .getArchitecture(id)
        .then((m) => api.diagrams.listByModel(m.id))
        .then((diags) => {
          if (diags.length > 0) setDefaultDiagramId(diags[0]!.id);
        })
        .catch(() => {});
    } catch (err) {
      setError(formatApiError(err, locale));
    } finally {
      setLoading(false);
    }
  }, [id, locale]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleIngest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setIngesting(true);
    setError(null);
    setNotice(null);
    try {
      const resolvedKind = docKind === 'auto' ? undefined : docKind;
      if (ingestTab === 'upload') {
        if (!selectedFile) return;
        await api.projects.uploadDocument(id, selectedFile, resolvedKind);
        setSelectedFile(null);
      } else {
        if (!pasteText.trim()) return;
        await api.projects.uploadDocument(id, {
          text: pasteText,
          filename: pasteFilename.trim() || undefined,
          kind: resolvedKind ?? 'text',
        });
        setPasteText('');
        setPasteFilename('');
      }
      await loadAll();
    } catch (err) {
      setError(formatApiError(err, locale));
    } finally {
      setIngesting(false);
    }
  };

  const handleDeleteDoc = async (docId: string) => {
    try {
      await api.projects.deleteDocument(docId);
      await loadAll();
    } catch (err) {
      setError(formatApiError(err, locale));
    }
  };

  const handleStartRun = async () => {
    if (!id) return;
    setStartingRun(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.projects.startRun(id, { mode, from_stage: fromStage });
      const run = await api.projects.getRun(res.run_id);
      setActiveRun(run);
      await refreshUsage();
    } catch (err) {
      setError(formatApiError(err, locale));
    } finally {
      setStartingRun(false);
    }
  };

  const handleLockBaseline = async () => {
    if (!id) return;
    setLocking(true);
    setError(null);
    setNotice(null);
    try {
      await api.projects.lockBaseline(id);
      setNotice(t.projectDetail.baselineSuccess);
      await loadAll();
    } catch (err) {
      setError(formatApiError(err, locale));
    } finally {
      setLocking(false);
    }
  };

  const handleToggleChecklistNa = async (item: ChecklistItemStatus) => {
    if (!id) return;
    const isCurrentlyNa = item.status === 'not_applicable';
    let reason: string | undefined;
    if (!isCurrentlyNa) {
      const entered = window.prompt(t.projectDetail.naReasonPrompt, 'Out of project scope');
      if (entered === null) return;
      reason = entered.trim() || 'Marked N/A by user';
    }
    try {
      await api.projects.updateChecklistItem(id, item.id, {
        not_applicable: !isCurrentlyNa,
        reason,
      });
      await loadAll();
    } catch (err) {
      setError(formatApiError(err, locale));
    }
  };

  const handleToggleFormat = (fmt: string) => {
    setExportFormats((prev) =>
      prev.includes(fmt) ? (prev.length > 1 ? prev.filter((f) => f !== fmt) : prev) : [...prev, fmt],
    );
  };

  const handleCreateExport = async () => {
    if (!id) return;
    setExporting(true);
    setError(null);
    try {
      await api.projects.createExport(id, exportFormats);
      await loadAll();
    } catch (err) {
      setError(formatApiError(err, locale));
    } finally {
      setExporting(false);
    }
  };

  const filteredSegments = segments.filter((s) =>
    segFilter === 'all' ? true : s.coverageStatus === segFilter,
  );
  const selectedSegment = segments.find((s) => s.id === selectedSegId) ?? null;
  const baselineLocked = Boolean(
    (project?.constraints as Record<string, unknown> | undefined)?.baseline_locked,
  );

  return (
    <AppShell projectName={project?.name} defaultDiagramId={defaultDiagramId}>
      {loading ? (
        <div className="p-10 text-center text-sm text-slate-400">{t.common.loading}</div>
      ) : (
        <div className="space-y-6">
          {/* Header Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-[#111623] p-5">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-xl font-bold text-slate-100">{project?.name}</h1>
                {baselineLocked && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
                    <Lock className="h-3 w-3" />
                    {t.projectDetail.baselineBadge}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                {(project?.platforms || []).map((p) => (
                  <span
                    key={p}
                    className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 uppercase text-slate-300"
                  >
                    {p}
                  </span>
                ))}
                <span>·</span>
                <span className="font-mono uppercase">{project?.outputLanguage}</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Link
                to={`/projects/${id}/requirements`}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-medium text-slate-200 hover:border-indigo-500/60"
              >
                <CheckSquare className="h-3.5 w-3.5 text-indigo-400" />
                {t.projectDetail.goRequirements}
              </Link>
              <Link
                to={`/projects/${id}/architecture`}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-medium text-slate-200 hover:border-indigo-500/60"
              >
                <Boxes className="h-3.5 w-3.5 text-indigo-400" />
                {t.projectDetail.goArchitecture}
              </Link>
              <Link
                to={`/projects/${id}/diagrams/${defaultDiagramId ?? 'default'}`}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-medium text-slate-200 hover:border-indigo-500/60"
              >
                <FileCode2 className="h-3.5 w-3.5 text-indigo-400" />
                {t.projectDetail.goDiagrams}
              </Link>
              {!baselineLocked && (
                <button
                  type="button"
                  disabled={locking}
                  onClick={handleLockBaseline}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  <Lock className="h-3.5 w-3.5" />
                  {locking ? t.projectDetail.locking : t.projectDetail.lockBaseline}
                </button>
              )}
            </div>
          </div>

          {notice && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/15 p-3.5 text-sm text-emerald-200">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
              {notice}
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2.5 rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
              <div>
                <div className="font-medium">{error.title}</div>
                {error.hint && <div className="mt-1 text-xs text-rose-300/90">{error.hint}</div>}
              </div>
            </div>
          )}

          {/* 1. Document Ingestion + 2. Pipeline Control */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Ingestion Card */}
            <section className="rounded-2xl border border-slate-800 bg-[#111623] p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-slate-100">
                  {t.projectDetail.ingestionTitle}
                </h2>
                <div className="flex rounded-lg border border-slate-800 bg-slate-950 p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setIngestTab('upload')}
                    className={`rounded-md px-2.5 py-1 font-medium ${
                      ingestTab === 'upload' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {t.projectDetail.tabUpload}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIngestTab('paste')}
                    className={`rounded-md px-2.5 py-1 font-medium ${
                      ingestTab === 'paste' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {t.projectDetail.tabPaste}
                  </button>
                </div>
              </div>

              <form onSubmit={handleIngest} className="space-y-3">
                <div className="flex items-center gap-3">
                  <label className="text-xs text-slate-400">{t.projectDetail.docKind}:</label>
                  <select
                    value={docKind}
                    onChange={(e) => setDocKind(e.target.value as typeof docKind)}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-slate-200"
                  >
                    <option value="auto">{t.projectDetail.kindAuto}</option>
                    <option value="srs">{t.projectDetail.kindSrs}</option>
                    <option value="text">{t.projectDetail.kindText}</option>
                    <option value="email">{t.projectDetail.kindEmail}</option>
                  </select>
                </div>

                {ingestTab === 'upload' ? (
                  <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-700 bg-slate-950/60 p-6 text-center transition hover:border-indigo-500/60">
                    <UploadCloud className="mb-2 h-7 w-7 text-indigo-400" />
                    <span className="text-xs text-slate-300">
                      {selectedFile ? selectedFile.name : t.projectDetail.dropzoneHint}
                    </span>
                    <input
                      type="file"
                      accept=".pdf,.docx,.md,.txt,.eml,.json"
                      onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                      className="hidden"
                    />
                  </label>
                ) : (
                  <div className="space-y-2.5">
                    <input
                      type="text"
                      value={pasteFilename}
                      onChange={(e) => setPasteFilename(e.target.value)}
                      placeholder={t.projectDetail.pasteFilename}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500"
                    />
                    <textarea
                      rows={5}
                      value={pasteText}
                      onChange={(e) => setPasteText(e.target.value)}
                      placeholder={t.projectDetail.pastePlaceholder}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                )}

                <button
                  type="submit"
                  disabled={
                    ingesting ||
                    (ingestTab === 'upload' ? !selectedFile : !pasteText.trim())
                  }
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  <UploadCloud className="h-3.5 w-3.5" />
                  {ingesting ? t.projectDetail.ingesting : t.projectDetail.ingestBtn}
                </button>
              </form>

              <div className="border-t border-slate-800 pt-3">
                <div className="mb-2 text-xs font-semibold text-slate-300">
                  {t.projectDetail.uploadedDocs} ({docs.length})
                </div>
                {docs.length === 0 ? (
                  <p className="text-xs text-slate-500">{t.projectDetail.noDocs}</p>
                ) : (
                  <div className="space-y-1.5">
                    {docs.map((d) => (
                      <div
                        key={d.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <FileText className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
                          <span className="truncate font-medium text-slate-200">{d.filename}</span>
                          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase text-slate-400">
                            {d.kind}
                          </span>
                          <span className="hidden font-mono text-[10px] text-slate-500 sm:inline">
                            {d.sha256.slice(0, 8)}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteDoc(d.id)}
                          className="rounded p-1 text-slate-500 hover:bg-rose-500/15 hover:text-rose-300"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* Pipeline Runner Card */}
            <section className="rounded-2xl border border-slate-800 bg-[#111623] p-5 space-y-4">
              <h2 className="text-base font-semibold text-slate-100">
                {t.projectDetail.pipelineTitle}
              </h2>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {(
                  [
                    { id: 'eco', label: t.projectDetail.modeEco },
                    { id: 'standard', label: t.projectDetail.modeStandard },
                    { id: 'thorough', label: t.projectDetail.modeThorough },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMode(m.id)}
                    className={`rounded-xl border px-3 py-2.5 text-left text-xs font-medium transition ${
                      mode === m.id
                        ? 'border-indigo-500 bg-indigo-500/20 text-indigo-200'
                        : 'border-slate-700 bg-slate-950 text-slate-400 hover:border-slate-600'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <label className="text-xs text-slate-400">{t.projectDetail.fromStage}:</label>
                <select
                  value={fromStage}
                  onChange={(e) => setFromStage(Number(e.target.value))}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200"
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                    <option key={s} value={s}>
                      S{s}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  disabled={startingRun || docs.length === 0}
                  onClick={handleStartRun}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  <Play className="h-3.5 w-3.5" />
                  {startingRun ? t.projectDetail.running : t.projectDetail.runPipeline}
                </button>
              </div>

              <RunProgressDrawer
                run={activeRun}
                onRunFinished={loadAll}
                onRunUpdated={(updated) => setActiveRun(updated)}
              />
            </section>
          </div>

          {/* 3. Coverage Ledger & Segments */}
          <section className="rounded-2xl border border-slate-800 bg-[#111623] p-5 space-y-4">
            <h2 className="text-base font-semibold text-slate-100">
              {t.projectDetail.coverageTitle}
            </h2>
            <CoverageBar coverage={coverage} />

            <div className="border-t border-slate-800 pt-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium text-slate-200">
                  {t.projectDetail.segmentsTitle} ({filteredSegments.length})
                </h3>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  {(
                    [
                      { key: 'all', label: t.projectDetail.filterAll },
                      { key: 'mapped', label: t.projectDetail.filterMapped },
                      { key: 'not_requirement', label: t.projectDetail.filterNotReq },
                      { key: 'unresolved', label: t.projectDetail.filterUnresolved },
                      { key: 'unmapped', label: t.projectDetail.filterUnmapped },
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setSegFilter(f.key)}
                      className={`rounded-lg px-2.5 py-1 transition ${
                        segFilter === f.key
                          ? 'bg-indigo-600 text-white'
                          : 'border border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {filteredSegments.length === 0 ? (
                <p className="text-xs text-slate-500">{t.projectDetail.noSegments}</p>
              ) : (
                <div className="grid gap-4 lg:grid-cols-3">
                  <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1 lg:col-span-2">
                    {filteredSegments.map((seg) => (
                      <button
                        key={seg.id}
                        type="button"
                        onClick={() => setSelectedSegId(seg.id)}
                        className={`w-full rounded-xl border p-3 text-left text-xs transition ${
                          selectedSegId === seg.id
                            ? 'border-indigo-500 bg-indigo-500/15'
                            : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
                        }`}
                      >
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <span className="font-mono text-[11px] text-slate-400">
                            #{seg.ordinal} · {seg.document_filename || 'clarification'}
                          </span>
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                              seg.coverageStatus === 'mapped'
                                ? 'bg-emerald-500/15 text-emerald-300'
                                : seg.coverageStatus === 'not_requirement'
                                  ? 'bg-slate-700 text-slate-300'
                                  : seg.coverageStatus === 'unresolved'
                                    ? 'bg-amber-500/15 text-amber-300'
                                    : 'bg-rose-500/15 text-rose-300'
                            }`}
                          >
                            {seg.coverageStatus}
                          </span>
                        </div>
                        <p className="line-clamp-2 text-slate-200">{seg.text}</p>
                      </button>
                    ))}
                  </div>

                  <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 text-xs">
                    {selectedSegment ? (
                      <div className="space-y-3">
                        <div className="font-mono text-[11px] text-indigo-300">
                          Segment #{selectedSegment.ordinal} ({selectedSegment.coverageStatus})
                        </div>
                        <p className="whitespace-pre-wrap text-slate-200 leading-relaxed">
                          {selectedSegment.text}
                        </p>
                        <div className="border-t border-slate-800 pt-2">
                          <div className="mb-1.5 font-semibold text-slate-300">
                            {t.projectDetail.linkedReqs} ({selectedSegment.linked_requirements?.length ?? 0})
                          </div>
                          {selectedSegment.linked_requirements &&
                          selectedSegment.linked_requirements.length > 0 ? (
                            <div className="space-y-1.5">
                              {selectedSegment.linked_requirements.map((r) => (
                                <Link
                                  key={r.id}
                                  to={`/projects/${id}/requirements?selected=${r.id}`}
                                  className="block rounded-lg border border-slate-800 bg-slate-900 p-2 hover:border-indigo-500/50"
                                >
                                  <span className="font-mono font-semibold text-indigo-300">
                                    {r.code}
                                  </span>
                                  <p className="mt-0.5 line-clamp-2 text-slate-300">{r.statement}</p>
                                </Link>
                              ))}
                            </div>
                          ) : (
                            <span className="text-slate-500">{t.common.noData}</span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="text-slate-500">{t.requirements.selectPrompt}</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* 4. Platform Checklist + 5. Export Bundle */}
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Checklist */}
            <section className="rounded-2xl border border-slate-800 bg-[#111623] p-5 space-y-3 lg:col-span-2">
              <h2 className="text-base font-semibold text-slate-100">
                {t.projectDetail.checklistTitle}
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-800 text-slate-400">
                    <tr>
                      <th className="py-2 pr-3">{t.projectDetail.checklistTopic}</th>
                      <th className="py-2 pr-3">{t.projectDetail.checklistPlatform}</th>
                      <th className="py-2 pr-3">{t.projectDetail.checklistLevel}</th>
                      <th className="py-2 pr-3">{t.projectDetail.checklistStatus}</th>
                      <th className="py-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {checklist.map((item) => (
                      <tr key={item.id}>
                        <td className="py-2.5 pr-3">
                          <div className="font-medium text-slate-200">
                            {locale === 'en' ? item.topic.en : item.topic.vi}
                          </div>
                          {item.reason && (
                            <div className="text-[11px] text-slate-500">{item.reason}</div>
                          )}
                        </td>
                        <td className="py-2.5 pr-3 uppercase text-slate-400">{item.platform}</td>
                        <td className="py-2.5 pr-3 text-slate-400">{item.level}</td>
                        <td className="py-2.5 pr-3">
                          <span
                            className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${
                              item.status === 'covered'
                                ? 'bg-emerald-500/15 text-emerald-300'
                                : item.status === 'mentioned'
                                  ? 'bg-sky-500/15 text-sky-300'
                                  : item.status === 'not_applicable'
                                    ? 'bg-slate-700 text-slate-300'
                                    : 'bg-amber-500/15 text-amber-300'
                            }`}
                          >
                            {item.status === 'covered'
                              ? t.projectDetail.checklistCovered
                              : item.status === 'mentioned'
                                ? t.projectDetail.checklistMentioned
                                : item.status === 'not_applicable'
                                  ? t.projectDetail.checklistNa
                                  : t.projectDetail.checklistMissing}
                          </span>
                        </td>
                        <td className="py-2.5 text-right">
                          <button
                            type="button"
                            onClick={() => handleToggleChecklistNa(item)}
                            className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-300 hover:border-indigo-500/50"
                          >
                            {item.status === 'not_applicable'
                              ? t.projectDetail.reopenItem
                              : t.projectDetail.markNa}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Export Card */}
            <section className="rounded-2xl border border-slate-800 bg-[#111623] p-5 space-y-4">
              <div className="flex items-center gap-2">
                <Archive className="h-4 w-4 text-indigo-400" />
                <h2 className="text-base font-semibold text-slate-100">
                  {t.projectDetail.exportsTitle}
                </h2>
              </div>

              <div className="space-y-2">
                <div className="text-xs text-slate-400">{t.projectDetail.exportFormats}:</div>
                <div className="flex flex-wrap gap-1.5">
                  {['zip', 'markdown', 'csv', 'puml', 'svg'].map((fmt) => (
                    <button
                      key={fmt}
                      type="button"
                      onClick={() => handleToggleFormat(fmt)}
                      className={`rounded-lg border px-2.5 py-1 font-mono text-[11px] uppercase ${
                        exportFormats.includes(fmt)
                          ? 'border-indigo-500 bg-indigo-500/20 text-indigo-200'
                          : 'border-slate-700 bg-slate-900 text-slate-400'
                      }`}
                    >
                      {fmt}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                disabled={exporting}
                onClick={handleCreateExport}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                {exporting ? t.projectDetail.generatingExport : t.projectDetail.generateExport}
              </button>

              <div className="border-t border-slate-800 pt-3 space-y-2">
                <div className="text-xs font-medium text-slate-300">
                  {t.projectDetail.exportHistory}
                </div>
                {exportsList.length === 0 ? (
                  <p className="text-xs text-slate-500">{t.common.noData}</p>
                ) : (
                  <div className="space-y-2">
                    {exportsList.map((exp) => (
                      <div
                        key={exp.export_id}
                        className="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/70 p-2.5 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-mono text-[11px] text-slate-200">
                            {exp.formats.join(', ')}
                          </div>
                          <div className="text-[10px] text-slate-500">
                            {exp.status === 'expired'
                              ? t.projectDetail.expired
                              : `${t.projectDetail.ready} · ${new Date(exp.expires_at).toLocaleString()}`}
                          </div>
                        </div>
                        {exp.download_url && exp.status !== 'expired' && (
                          <a
                            href={exp.download_url}
                            download
                            className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-emerald-600/20 px-2.5 py-1 text-[11px] font-medium text-emerald-300 hover:bg-emerald-600/30"
                          >
                            <Download className="h-3 w-3" />
                            {t.common.download}
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      )}
    </AppShell>
  );
}
