# Build the Windows installer (manual steps)

Goal: produce `Rayzan-<version>-win-x64.exe` (NSIS installer) plus the portable ZIP to hand to a tester. The tester-side instructions live in [TESTER-HANDOFF.md](./TESTER-HANDOFF.md).

## 1. Prerequisites (build machine only)

- Windows 10/11 x64.
- Node.js >= 20 (`node -v`).
- pnpm 9.3.0 (the repo pins `packageManager: pnpm@9.3.0`; `corepack enable` activates it).
- Internet access on first build (electron-builder downloads the Electron 32.2.8 binary cache).
- **A short checkout path.** The NSIS stage runs `makensis.exe`, which is a 32-bit ANSI tool: it cannot open any file whose full path exceeds 260 characters, and turning on Windows `LongPathsEnabled` does not help it. With pnpm's deep virtual store, `...\.pnpm\app-builder-lib@25.1.8_dmg-builder@...atcm\node_modules\app-builder-lib\templates\nsis\include\allowOnlyOneInstallerInstance.nsh` lands at 261 chars from this checkout and the installer step dies with `!include: could not open file`. If you hit that, relink the store to a short location before packaging (writes only to `node_modules`, no repo files change; a plain `pnpm install` reverts it):

```bash
pnpm install --virtual-store-dir "C:/Users/<you>/vst" --force
```

## 2. Install dependencies

```bash
cd rayzan
pnpm install --frozen-lockfile
```

## 3. (Optional) Bump the version

Both `apps/rayzan-desktop/package.json` and the artifact name use it. Current value is `0.0.2`; the output is named `Rayzan-${version}-win-x64.exe`, so setting e.g. `0.1.0` produces `Rayzan-0.1.0-win-x64.exe`.

## 4. Run the checks (recommended before packaging)

```bash
pnpm test                                  # packages + local + extension
pnpm --filter @rayzan/desktop test         # managed-provider + derive
pnpm --filter @rayzan/desktop typecheck
```

## 5. Build the installer

```bash
pnpm desktop:dist
```

This runs, in order:

1. `scripts/ensure-electron-sqlite.mjs` — rebuilds `better-sqlite3` against the Electron ABI into the isolated `.electron-native/` folder.
2. `scripts/ensure-esbuild-pack.mjs` — copies `esbuild` and its `@esbuild/win32-<arch>` binary, version-checked against each other, into `.electron-native/esbuild-pack/node_modules/`, so packaging ships them as real files (see below).
3. `vite build` — bundles the renderer plus the Electron main/preload (esbuild is deliberately kept external; it must load as real code from a `node_modules` folder, never from inside the archive).
4. `scripts/package-desktop.mjs` — packages asar and produces three targets: `nsis` (installer), `dir` (unpacked), `zip` (portable). Each run uses a fresh output directory, so an open app or file watcher holding a previous `app.asar` cannot block the new package. Non-asar payloads go in via `extraResources`: the local runtime dashboard (`local-public`), the app icon, `resources/capture` (shared capture sources, read by the send-bundler at runtime) and **`resources/node_modules/{esbuild,@esbuild/win32-x64}`** — esbuild stays out of `app.asar` on purpose, because it locates its native binary with `require.resolve`, and an `app.asar/...` executable path cannot be spawned. It also runs `scripts/after-pack.cjs`, which copies the Electron-built `better_sqlite3.node` into `app.asar.unpacked`.

Artifacts land in a timestamped folder inside `apps/rayzan-desktop/release/` (git-ignored). The command prints its exact path:

- `Rayzan-<version>-win-x64.exe` — installer, **send this**
- `Rayzan-<version>-win-x64.zip` — portable fallback
- `win-unpacked/` — the raw app folder (for your own quick testing)

Keep the app folder from each build together. Electron needs the files beside `Rayzan.exe`, including its `.pak` resources and locale files. Old build folders can be removed after closing any app launched from them.

## 6. App / installer icon

`Rayzan.exe`'s embedded icon comes from `apps/rayzan-desktop/resources/rayzan-app-icon.ico` via `win.icon`, and the installer/uninstaller use the same file (`nsis.installerIcon`/`uninstallerIcon`). This requires `"signAndEditExecutable": true` in the build config — electron-builder's resource editor (rcedit) is what writes the icon and version info into the exe. When it is `false`, packaging skips that step and the installed app keeps the **default Electron logo** (the bug in earlier test builds).

The window/taskbar icon at runtime is a separate path: the packaged app loads `resources/rayzan-app-icon.ico` shipped via `extraResources`.

Stamping the icon needs rcedit, which ships inside electron-builder's `winCodeSign` tool cache. On a non-elevated Windows account the cache extraction can abort with `Cannot create symbolic link ... darwin/10.12/lib/libssl.dylib` — those two entries are macOS-only and irrelevant here. Extract the downloaded archive yourself, skipping `darwin`, into the cache folder the tool expects:

```bash
"<repo>/node_modules/.pnpm/7zip-bin@*/node_modules/7zip-bin/win/x64/7za.exe" \
  x -y -bd -xr!darwin \
  "$LOCALAPPDATA/electron-builder/Cache/winCodeSign/<random>.7z" \
  "-o$LOCALAPPDATA/electron-builder/Cache/winCodeSign/winCodeSign-2.6.0"
```

Confirmed on the 0.0.0 build: both `Rayzan.exe` and the installer report `ProductName = Rayzan` (not `Electron`) and contain the 256px image from `rayzan-app-icon.ico`.

## 7. Smoke-test the build yourself

1. Run the installer on your machine (or better, a clean Windows account). It is unsigned — SmartScreen shows a "publisher unknown" warning; click **More info → Run anyway**.
2. Verify the Start-menu entry, desktop shortcut, and taskbar icon all show the Rayzan logo. If Explorer still shows the old Electron icon for a rebuilt exe at the same path, it is the Windows icon cache — run `ie4uinit.exe -show` or restart Explorer.
3. Launch, wait for **Ready** in the top bar.
4. Run one small decision end-to-end (see the tester checklist in TESTER-HANDOFF.md).
5. Send one message through a managed ChatGPT provider. The first send is what executes the capture send-bundler through esbuild, so it is the only step that proves `resources\node_modules\@esbuild\win32-x64\esbuild.exe` resolves from outside the archive.

App data lives at `%APPDATA%\Rayzan\rayzan.sqlite`; delete it to reset history between tests.

## 8. Bridge extension (only if the tester needs tab-binding mode)

```bash
pnpm build:extension
```

Output is in `apps/browser-extension/dist/`. Zip that folder as `Rayzan-Bridge-<version>.zip` and include the load-unpacked instructions from TESTER-HANDOFF.md. Managed in-app provider sessions do not need the extension.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Installed app shows the default Electron logo | `signAndEditExecutable` was flipped back to `false`, or Explorer icon cache — see section 6/7. |
| `Packaged Electron better-sqlite3 missing isolated binary` during `dist` | Rebuild step didn't run or failed: `pnpm --filter @rayzan/desktop rebuild-native`, then `pnpm desktop:dist`. |
| `__filename is not defined` on first ChatGPT send (packaged app) | esbuild got bundled into the ESM main bundle again; `vite.config.ts` must keep `esbuild` in `rollupOptions.external`. |
| `spawn ...\resources\app.asar\node_modules\@esbuild\win32-x64\esbuild.exe ENOENT` on first ChatGPT send (packaged app) | esbuild was archived inside `app.asar` again, so its `require.resolve` binary lookup points into the archive instead of `resources\node_modules\@esbuild\win32-x64\esbuild.exe`. The binary being *unpacked* next to the archive does not help — esbuild never rewrites the path. Keep the `!node_modules/esbuild/**` / `!node_modules/@esbuild/**` entries in `build.files` and the two `extraResources` entries from `ensure-esbuild-pack.mjs`, then re-run `pnpm desktop:dist`. |
| Installer build fails downloading Electron | Clear proxy/VPN and retry; the cache lives in `%LOCALAPPDATA%\electron\Cache`. |
| `app.asar ... being used by another process` when packaging starts | The packaging target was reused while Rayzan or another process held its `app.asar` open. Use `pnpm desktop:dist`, which now creates a fresh output folder for every run. Close any app launched from that specific folder before removing it. |
| `<repo>\packages\capture\package.json must be under <repo>\apps\rayzan-desktop` | electron-builder refuses to pack a symlinked workspace package that resolves outside the app folder. `@rayzan/capture` is therefore a **dev**Dependency (rollup inlines it into `dist-electron/main.js`) and its source ships as real files through `extraResources` to `resources/capture`; `chatgpt-send-bundle.ts` reads that folder when `app.isPackaged`. Keep it out of `dependencies` — esbuild's native binary cannot read `.ts` sources from inside `app.asar` anyway. |
| `!include: could not open file: ...allowOnlyOneInstallerInstance.nsh` | MAX_PATH: makensis cannot open a 261-char path. Use the short virtual store dir from section 1, or build from a shorter checkout. |
| `Cannot create symbolic link ... libcrypto.dylib` during winCodeSign extraction | Non-elevated account extracting macOS symlinks; see the manual extraction in section 6. |
