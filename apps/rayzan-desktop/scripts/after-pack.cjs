const fs = require('node:fs');
const path = require('node:path');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
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
  const pnpm = path.resolve(__dirname, '../../../node_modules/.pnpm');
  const modules = path.join(
    context.appOutDir,
    'resources',
    'app.asar.unpacked',
    'node_modules',
  );
  const nested = path.join(modules, 'better-sqlite3', 'node_modules');
  copyDir(
    path.join(pnpm, 'bindings@1.5.0/node_modules/bindings'),
    path.join(nested, 'bindings'),
  );
  copyDir(
    path.join(pnpm, 'file-uri-to-path@1.0.0/node_modules/file-uri-to-path'),
    path.join(nested, 'file-uri-to-path'),
  );
};
