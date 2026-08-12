import { defineConfig } from "vitest/config";
import packagejson from "./package.json";
import { getNodeEnvDefine } from "./vite.env";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    typecheck: {
      tsconfig: "./tsconfig.json",
    },
    environment: "happy-dom",
    globals: true,
    setupFiles: ["@vitest/web-worker", "./vitest-setup-tests.ts"],
  },
  define: {
    __MT_SDK_VERSION__: JSON.stringify(packagejson.version),
    __MT_NODE_ENV__: JSON.stringify(getNodeEnvDefine()),
  },
});
