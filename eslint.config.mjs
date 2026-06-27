import nextConfig from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default [
  ...nextConfig,
  ...nextTs,
  {
    rules: {
      // React 19 strict rules — flag common valid patterns in this codebase
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
    },
  },
];
