import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  BookOpen,
  Check,
  CheckCircle2,
  FileText,
  HelpCircle,
  History,
  Plus,
  Search,
  ShieldAlert,
  X,
  XCircle,
} from 'lucide-react';
import {
  api,
  formatApiError,
  type ClarificationQuestion,
  type GlossaryTerm,
  type ProjectRecord,
  type RequirementRecord,
} from '../api/client';
import { AppShell } from '../components/AppShell';
import { ClarificationInbox } from '../components/ClarificationInbox';
import { OriginBadge, StatusBadge, TierBadge } from '../components/OriginBadge';
import { VersionDiffModal } from '../components/VersionDiffModal';
import { useI18n } from '../i18n/I18nProvider';

function HighlightedQuote({ text, quote }: { text: string; quote?: string | null }) {
  if (!quote || !text.includes(quote)) {
    return <span>{text}</span>;
  }
  const idx = text.indexOf(quote);
  const before = text.slice(0, idx);
  const after = text.slice(idx + quote.length);
  return (
    <span>
      {before}
      <mark className="rounded bg-amber-400/25 px-1 text-amber-200">{quote}</mark>
      {after}
    </span>
  );
}

export function RequirementsPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { locale, t } = useI18n();

  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [items, setItems] = useState<RequirementRecord[]>([]);
  const [selected, setSelected] = useState<RequirementRecord | null>(null);
  const [questions, setQuestions] = useState<ClarificationQuestion[]>([]);
  const [glossary, setGlossary] = useState<GlossaryTerm[]>([]);

  // Filters
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [platformFilter, setPlatformFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [originFilter, setOriginFilter] = useState('');
  const [earsFilter, setEarsFilter] = useState('');
  const [onlyAsr, setOnlyAsr] = useState(false);

  // Detail edit state
  const [editStatement, setEditStatement] = useState('');
  const [editAcceptance, setEditAcceptance] = useState('');
  const [editRationale, setEditRationale] = useState('');
  const [editPriority, setEditPriority] = useState<RequirementRecord['priority']>('should');
  const [editEars, setEditEars] = useState<RequirementRecord['earsPattern']>('ubiquitous');

  // Drawers / Modals
  const [showInbox, setShowInbox] = useState(false);
  const [showGlossary, setShowGlossary] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  // Add requirement form
  const [newType, setNewType] = useState<RequirementRecord['type']>('functional');
  const [newEars, setNewEars] = useState<RequirementRecord['earsPattern']>('ubiquitous');
  const [newStatement, setNewStatement] = useState('');
  const [newAcceptance, setNewAcceptance] = useState('');

  // Add glossary form
  const [termVi, setTermVi] = useState('');
  const [termEn, setTermEn] = useState('');
  const [termDef, setTermDef] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ title: string; hint?: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const [proj, reqs, qs, gls] = await Promise.all([
        api.projects.get(projectId),
        api.requirements.list(projectId, {
          search,
          type: typeFilter,
          platform: platformFilter,
          status: statusFilter,
          origin: originFilter,
          ears_pattern: earsFilter,
          is_asr: onlyAsr ? 'true' : '',
        }),
        api.requirements.listQuestions(projectId).catch(() => []),
        api.requirements.listGlossary(projectId).catch(() => []),
      ]);
      setProject(proj);
      setItems(reqs);
      setQuestions(qs);
      setGlossary(gls);
      setError(null);

      const urlSelected = searchParams.get('selected');
      const targetId = urlSelected || selected?.id || reqs[0]?.id;
      if (targetId) {
        const detail = await api.requirements.get(projectId, targetId).catch(() => null);
        if (detail) {
          setSelected(detail);
          setEditStatement(detail.statement);
          setEditAcceptance(detail.acceptanceCriteria ?? '');
          setEditRationale(detail.rationale ?? '');
          setEditPriority(detail.priority);
          setEditEars(detail.earsPattern);
        }
      } else {
        setSelected(null);
      }
    } catch (err) {
      setError(formatApiError(err, locale));
    } finally {
      setLoading(false);
    }
  }, [projectId, search, typeFilter, platformFilter, statusFilter, originFilter, earsFilter, onlyAsr, locale]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const handleSelectReq = async (reqId: string) => {
    if (!projectId) return;
    setSearchParams({ selected: reqId });
    setNotice(null);
    setError(null);
    try {
      const detail = await api.requirements.get(projectId, reqId);
      setSelected(detail);
      setEditStatement(detail.statement);
      setEditAcceptance(detail.acceptanceCriteria ?? '');
      setEditRationale(detail.rationale ?? '');
      setEditPriority(detail.priority);
      setEditEars(detail.earsPattern);
    } catch (err) {
      setError(formatApiError(err, locale));
    }
  };

  const handleSave = async () => {
    if (!projectId || !selected) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await api.requirements.update(projectId, selected.id, {
        statement: editStatement,
        acceptance_criteria: editAcceptance || undefined,
        rationale: editRationale || undefined,
        priority: editPriority,
        ears_pattern: editEars,
      });
      setSelected(updated);
      setNotice(t.common.save + ' ✓');
      await loadList();
    } catch (err) {
      setError(formatApiError(err, locale));
    } finally {
      setSaving(false);
    }
  };

  const handleStatusAction = async (
    nextStatus: 'approved' | 'rejected',
    confirmInferred = false,
  ) => {
    if (!projectId || !selected) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await api.requirements.update(projectId, selected.id, {
        status: nextStatus,
        confirm_inferred: confirmInferred,
      });
      setSelected(updated);
      await loadList();
    } catch (err) {
      setError(formatApiError(err, locale));
    } finally {
      setSaving(false);
    }
  };

  const handleCreateReq = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId || !newStatement.trim()) return;
    setSaving(true);
    try {
      const created = await api.requirements.create(projectId, {
        type: newType,
        platforms: project?.platforms ?? ['web'],
        ears_pattern: newEars,
        statement: newStatement.trim(),
        acceptance_criteria: newAcceptance.trim() || undefined,
        origin: 'explicit',
      });
      setShowAddModal(false);
      setNewStatement('');
      setNewAcceptance('');
      await loadList();
      await handleSelectReq(created.id);
    } catch (err) {
      setError(formatApiError(err, locale));
    } finally {
      setSaving(false);
    }
  };

  const handleAddGlossary = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId || (!termVi.trim() && !termEn.trim())) return;
    try {
      await api.requirements.addGlossary(projectId, {
        term_vi: termVi.trim(),
        term_en: termEn.trim(),
        definition: termDef.trim(),
      });
      setTermVi('');
      setTermEn('');
      setTermDef('');
      setGlossary(await api.requirements.listGlossary(projectId));
    } catch (err) {
      setError(formatApiError(err, locale));
    }
  };

  const pendingQuestionsCount = questions.filter((q) => q.status === 'pending').length;

  return (
    <AppShell projectName={project?.name}>
      <div className="space-y-4">
        {/* Top Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-bold text-slate-100">{t.requirements.title}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowInbox(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/25"
            >
              <HelpCircle className="h-3.5 w-3.5" />
              {t.requirements.clarificationInbox}
              <span className="rounded-full bg-amber-500/30 px-1.5 py-0.5 font-mono text-[10px]">
                {pendingQuestionsCount}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setShowGlossary(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-indigo-500/50"
            >
              <BookOpen className="h-3.5 w-3.5 text-indigo-400" />
              {t.requirements.glossaryBtn} ({glossary.length})
            </button>
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
            >
              <Plus className="h-3.5 w-3.5" />
              {t.requirements.addRequirement}
            </button>
          </div>
        </div>

        {/* Multi-dimensional Filter Bar */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-[#111623] p-3 text-xs">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.common.search}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 py-1.5 pl-8 pr-3 text-xs text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-slate-200"
          >
            <option value="">{t.requirements.filterType}: {t.common.all}</option>
            <option value="functional">functional</option>
            <option value="non-functional">non-functional</option>
            <option value="constraint">constraint</option>
            <option value="interface">interface</option>
            <option value="assumption">assumption</option>
          </select>

          <select
            value={originFilter}
            onChange={(e) => setOriginFilter(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-slate-200"
          >
            <option value="">{t.requirements.filterOrigin}: {t.common.all}</option>
            <option value="explicit">{t.origin.explicit}</option>
            <option value="inferred">{t.origin.inferred}</option>
            <option value="assumption">{t.origin.assumption}</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-slate-200"
          >
            <option value="">{t.requirements.filterStatus}: {t.common.all}</option>
            <option value="candidate">candidate</option>
            <option value="needs_clarification">needs_clarification</option>
            <option value="normalized">normalized</option>
            <option value="approved">approved</option>
            <option value="baseline">baseline</option>
            <option value="rejected">rejected</option>
          </select>

          <select
            value={earsFilter}
            onChange={(e) => setEarsFilter(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-slate-200"
          >
            <option value="">{t.requirements.filterEars}: {t.common.all}</option>
            <option value="ubiquitous">ubiquitous</option>
            <option value="event-driven">event-driven</option>
            <option value="state-driven">state-driven</option>
            <option value="optional">optional</option>
            <option value="unwanted">unwanted</option>
            <option value="complex">complex</option>
          </select>

          <select
            value={platformFilter}
            onChange={(e) => setPlatformFilter(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-slate-200"
          >
            <option value="">{t.requirements.filterPlatform}: {t.common.all}</option>
            <option value="web">web</option>
            <option value="mobile">mobile</option>
            <option value="iot">iot</option>
            <option value="shared">shared</option>
          </select>

          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-slate-300">
            <input
              type="checkbox"
              checked={onlyAsr}
              onChange={(e) => setOnlyAsr(e.target.checked)}
              className="rounded border-slate-600 bg-slate-900 text-indigo-600"
            />
            {t.requirements.onlyAsr}
          </label>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
            <div>
              <div className="font-medium">{error.title}</div>
              {error.hint && <div className="mt-0.5 text-rose-300/90">{error.hint}</div>}
            </div>
          </div>
        )}

        {notice && (
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-300">
            {notice}
          </div>
        )}

        {/* Master-Detail Split Layout */}
        <div className="grid gap-5 lg:grid-cols-12">
          {/* Left Master List */}
          <div className="max-h-[75vh] space-y-2 overflow-y-auto pr-1 lg:col-span-5">
            {loading ? (
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 text-center text-xs text-slate-400">
                {t.common.loading}
              </div>
            ) : items.length === 0 ? (
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 text-center text-xs text-slate-500">
                {t.common.noData}
              </div>
            ) : (
              items.map((req) => {
                const isSelected = selected?.id === req.id;
                const scoreColor =
                  req.qualityScore >= 80
                    ? 'text-emerald-300'
                    : req.qualityScore >= 60
                      ? 'text-amber-300'
                      : 'text-rose-300';
                return (
                  <button
                    key={req.id}
                    type="button"
                    onClick={() => handleSelectReq(req.id)}
                    className={`w-full rounded-xl border p-3.5 text-left transition ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-500/15'
                        : 'border-slate-800 bg-[#111623] hover:border-slate-700'
                    }`}
                  >
                    <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-xs font-bold text-indigo-300">{req.code}</span>
                        <OriginBadge origin={req.origin} showTooltip={false} />
                        {req.isAsr && (
                          <span className="rounded bg-cyan-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-cyan-300">
                            ASR
                          </span>
                        )}
                      </div>
                      <span className={`font-mono text-xs font-semibold ${scoreColor}`}>
                        {req.qualityScore}/100
                      </span>
                    </div>

                    <p className="line-clamp-2 text-xs leading-relaxed text-slate-200">{req.statement}</p>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={req.status} />
                      <TierBadge tier={req.resolvedBy} />
                      <span className="rounded bg-slate-800/80 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                        {req.earsPattern}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Right Detail Panel */}
          <div className="rounded-2xl border border-slate-800 bg-[#111623] p-5 lg:col-span-7">
            {!selected ? (
              <div className="flex h-64 items-center justify-center text-sm text-slate-500">
                {t.requirements.selectPrompt}
              </div>
            ) : (
              <div className="space-y-5">
                {/* Header & Actions */}
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-4">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-base font-bold text-indigo-300">{selected.code}</span>
                      <OriginBadge origin={selected.origin} />
                      <StatusBadge status={selected.status} />
                      <TierBadge tier={selected.resolvedBy} />
                    </div>
                    <div className="text-xs text-slate-400">
                      {t.requirements.qualityScore}:{' '}
                      <strong className="font-mono text-slate-200">{selected.qualityScore}/100</strong> ·{' '}
                      {selected.type} · {(selected.platforms || []).join(', ')}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowDiff(true)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200 hover:border-indigo-500/50"
                    >
                      <History className="h-3.5 w-3.5" />
                      {t.requirements.historyDiffBtn} ({selected.versions?.length ?? 0})
                    </button>

                    {selected.origin === 'inferred' &&
                    selected.status !== 'approved' &&
                    selected.status !== 'baseline' ? (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => handleStatusAction('approved', true)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {t.requirements.confirmInferredBtn}
                      </button>
                    ) : (
                      selected.status !== 'approved' &&
                      selected.status !== 'baseline' && (
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => handleStatusAction('approved', false)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                        >
                          <Check className="h-3.5 w-3.5" />
                          {t.requirements.approveBtn}
                        </button>
                      )
                    )}

                    {selected.status !== 'rejected' && (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => handleStatusAction('rejected', false)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        {t.requirements.rejectBtn}
                      </button>
                    )}
                  </div>
                </div>

                {selected.origin === 'inferred' &&
                  selected.status !== 'approved' &&
                  selected.status !== 'baseline' && (
                    <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                      <span>{t.requirements.inferredWarning}</span>
                    </div>
                  )}

                {/* Normalized EARS Statement vs Source Segment Comparison */}
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-indigo-300">
                      {t.requirements.normalizedStatement}
                    </label>
                    <textarea
                      rows={4}
                      value={editStatement}
                      onChange={(e) => setEditStatement(e.target.value)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
                    />
                    <div className="text-[11px] text-slate-400">
                      <strong className="text-slate-300">{t.requirements.originalStatement}:</strong>{' '}
                      {selected.statementOriginal}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-300">
                      <FileText className="h-3.5 w-3.5" />
                      {t.requirements.sourceSegments}
                    </div>
                    {selected.sources && selected.sources.length > 0 ? (
                      <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
                        {selected.sources.map((src, i) => (
                          <div
                            key={`${src.segmentId}-${i}`}
                            className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 text-xs"
                          >
                            <div className="mb-1 flex items-center justify-between text-[10px] text-slate-400">
                              <span className="font-mono">
                                Segment #{src.segment?.ordinal ?? '?'} ·{' '}
                                {src.segment?.documentId ? 'Document' : 'User Clarification'}
                              </span>
                              <span>{src.segment?.language?.toUpperCase()}</span>
                            </div>
                            <p className="leading-relaxed text-slate-200">
                              {src.segment?.text ? (
                                <HighlightedQuote text={src.segment.text} quote={src.quote} />
                              ) : (
                                src.quote || src.segmentId
                              )}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-slate-800 bg-slate-950/40 p-4 text-xs text-slate-500">
                        {t.requirements.noSources}
                      </div>
                    )}
                  </div>
                </div>

                {/* Metadata & Acceptance Criteria */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs text-slate-400">
                      {t.requirements.filterEars}
                    </label>
                    <select
                      value={editEars}
                      onChange={(e) =>
                        setEditEars(e.target.value as RequirementRecord['earsPattern'])
                      }
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-200"
                    >
                      <option value="ubiquitous">ubiquitous</option>
                      <option value="event-driven">event-driven</option>
                      <option value="state-driven">state-driven</option>
                      <option value="optional">optional</option>
                      <option value="unwanted">unwanted</option>
                      <option value="complex">complex</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-400">
                      {t.requirements.priority}
                    </label>
                    <select
                      value={editPriority}
                      onChange={(e) =>
                        setEditPriority(e.target.value as RequirementRecord['priority'])
                      }
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-200"
                    >
                      <option value="must">must</option>
                      <option value="should">should</option>
                      <option value="could">could</option>
                      <option value="wont">wont</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs text-slate-400">
                    {t.requirements.acceptanceCriteria}
                  </label>
                  <textarea
                    rows={3}
                    value={editAcceptance}
                    onChange={(e) => setEditAcceptance(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 font-mono text-xs text-slate-200"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs text-slate-400">
                    {t.requirements.rationale}
                  </label>
                  <input
                    type="text"
                    value={editRationale}
                    onChange={(e) => setEditRationale(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200"
                  />
                </div>

                {selected.issues && selected.issues.length > 0 && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-3 text-xs">
                    <div className="mb-1 font-semibold text-amber-300">
                      {t.requirements.incoseIssues}
                    </div>
                    <ul className="list-disc space-y-0.5 pl-4 text-amber-200/90">
                      {selected.issues.map((iss, idx) => (
                        <li key={idx}>{iss}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={handleSave}
                    className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
                  >
                    {saving ? t.common.saving : t.common.save}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Clarification Inbox Drawer */}
      <ClarificationInbox
        open={showInbox}
        questions={questions}
        onClose={() => setShowInbox(false)}
        onAnswered={loadList}
      />

      {/* Version History & Diff Modal */}
      {selected && projectId && (
        <VersionDiffModal
          open={showDiff}
          projectId={projectId}
          requirementId={selected.id}
          versions={selected.versions ?? []}
          onClose={() => setShowDiff(false)}
          onReverted={loadList}
        />
      )}

      {/* Bilingual Glossary Drawer */}
      {showGlossary && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm">
          <div className="flex h-full w-full max-w-lg flex-col border-l border-slate-800 bg-[#0f131d] shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
              <div className="flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-indigo-400" />
                <h2 className="text-base font-semibold text-slate-100">
                  {t.requirements.glossaryTitle}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowGlossary(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              <form onSubmit={handleAddGlossary} className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/60 p-3.5">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={termVi}
                    onChange={(e) => setTermVi(e.target.value)}
                    placeholder={t.requirements.termVi}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100"
                  />
                  <input
                    type="text"
                    value={termEn}
                    onChange={(e) => setTermEn(e.target.value)}
                    placeholder={t.requirements.termEn}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100"
                  />
                </div>
                <input
                  type="text"
                  value={termDef}
                  onChange={(e) => setTermDef(e.target.value)}
                  placeholder={t.requirements.definition}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100"
                />
                <button
                  type="submit"
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
                >
                  {t.requirements.addTerm}
                </button>
              </form>

              <div className="space-y-2">
                {glossary.map((g) => (
                  <div key={g.id} className="rounded-xl border border-slate-800 bg-slate-900/40 p-3 text-xs">
                    <div className="font-semibold text-indigo-300">
                      {g.termVi} <span className="text-slate-500">↔</span> {g.termEn}
                    </div>
                    {g.definition && <p className="mt-1 text-slate-400">{g.definition}</p>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Requirement Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-[#101521] p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h2 className="text-base font-semibold text-slate-100">{t.requirements.addRequirement}</h2>
              <button type="button" onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleCreateReq} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as RequirementRecord['type'])}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-slate-200"
                >
                  <option value="functional">functional</option>
                  <option value="non-functional">non-functional</option>
                  <option value="constraint">constraint</option>
                  <option value="interface">interface</option>
                </select>
                <select
                  value={newEars}
                  onChange={(e) => setNewEars(e.target.value as RequirementRecord['earsPattern'])}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-slate-200"
                >
                  <option value="ubiquitous">ubiquitous</option>
                  <option value="event-driven">event-driven</option>
                  <option value="state-driven">state-driven</option>
                  <option value="optional">optional</option>
                  <option value="unwanted">unwanted</option>
                </select>
              </div>
              <textarea
                rows={3}
                required
                value={newStatement}
                onChange={(e) => setNewStatement(e.target.value)}
                placeholder={t.requirements.normalizedStatement}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm text-slate-100"
              />
              <textarea
                rows={2}
                value={newAcceptance}
                onChange={(e) => setNewAcceptance(e.target.value)}
                placeholder={t.requirements.acceptanceCriteria}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs text-slate-100"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-slate-300"
                >
                  {t.common.cancel}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-indigo-600 px-4 py-1.5 font-medium text-white hover:bg-indigo-500"
                >
                  {t.common.create}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
