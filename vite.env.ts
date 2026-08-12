/**
 * Single source of truth for the build-time `define` values shared by every
 * Vite config (dev, es, umd, e2e, test).
 *
 * `__MT_NODE_ENV__` must mean the same thing in all of them: the SDK compares
 * it against the string `"development"` to gate development-only diagnostics.
 * Injecting a different shape from a single config silently disables those
 * diagnostics in that environment, which is exactly what used to happen under
 * Vitest.
 */

/**
 * The environment name injected as `__MT_NODE_ENV__`.
 *
 * Anything that is not an explicit production build counts as development, so
 * the value is always one of the two strings declared in
 * `src/declarations.d.ts` — never `undefined`, which is what
 * `JSON.stringify(process.env.NODE_ENV)` produces when the variable is unset
 * (e.g. `npm run dev`).
 */
export function getNodeEnvDefine(): "development" | "production" {
  return process.env.NODE_ENV === "production" ? "production" : "development";
}
