import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import "../globals.css";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { AuthProvider } from "@/contexts/AuthContext";
import { AppUrlsProvider } from "@/contexts/AppUrlsContext";
import type { AppUrls } from "@/contexts/AppUrlsContext";

const geist = Geist({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Cunav",
  description: "Customer Support",
  icons: { icon: "/icon.svg" },
};

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!routing.locales.includes(locale as never)) notFound();

  const messages = await getMessages();

  const appUrls: AppUrls = {
    obairUrl:     process.env.OBAIR_URL      ?? "",
    damBrowserUrl: process.env.DAM_BROWSER_URL ?? "",
    tograUrl:     process.env.TOGRA_URL      ?? "",
  };

  return (
    <html lang={locale} className="h-full">
      <body className={`${geist.className} bg-slate-50 text-slate-900 flex flex-col h-full`}>
        <NextIntlClientProvider messages={messages}>
          <AuthProvider>
            <AppUrlsProvider urls={appUrls}>
              <Nav />
              <main className="flex-1 flex flex-col min-h-0 overflow-hidden">{children}</main>
              <Footer />
            </AppUrlsProvider>
          </AuthProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
