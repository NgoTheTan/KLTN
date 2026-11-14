import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Cpu,
  FolderPlus,
  Gauge,
  Globe2,
  Lock,
  Plus,
  Smartphone,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { Language, Platform } from '@srs-tool/schemas';
import { api, formatApiError, type ProjectRecord } from '../api/client';
import { AppShell } from '../components/AppShell';
import { useAuth } from '../auth/AuthProvider';
import { useI18n } from '../i18n/I18nProvider';

const SAMPLE_SRS_CONTENT = `# Smart Building IoT & Web Operations SRS (Song ngữ Việt–Anh)

## 1. Giới thiệu (Không phải yêu cầu)
Tài liệu này mô tả yêu cầu cho hệ thống giám sát toà nhà thông minh đa nền tảng.

## 2. Yêu cầu Chức năng (Functional Requirements)
- Hệ thống phải thu thập dữ liệu nhiệt độ và độ ẩm từ cảm biến IoT qua giao thức MQTT mỗi 5 giây.
- Khi nhiệt độ phòng máy chủ vượt quá 35 độ C, hệ thống phải gửi cảnh báo đẩy (push notification) tới ứng dụng di động của người vận hành trong vòng 3 giây.
- The web dashboard shall allow facility administrators to export daily energy consumption reports in CSV and PDF formats.
- Người dùng có thể xem lịch sử cảnh báo nhanh và dễ sử dụng.

## 3. Yêu cầu Phi chức năng (Non-Functional Requirements)
- Thời gian phản hồi của API dashboard phải nhỏ hơn 500 ms cho 95% truy vấn với 1000 thiết bị kết nối đồng thời.
- Tất cả dữ liệu truyền tải giữa thiết bị IoT, ứng dụng di động và máy chủ web phải được mã hoá bằng TLS 1.3.
- Hệ thống phải hỗ trợ xác thực hai yếu tố (MFA) và phân quyền theo vai trò (RBAC) cho tài khoản quản trị viên.
`;

export function ProjectsPage() {
  const { locale, t } = useI18n();
  const { usage, refreshUsage } = useAuth();
  const navigate = useNavigate();

  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ title: string; hint?: string } | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [creatingSample, setCreatingSample] = useState(false);

  // Create form state
  const [name, setName] = useState('');
  const [platforms, setPlatforms] = useState<Platform[]>(['web']);
  const [outputLanguage, setOutputLanguage] = useState<Language>(locale);
  const [teamSize, setTeamSize] = useState('3-5');
  const [budget, setBudget] = useState('low');
  const [openSourceOnly, setOpenSourceOnly] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.projects.list();
      setProjects(list);
      setError(null);
    } catch (err) {
      setError(formatApiError(err, locale));
    } finally {
      setLoading(false);
    }
  }, [locale]);

  useEffect(() => {
    loadProjects();
    refreshUsage();
  }, [loadProjects, refreshUsage]);

  const togglePlatform = (p: Platform) => {
    setPlatforms((prev) =>
      prev.includes(p) ? (prev.length > 1 ? prev.filter((x) => x !== p) : prev) : [...prev, p],
    );
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await api.projects.create({
        name: name.trim(),
        platforms,
        output_language: outputLanguage,
        constraints: {
          team_size: teamSize,
          budget,
          open_source_preferred: openSourceOnly,
        },
      });
      setShowModal(false);
      setName('');
      navigate(`/projects/${created.id}`);
    } catch (err) {
      setError(formatApiError(err, locale));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateSample = async () => {
    setCreatingSample(true);
    setError(null);
    try {
      const created = await api.projects.create({
        name:
          locale === 'vi'
            ? 'Smart Building IoT & Web (Dự án mẫu)'
            : 'Smart Building IoT & Web (Sample Project)',
        platforms: ['web', 'mobile', 'iot'],
        output_language: locale,
        constraints: {
          team_size: '3-5',
          budget: 'low',
          open_source_preferred: true,
        },
      });
      await api.projects.uploadDocument(created.id, {
        text: SAMPLE_SRS_CONTENT,
        filename: 'smart-building-srs.md',
        kind: 'srs',
      });
      navigate(`/projects/${created.id}`);
    } catch (err) {
      setError(formatApiError(err, locale));
    } finally {
      setCreatingSample(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(t.projects.deleteConfirm)) return;
    try {
      await api.projects.delete(id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      setError(formatApiError(err, locale));
    }
  };

  const platformIcon = (p: string) => {
    if (p === 'mobile') return <Smartphone className="h-3 w-3" />;
    if (p === 'iot') return <Cpu className="h-3 w-3" />;
    return <Globe2 className="h-3 w-3" />;
  };

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Page Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-100">{t.projects.title}</h1>
            <p className="mt-1 text-sm text-slate-400">{t.projects.subtitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={creatingSample}
              onClick={handleCreateSample}
              className="inline-flex items-center gap-2 rounded-xl border border-indigo-500/40 bg-indigo-500/15 px-4 py-2 text-sm font-medium text-indigo-200 transition hover:bg-indigo-500/25 disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4 text-indigo-400" />
              {creatingSample ? t.projects.creatingSample : t.projects.createSample}
            </button>
            <button
              type="button"
              onClick={() => {
                setOutputLanguage(locale);
                setShowModal(true);
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-indigo-500/30 transition hover:bg-indigo-500"
            >
              <Plus className="h-4 w-4" />
              {t.projects.newProject}
            </button>
          </div>
        </div>

        {/* Daily Token Quota Banner */}
        {usage && (
          <div className="rounded-2xl border border-slate-800 bg-[#111623] p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-400">
                  <Gauge className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-200">{t.projects.quotaCardTitle}</div>
                  <div className="text-xs text-slate-400">{t.projects.ecoTip}</div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-5 text-sm">
                <div>
                  <div className="text-xs text-slate-400">{t.projects.used}</div>
                  <div className="font-mono font-semibold text-slate-200">
                    {usage.usedTokens.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-400">{t.projects.remaining}</div>
                  <div className="font-mono font-semibold text-emerald-300">
                    {usage.remainingTokens.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-400">{t.projects.dailyLimit}</div>
                  <div className="font-mono font-semibold text-slate-300">
                    {usage.dailyLimitTokens.toLocaleString()}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
            <div className="font-medium">{error.title}</div>
            {error.hint && <div className="mt-1 text-xs text-rose-300/90">{error.hint}</div>}
          </div>
        )}

        {/* Projects Grid */}
        {loading ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-10 text-center text-sm text-slate-400">
            {t.common.loading}
          </div>
        ) : projects.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/30 p-12 text-center">
            <FolderPlus className="mx-auto mb-3 h-10 w-10 text-slate-500" />
            <h2 className="text-base font-semibold text-slate-200">{t.projects.emptyTitle}</h2>
            <p className="mx-auto mt-1 max-w-lg text-sm text-slate-400">{t.projects.emptyDesc}</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => {
              const locked = Boolean((p.constraints as Record<string, unknown> | undefined)?.baseline_locked);
              return (
                <div
                  key={p.id}
                  className="group flex flex-col justify-between rounded-2xl border border-slate-800 bg-[#111623] p-5 transition hover:border-indigo-500/50"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <Link
                        to={`/projects/${p.id}`}
                        className="text-base font-semibold text-slate-100 group-hover:text-indigo-300"
                      >
                        {p.name}
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleDelete(p.id)}
                        title={t.common.delete}
                        className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-500/15 hover:text-rose-300"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {(p.platforms || []).map((pl) => (
                        <span
                          key={pl}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] font-medium uppercase text-slate-300"
                        >
                          {platformIcon(pl)}
                          {pl}
                        </span>
                      ))}
                      <span className="rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 font-mono text-[11px] uppercase text-indigo-300">
                        {p.outputLanguage || 'vi'}
                      </span>
                      {locked && (
                        <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                          <Lock className="h-3 w-3" />
                          {t.projects.baselineLocked}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-5 flex items-center justify-between border-t border-slate-800/80 pt-3.5 text-xs">
                    <span className="text-slate-500">
                      {new Date(p.updatedAt || p.createdAt).toLocaleDateString()}
                    </span>
                    <Link
                      to={`/projects/${p.id}`}
                      className="inline-flex items-center gap-1 font-medium text-indigo-400 hover:text-indigo-300"
                    >
                      {t.projects.openProject}
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create Project Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-[#101521] shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-100">{t.projects.modalTitle}</h2>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-4 p-5">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-300">
                  {t.projects.projectName}
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t.projects.projectNamePlaceholder}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-300">
                  {t.projects.platforms}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['web', 'mobile', 'iot'] as Platform[]).map((p) => {
                    const active = platforms.includes(p);
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => togglePlatform(p)}
                        className={`flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold uppercase transition ${
                          active
                            ? 'border-indigo-500 bg-indigo-500/20 text-indigo-200'
                            : 'border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600'
                        }`}
                      >
                        {platformIcon(p)}
                        {p}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-300">
                  {t.projects.outputLang}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(['vi', 'en'] as Language[]).map((lang) => (
                    <button
                      key={lang}
                      type="button"
                      onClick={() => setOutputLanguage(lang)}
                      className={`rounded-xl border px-3 py-2 text-xs font-medium transition ${
                        outputLanguage === lang
                          ? 'border-indigo-500 bg-indigo-500/20 text-indigo-200'
                          : 'border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600'
                      }`}
                    >
                      {lang === 'vi' ? t.common.vi : t.common.en}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/50 p-3.5">
                <div className="text-xs font-semibold text-slate-300">{t.projects.constraintsTitle}</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-[11px] text-slate-400">{t.projects.teamSize}</label>
                    <select
                      value={teamSize}
                      onChange={(e) => setTeamSize(e.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200"
                    >
                      <option value="1-2">1-2</option>
                      <option value="3-5">3-5</option>
                      <option value="6-15">6-15</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] text-slate-400">{t.projects.budgetTier}</label>
                    <select
                      value={budget}
                      onChange={(e) => setBudget(e.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200"
                    >
                      <option value="low">{t.projects.budgetLow}</option>
                      <option value="medium">{t.projects.budgetMedium}</option>
                      <option value="high">{t.projects.budgetHigh}</option>
                    </select>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={openSourceOnly}
                    onChange={(e) => setOpenSourceOnly(e.target.checked)}
                    className="rounded border-slate-600 bg-slate-950 text-indigo-600"
                  />
                  {t.projects.openSourceOnly}
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800"
                >
                  {t.common.cancel}
                </button>
                <button
                  type="submit"
                  disabled={submitting || !name.trim()}
                  className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  {submitting ? t.common.saving : t.common.create}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
