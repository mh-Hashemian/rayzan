import { mkdir, rm, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await build({
  absWorkingDir: root,
  entryPoints: { background: 'src/background/service-worker.ts' },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome120', 'firefox121'],
  outfile: path.join(dist, 'background.js'),
  logLevel: 'info',
});

await build({
  absWorkingDir: root,
  entryPoints: {
    content: 'src/content/content.ts',
    popup: 'src/popup/popup.ts',
  },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome120'],
  outdir: dist,
  logLevel: 'info',
});

await cp(path.join(root, 'manifest.json'), path.join(dist, 'manifest.json'));
await cp(
  path.join(root, 'src/popup/popup.html'),
  path.join(dist, 'popup.html'),
);
