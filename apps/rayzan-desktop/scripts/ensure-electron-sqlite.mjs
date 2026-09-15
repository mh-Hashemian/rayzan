import { createRequire } from 'node:module';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const desktopRoot = path.resolve(here, '..');
export const nativeRoot = path.join(desktopRoot, '.electron-native');
const modulesRoot = path.join(nativeRoot, 'node_modules');
const nativeSqlite = path.join(modulesRoot, 'better-sqlite3');
const stampPath = path.join(nativeRoot, 'stamp.json');
const nativeNode = path.join(nativeSqlite, 'build', 'Release', 'better_sqlite3.node');

const require = createRequire(path.join(desktopRoot, 'package.json'));
const desktopPkg = JSON.parse(
  readFileSync(path.join(desktopRoot, 'package.json'), 'utf8'),
);
const electronVersion = String(
  require('electron/package.json').version,
);
const sqliteVersion = String(desktopPkg.dependencies['better-sqlite3']).replace(
  /^\^/,
  '',
);

function workspaceSqliteRoot() {
  return path.dirname(require.resolve('better-sqlite3/package.json'));
}

function workspaceNodePath() {
  return path.join(workspaceSqliteRoot(), 'build', 'Release', 'better_sqlite3.node');
}

function readStamp() {
  if (!existsSync(stampPath)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(stampPath, 'utf8'));
  } catch {
    return undefined;
  }
}

function stampMatches() {
  const stamp = readStamp();
  return (
    stamp !== undefined &&
    stamp.electronVersion === electronVersion &&
    stamp.sqliteVersion === sqliteVersion &&
    existsSync(nativeNode)
  );
}

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

function nestBindings() {
  const sqliteRoot = nativeSqlite;
  const bindingsRoot = path.dirname(
    require.resolve('bindings/package.json', { paths: [workspaceSqliteRoot()] }),
  );
  const futpRoot = path.dirname(
    require.resolve('file-uri-to-path/package.json', { paths: [bindingsRoot] }),
  );
  const nested = path.join(sqliteRoot, 'node_modules');
  copyPackage(bindingsRoot, path.join(nested, 'bindings'));
  copyPackage(futpRoot, path.join(nested, 'file-uri-to-path'));
}

export function linkElectronSqlite(
  distElectron = path.join(desktopRoot, 'dist-electron'),
) {
  if (!existsSync(nativeSqlite)) {
    throw new Error(
      `Electron better-sqlite3 is missing at ${nativeSqlite}. Run pnpm desktop:dev once to prepare it.`,
    );
  }
  const linkDir = path.join(distElectron, 'node_modules');
  const link = path.join(linkDir, 'better-sqlite3');
  mkdirSync(linkDir, { recursive: true });
  rmSync(link, { recursive: true, force: true });
  symlinkSync(nativeSqlite, link, process.platform === 'win32' ? 'junction' : 'dir');
}

export async function ensureElectronSqlite(options = {}) {
  const force = options.force === true;
  if (!force && stampMatches()) {
    process.stdout.write(
      `Using cached Electron better-sqlite3 (${electronVersion} / ${sqliteVersion})\n`,
    );
    return { rebuilt: false, nativeSqlite, workspaceNode: workspaceNodePath() };
  }

  process.stdout.write(
    `Preparing isolated Electron better-sqlite3 for Electron ${electronVersion} (does not modify the CLI binary)\n`,
  );

  const source = workspaceSqliteRoot();
  const workspaceNode = workspaceNodePath();
  const workspaceMtime = existsSync(workspaceNode)
    ? readFileSync(workspaceNode)
    : undefined;

  rmSync(nativeRoot, { recursive: true, force: true });
  mkdirSync(modulesRoot, { recursive: true });
  writeFileSync(
    path.join(nativeRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'rayzan-electron-native',
        private: true,
        dependencies: { 'better-sqlite3': sqliteVersion },
      },
      null,
      2,
    )}\n`,
  );
  copyPackage(source, nativeSqlite);
  if (!existsSync(path.join(nativeSqlite, 'package.json'))) {
    throw new Error(`failed to copy better-sqlite3 from ${source}`);
  }
  nestBindings();

  const { rebuild } = require('@electron/rebuild');
  await rebuild({
    buildPath: nativeRoot,
    projectRootPath: nativeRoot,
    electronVersion,
    force: true,
    onlyModules: ['better-sqlite3'],
  });

  if (!existsSync(nativeNode)) {
    throw new Error(`electron-rebuild did not produce ${nativeNode}`);
  }

  if (workspaceMtime !== undefined) {
    const after = readFileSync(workspaceNode);
    if (!after.equals(workspaceMtime)) {
      throw new Error(
        'CLI better-sqlite3 binary changed during Electron rebuild; aborting to preserve Node ABI 115',
      );
    }
    const rebuilt = readFileSync(nativeNode);
    if (rebuilt.equals(workspaceMtime)) {
      throw new Error(
        'Electron rebuild left better-sqlite3 identical to the CLI binary; ABI isolation failed',
      );
    }
  }

  writeFileSync(
    stampPath,
    `${JSON.stringify(
      {
        electronVersion,
        sqliteVersion,
        nativeNode,
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(`Wrote ${nativeNode}\n`);
  return { rebuilt: true, nativeSqlite, workspaceNode };
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const force = process.argv.includes('--force');
  ensureElectronSqlite({ force })
    .then(() => {
      linkElectronSqlite();
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
      process.exit(1);
    });
}
