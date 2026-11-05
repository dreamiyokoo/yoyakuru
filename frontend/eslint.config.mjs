import next from "eslint-config-next";

const config = [
  ...next,
  { ignores: [".next/**", "coverage/**", "playwright-report/**", "test-results/**", "next-env.d.ts"] },
];

export default config;
