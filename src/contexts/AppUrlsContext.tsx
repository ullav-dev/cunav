"use client";

import { createContext, useContext } from "react";
import type { ReactNode } from "react";

export type AppUrls = {
  obairUrl: string;
  damBrowserUrl: string;
  tograUrl: string;
};

const defaultUrls: AppUrls = {
  obairUrl: "",
  damBrowserUrl: "",
  tograUrl: "",
};

const AppUrlsContext = createContext<AppUrls>(defaultUrls);

export function AppUrlsProvider({
  urls,
  children,
}: {
  urls: AppUrls;
  children: ReactNode;
}) {
  return (
    <AppUrlsContext.Provider value={urls}>{children}</AppUrlsContext.Provider>
  );
}

export function useAppUrls(): AppUrls {
  return useContext(AppUrlsContext);
}
