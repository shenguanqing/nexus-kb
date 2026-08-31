import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import Components from 'unplugin-vue-components/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => ({
  plugins: [
    vue(),
    ...(mode === 'test'
      ? []
      : [
          Components({
            resolvers: [ElementPlusResolver({ importStyle: false })],
            dts: false,
          }),
        ]),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@nexus-kb/contracts': fileURLToPath(
        new URL('../../packages/contracts/src/index.ts', import.meta.url),
      ),
    },
  },
  optimizeDeps: {
    include: ['@element-plus/icons-vue', 'element-plus/es'],
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: { '/v1': 'http://127.0.0.1:3000', '/health': 'http://127.0.0.1:3000' },
  },
  test: { environment: 'jsdom', setupFiles: ['./src/test/setup.ts'] },
}));
