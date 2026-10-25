import { useCallback, useEffect, useRef, useState } from "react";
import AdminDashboard from "./components/AdminDashboard.jsx";
import LoginModal from "./components/LoginModal.jsx";
import ReportFeed from "./components/ReportFeed.jsx";
import ReportForm from "./components/ReportForm.jsx";
import TargetCursor from "./components/TargetCursor.jsx";
import { useAuth } from "./context/AuthContext.jsx";

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
};

function PermissionBanner({ user, onOpenLogin, onReturnToFeed }) {
  return (
    <section
      aria-labelledby="admin-permission-title"
      className="mx-auto flex w-full max-w-3xl flex-col gap-5 rounded-xl border border-cyan/20 bg-panel p-6 shadow-[0_0_28px_rgba(76,215,246,0.06)] sm:flex-row sm:items-center sm:p-8"
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
          className="rounded bg-gradient-to-r from-cyan to-mint px-4 py-2.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-[#06202a] transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-cyan/40"
          onClick={onOpenLogin}
          type="button"
        >
          {user ? "Sign in as Authority" : "Sign in"}
        </button>
        <button
          className="rounded border border-white/10 bg-panel-raised px-4 py-2.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-muted transition hover:border-cyan/30 hover:text-ink focus:outline-none focus:ring-2 focus:ring-cyan/40"
          onClick={onReturnToFeed}
          type="button"
        >
          Back to Feed
        </button>
      </div>
    </section>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState("feed");
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [toastLeaving, setToastLeaving] = useState(false);
  const toastId = useRef(0);
  const { user, isAuthenticated, logout, verifyEmail } = useAuth();
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
    const meta = PAGE_META[activeTab] ?? PAGE_META.feed;
    document.title = meta.title;
    const description = document.querySelector('meta[name="description"]');
    if (description) description.setAttribute("content", meta.description);
  }, [activeTab]);

  useEffect(() => {
    const currentUrl = new URL(window.location.href);
    const verificationToken = currentUrl.searchParams.get("verifyEmail");
    if (!verificationToken) return undefined;

    currentUrl.searchParams.delete("verifyEmail");
    window.history.replaceState({}, "", `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`);
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

  return (
    <>
      <TargetCursor />
      {toast && (
        <div
          aria-atomic="true"
          aria-live="polite"
          className={`animate-civic-toast-in fixed right-4 top-20 z-[10000] flex w-[calc(100%-2rem)] max-w-sm items-start gap-3 rounded-xl border border-mint/25 bg-panel/90 p-4 text-ink shadow-[0_12px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl transition-all duration-300 sm:right-6 ${toastLeaving ? "translate-y-2 scale-[0.98] opacity-0" : "translate-y-0 scale-100 opacity-100"}`}
          key={toast.id}
          role="status"
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-mint/20 bg-mint/10 text-mint">
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
        </div>
      )}
      <main className="flex min-h-screen flex-col bg-canvas font-sans text-ink">
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-cyan focus:px-4 focus:py-2 focus:font-mono focus:text-xs focus:font-semibold focus:text-[#06202a]"
        href="#main-content"
      >
        Skip to main content
      </a>
      <header className="sticky top-0 z-20 border-b border-white/[0.08] bg-canvas/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1720px] flex-col gap-4 px-4 py-3 sm:px-6 lg:flex-row lg:flex-nowrap lg:items-center lg:justify-between lg:gap-5 lg:px-8">
          <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-3">
            <div className="flex items-center gap-2.5">
              <svg
                aria-hidden="true"
                className="h-8 w-8 text-cyan"
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
                <span className="text-cyan">Guard</span>
              </div>
            </div>

            <div className="hidden items-center gap-2 rounded-full border border-white/[0.08] bg-panel px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-mint 2xl:inline-flex">
              <span className="h-2 w-2 animate-pulse rounded-full bg-mint shadow-[0_0_10px_#4edea3]" />
              AI pipeline active
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center lg:flex-1 lg:justify-end lg:gap-3">
            <nav
              aria-label="Main navigation"
              className="flex w-full gap-1 overflow-x-auto rounded-xl border border-white/[0.06] bg-deep/70 p-1 sm:w-auto"
            >
              {tabs.map((tab) => {
                const isActive = activeTab === tab.id;

                return (
                  <button
                    aria-pressed={isActive}
                    className={`min-w-0 flex-1 rounded-lg px-3 py-2.5 text-left text-xs font-semibold leading-4 transition sm:min-w-[118px] sm:px-4 ${
                      isActive
                        ? "bg-cyan text-[#06202a] shadow-[0_0_18px_rgba(76,215,246,0.2)]"
                        : "text-muted hover:bg-panel-hover hover:text-ink"
                    }`}
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    type="button"
                  >
                    <span className="hidden sm:inline">{tab.label}</span>
                    <span className="sm:hidden">{tab.shortLabel}</span>
                  </button>
                );
              })}
            </nav>

            <div className="flex items-center justify-between gap-3 sm:justify-end sm:gap-5">
              <div className="inline-flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-panel px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-wide text-muted">
                <span className={`h-1.5 w-1.5 rounded-full ${user?.role === "authority" ? "bg-cyan" : user ? "bg-mint" : "bg-muted"}`} />
                {roleLabel}
              </div>
              <div className="hidden border-l border-white/10 pl-5 text-right xl:block">
                <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-muted">
                  Municipal response
                </p>
                <p className="mt-0.5 font-mono text-xs font-semibold text-mint">
                  Civic reporting online
                </p>
              </div>
              <div className="flex items-center gap-2.5">
                <div className="text-right">
                  <p className="text-xs font-semibold text-ink">
                    {user?.name ?? "Guest"}
                  </p>
                  <p className="font-mono text-[9px] text-cyan">
                    {user?.role === "authority" ? "AUTHORITY" : user ? "CITIZEN" : "NOT SIGNED IN"}
                  </p>
                </div>
                <div className="grid h-9 w-9 place-items-center rounded-full border border-cyan/40 bg-panel-raised font-mono text-xs font-semibold text-cyan">
                  {user?.name
                    ? user.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()
                    : "CG"}
                </div>
              </div>
              {isAuthenticated ? (
                <button
                  className="rounded border border-white/10 bg-panel-raised px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-wide text-muted hover:border-alert/30 hover:text-alert"
                  onClick={logout}
                  type="button"
                >
                  Sign out
                </button>
              ) : (
                <button
                  className="whitespace-nowrap rounded border border-cyan/30 bg-cyan/10 px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-wide text-cyan hover:bg-cyan/15"
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
        {activeTab === "form" ? (
          <ReportForm onSubmit={() => showToast("Report submitted. AI triage is running.")} />
        ) : activeTab === "feed" ? (
          <ReportFeed />
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

      <LoginModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onSuccess={(authenticatedUser) => {
          if (authenticatedUser.role === "authority" && activeTab === "admin") {
            setActiveTab("admin");
          }
        }}
      />

      <footer className="border-t border-white/[0.06] bg-deep/70 px-4 py-3 sm:px-6 lg:px-8">
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
            <span className="h-1.5 w-1.5 rounded-full bg-mint" />
            Secure civic reporting portal
          </span>
        </div>
      </footer>
      </main>
    </>
  );
}
