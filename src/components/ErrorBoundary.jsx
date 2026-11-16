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
      <div className="grid min-h-screen place-items-center bg-canvas px-6">
        <div className="w-full max-w-md rounded-xl border border-signal/25 bg-panel p-6 shadow">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-alert">
            Interface error
          </p>
          <h1 className="mt-2 font-display text-xl font-semibold text-ink">
            Something went wrong
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted">
            Your reports are safe. Reload the page to reconnect to the incident stream.
          </p>
          <button
            className="mt-5 inline-flex min-h-11 rounded-lg bg-cyan px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-brand active:scale-[0.98] dark:text-slate-900"
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
