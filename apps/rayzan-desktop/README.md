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

The home screen shows the resolved paths.

## Debug UI

Engineering dashboard: `http://127.0.0.1:8787/debug` (Open Workspace).

## Native SQLite

`better-sqlite3` is pinned to Electron 32 / Node 20 ABI (module version 115), so development can share the CLI native binary. Packaging copies that binary into the app and unpacks it from ASAR. After an Electron major upgrade that changes ABI, rebuild inside a copy of the module rather than overwriting the CLI binary:

```text
pnpm --filter @rayzan/desktop rebuild-native
```

Do this only when the CLI is not using SQLite (stop `pnpm start:local` first).

## Packaging (Windows x64)

```text
pnpm desktop:dist
```

Artifacts:

- `apps/rayzan-desktop/release/win-unpacked/Rayzan.exe` — double-click, no Node/pnpm required
- `apps/rayzan-desktop/release/Rayzan-0.0.0-win-x64.zip`

NSIS installer is not produced yet: electron-builder's NSIS templates live under a pnpm path containing `@`, which `makensis` cannot `!include`. The unpacked app and zip are the 3C.1 deliverable.
