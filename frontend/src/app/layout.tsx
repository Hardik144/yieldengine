import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "YieldEngine // Enterprise B2B Logistics Dynamic Pricing Terminal",
  description:
    "Bloomberg-grade B2B freight pricing command center processing 5,000+ QuoteRequests/hr with real-time market telemetry and sub-50ms PostgreSQL indexing.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        {/* MANDATORY per modern-web-guidance `dark-mode`: declare supported color-scheme in head to prevent FOUC */}
        <meta name="color-scheme" content="dark" />
      </head>
      <body className="min-h-screen bg-[#06090f] text-slate-100 antialiased selection:bg-amber-500 selection:text-slate-950">
        {children}
      </body>
    </html>
  );
}
