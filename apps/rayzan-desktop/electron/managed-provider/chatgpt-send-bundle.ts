import { createRequire } from 'node:module';
import path from 'node:path';

import { app } from 'electron';

import { buildSync } from 'esbuild';

let cached: string | undefined;

function capturePackageRoot(): string {
  const require = createRequire(import.meta.url);
  // esbuild's native binary cannot read inside app.asar, so the packaged app
  // ships the shared capture sources as real files under resources/capture.
  return app.isPackaged
    ? path.join(process.resourcesPath, 'capture')
    : path.dirname(require.resolve('@rayzan/capture/package.json'));
}

/**
 * Bundle shared ChatGPT send helpers into a page-world IIFE for Electron
 * executeJavaScript. Same source as `@rayzan/capture/send` used by the extension.
 */
export function chatgptSendIifeSource(): string {
  if (cached) {
    return cached;
  }
  const packageRoot = capturePackageRoot();
  const result = buildSync({
    entryPoints: [path.join(packageRoot, 'src', 'send', 'page-entry.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: '__rayzanChatGptSend',
    platform: 'browser',
    target: ['chrome120'],
    absWorkingDir: packageRoot,
  });
  const text = result.outputFiles[0]?.text;
  if (!text) {
    throw new Error('Failed to bundle ChatGPT send page helpers');
  }
  cached = text;
  return text;
}
