import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import { QueryProvider } from "./providers";
import { Header } from "@/components/layout/header";
import "./globals.css";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope" });

export const metadata: Metadata = {
  title: "Naxis - Operational Intelligence",
  description: "Multi-vendor network operational intelligence platform",
};

const themeScript = `
  (function() {
    try {
      const stored = localStorage.getItem("naxis-theme");
      const theme = stored === "light" || stored === "dark" ? stored : "system";
      const resolved = theme === "system"
        ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
        : theme;
      document.documentElement.setAttribute("data-theme", resolved);
    } catch (_) {}
  })();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body suppressHydrationWarning className={`${manrope.variable} font-sans antialiased bg-background text-foreground`}>
        <QueryProvider>
          <div className="relative min-h-screen flex flex-col">
            <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_0%,hsl(var(--primary)/0.18),transparent_60%),linear-gradient(180deg,hsl(var(--background))_0%,hsl(var(--background-elevated))_100%)]" />
              <div className="absolute inset-0 bg-[linear-gradient(hsl(var(--border)/0.3)_1px,transparent_1px),linear-gradient(90deg,hsl(var(--border)/0.3)_1px,transparent_1px)] bg-[size:80px_80px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_80%)]" />
            </div>
            <Header />
            <main className="flex-1">{children}</main>
          </div>
        </QueryProvider>
      </body>
    </html>
  );
}
