import { Component } from "react";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("CivicGuard UI crashed:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="grid min-h-screen place-items-center bg-deep px-6">
        <div className="w-full max-w-md rounded-xl border border-alert/20 bg-panel p-6 shadow-2xl">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-alert">
            Interface error
          </p>
          <h1 className="mt-2 font-display text-xl font-semibold text-ink">
            Something went wrong on this screen
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted">
            Your reports are safe. Reload the page to reconnect to the incident stream.
          </p>
          {this.state.error?.message && (
            <p className="mt-3 break-words rounded border border-white/10 bg-deep/70 px-3 py-2 font-mono text-[10px] text-muted">
              {this.state.error.message}
            </p>
          )}
          <button
            className="mt-5 inline-flex rounded bg-cyan px-4 py-2.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-[#06202a] transition hover:brightness-110"
            onClick={() => window.location.reload()}
            type="button"
          >
            Reload CivicGuard
          </button>
        </div>
      </div>
    );
  }
}
