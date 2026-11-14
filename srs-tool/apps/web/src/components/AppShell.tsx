import React, { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import {
  Boxes,
  CheckSquare,
  FileCode2,
  FolderKanban,
  Gauge,
  Globe,
  Layers,
  UserCheck,
} from 'lucide-react';
import { useI18n } from '../i18n/I18nProvider';
import { useAuth } from '../auth/AuthProvider';

function formatCountdown(resetsAtIso?: string): string {
  if (!resetsAtIso) return '--:--';
  const diff = new Date(resetsAtIso).getTime() - Date.now();
  if (diff <= 0) return '00:00';
  const hrs = Math.floor(diff / 3_600_000);
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  return `${String(hrs).padStart(2, '0')}h ${String(mins).padStart(2, '0')}m`;
}

export function AppShell({
  projectName,
  defaultDiagramId,
  children,
}: {
  projectName?: string;
  defaultDiagramId?: string;
  children: React.ReactNode;
}) {
  const { locale, t, toggleLocale } = useI18n();
  const { user, usage, signInDev } = useAuth();
  const { id: projectId } = useParams<{ id: string }>();
  const location = useLocation();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [countdown, setCountdown] = useState(() => formatCountdown(usage?.resetsAt));

  useEffect(() => {
    setCountdown(formatCountdown(usage?.resetsAt));
    const timer = setInterval(() => {
      setCountdown(formatCountdown(usage?.resetsAt));
    }, 30_000);
    return () => clearInterval(timer);
  }, [usage?.resetsAt]);

  const handleSwitchUser = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = emailInput.trim();
    if (!trimmed) return;
    await signInDev(trimmed);
    setEmailInput('');
    setShowUserMenu(false);
    window.location.reload();
  };

  const quotaPct = usage && usage.dailyLimitTokens > 0
    ? Math.min(100, Math.round((usage.usedTokens / usage.dailyLimitTokens) * 100))
    : 0;

  return (
    <div className="flex min-h-screen flex-col bg-[#0b0e14] text-slate-100">
      <header className="sticky top-0 z-30 border-b border-slate-800/90 bg-[#0f131d]/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
          <div className="flex items-center gap-4">
            <Link to="/projects" className="flex items-center gap-2.5 text-slate-100 hover:text-white">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600/90 text-white shadow-sm shadow-indigo-500/30">
                <Layers className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-semibold leading-tight tracking-tight">{t.common.appName}</div>
                <div className="text-[11px] text-slate-400">{t.common.appSubtitle}</div>
              </div>
            </Link>

            {projectId && (
              <nav className="hidden items-center gap-1 border-l border-slate-800 pl-4 md:flex">
                <Link
                  to={`/projects/${projectId}`}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                    location.pathname === `/projects/${projectId}`
                      ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/40'
                      : 'text-slate-300 hover:bg-slate-800/80'
                  }`}
                >
                  <FolderKanban className="h-3.5 w-3.5" />
                  {projectName ? projectName : t.nav.overview}
                </Link>
                <Link
                  to={`/projects/${projectId}/requirements`}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                    location.pathname.includes('/requirements')
                      ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/40'
                      : 'text-slate-300 hover:bg-slate-800/80'
                  }`}
                >
                  <CheckSquare className="h-3.5 w-3.5" />
                  {t.nav.requirements}
                </Link>
                <Link
                  to={`/projects/${projectId}/architecture`}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                    location.pathname.includes('/architecture')
                      ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/40'
                      : 'text-slate-300 hover:bg-slate-800/80'
                  }`}
                >
                  <Boxes className="h-3.5 w-3.5" />
                  {t.nav.architecture}
                </Link>
                <Link
                  to={
                    defaultDiagramId
                      ? `/projects/${projectId}/diagrams/${defaultDiagramId}`
                      : `/projects/${projectId}/diagrams/default`
                  }
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                    location.pathname.includes('/diagrams')
                      ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/40'
                      : 'text-slate-300 hover:bg-slate-800/80'
                  }`}
                >
                  <FileCode2 className="h-3.5 w-3.5" />
                  {t.nav.diagrams}
                </Link>
              </nav>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            {usage && (
              <div
                className="hidden items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-1.5 text-xs sm:flex"
                title={`${t.projects.used}: ${usage.usedTokens.toLocaleString()} / ${usage.dailyLimitTokens.toLocaleString()}`}
              >
                <Gauge className="h-3.5 w-3.5 text-indigo-400" />
                <span className="text-slate-400">{t.nav.quotaLabel}:</span>
                <span className="font-mono font-medium text-slate-200">
                  {usage.remainingTokens.toLocaleString()} / {usage.dailyLimitTokens.toLocaleString()}
                </span>
                <span className="text-[11px] text-slate-500">({quotaPct}%)</span>
                <span className="border-l border-slate-800 pl-2 text-[11px] text-slate-400">
                  {t.nav.resetIn} {countdown}
                </span>
              </div>
            )}

            <button
              type="button"
              onClick={toggleLocale}
              data-testid="locale-toggle"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-indigo-500/60 hover:text-white"
              title="VI ↔ EN"
            >
              <Globe className="h-3.5 w-3.5 text-indigo-400" />
              <span>{locale === 'vi' ? 'VI' : 'EN'}</span>
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => setShowUserMenu((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200 transition hover:border-slate-500"
              >
                <UserCheck className="h-3.5 w-3.5 text-emerald-400" />
                <span className="max-w-[140px] truncate">{user?.email ?? 'dev@srs-tool.local'}</span>
              </button>

              {showUserMenu && (
                <div className="absolute right-0 mt-2 w-72 rounded-xl border border-slate-700 bg-[#131826] p-3 shadow-xl">
                  <div className="mb-2 text-xs text-slate-400">
                    {t.nav.signedInAs}: <span className="font-medium text-slate-200">{user?.email}</span>
                  </div>
                  <form onSubmit={handleSwitchUser} className="space-y-2">
                    <input
                      type="email"
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      placeholder={t.nav.devEmailPlaceholder}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
                    />
                    <button
                      type="submit"
                      className="w-full rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
                    >
                      {t.nav.switchUser}
                    </button>
                  </form>
                </div>
              )}
            </div>
          </div>
        </div>

        {projectId && (
          <div className="flex items-center gap-1 overflow-x-auto border-t border-slate-800/70 px-4 py-1.5 md:hidden">
            <Link
              to={`/projects/${projectId}`}
              className="shrink-0 rounded-md px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800"
            >
              {t.nav.overview}
            </Link>
            <Link
              to={`/projects/${projectId}/requirements`}
              className="shrink-0 rounded-md px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800"
            >
              {t.nav.requirements}
            </Link>
            <Link
              to={`/projects/${projectId}/architecture`}
              className="shrink-0 rounded-md px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800"
            >
              {t.nav.architecture}
            </Link>
            <Link
              to={`/projects/${projectId}/diagrams/default`}
              className="shrink-0 rounded-md px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800"
            >
              {t.nav.diagrams}
            </Link>
          </div>
        )}
      </header>

      <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
