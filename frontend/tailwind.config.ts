import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Naxis brand colors - calm, operational, premium
        background: {
          DEFAULT: "hsl(222 47% 11%)", // Deep navy
          elevated: "hsl(222 47% 14%)",
          hover: "hsl(222 47% 16%)",
        },
        foreground: {
          DEFAULT: "hsl(210 40% 98%)",
          muted: "hsl(217 10% 64%)",
          subtle: "hsl(217 10% 50%)",
        },
        primary: {
          DEFAULT: "hsl(199 89% 48%)", // Cyan blue
          hover: "hsl(199 89% 55%)",
          subtle: "hsl(199 89% 20%)",
        },
        border: {
          DEFAULT: "hsl(217 19% 27%)",
          hover: "hsl(217 19% 35%)",
        },
        // Severity colors
        critical: {
          DEFAULT: "hsl(0 84% 60%)", // Red
          bg: "hsl(0 84% 15%)",
          border: "hsl(0 84% 30%)",
        },
        major: {
          DEFAULT: "hsl(38 92% 50%)", // Amber
          bg: "hsl(38 92% 15%)",
          border: "hsl(38 92% 30%)",
        },
        minor: {
          DEFAULT: "hsl(48 96% 53%)", // Yellow
          bg: "hsl(48 96% 15%)",
          border: "hsl(48 96% 30%)",
        },
        info: {
          DEFAULT: "hsl(199 89% 48%)", // Cyan
          bg: "hsl(199 89% 15%)",
          border: "hsl(199 89% 30%)",
        },
        success: {
          DEFAULT: "hsl(142 71% 45%)", // Muted green
          bg: "hsl(142 71% 15%)",
          border: "hsl(142 71% 30%)",
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
        lg: "0.5rem",
        md: "0.375rem",
        sm: "0.25rem",
      },
    },
  },
  plugins: [],
};

export default config;
