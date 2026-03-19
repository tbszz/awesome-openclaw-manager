# Awesome OpenClaw Manager Windows + WSL2 Full Deployment Edition

[English](windows-wsl2.en.md) | [中文](windows-wsl2.md)

The Windows + WSL2 Full Deployment Edition is the most complete way to run Awesome OpenClaw Manager. It is built for setups where the desktop app runs on Windows while OpenClaw gateways and bots run inside Ubuntu on WSL2.

## Best for

- multi-gateway OpenClaw deployments
- multiple Telegram bot or Discord bot lanes
- service-based OpenClaw operations with manifest-driven scaling

## Included

- `openclaw-manager.exe`
- `WebView2Loader.dll`
- `openclaw-manager-wsl-launch.ps1`
- `scripts/build-manager-windows.ps1`
- `scripts/package-release-bundles.ps1`
- `scripts/provision_wsl_gateways.py`
- `scripts/start-wsl-proxy-bridge.ps1`
- `scripts/sync-openclaw-to-wsl.ps1`
- `scripts/windows-proxy-bridge.mjs`
- `README.md`
- `manager-ui.png`
- `manager-ui-en.png`

## Requirements

- Windows 10 or Windows 11
- WSL2
- Ubuntu
- Node.js
- a working OpenClaw runtime

## Deployment flow

1. Download `Awesome-OpenClaw-Manager-Windows-WSL2-v0.0.7.zip`.
2. Extract it on Windows.
3. Prepare WSL2, Ubuntu, and OpenClaw inside the subsystem.
4. Use the scripts in `scripts/` to sync config, provision gateways, and manage bridges as needed.
5. Launch `openclaw-manager-wsl-launch.ps1`.
6. Add and manage gateways directly from the UI.
