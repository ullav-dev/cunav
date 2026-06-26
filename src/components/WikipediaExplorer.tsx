"use client";

import { useState, useEffect, useRef } from "react";
import { useLocale } from "next-intl";

interface WikiSearchResult {
  key: string;
  title: string;
  excerpt: string;
  description?: string;
  thumbnail?: { url: string; width: number; height: number };
}

interface WikiSummary {
  title: string;
  extract: string;
  thumbnail?: { source: string };
  content_urls: { desktop: { page: string } };
}

function wikiLang(locale: string): string {
  const map: Record<string, string> = { en: "en", de: "de", ga: "ga" };
  return map[locale] ?? "en";
}

function searchUrl(lang: string, query: string) {
  return `https://${lang}.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(query)}&limit=10`;
}

function summaryUrl(lang: string, key: string) {
  return `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(key)}`;
}

interface Props {
  onSaveAsNote?: (title: string, body: string) => Promise<void>;
  initialQuery?: string;
}

function ResultCard({ result, selected, onClick }: { result: WikiSearchResult; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-lg border p-3 transition-colors ${
        selected ? "border-violet-400 bg-violet-50" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      <div className="flex items-start gap-2">
        {result.thumbnail && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={result.thumbnail.url} alt="" className="w-10 h-10 object-cover rounded shrink-0" />
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-800 truncate">{result.title}</p>
          {result.description && (
            <p className="text-xs text-slate-500 mt-0.5 truncate">{result.description}</p>
          )}
          {result.excerpt && (
            <p
              className="text-xs text-slate-400 mt-1 line-clamp-2"
              dangerouslySetInnerHTML={{ __html: result.excerpt }}
            />
          )}
        </div>
      </div>
    </button>
  );
}

export default function WikipediaExplorer({ onSaveAsNote, initialQuery = "" }: Props) {
  const locale = useLocale();
  const lang = wikiLang(locale);

  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<WikiSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [summary, setSummary] = useState<WikiSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { setResults([]); setSearchError(null); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true); setSearchError(null); setSelectedKey(null); setSummary(null);
      try {
        const res = await fetch(searchUrl(lang, query.trim()));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setResults(data.pages ?? []);
      } catch {
        setSearchError("Search failed. Check your connection.");
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, lang]);

  async function handleSelectResult(result: WikiSearchResult) {
    setSelectedKey(result.key); setSummary(null); setLoadingSummary(true);
    try {
      const res = await fetch(summaryUrl(lang, result.key));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSummary(await res.json());
    } catch {
      setSummary(null);
    } finally {
      setLoadingSummary(false);
    }
  }

  function handleSaveAsNote() {
    if (!summary || !onSaveAsNote) return;
    const url = summary.content_urls.desktop.page;
    const body = `${summary.extract}\n\n*Source: [${summary.title} on Wikipedia](${url})*`;
    onSaveAsNote(summary.title, body);
  }

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="relative">
        <svg viewBox="0 0 16 16" fill="currentColor" className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none">
          <path d="M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215ZM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7Z"/>
        </svg>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Wikipedia…"
          className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400"
          autoFocus
        />
        {searching && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 animate-pulse">Searching…</span>
        )}
      </div>

      {searchError && <p className="text-xs text-red-500">{searchError}</p>}

      <div className="flex gap-3 flex-1 min-h-0">
        {results.length > 0 && (
          <div className="w-56 shrink-0 space-y-1.5 overflow-y-auto pr-1">
            {results.map((r) => (
              <ResultCard key={r.key} result={r} selected={selectedKey === r.key} onClick={() => handleSelectResult(r)} />
            ))}
          </div>
        )}

        <div className="flex-1 min-w-0">
          {loadingSummary && (
            <div className="flex items-center justify-center h-32 text-slate-400 text-sm">Loading…</div>
          )}
          {!loadingSummary && summary && (
            <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3 overflow-y-auto h-full">
              <div className="flex items-start gap-3">
                {summary.thumbnail && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={summary.thumbnail.source} alt={summary.title} className="w-20 h-20 object-cover rounded-lg shrink-0" />
                )}
                <div className="min-w-0">
                  <h3 className="font-semibold text-slate-800">{summary.title}</h3>
                  <a href={summary.content_urls.desktop.page} target="_blank" rel="noopener noreferrer" className="text-xs text-violet-600 hover:underline">
                    Open in Wikipedia ↗
                  </a>
                </div>
              </div>
              <p className="text-sm text-slate-700 leading-relaxed">{summary.extract}</p>
              <div className="flex gap-2 pt-2 border-t border-slate-100">
                <a href={summary.content_urls.desktop.page} target="_blank" rel="noopener noreferrer" className="border border-slate-300 text-slate-600 hover:bg-slate-50 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors">
                  Open in Wikipedia ↗
                </a>
                {onSaveAsNote && (
                  <button onClick={handleSaveAsNote} className="bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors">
                    Save as note
                  </button>
                )}
              </div>
            </div>
          )}
          {!loadingSummary && !summary && !selectedKey && results.length > 0 && (
            <div className="flex items-center justify-center h-32 text-slate-400 text-sm">Select a result to read it</div>
          )}
          {!loadingSummary && !summary && results.length === 0 && query.trim() && !searching && (
            <div className="flex items-center justify-center h-32 text-slate-400 text-sm">No results found</div>
          )}
          {!query.trim() && (
            <div className="flex flex-col items-center justify-center h-32 text-slate-400">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 mb-2 opacity-30">
                <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2ZM9.5 7.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1 0-1Zm-1 3h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1 0-1Zm1 3h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1 0-1Z"/>
              </svg>
              <p className="text-sm">Search Wikipedia to find background info</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
