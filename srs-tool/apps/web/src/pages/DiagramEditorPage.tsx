import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  LockOpen,
  Play,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  api,
  formatApiError,
  type DiagramDetail,
  type DiagramSummary,
  type ProjectRecord,
} from '../api/client';
import { AgentPatchSidebar } from '../components/AgentPatchSidebar';
import { AppShell } from '../components/AppShell';
import { CodeMirrorPuml } from '../components/CodeMirrorPuml';
import { useI18n } from '../i18n/I18nProvider';

function extractErrorLine(errMsg?: string): number | null {
  if (!errMsg) return null;
  const match = errMsg.match(/line\s+(\d+)/i) || errMsg.match(/dòng\s+(\d+)/i);
  if (match && match[1]) {
    const n = Number(match[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

export function DiagramEditorPage() {
  const { id: projectId, diagramId } = useParams<{ id?: string; diagramId: string }>();
  const navigate = useNavigate();
  const { locale, t } = useI18n();

  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [views, setViews] = useState<DiagramSummary[]>([]);
  const [diagram, setDiagram] = useState<DiagramDetail | null>(null);
  const [pumlCode, setPumlCode] = useState('');
  const [lastValidSvg, setLastValidSvg] = useState<string>('');
  const [syntaxError, setSyntaxError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ title: string; hint?: string } | null>(null);

  const loadDiagram = useCallback(
    async (targetDiagramId?: string) => {
      setLoading(true);
      try {
        if (projectId) {
          const [proj, arch] = await Promise.all([
            api.projects.get(projectId),
            api.projects.getArchitecture(projectId),
          ]);
          setProject(proj);
          const list = await api.diagrams.listByModel(arch.id);
          setViews(list);

          const resolvedId =
            targetDiagramId && targetDiagramId !== 'default'
              ? targetDiagramId
              : list[0]?.id;

          if (resolvedId) {
            const detail = await api.diagrams.get(resolvedId, 'json');
            setDiagram(detail);
            setPumlCode(detail.puml ?? detail.content ?? '');
            if (detail.svg && !detail.error) {
              setLastValidSvg(detail.svg);
              setSyntaxError(null);
            } else if (detail.error) {
              setSyntaxError(detail.error);
            }
          }
        } else if (targetDiagramId) {
          const detail = await api.diagrams.get(targetDiagramId, 'json');
          setDiagram(detail);
          setPumlCode(detail.puml ?? detail.content ?? '');
          if (detail.svg && !detail.error) {
            setLastValidSvg(detail.svg);
            setSyntaxError(null);
          }
          if (detail.modelId) {
            const list = await api.diagrams.listByModel(detail.modelId).catch(() => []);
            setViews(list);
          }
        }
        setError(null);
      } catch (err) {
        setError(formatApiError(err, locale));
      } finally {
        setLoading(false);
      }
    },
    [projectId, locale],
  );

  useEffect(() => {
    loadDiagram(diagramId);
  }, [diagramId, loadDiagram]);

  const handleSaveAndRender = async () => {
    if (!diagram) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.diagrams.updatePuml(diagram.id, pumlCode);
      setDiagram(updated);
      if (updated.syntax_error) {
        // Keep lastValidSvg intact per FR-DIA-006!
        setSyntaxError(updated.syntax_error);
      } else {
        setSyntaxError(null);
        if (updated.svg) setLastValidSvg(updated.svg);
      }
    } catch (err) {
      setError(formatApiError(err, locale));
    } finally {
      setSaving(false);
    }
  };

  const handleResetToModel = async () => {
    if (!diagram) return;
    setSaving(true);
    setError(null);
    try {
      const resetDiag = await api.diagrams.reset(diagram.id);
      setDiagram(resetDiag);
      setPumlCode(resetDiag.puml ?? '');
      setSyntaxError(resetDiag.error ?? null);
      if (resetDiag.svg && !resetDiag.error) {
        setLastValidSvg(resetDiag.svg);
      }
    } catch (err) {
      setError(formatApiError(err, locale));
    } finally {
      setSaving(false);
    }
  };

  const downloadTextFile = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const errorLine = extractErrorLine(syntaxError ?? undefined);
  const isDetached = diagram?.mode === 'detached';

  return (
    <AppShell projectName={project?.name} defaultDiagramId={diagram?.id}>
      <div className="space-y-4">
        {/* Top Studio Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-[#111623] p-4">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-lg font-bold text-slate-100">{t.diagramEditor.title}</h1>

            {/* View Switcher Tabs */}
            <div className="flex flex-wrap gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1">
              {views.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() =>
                    navigate(
                      projectId ? `/projects/${projectId}/diagrams/${v.id}` : `/diagrams/${v.id}`,
                    )
                  }
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium uppercase transition ${
                    diagram?.id === v.id
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {v.type}
                </button>
              ))}
            </div>

            {diagram && (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                  isDetached
                    ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                    : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                }`}
              >
                {isDetached ? (
                  <LockOpen className="h-3.5 w-3.5" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                )}
                {isDetached ? t.diagramEditor.detachedMode : t.diagramEditor.modelMode}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isDetached && (
              <button
                type="button"
                disabled={saving}
                onClick={handleResetToModel}
                className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/25 disabled:opacity-50"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t.diagramEditor.resetToModel}
              </button>
            )}
            <button
              type="button"
              disabled={!pumlCode}
              onClick={() =>
                downloadTextFile(
                  pumlCode,
                  `${diagram?.type ?? 'diagram'}.puml`,
                  'text/plain;charset=utf-8',
                )
              }
              className="inline-flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200 hover:border-slate-500"
            >
              <Download className="h-3.5 w-3.5" />
              {t.diagramEditor.exportPuml}
            </button>
            <button
              type="button"
              disabled={!lastValidSvg}
              onClick={() =>
                downloadTextFile(
                  lastValidSvg,
                  `${diagram?.type ?? 'diagram'}.svg`,
                  'image/svg+xml;charset=utf-8',
                )
              }
              className="inline-flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200 hover:border-slate-500"
            >
              <Download className="h-3.5 w-3.5" />
              {t.diagramEditor.exportSvg}
            </button>
            <button
              type="button"
              disabled={saving || !diagram}
              onClick={handleSaveAndRender}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" />
              {saving ? t.diagramEditor.savingRender : t.diagramEditor.saveRender}
            </button>
          </div>
        </div>

        {/* Detached Mode Warning Banner */}
        {isDetached && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-200">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
              <span>{t.diagramEditor.detachedBanner}</span>
            </div>
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
          <div className="grid gap-4 lg:grid-cols-12" style={{ minHeight: '68vh' }}>
            {/* Left Pane: CodeMirror 6 PlantUML Editor */}
            <div className="flex flex-col space-y-2 lg:col-span-4" style={{ height: '68vh' }}>
              {syntaxError && (
                <div className="rounded-xl border border-rose-500/50 bg-rose-500/15 p-3 text-xs text-rose-200">
                  <div className="font-semibold">
                    {t.diagramEditor.syntaxErrorTitle}
                    {errorLine ? ` (Line ${errorLine})` : ''}
                  </div>
                  <div className="mt-1 font-mono text-[11px]">{syntaxError}</div>
                  <div className="mt-1 text-amber-300">{t.diagramEditor.lastValidNotice}</div>
                </div>
              )}
              <div className="flex-1 min-h-0">
                <CodeMirrorPuml
                  value={pumlCode}
                  onChange={setPumlCode}
                  errorLine={errorLine}
                />
              </div>
            </div>

            {/* Center Pane: Zoomable SVG Canvas */}
            <div
              className="flex flex-col overflow-hidden rounded-xl border border-slate-800 bg-[#101521] lg:col-span-5"
              style={{ height: '68vh' }}
            >
              <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2 text-xs">
                <span className="font-mono text-slate-400">
                  SVG Preview ({Math.round(zoom * 100)}%)
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.15).toFixed(2)))}
                    className="rounded-md border border-slate-700 bg-slate-900 p-1 text-slate-300 hover:bg-slate-800"
                    title={t.diagramEditor.zoomOut}
                  >
                    <ZoomOut className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoom(1)}
                    className="rounded-md border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] text-slate-300 hover:bg-slate-800"
                  >
                    {t.diagramEditor.zoomReset}
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.15).toFixed(2)))}
                    className="rounded-md border border-slate-700 bg-slate-900 p-1 text-slate-300 hover:bg-slate-800"
                    title={t.diagramEditor.zoomIn}
                  >
                    <ZoomIn className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-auto bg-slate-100 p-4">
                {lastValidSvg ? (
                  <div
                    style={{
                      transform: `scale(${zoom})`,
                      transformOrigin: 'top left',
                    }}
                    className="inline-block min-w-full [&_svg]:h-auto [&_svg]:max-w-none"
                    dangerouslySetInnerHTML={{ __html: lastValidSvg }}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-slate-500">
                    {t.common.noData}
                  </div>
                )}
              </div>
            </div>

            {/* Right Pane: AI Agent Sidebar */}
            <div className="lg:col-span-3" style={{ height: '68vh' }}>
              {projectId ? (
                <AgentPatchSidebar
                  projectId={projectId}
                  onModelUpdated={() => loadDiagram(diagram?.id)}
                />
              ) : (
                <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 text-xs text-slate-400">
                  {t.common.noData}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
