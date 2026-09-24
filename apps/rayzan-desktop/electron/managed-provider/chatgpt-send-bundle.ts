import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSync } from 'esbuild';

let cached: string | undefined;

/**
 * Bundle shared ChatGPT send helpers into a page-world IIFE for Electron
 * executeJavaScript. Same source as `@rayzan/capture/send` used by the extension.
 */
export function chatgptSendIifeSource(): string {
  if (cached) {
    return cached;
  }
  const require = createRequire(import.meta.url);
  let entry: string;
  try {
    entry = require.resolve('@rayzan/capture/send/page-entry');
  } catch {
    // Workspace TypeScript export — resolve via package root.
    const pkg = path.dirname(require.resolve('@rayzan/capture/package.json'));
    entry = path.join(pkg, 'src/send/page-entry.ts');
  }
  const result = buildSync({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: '__rayzanChatGptSend',
    platform: 'browser',
    target: ['chrome120'],
    absWorkingDir: path.dirname(fileURLToPath(import.meta.url)),
  });
  const text = result.outputFiles[0]?.text;
  if (!text) {
    throw new Error('Failed to bundle ChatGPT send page helpers');
  }
  cached = text;
  return text;
}
