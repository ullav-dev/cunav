import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { execFileSync } from "child_process";
import { readFileSync } from "fs";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const appVersion: string = JSON.parse(readFileSync("./package.json", "utf-8")).version;
const gitSha: string = (() => {
  try { return execFileSync("git", ["rev-parse", "--short", "HEAD"]).toString().trim(); }
  catch { return "dev"; }
})();

const nextConfig: NextConfig = {
  output: "standalone",
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
    NEXT_PUBLIC_GIT_SHA: gitSha,
  },
};

export default withNextIntl(nextConfig);
