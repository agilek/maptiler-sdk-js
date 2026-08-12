import { defineConfig } from 'vite';
import packagejson from './package.json';
import { getNodeEnvDefine } from './vite.env';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        mapLoad: 'public/mapLoad.html',
        rtlTextPlugin: 'public/rtlTextPlugin.html',
        animatedRouteLayer: 'public/animatedRouteLayer.html',
        haloSpace: 'public/haloSpace.html',
      },
    },
  },
  root: './e2e',
  define: {
    __MT_SDK_VERSION__: JSON.stringify(packagejson.version),
    __MT_NODE_ENV__: JSON.stringify(getNodeEnvDefine()),
  },
});
