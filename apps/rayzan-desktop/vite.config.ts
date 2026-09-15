import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const root = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const electronSimpleModule = require('vite-plugin-electron/simple') as {
  default?: (options: unknown) => PluginOption;
};
const electronSimple = (electronSimpleModule.default ??
  electronSimpleModule) as (options: unknown) => PluginOption;

function electronSqlitePlugin(): PluginOption {
  return {
    name: 'rayzan-electron-sqlite',
    async buildStart() {
      const native = (await import(
        pathToFileURL(path.join(root, 'scripts/ensure-electron-sqlite.mjs')).href
      )) as {
        ensureElectronSqlite: () => Promise<unknown>;
        linkElectronSqlite: (distElectron?: string) => void;
      };
      await native.ensureElectronSqlite();
      native.linkElectronSqlite(path.join(root, 'dist-electron'));
    },
    async closeBundle() {
      const native = (await import(
        pathToFileURL(path.join(root, 'scripts/ensure-electron-sqlite.mjs')).href
      )) as {
        linkElectronSqlite: (distElectron?: string) => void;
      };
      native.linkElectronSqlite(path.join(root, 'dist-electron'));
    },
  };
}

export default defineConfig({
  base: './',
  root,
  plugins: [
    electronSqlitePlugin(),
    react(),
    electronSimple({
      main: {
        entry: path.join(root, 'electron/main.ts'),
        onstart: async (args: { startup: () => Promise<void> }) => {
          const native = (await import(
            pathToFileURL(path.join(root, 'scripts/ensure-electron-sqlite.mjs'))
              .href
          )) as {
            linkElectronSqlite: (distElectron?: string) => void;
          };
          native.linkElectronSqlite(path.join(root, 'dist-electron'));
          await args.startup();
        },
        vite: {
          plugins: [electronSqlitePlugin()],
          build: {
            outDir: path.join(root, 'dist-electron'),
            emptyOutDir: false,
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
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
});
