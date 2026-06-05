import type { Config } from "tailwindcss";

// Colors reference the CSS variables defined in app/globals.css so the Day/Dusk
// theme (via the [data-theme] attribute) flows through Tailwind utilities too.
const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        cardinal: "#8C1515",
        bg: "var(--bg)",
        "bg-2": "var(--bg-2)",
        panel: "var(--panel)",
        "panel-2": "var(--panel-2)",
        "panel-3": "var(--panel-3)",
        ink: "var(--ink)",
        "ink-2": "var(--ink-2)",
        "ink-3": "var(--ink-3)",
        line: "var(--line)",
        "line-2": "var(--line-2)",
        accent: "var(--accent)",
        "accent-2": "var(--accent-2)",
        "accent-ink": "var(--accent-ink)",
        "accent-soft": "var(--accent-soft)",
        trust: "var(--trust)",
        respect: "var(--respect)",
        vibe: "var(--vibe)",
        good: "var(--good)",
        bad: "var(--bad)",
      },
      fontFamily: {
        pixel: ["var(--font-pixel)", '"Pixelify Sans"', "monospace"],
        body: ["var(--font-body)", '"Nunito"', "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "var(--r)",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        btn: "var(--shadow-btn)",
        "btn-accent": "var(--shadow-btn-accent)",
      },
    },
  },
  plugins: [],
};

export default config;
