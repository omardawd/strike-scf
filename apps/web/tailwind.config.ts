import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        accent: "var(--color-accent)",
        "accent-light": "var(--color-accent-light)",
        ink1: "var(--color-ink-1)",
        ink2: "var(--color-ink-2)",
        ink3: "var(--color-ink-3)",
        ink4: "var(--color-ink-4)",
        card: "var(--color-card)",
        border: "var(--color-border)",
      },
      fontFamily: {
        sans: ["Inter", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
    },
  },
};

export default config;
