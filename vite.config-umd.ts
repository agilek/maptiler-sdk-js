import { resolve } from 'path';
import { defineConfig } from 'vite';
import packagejson from "./package.json";
import { getNodeEnvDefine } from './vite.env';

const isProduction = process.env.NODE_ENV === "production";

export default defineConfig({
  mode: isProduction ? "production" : "development",
  build: {
    outDir: "build",
    minify: true,
    emptyOutDir: isProduction,
    sourcemap: true,
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'maptilersdk',
      fileName: (_, __) => "maptiler-sdk.umd.min.js",
      formats: ['umd'],
    }
  },
  define: {
    __MT_SDK_VERSION__: JSON.stringify(packagejson.version),
    __MT_NODE_ENV__: JSON.stringify(getNodeEnvDefine()),
  },
  plugins: [],
});
