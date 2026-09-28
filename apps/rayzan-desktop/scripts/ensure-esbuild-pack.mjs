import { createRequire } from 'node:module';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, '..');
const nativeRoot = path.join(desktopRoot, '.electron-native');
// Staged outside the asar: esbuild resolves its native binary with
// require.resolve, which inside app.asar yields an archive path that cannot be
// spawned, so the packaged app loads esbuild from resources/node_modules.
const packRoot = path.join(nativeRoot, 'esbuild-pack');
const modulesRoot = path.join(packRoot, 'node_modules');
const stampPath = path.join(packRoot, 'stamp.json');

const require = createRequire(path.join(desktopRoot, 'package.json'));
const platformPackage = `@esbuild/${process.platform}-${process.arch}`;

function copyPackage(from, to) {
  mkdirSync(path.dirname(to), { recursive: true });
  const fromResolved = path.resolve(from).replace(/\\/g, '/').toLowerCase();
  cpSync(from, to, {
    recursive: true,
    dereference: true,
    filter: (source) => {
      const normalizedSource = path
        .resolve(source)
        .replace(/\\/g, '/')
        .toLowerCase();
      if (normalizedSource === fromResolved) {
        return true;
      }
      if (!normalizedSource.startsWith(`${fromResolved}/`)) {
        return true;
      }
      const relative = normalizedSource.slice(fromResolved.length + 1);
      return !relative.split('/').includes('node_modules');
    },
  });
}

export function ensureEsbuildPack({ force = false } = {}) {
  const esbuildRoot = path.dirname(require.resolve('esbuild/package.json'));
  const esbuildVersion = String(
    JSON.parse(readFileSync(path.join(esbuildRoot, 'package.json'), 'utf8')).version,
  );
  // The binary and the JS host must be the same version or esbuild refuses to
  // start its service, so resolve the platform package beside esbuild itself.
  const binaryRoot = path.dirname(require.resolve(`${platformPackage}/package.json`, {
    paths: [esbuildRoot],
  }));
  const binaryVersion = String(
    JSON.parse(readFileSync(path.join(binaryRoot, 'package.json'), 'utf8')).version,
  );
  if (binaryVersion !== esbuildVersion) {
    throw new Error(
      `esbuild JS ${esbuildVersion} does not match ${platformPackage} ${binaryVersion}`,
    );
  }
  const binaryName = process.platform === 'win32' ? 'esbuild.exe' : 'esbuild';
  const binaryPath = path.join(
    binaryRoot,
    process.platform === 'win32' ? binaryName : path.join('bin', binaryName),
  );
  if (!existsSync(binaryPath)) {
    throw new Error(`${platformPackage} is missing its executable at ${binaryPath}`);
  }

  const stamp = { esbuildVersion, platformPackage };
  const staged = path.join(modulesRoot, platformPackage, binaryName);
  if (
    !force &&
    existsSync(path.join(modulesRoot, 'esbuild', 'lib', 'main.js')) &&
    existsSync(staged) &&
    existsSync(stampPath) &&
    readFileSync(stampPath, 'utf8') === `${JSON.stringify(stamp, null, 2)}\n`
  ) {
    process.stdout.write(`Using cached ${platformPackage} esbuild pack (${esbuildVersion})\n`);
    return { staged, esbuildVersion };
  }

  process.stdout.write(
    `Staging esbuild ${esbuildVersion} (${platformPackage}) to ship outside the asar\n`,
  );
  rmSync(packRoot, { recursive: true, force: true });
  mkdirSync(modulesRoot, { recursive: true });
  copyPackage(esbuildRoot, path.join(modulesRoot, 'esbuild'));
  copyPackage(binaryRoot, path.join(modulesRoot, platformPackage));
  if (!existsSync(path.join(modulesRoot, 'esbuild', 'lib', 'main.js'))) {
    throw new Error(`failed to stage esbuild from ${esbuildRoot}`);
  }
  if (!existsSync(staged)) {
    throw new Error(`failed to stage ${platformPackage} from ${binaryRoot}`);
  }
  writeFileSync(stampPath, `${JSON.stringify(stamp, null, 2)}\n`);
  process.stdout.write(`Wrote ${staged}\n`);
  return { staged, esbuildVersion };
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    ensureEsbuildPack({ force: process.argv.includes('--force') });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  }
}
