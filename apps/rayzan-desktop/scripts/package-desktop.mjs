import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'electron-builder';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const output = path.join(desktopRoot, 'release', `build-${stamp}-${process.pid}`);

console.log(`Packaging Rayzan into ${output}`);

await build({
  projectDir: desktopRoot,
  win: ['nsis', 'dir', 'zip'],
  x64: true,
  config: {
    directories: { output },
  },
});

console.log(`Rayzan artifacts: ${output}`);
