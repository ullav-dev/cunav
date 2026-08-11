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
  // @ullav-dev/tack-notes ships raw TS source (no build step, same as
  // @ullav-dev/dam-picker) -- Next excludes node_modules from
  // transpilation by default, so a real published dependency needs this
  // opt-in. Matches awe-client's existing next.config.ts precedent for
  // dam-picker exactly.
  transpilePackages: ["@ullav-dev/tack-notes"],
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
    NEXT_PUBLIC_GIT_SHA: gitSha,
  },
};

export default withNextIntl(nextConfig);
