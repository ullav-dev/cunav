/** Root-level fallback for paths that don't even reach the [locale] segment
 *  (missing/invalid locale prefix). Next renders this using ONLY the root
 *  layout (src/app/layout.tsx, which just passes through children with no
 *  <html>/<body>) — so unlike ./[locale]/not-found.tsx, this one must
 *  provide those tags itself, and can't use next-intl (no locale resolved,
 *  no NextIntlClientProvider in this tree). Kept plain/untranslated for
 *  that reason; the common case (valid locale, unknown page) is handled by
 *  [locale]/not-found.tsx instead, which does render inside the normal app
 *  chrome and can use it. */
export default function RootNotFound() {
  return (
    <html lang="en">
      <body className="h-full flex items-center justify-center bg-slate-50 text-slate-900">
        <div className="flex flex-col items-center gap-3 text-center px-4">
          <h1 className="text-2xl font-semibold">Page not found</h1>
          <p className="text-slate-500">The page you&apos;re looking for doesn&apos;t exist or may have moved.</p>
          <a href="/" className="mt-2 text-sm font-medium text-blue-600 hover:text-blue-700">
            Back to Cunav
          </a>
        </div>
      </body>
    </html>
  );
}
