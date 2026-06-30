import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class", '[data-theme="dark"]'],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: {
          DEFAULT: "hsl(var(--background))",
          elevated: "hsl(var(--background-elevated))",
          hover: "hsl(var(--background-hover))",
        },
        foreground: {
          DEFAULT: "hsl(var(--foreground))",
          muted: "hsl(var(--foreground-muted))",
          subtle: "hsl(var(--foreground-subtle))",
        },
        surface: {
          DEFAULT: "hsl(var(--surface))",
          elevated: "hsl(var(--surface-elevated))",
          subtle: "hsl(var(--surface-subtle))",
          hover: "hsl(var(--surface-hover))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          hover: "hsl(var(--primary-hover))",
          subtle: "hsl(var(--primary-subtle))",
        },
        border: {
          DEFAULT: "hsl(var(--border))",
          hover: "hsl(var(--border-hover))",
        },
        critical: {
          DEFAULT: "hsl(var(--critical))",
          bg: "hsl(var(--critical-bg))",
          border: "hsl(var(--critical-border))",
        },
        major: {
          DEFAULT: "hsl(var(--major))",
          bg: "hsl(var(--major-bg))",
          border: "hsl(var(--major-border))",
        },
        minor: {
          DEFAULT: "hsl(var(--minor))",
          bg: "hsl(var(--minor-bg))",
          border: "hsl(var(--minor-border))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          bg: "hsl(var(--info-bg))",
          border: "hsl(var(--info-border))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          bg: "hsl(var(--success-bg))",
          border: "hsl(var(--success-border))",
        },
      },
      fontFamily: {
        sans: [
          "var(--font-manrope)",
          "Manrope",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
        mono: [
          "Menlo",
          "Monaco",
          "Courier New",
          "monospace",
        ],
      },
      fontSize: {
        "2xs": ["0.625rem", { lineHeight: "0.875rem" }],
      },
      borderRadius: {
        lg: "0.75rem",
        md: "0.5rem",
        sm: "0.25rem",
      },
      boxShadow: {
        surface: "0 1px 2px 0 rgba(0, 0, 0, 0.08), 0 0 0 1px hsl(var(--border) / 0.5)",
        "surface-lg": "0 8px 24px -4px rgba(0, 0, 0, 0.1), 0 0 0 1px hsl(var(--border) / 0.5)",
        glow: "0 0 40px -12px hsl(var(--primary) / 0.35)",
      },
    },
  },
  plugins: [],
};

export default config;
