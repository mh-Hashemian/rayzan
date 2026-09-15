import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const electronSimpleModule = require('vite-plugin-electron/simple') as {
  default?: (options: unknown) => PluginOption;
};
const electronSimple = (electronSimpleModule.default ??
  electronSimpleModule) as (options: unknown) => PluginOption;

export default defineConfig({
  base: './',
  root,
  plugins: [
    react(),
    electronSimple({
      main: {
        entry: path.join(root, 'electron/main.ts'),
        vite: {
          build: {
            outDir: path.join(root, 'dist-electron'),
            rollupOptions: {
              external: ['better-sqlite3', 'electron'],
            },
          },
        },
      },
      preload: {
        input: path.join(root, 'electron/preload.ts'),
        vite: {
          build: {
            outDir: path.join(root, 'dist-electron'),
            rollupOptions: {
              output: {
                format: 'cjs',
                entryFileNames: 'preload.cjs',
              },
            },
          },
        },
      },
    }) as PluginOption,
  ],
  build: {
    outDir: path.join(root, 'dist'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
