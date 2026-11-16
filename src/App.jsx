import { useCallback, useEffect, useRef, useState } from "react";
import AdminDashboard from "./components/AdminDashboard.jsx";
import CityHealthPage from "./components/CityHealthPage.jsx";
import LoginModal from "./components/LoginModal.jsx";
import ReportFeed from "./components/ReportFeed.jsx";
import ReportForm from "./components/ReportForm.jsx";
import ReportTrackingPage from "./components/ReportTrackingPage.jsx";
import StaffPostersPage from "./components/StaffPostersPage.jsx";
import { useAuth } from "./context/AuthContext.jsx";
import { ThemeProvider, useTheme } from "./context/ThemeContext.jsx";
import { syncOfflineQueue } from "./services/offlineQueue.js";
import cityConfig from "../config/city.json";

const tabs = [
  { id: "form", label: "Citizen Report Form", shortLabel: "Report Issue" },
  { id: "feed", label: "Live Incident Feed", shortLabel: "Live Feed" },
  { id: "admin", label: "Admin Incident Ops", shortLabel: "Admin Ops" },
];

const PAGE_META = {
  form: {
    title: "Report an Issue — CivicGuard",
    description:
      "Report a pothole, broken streetlight, accessibility blocker or sanitation issue to your municipality. AI triage runs in the background.",
  },
  feed: {
    title: "Live Incident Feed — CivicGuard",
    description:
      "Browse live municipal incident reports with AI-assigned category, severity and urgency. Updated every five seconds.",
  },
  admin: {
    title: "Incident Operations — CivicGuard",
    description:
      "Authority operations dashboard for triaging municipal incidents, updating status and exporting reports.",
  },
  health: {
    title: `${cityConfig.cityName} City Health — CivicGuard`,
    description:
      "Aggregate citywide incident and resolution metrics, including a privacy-preserving map of reports from the last 30 days.",
  },
  posters: {
    title: "Location Posters — CivicGuard",
    description: "Staff tools for creating printable, location-specific CivicGuard reporting posters.",
  },
};

function PermissionBanner({ user, onOpenLogin, onReturnToFeed }) {
  return (
    <section
      aria-labelledby="admin-permission-title"
      className="mx-auto flex w-full max-w-3xl flex-col gap-5 rounded-xl border border-line bg-panel p-6 shadow sm:flex-row sm:items-center sm:p-8"
      role="status"
    >
      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border border-cyan/20 bg-cyan/10 text-cyan">
        <svg aria-hidden="true" className="h-6 w-6" fill="none" viewBox="0 0 24 24">
          <path
            d="M7 10V7a5 5 0 0 1 10 0v3m-11 0h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Zm5 4v3"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.7"
          />
        </svg>
      </div>

      <div className="flex-1">
        <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-cyan">
          Access control / {user ? "citizen session" : "guest session"}
        </p>
        <h1
          className="mt-1 font-display text-xl font-semibold text-ink"
          id="admin-permission-title"
        >
          {user ? "Authority access required" : "Sign in to continue"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          The Admin Incident Ops dashboard is only available to authenticated
          Authority Members. Sign in with an authority account or return to the
          live incident feed.
        </p>
      </div>

      <div className="flex shrink-0 flex-wrap gap-2">
        <button
          className="min-h-11 rounded-lg bg-cyan px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-brand dark:text-slate-900"
          onClick={onOpenLogin}
          type="button"
        >
          {user ? "Sign in as Authority" : "Sign in"}
        </button>
        <button
          className="rounded border border-slate-200 dark:border-white/10 bg-panel-raised px-4 py-2.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-muted transition hover:border-cyan/30 hover:text-ink focus:outline-none focus:ring-2 focus:ring-cyan/40"
          onClick={onReturnToFeed}
          type="button"
        >
          Back to Feed
        </button>
      </div>
    </section>
  );
}

function AppContent() {
  const [staffPostersPage, setStaffPostersPage] = useState(
    () => window.location.pathname.replace(/\/+$/, "") === "/staff/posters",
  );
  const [cityHealthPage, setCityHealthPage] = useState(
    () => window.location.pathname.replace(/\/+$/, "") === "/city-health",
  );
  const [trackingCode, setTrackingCode] = useState(() => {
    const match = window.location.pathname.match(/^\/track\/([^/]+)\/?$/i);
    return match ? decodeURIComponent(match[1]).toUpperCase() : null;
  });
  const [activeTab, setActiveTab] = useState(
    () => window.location.pathname.replace(/\/+$/, "") === "/report" ? "form" : "feed",
  );
  const [submittedReports, setSubmittedReports] = useState([]);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [passwordResetToken, setPasswordResetToken] = useState(null);
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [toast, setToast] = useState(null);
  const [toastLeaving, setToastLeaving] = useState(false);
  const toastId = useRef(0);
  const { user, isAuthenticated, logout, verifyEmail } = useAuth();
  const { darkMode, toggleTheme } = useTheme();
  const roleLabel = user?.role === "authority"
    ? "Authority View"
    : user
      ? "Citizen View"
      : "Guest View";

  const showToast = useCallback((message) => {
    toastId.current += 1;
    setToast({ id: toastId.current, message });
    setToastLeaving(false);
  }, []);

  const addOptimisticReport = useCallback((report) => {
    setSubmittedReports((current) => [report, ...current]);
    setActiveTab("feed");
  }, []);

  const reconcileSubmittedReport = useCallback((report, optimisticId, errorMessage) => {
    setSubmittedReports((current) => [
      ...(report && !report.duplicateOf ? [report] : []),
      ...current.filter((item) => item.id !== optimisticId && item.id !== report?.id),
    ]);
    showToast(report
      ? report.duplicate
        ? `Report linked to an existing incident. Track it with ${report.trackingCode}.`
        : `Report submitted. Track it with ${report.trackingCode || "the report ID"}. AI triage is running.`
      : `Report submission failed: ${errorMessage || "Please try again."}`);
  }, [showToast]);

  const removeSyncedReports = useCallback((reportIds) => {
    if (reportIds.length === 0) return;
    const synced = new Set(reportIds);
    setSubmittedReports((current) => current.filter((report) => !synced.has(report.id)));
  }, []);

  useEffect(() => {
    if (!toast) return undefined;

    const fadeTimer = window.setTimeout(() => setToastLeaving(true), 2700);
    const dismissTimer = window.setTimeout(() => setToast(null), 3000);
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(dismissTimer);
    };
  }, [toast]);

  useEffect(() => {
    const meta = staffPostersPage
      ? PAGE_META.posters
      : cityHealthPage
        ? PAGE_META.health
        : PAGE_META[activeTab] ?? PAGE_META.feed;
    document.title = meta.title;
    const description = document.querySelector('meta[name="description"]');
    if (description) description.setAttribute("content", meta.description);
  }, [activeTab, cityHealthPage, staffPostersPage]);

  useEffect(() => {
    function updateTrackingRoute() {
      const match = window.location.pathname.match(/^\/track\/([^/]+)\/?$/i);
      setTrackingCode(match ? decodeURIComponent(match[1]).toUpperCase() : null);
      setCityHealthPage(window.location.pathname.replace(/\/+$/, "") === "/city-health");
      setStaffPostersPage(window.location.pathname.replace(/\/+$/, "") === "/staff/posters");
      if (window.location.pathname.replace(/\/+$/, "") === "/report") setActiveTab("form");
    }
    window.addEventListener("popstate", updateTrackingRoute);
    return () => window.removeEventListener("popstate", updateTrackingRoute);
  }, []);

  useEffect(() => {
    const currentUrl = new URL(window.location.href);
    const verificationToken = currentUrl.searchParams.get("verifyEmail");
    const resetToken = currentUrl.searchParams.get("resetPassword");
    if (!verificationToken && !resetToken) return undefined;

    currentUrl.searchParams.delete("verifyEmail");
    currentUrl.searchParams.delete("resetPassword");
    window.history.replaceState({}, "", `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`);
    if (resetToken) {
      setPasswordResetToken(resetToken);
      setIsAuthModalOpen(true);
    }
    if (!verificationToken) return undefined;
    let active = true;

    verifyEmail(verificationToken)
      .then((verifiedUser) => {
        if (!active) return;
        setIsAuthModalOpen(false);
        setActiveTab(verifiedUser.role === "authority" ? "admin" : "feed");
        showToast("Email verified. You are now signed in.");
      })
      .catch((verificationError) => {
        if (!active) return;
        setIsAuthModalOpen(true);
        showToast(verificationError.message || "Email verification link is invalid or expired.");
      });

    return () => {
      active = false;
    };
  }, [verifyEmail, showToast]);

  useEffect(() => {
    if (typeof window !== "undefined" && "serviceWorker" in navigator && window.location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    const handleBeforeInstall = (event) => {
      event.preventDefault();
      setDeferredPrompt(event);
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstall);

    const handleOnline = async () => {
      const { syncedCount } = await syncOfflineQueue((report) => {
        showToast(`Offline report synced! Tracking code: ${report.trackingCode || report.id}`);
      });
      if (syncedCount > 0) {
        showToast(`Successfully dispatched ${syncedCount} queued offline report${syncedCount > 1 ? "s" : ""}.`);
      }
    };
    window.addEventListener("online", handleOnline);
    handleOnline();

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("online", handleOnline);
    };
  }, [showToast]);

  return (
    <>
      {toast && (
        <div
          aria-atomic="true"
          aria-live="polite"
          className={`civic-toast animate-civic-toast-in fixed right-4 top-20 z-[10000] flex min-h-11 w-[calc(100%-2rem)] max-w-sm items-start gap-3 rounded-lg border border-line bg-panel p-4 text-ink shadow sm:right-6 ${toastLeaving ? "translate-y-2 scale-[0.98] opacity-0" : "translate-y-0 scale-100 opacity-100"}`}
          key={toast.id}
          role="status"
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-resolved/25 bg-resolved/10 text-resolved">
            <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 20 20">
              <path d="m4 10 4 4 8-8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
            </svg>
          </span>
          <p className="flex-1 pt-1 text-sm font-medium leading-5">{toast.message}</p>
          <button
            aria-label="Dismiss notification"
            className="rounded px-1 text-lg leading-5 text-muted transition hover:text-ink"
            onClick={() => setToast(null)}
            type="button"
          >
            ×
          </button>
          <span aria-hidden="true" className="civic-toast-progress absolute inset-x-0 bottom-0 h-1 bg-resolved/70" />
        </div>
      )}
      <main className="flex min-h-screen flex-col bg-canvas font-sans text-ink">
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-brand focus:px-4 focus:py-2 focus:font-mono focus:text-xs focus:font-semibold focus:text-white dark:focus:text-slate-900"
        href="#main-content"
      >
        Skip to main content
      </a>
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/95">
        <div className="mx-auto flex max-w-[1720px] flex-col gap-4 px-4 py-3 sm:px-6 lg:flex-row lg:flex-nowrap lg:items-center lg:justify-between lg:gap-5 lg:px-8">
          <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-3">
            <div className="flex items-center gap-2.5">
              <svg
                aria-hidden="true"
                className="h-8 w-8 text-brand"
                fill="none"
                viewBox="0 0 32 32"
              >
                <path
                  d="M16 3.5 27 8v7.2c0 6.2-4.4 11.4-11 13.3C10.4 26.6 6 21.4 6 15.2V8l10-4.5Z"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <path d="m11.5 15.5 3 3 6-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
              </svg>
              <div className="font-display text-xl font-bold tracking-tight">
                <span className="text-ink">Civic</span>
                <span className="text-brand">Guard</span>
              </div>
            </div>

            <div className="hidden items-center gap-2 rounded-full border border-line bg-panel px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-resolved 2xl:inline-flex">
              <span className="h-2 w-2 rounded-full bg-resolved" />
              AI pipeline active
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center lg:flex-1 lg:justify-end lg:gap-3">
            <nav
              aria-label="Main navigation"
              className="flex w-full gap-1 overflow-x-auto rounded-lg border border-line bg-deep p-1 sm:w-auto"
            >
              {tabs.map((tab) => {
                const isActive = activeTab === tab.id;

                return (
                  <button
                    aria-pressed={isActive}
                    className={`min-w-0 flex-1 rounded-lg px-3 py-2.5 text-left text-xs font-semibold leading-4 transition sm:min-w-[118px] sm:px-4 ${
                      isActive
                        ? "bg-cyan text-white dark:text-slate-900 shadow"
                        : "text-muted hover:bg-panel-hover hover:text-ink"
                    }`}
                    key={tab.id}
                    onClick={() => {
                      if (window.location.pathname !== "/") {
                        window.history.pushState({}, "", "/");
                      }
                      setStaffPostersPage(false);
                      if (cityHealthPage) {
                        setCityHealthPage(false);
                      }
                      if (trackingCode) {
                        window.history.replaceState({}, "", "/");
                        setTrackingCode(null);
                      }
                      setActiveTab(tab.id);
                    }}
                    type="button"
                  >
                    <span className="hidden sm:inline">{tab.label}</span>
                    <span className="sm:hidden">{tab.shortLabel}</span>
                  </button>
                );
              })}
              <button
                aria-current={cityHealthPage ? "page" : undefined}
                className={`min-w-0 flex-1 rounded-lg px-3 py-2.5 text-left text-xs font-semibold leading-4 transition sm:min-w-[118px] sm:px-4 ${
                  cityHealthPage
                    ? "bg-cyan text-white dark:text-slate-900 shadow"
                    : "text-muted hover:bg-panel-hover hover:text-ink"
                }`}
                onClick={() => {
                  window.history.pushState({}, "", "/city-health");
                  setTrackingCode(null);
                  setCityHealthPage(true);
                }}
                type="button"
              >
                City Health
              </button>
              {user?.role === "authority" ? (
                <button
                  aria-current={staffPostersPage ? "page" : undefined}
                  className={`min-w-0 flex-1 rounded-lg px-3 py-2.5 text-left text-xs font-semibold leading-4 transition sm:min-w-[118px] sm:px-4 ${
                    staffPostersPage
                      ? "bg-cyan text-white dark:text-slate-900 shadow"
                      : "text-muted hover:bg-panel-hover hover:text-ink"
                  }`}
                  onClick={() => {
                    window.history.pushState({}, "", "/staff/posters");
                    setTrackingCode(null);
                    setCityHealthPage(false);
                    setStaffPostersPage(true);
                  }}
                  type="button"
                >
                  Posters
                </button>
              ) : null}
            </nav>

            <div className="flex items-center justify-between gap-3 sm:justify-end sm:gap-5">
              {deferredPrompt && (
                <button
                  type="button"
                  onClick={async () => {
                    deferredPrompt.prompt();
                    const choice = await deferredPrompt.userChoice;
                    if (choice?.outcome === "accepted") setDeferredPrompt(null);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-brand/10 px-3 py-1.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-brand transition hover:bg-brand/20 focus:outline-none focus:ring-2 focus:ring-brand"
                  aria-label="Install CivicGuard App on this device"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  <span>Install App</span>
                </button>
              )}
              <div className="inline-flex shrink-0 items-center gap-2 rounded-full border border-slate-200 dark:border-white/10 bg-panel px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-wide text-muted">
                <span className={`h-1.5 w-1.5 rounded-full ${user?.role === "authority" ? "bg-cyan" : user ? "bg-mint" : "bg-muted"}`} />
                {roleLabel}
              </div>
              <div className="hidden border-l border-slate-200 dark:border-white/10 pl-5 text-right xl:block">
                <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-muted">
                  Municipal response
                </p>
                <p className="mt-0.5 font-mono text-xs font-semibold text-mint">
                  Civic reporting online
                </p>
              </div>
              <div className="flex items-center gap-2.5">
                <button
                  aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-line bg-panel-raised text-brand transition hover:bg-panel-hover focus:outline-none focus:ring-2 focus:ring-brand"
                  onClick={toggleTheme}
                  type="button"
                >
                  <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
                    {darkMode ? (
                      <>
                        <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" />
                        <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
                      </>
                    ) : (
                      <path d="M20.2 15.1A8.4 8.4 0 0 1 8.9 3.8 8.5 8.5 0 1 0 20.2 15.1Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
                    )}
                  </svg>
                </button>
                <div className="text-right">
                  <p className="text-xs font-semibold text-ink">
                    {user?.name ?? "Guest"}
                  </p>
                  <p className="font-mono text-[9px] text-brand">
                    {user?.role === "authority" ? "AUTHORITY" : user ? "CITIZEN" : "NOT SIGNED IN"}
                  </p>
                </div>
                <div className="grid h-9 w-9 place-items-center rounded-full border border-line bg-panel-raised font-mono text-xs font-semibold text-brand">
                  {user?.name
                    ? user.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()
                    : "CG"}
                </div>
              </div>
              {isAuthenticated ? (
                <button
                  className="rounded border border-slate-200 dark:border-white/10 bg-panel-raised px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-wide text-muted hover:border-alert/30 hover:text-alert"
                  onClick={logout}
                  type="button"
                >
                  Sign out
                </button>
              ) : (
                <button
                  className="min-h-11 whitespace-nowrap rounded-lg border border-line bg-panel-raised px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-wide text-brand hover:bg-panel-hover"
                  onClick={() => setIsAuthModalOpen(true)}
                  type="button"
                >
                  Sign in
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="w-full flex-1 px-4 py-6 sm:px-6 lg:px-8" id="main-content">
        <div className="animate-fade-in" key={activeTab}>
        {trackingCode ? (
          <ReportTrackingPage code={trackingCode} />
        ) : cityHealthPage ? (
          <CityHealthPage />
        ) : staffPostersPage ? (
          user?.role === "authority" ? (
            <StaffPostersPage />
          ) : (
            <PermissionBanner
              onReturnToFeed={() => {
                window.history.pushState({}, "", "/");
                setStaffPostersPage(false);
                setActiveTab("feed");
              }}
              onOpenLogin={() => setIsAuthModalOpen(true)}
              user={user}
            />
          )
        ) : activeTab === "form" ? (
          <ReportForm
            onOptimisticSubmit={addOptimisticReport}
            onSubmit={reconcileSubmittedReport}
          />
        ) : activeTab === "feed" ? (
          <ReportFeed
            onCreateReport={() => setActiveTab("form")}
            onSyncedReports={removeSyncedReports}
            submittedReports={submittedReports}
          />
        ) : user?.role === "authority" ? (
          <AdminDashboard onNotify={showToast} />
        ) : (
          <PermissionBanner
            onReturnToFeed={() => setActiveTab("feed")}
            onOpenLogin={() => setIsAuthModalOpen(true)}
            user={user}
          />
        )}
        </div>
      </div>

      <LoginModal
        isOpen={isAuthModalOpen}
        onClose={() => {
          setIsAuthModalOpen(false);
          setPasswordResetToken(null);
        }}
        onSuccess={(authenticatedUser) => {
          if (authenticatedUser.role === "authority" && activeTab === "admin") {
            setActiveTab("admin");
          }
        }}
        resetToken={passwordResetToken}
      />

      <footer className="border-t border-line bg-deep px-4 py-4 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-[1720px] flex-col gap-2 font-mono text-[9px] uppercase tracking-[0.1em] text-muted sm:flex-row sm:items-center sm:justify-between">
          <span>Municipal incident intelligence</span>
          <nav aria-label="Legal and project links" className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <a className="normal-case tracking-normal transition hover:text-ink" href="/privacy.html">
              Privacy
            </a>
            <a className="normal-case tracking-normal transition hover:text-ink" href="/terms.html">
              Terms
            </a>
            <a
              className="normal-case tracking-normal transition hover:text-ink"
              href="https://github.com/rexis67/civicguard/issues"
              rel="noopener noreferrer"
              target="_blank"
            >
              Contact
            </a>
          </nav>
          <span className="inline-flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-resolved" />
            Secure civic reporting portal
          </span>
        </div>
      </footer>
      </main>
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}
