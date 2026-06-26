import { getTranslations } from "next-intl/server";

export default async function Footer() {
  const t = await getTranslations("footer");
  const version = process.env.NEXT_PUBLIC_APP_VERSION ?? "";
  return (
    <footer className="bg-white border-t border-slate-100 py-3 px-6 shrink-0">
      <p className="text-xs text-slate-400 text-center">
        Cunav {version} — {t("tagline")}
      </p>
    </footer>
  );
}
