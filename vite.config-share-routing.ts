import { defineConfig } from 'vite';
import packagejson from './package.json';
import { getNodeEnvDefine } from './vite.env';

// Production build of the routing demos for the maptiler/share preview
// deployment. Invoked from that repo's Pages workflow — not part of this
// repo's own npm scripts.
export default defineConfig({
  mode: 'production',
  root: './demos',
  base: './',
  build: {
    outDir: '../dist-share-routing',
    emptyOutDir: true,
    minify: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        index: 'demos/public/17-routing-control.html',
        headless: 'demos/public/16-routing.html',
      },
    },
  },
  define: {
    __MT_SDK_VERSION__: JSON.stringify(packagejson.version),
    __MT_NODE_ENV__: JSON.stringify(getNodeEnvDefine()),
  },
});
