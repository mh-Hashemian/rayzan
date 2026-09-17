# Rayzan Tester Handoff

## What to share

- `Rayzan-0.0.0-win-x64-installer.exe` — preferred Windows x64 installer.
- `Rayzan-0.0.0-win-x64.zip` — portable fallback. Extract it completely, then run `Rayzan.exe` from the extracted folder.
- `Rayzan-Bridge-0.0.0.zip` — separately loadable browser extension for Chrome or Edge.

The desktop app and extension are local-first. No Node.js, pnpm, or source checkout is required for a tester.

## Install and start Rayzan

1. Use Windows 10 or Windows 11 on a 64-bit computer.
2. Run `Rayzan-0.0.0-win-x64-installer.exe` and complete the installer. If you received the ZIP instead, extract the entire archive before opening `Rayzan.exe`; do not run it from inside the archive.
3. Start **Rayzan** from the Start menu or `Rayzan.exe`.
4. On first launch, Rayzan starts its local runtime automatically. The top bar should change from **Loading** to **Ready**.

This is an unsigned test build. Windows SmartScreen may show a publisher warning; testers should proceed only when they received the file from a trusted Rayzan project contact.

Rayzan stores its local debate data at `%APPDATA%\\Rayzan\\rayzan.sqlite`. Deleting that database resets the desktop app's local history.

## Browser extension

The Rayzan Bridge extension lets Rayzan deliver prompts to, and capture final responses from, browser tabs that you bind to Rayzan agents. It is not a cloud service and it does not contain provider credentials. Sign in to each AI provider in your own browser tab.

### Chrome or Edge

1. Extract `Rayzan-Bridge-0.0.0.zip` to a permanent folder. Keep the folder after loading it.
2. In Chrome, open `chrome://extensions`. In Edge, open `edge://extensions`.
3. Turn on **Developer mode**.
4. Select **Load unpacked**, then choose the extracted `Rayzan-Bridge-0.0.0` folder — the folder that contains `manifest.json`.
5. Pin **Rayzan Bridge** from the browser extensions menu.

The browser displays an expected developer-mode notice because this test build is loaded unpacked rather than distributed through a browser store.

### Binding tabs for a live debate

1. Start Rayzan first and wait for **Ready**.
2. Open one signed-in tab for each provider you plan to use. The bridge currently supports ChatGPT, DeepSeek, Qwen, GLM, and Grok.
3. In Rayzan, create/select the Coordinator and Watchers, then use the bridge popup on each provider tab to bind that tab to the matching Rayzan agent.
4. Start a new decision. Keep the bound tabs open while prompts are being sent and responses are captured.

The extension connects only to Rayzan's local bridge at `127.0.0.1:8787` and to the supported provider tabs. If its popup reports that Rayzan is unavailable, verify that the desktop app is running and that a local firewall or security product is not blocking localhost access.

## Quick test checklist

1. Rayzan opens and reaches **Ready**.
2. The sidebar logo and app icon appear correctly.
3. The extension loads and can bind a provider tab.
4. Start a decision and confirm that **Reframe** finishes before **Round 1** becomes active.
5. Confirm each agent receives one prompt and that a Coordinator checkpoint waits for the Operator's decision.

## Test feedback to collect

Please report the Windows version, browser/version, provider used, approximate time of failure, screenshot, and any visible Rayzan or extension error. Do not include provider passwords, access tokens, or personal conversation content.
