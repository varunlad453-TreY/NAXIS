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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${manrope.variable} font-sans antialiased bg-background text-foreground`}>
        <QueryProvider>
          <div className="relative min-h-screen flex flex-col overflow-hidden">
            <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(17,168,216,0.18),_transparent_32%),radial-gradient(circle_at_80%_0%,_rgba(255,72,72,0.12),_transparent_24%),linear-gradient(180deg,_rgba(4,10,24,0.96)_0%,_rgba(6,12,29,0.99)_45%,_rgba(4,9,20,1)_100%)]" />
              <div className="absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.04)_1px,transparent_1px)] bg-[size:96px_96px] opacity-25 [mask-image:radial-gradient(circle_at_center,black,transparent_85%)]" />
              <div className="absolute -left-32 top-20 h-96 w-96 rounded-full bg-cyan-500/10 blur-[120px]" />
              <div className="absolute right-[-6rem] top-52 h-[28rem] w-[28rem] rounded-full bg-red-500/10 blur-[140px]" />
            </div>
            <Header />
            <main className="flex-1">{children}</main>
          </div>
        </QueryProvider>
      </body>
    </html>
  );
}
