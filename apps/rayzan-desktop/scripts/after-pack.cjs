const fs = require('node:fs');
const path = require('node:path');

const SKIP_NATIVE_JUNK = /\.(pdb|iobj|ipdb|exp)$/i;

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP_NATIVE_JUNK.test(entry.name)) {
      continue;
    }
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(from, to);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
    }
  }
}

exports.default = async function afterPack(context) {
  const nativeSqlite = path.resolve(
    __dirname,
    '../.electron-native/node_modules/better-sqlite3',
  );
  const nativeNode = path.join(
    nativeSqlite,
    'build',
    'Release',
    'better_sqlite3.node',
  );
  if (!fs.existsSync(nativeNode)) {
    throw new Error(
      `Packaged Electron better-sqlite3 missing isolated binary at ${nativeNode}`,
    );
  }
  const dest = path.join(
    context.appOutDir,
    'resources',
    'app.asar.unpacked',
    'node_modules',
    'better-sqlite3',
  );
  copyDir(nativeSqlite, dest);
};
