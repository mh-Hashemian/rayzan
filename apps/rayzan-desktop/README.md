# Rayzan Desktop

Electron product shell around the existing Rayzan runtime.

```text
pnpm desktop:dev
pnpm desktop:build
pnpm desktop:dist
```

Development CLI (`pnpm start:local`) is unchanged. Desktop is not required for backend tests.

## Data

- CLI: `apps/rayzan-local/data/rayzan.sqlite`
- Desktop: `%APPDATA%\Rayzan\rayzan.sqlite` (`app.getPath('userData')`)

The Settings screen shows the resolved paths. The home screen is the product shell (team, recent debates), not the engineering dashboard. It hydrates from `GET /api/status` once, then listens to `GET /api/events/stream`. It does not poll.

## Debug UI

Engineering dashboard: `http://127.0.0.1:8787/debug` (Settings → Open debug workspace). Observatory is not in global navigation.

## Native SQLite

`better-sqlite3` is a native module. Electron 32 uses NODE_MODULE_VERSION 128 even though it embeds Node 20. The CLI/Node workspace binary is ABI 115 and must not be overwritten.

`pnpm desktop:dev` and `pnpm desktop:dist` copy `better-sqlite3` into `apps/rayzan-desktop/.electron-native/` and rebuild that copy for Electron. The workspace CLI binary is left alone. The isolated binary is cached until Electron or `better-sqlite3` versions change. Packaging copies that same isolated tree into the unpacked app so the pnpm CLI binary is not shipped. The Vite dev server binds `127.0.0.1` so Electron can load the renderer on Windows.

```text
pnpm desktop:dev
pnpm --filter @rayzan/desktop rebuild-native
```

## Packaging (Windows x64)

```text
pnpm desktop:dist
```

Artifacts:

- `apps/rayzan-desktop/release/win-unpacked/Rayzan.exe` — double-click, no Node/pnpm required
- `apps/rayzan-desktop/release/Rayzan-0.0.0-win-x64.zip`

NSIS installer is not produced yet: electron-builder's NSIS templates live under a pnpm path containing `@`, which `makensis` cannot `!include`. The unpacked app and zip are the 3C.1 deliverable.
