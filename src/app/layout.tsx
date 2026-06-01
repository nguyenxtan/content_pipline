import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { AppSettingsProvider } from "@/contexts/app-settings";
import { getUsdRateAction } from "@/actions/exchange-rate";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: process.env.NEXT_PUBLIC_APP_NAME ?? "Content Pipeline",
  description: "AI Content Pipeline Manager for YouTube",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const usdRate = await getUsdRateAction();

  return (
    <html
      lang="vi"
      className={`${geistSans.variable} ${geistMono.variable} dark`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-[hsl(var(--background))] text-[hsl(var(--foreground))]">
        <AppSettingsProvider initialRate={usdRate}>
          {children}
          <Toaster position="top-right" richColors />
        </AppSettingsProvider>
      </body>
    </html>
  );
}
