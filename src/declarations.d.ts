declare module "*?raw" {
  const content: string;
  export default content;
}

declare const __MT_SDK_VERSION__: string;

/**
 * Build environment, injected by every Vite config through
 * `getNodeEnvDefine()` in `vite.env.ts`. Narrowed to the two values that
 * function can produce so a comparison against anything else is a type error
 * rather than a silently dead branch.
 */
declare const __MT_NODE_ENV__: "development" | "production";
