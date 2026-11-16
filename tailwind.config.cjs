module.exports = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: "rgb(var(--civic-brand-rgb) / <alpha-value>)",
        signal: "rgb(var(--civic-signal-rgb) / <alpha-value>)",
        pending: "rgb(var(--civic-pending-rgb) / <alpha-value>)",
        progress: "rgb(var(--civic-progress-rgb) / <alpha-value>)",
        resolved: "rgb(var(--civic-resolved-rgb) / <alpha-value>)",
        civic: {
          bg: "var(--civic-bg)",
          surface: "var(--civic-surface)",
          text: "var(--civic-text)",
          muted: "var(--civic-muted)",
          border: "var(--civic-border)",
          accent: "var(--civic-accent)",
        },
        canvas: "rgb(var(--civic-bg-rgb) / <alpha-value>)",
        deep: "rgb(var(--civic-deep-rgb) / <alpha-value>)",
        panel: "rgb(var(--civic-surface-rgb) / <alpha-value>)",
        "panel-raised": "rgb(var(--civic-raised-rgb) / <alpha-value>)",
        "panel-hover": "rgb(var(--civic-hover-rgb) / <alpha-value>)",
        ink: "rgb(var(--civic-text-rgb) / <alpha-value>)",
        muted: "rgb(var(--civic-muted-rgb) / <alpha-value>)",
        line: "rgb(var(--civic-border-rgb) / <alpha-value>)",
        cyan: "rgb(var(--civic-cyan-rgb) / <alpha-value>)",
        mint: "rgb(var(--civic-mint-rgb) / <alpha-value>)",
        alert: "rgb(var(--civic-alert-rgb) / <alpha-value>)",
      },
      boxShadow: {
        DEFAULT: "var(--civic-shadow)",
        sm: "var(--civic-shadow)",
        md: "var(--civic-shadow)",
        lg: "var(--civic-shadow)",
        xl: "var(--civic-shadow)",
        "2xl": "var(--civic-shadow)",
        civic: "var(--civic-shadow)",
      },
      borderRadius: {
        DEFAULT: "8px",
        lg: "8px",
        xl: "8px",
        full: "9999px",
      },
      keyframes: {
        "slide-in": {
          from: { opacity: "0", transform: "translate3d(1rem, -0.5rem, 0)" },
          to: { opacity: "1", transform: "translate3d(0, 0, 0)" },
        },
        "fade-in": {
          from: { opacity: "0", transform: "scale(0.97)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "pulse-slow": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
      },
      animation: {
        "slide-in": "slide-in 240ms ease-out both",
        "fade-in": "fade-in 220ms ease-out both",
        "pulse-slow": "pulse-slow 2.4s ease-in-out infinite",
      },
      fontFamily: {
        display: ["Space Grotesk", "sans-serif"],
        sans: ["Geist", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
