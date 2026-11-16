import { useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";

export default function LoginModal({ isOpen, onClose, onSuccess, resetToken }) {
  const { login, register, resendVerification, forgotPassword, resetPassword } = useAuth();
  const [mode, setMode] = useState("login");
  const [role, setRole] = useState("citizen");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [verificationInfo, setVerificationInfo] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = () => {
      setPassword("");
      setError("");
      setStatusMessage("");
      setVerificationInfo(null);
      onClose();
    };
  }, [onClose]);

  useEffect(() => {
    if (!isOpen || !resetToken) return;
    setMode("reset");
    setError("");
    setStatusMessage("");
  }, [isOpen, resetToken]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const previouslyFocused = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusTimer = window.setTimeout(() => {
      const firstField = dialogRef.current?.querySelector("input, select, textarea");
      firstField?.focus();
    }, 0);

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = [...dialogRef.current.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter((element) => element.offsetParent !== null);

      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      if (mode === "login") {
        const user = await login({ email, password });
        onSuccess?.(user);
        onCloseRef.current();
      } else if (mode === "register") {
        const result = await register({ name, email, password, role, inviteCode });
        setVerificationInfo(result);
        setError("");
      } else if (mode === "forgot") {
        const result = await forgotPassword(email);
        setStatusMessage(result.message);
      } else {
        const result = await resetPassword(resetToken, password);
        setStatusMessage(result.message);
        setPassword("");
        setMode("login");
      }
    } catch (submitError) {
      setError(submitError.message || "Authentication failed. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResendVerification() {
    if (!password) {
      setError("Enter the account password to resend the verification email.");
      return;
    }

    setIsResending(true);
    setError("");
    try {
      setVerificationInfo(await resendVerification({ email, password }));
    } catch (resendError) {
      setError(resendError.message || "Could not resend the verification email.");
    } finally {
      setIsResending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/45 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCloseRef.current();
      }}
    >
      <section
        aria-labelledby="auth-modal-title"
        aria-modal="true"
        className="my-8 w-full max-w-md overflow-hidden rounded-xl border border-line bg-panel shadow"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="border-b border-slate-200 dark:border-white/[0.06] px-6 pb-5 pt-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-brand">
                CivicGuard identity / secure access
              </p>
              <h2 className="mt-2 font-display text-2xl font-semibold text-ink" id="auth-modal-title">
                {mode === "login"
                  ? "Welcome back"
                  : mode === "register"
                    ? "Create your account"
                    : mode === "forgot"
                      ? "Reset your password"
                      : "Choose a new password"}
              </h2>
              <p className="mt-1 text-sm text-muted">
                {mode === "login"
                  ? "Sign in to access your CivicGuard workspace."
                  : mode === "register"
                    ? "Join your community’s incident response network."
                    : mode === "forgot"
                      ? "We’ll email a reset link if an account matches your address."
                      : "Choose a new password for your CivicGuard account."}
              </p>
            </div>
            <button
              aria-label="Close authentication dialog"
              className="rounded border border-slate-200 dark:border-white/10 bg-panel-raised px-2.5 py-1.5 font-mono text-xs text-muted hover:text-ink"
              onClick={() => onCloseRef.current()}
              type="button"
            >
              ×
            </button>
          </div>

          {["login", "register"].includes(mode) && (
            <div className="mt-5 inline-flex rounded-lg border border-slate-200 dark:border-white/[0.06] bg-deep p-1">
              {[
                { id: "login", label: "Sign in" },
                { id: "register", label: "Register" },
              ].map((item) => (
                <button
                  aria-pressed={mode === item.id}
                  className={`rounded px-4 py-2 font-mono text-[10px] font-semibold uppercase tracking-wide transition ${
                    mode === item.id ? "bg-cyan text-white dark:text-slate-900" : "text-muted hover:text-ink"
                  }`}
                  key={item.id}
                  onClick={() => {
                    setMode(item.id);
                    setError("");
                    setStatusMessage("");
                    setVerificationInfo(null);
                  }}
                  type="button"
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <form className="space-y-4 px-6 py-5" onSubmit={handleSubmit}>
          {verificationInfo && (
            <div className="space-y-3 rounded-lg border border-resolved/25 bg-resolved/5 p-4 text-sm text-ink" role="status">
              <p className="font-semibold text-resolved">Verify your email to activate your account.</p>
              <p className="text-muted">
                {verificationInfo.verificationUrl
                  ? "Email delivery is not configured on this deployment, so use the direct link below to activate your account. It expires in 24 hours."
                  : `We sent a verification link to ${email}. The link expires in 24 hours.`}
              </p>
              {verificationInfo.verificationUrl && (
                <a
                  className="inline-flex min-h-11 items-center rounded-lg border border-line bg-panel-raised px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-wide text-brand hover:bg-panel-hover focus:outline-none focus:ring-2 focus:ring-brand"
                  href={verificationInfo.verificationUrl}
                >
                  Verify email now
                </a>
              )}
              <button
                className="block font-mono text-[9px] font-semibold uppercase tracking-wide text-muted underline decoration-white/20 underline-offset-4 hover:text-ink disabled:opacity-50"
                disabled={isResending}
                onClick={handleResendVerification}
                type="button"
              >
                {isResending ? "Sending…" : "Resend verification email"}
              </button>
            </div>
          )}

          {statusMessage && (
            <p className="rounded-lg border border-resolved/25 bg-resolved/5 px-3 py-2.5 text-sm text-resolved" role="status">
              {statusMessage}
            </p>
          )}

          {mode === "register" && (
            <>
              <fieldset>
                <legend className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-wider text-muted">
                  Registration type
                </legend>
                <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 dark:border-white/[0.06] bg-deep p-1">
                  {[
                    { id: "citizen", label: "Citizen" },
                    { id: "authority", label: "Authority Member" },
                  ].map((option) => (
                    <button
                      aria-pressed={role === option.id}
                      className={`rounded px-3 py-2.5 font-mono text-[9px] font-semibold uppercase tracking-wide transition ${
                        role === option.id
                          ? "bg-cyan/10 text-cyan ring-1 ring-inset ring-cyan/30"
                          : "text-muted hover:text-ink"
                      }`}
                      key={option.id}
                      onClick={() => setRole(option.id)}
                      type="button"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <label className="block">
                <span className="mb-2 block font-mono text-[9px] font-semibold uppercase tracking-wider text-muted">
                  Full name
                </span>
                <input
                  autoComplete="name"
                  className="min-h-11 w-full rounded-lg border border-line bg-panel-raised px-3.5 py-2.5 text-sm text-ink outline-none placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/20"
                  maxLength={100}
                  onChange={(event) => setName(event.target.value)}
                  required
                  value={name}
                />
              </label>
            </>
          )}

          {mode !== "reset" && <label className="block">
            <span className="mb-2 block font-mono text-[9px] font-semibold uppercase tracking-wider text-muted">
              Email address
            </span>
            <input
              autoComplete="email"
              className="min-h-11 w-full rounded-lg border border-line bg-panel-raised px-3.5 py-2.5 text-sm text-ink outline-none placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/20"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>}

          {["login", "register", "reset"].includes(mode) && (
            <label className="block">
              <span className="mb-2 block font-mono text-[9px] font-semibold uppercase tracking-wider text-muted">
                {mode === "reset" ? "New password" : "Password"}
              </span>
              <input
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                className="min-h-11 w-full rounded-lg border border-line bg-panel-raised px-3.5 py-2.5 text-sm text-ink outline-none placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/20"
                minLength={8}
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />
              {["register", "reset"].includes(mode) && (
                <span className="mt-1 block font-mono text-[9px] text-muted/70">
                  Use at least 8 characters.
                </span>
              )}
            </label>
          )}

          {mode === "login" && (
            <button
              className="font-mono text-[9px] font-semibold uppercase tracking-wide text-cyan underline decoration-cyan/30 underline-offset-4 hover:text-mint"
              onClick={() => {
                setMode("forgot");
                setError("");
                setStatusMessage("");
              }}
              type="button"
            >
              Forgot password?
            </button>
          )}

          {mode === "register" && role === "authority" && (
            <label className="block">
              <span className="mb-2 block font-mono text-[9px] font-semibold uppercase tracking-wider text-muted">
                Authority verification code
                <span className="ml-1 font-normal normal-case tracking-normal">(required unless your email domain is allowlisted)</span>
              </span>
              <input
                autoComplete="off"
                className="min-h-11 w-full rounded-lg border border-line bg-panel-raised px-3.5 py-2.5 font-mono text-sm text-ink outline-none placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/20"
                onChange={(event) => setInviteCode(event.target.value)}
                placeholder="Enter official invite code"
                value={inviteCode}
              />
              <span className="mt-1 block font-mono text-[9px] text-muted/70">
                Ask your municipality for the invite code. A .gov address alone does not grant access.
              </span>
            </label>
          )}

          {error && (
            <p className="rounded border border-alert/20 bg-alert/10 px-3 py-2.5 text-sm text-alert" role="alert">
              {error}
            </p>
          )}

          {!verificationInfo && <button
            className="min-h-11 w-full rounded-lg bg-cyan px-4 py-3 text-sm font-semibold text-white shadow transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 disabled:cursor-wait disabled:opacity-60 dark:text-slate-900 dark:focus:ring-offset-slate-900"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting
              ? "Please wait…"
              : mode === "login"
                ? "Sign in"
                : mode === "register"
                  ? "Create account"
                  : mode === "forgot"
                    ? "Send reset link"
                    : "Reset password"}
          </button>}
        </form>
      </section>
    </div>
  );
}
