module.exports = {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#0b1326",
        deep: "#060e20",
        panel: "#131b2e",
        "panel-raised": "#171f33",
        "panel-hover": "#222a3d",
        ink: "#dae2fd",
        muted: "#aebbd4",
        line: "rgba(134, 147, 151, 0.2)",
        cyan: "#4cd7f6",
        mint: "#4edea3",
        alert: "#ff7f8b",
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
