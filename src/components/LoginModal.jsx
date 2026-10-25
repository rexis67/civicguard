import { useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";

export default function LoginModal({ isOpen, onClose, onSuccess }) {
  const { login, register, resendVerification } = useAuth();
  const [mode, setMode] = useState("login");
  const [role, setRole] = useState("citizen");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState("");
  const [verificationInfo, setVerificationInfo] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);

  if (!isOpen) return null;

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      if (mode === "login") {
        const user = await login({ email, password });
        onSuccess?.(user);
        onClose();
      } else {
        const result = await register({ name, email, password, role, inviteCode });
        setVerificationInfo(result);
        setError("");
        setPassword("");
      }
    } catch (submitError) {
      setError(submitError.message || "Authentication failed. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResendVerification() {
    setIsResending(true);
    setError("");
    try {
      setVerificationInfo(await resendVerification(email));
    } catch (resendError) {
      setError(resendError.message || "Could not resend the verification email.");
    } finally {
      setIsResending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-deep/80 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        aria-labelledby="auth-modal-title"
        aria-modal="true"
        className="my-8 w-full max-w-md overflow-hidden rounded-xl border border-white/10 bg-panel shadow-2xl shadow-black/40"
        role="dialog"
      >
        <div className="border-b border-white/[0.06] px-6 pb-5 pt-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-cyan">
                CivicGuard identity / secure access
              </p>
              <h2 className="mt-2 font-display text-2xl font-semibold text-ink" id="auth-modal-title">
                {mode === "login" ? "Welcome back" : "Create your account"}
              </h2>
              <p className="mt-1 text-sm text-muted">
                {mode === "login"
                  ? "Sign in to access your CivicGuard workspace."
                  : "Join your community’s incident response network."}
              </p>
            </div>
            <button
              aria-label="Close authentication dialog"
              className="rounded border border-white/10 bg-panel-raised px-2.5 py-1.5 font-mono text-xs text-muted hover:text-ink"
              onClick={onClose}
              type="button"
            >
              ×
            </button>
          </div>

          <div className="mt-5 inline-flex rounded-lg border border-white/[0.06] bg-deep p-1">
            {[
              { id: "login", label: "Sign in" },
              { id: "register", label: "Register" },
            ].map((item) => (
              <button
                aria-pressed={mode === item.id}
                className={`rounded px-4 py-2 font-mono text-[10px] font-semibold uppercase tracking-wide transition ${
                  mode === item.id ? "bg-cyan text-[#06202a]" : "text-muted hover:text-ink"
                }`}
                key={item.id}
                onClick={() => {
                  setMode(item.id);
                  setError("");
                  setVerificationInfo(null);
                }}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <form className="space-y-4 px-6 py-5" onSubmit={handleSubmit}>
          {verificationInfo && (
            <div className="space-y-3 rounded-lg border border-mint/20 bg-mint/10 p-4 text-sm text-ink" role="status">
              <p className="font-semibold text-mint">Verify your email to activate your account.</p>
              <p className="text-muted">
                We sent a verification link to {email}. The link expires in 24 hours.
              </p>
              {verificationInfo.verificationUrl && (
                <a
                  className="inline-flex rounded border border-cyan/30 bg-cyan/10 px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-wide text-cyan hover:bg-cyan/15"
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

          {mode === "register" && (
            <>
              <fieldset>
                <legend className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-wider text-muted">
                  Registration type
                </legend>
                <div className="grid grid-cols-2 gap-2 rounded-lg border border-white/[0.06] bg-deep p-1">
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
                  className="w-full rounded border border-white/10 bg-deep px-3.5 py-2.5 text-sm text-ink outline-none placeholder:text-muted/50 focus:border-cyan focus:ring-2 focus:ring-cyan/20"
                  maxLength={100}
                  onChange={(event) => setName(event.target.value)}
                  required
                  value={name}
                />
              </label>
            </>
          )}

          <label className="block">
            <span className="mb-2 block font-mono text-[9px] font-semibold uppercase tracking-wider text-muted">
              Email address
            </span>
            <input
              autoComplete="email"
              className="w-full rounded border border-white/10 bg-deep px-3.5 py-2.5 text-sm text-ink outline-none placeholder:text-muted/50 focus:border-cyan focus:ring-2 focus:ring-cyan/20"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>

          <label className="block">
            <span className="mb-2 block font-mono text-[9px] font-semibold uppercase tracking-wider text-muted">
              Password
            </span>
            <input
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              className="w-full rounded border border-white/10 bg-deep px-3.5 py-2.5 text-sm text-ink outline-none placeholder:text-muted/50 focus:border-cyan focus:ring-2 focus:ring-cyan/20"
              minLength={8}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
            {mode === "register" && (
              <span className="mt-1 block font-mono text-[9px] text-muted/70">
                Use at least 8 characters.
              </span>
            )}
          </label>

          {mode === "register" && role === "authority" && (
            <label className="block">
              <span className="mb-2 block font-mono text-[9px] font-semibold uppercase tracking-wider text-muted">
                Authority verification code
                <span className="ml-1 font-normal normal-case tracking-normal">(optional for .gov email)</span>
              </span>
              <input
                autoComplete="off"
                className="w-full rounded border border-cyan/20 bg-deep px-3.5 py-2.5 font-mono text-sm text-ink outline-none placeholder:text-muted/50 focus:border-cyan focus:ring-2 focus:ring-cyan/20"
                onChange={(event) => setInviteCode(event.target.value)}
                placeholder="Enter official invite code"
                value={inviteCode}
              />
              <span className="mt-1 block font-mono text-[9px] text-muted/70">
                Authority registration requires an invite code or a .gov address.
              </span>
            </label>
          )}

          {error && (
            <p className="rounded border border-alert/20 bg-alert/10 px-3 py-2.5 text-sm text-alert" role="alert">
              {error}
            </p>
          )}

          {!verificationInfo && <button
            className="w-full rounded bg-gradient-to-r from-cyan to-mint px-4 py-3 font-mono text-[10px] font-bold uppercase tracking-wider text-[#06202a] shadow-[0_0_18px_rgba(76,215,246,0.14)] transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-cyan/40 disabled:cursor-wait disabled:opacity-60"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
          </button>}
        </form>
      </section>
    </div>
  );
}
