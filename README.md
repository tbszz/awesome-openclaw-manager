# OpenClaw Multi-Gateway Manager

Desktop manager for running and operating multiple OpenClaw gateways from one Windows UI.

## What is included

- `openclaw-manager-src/openclaw-manager-main`: the Tauri + React manager app
- `openclaw-manager-wsl-launch.ps1`: Windows launcher that starts the manager and bridges WSL gateways
- `scripts/`: helper scripts for WSL gateway provisioning and sync workflows
- `docs/screenshots/manager-ui.png`: current UI screenshot

## Highlights

- Multi-gateway dashboard for `main`, `news`, `doctor`, and custom gateways
- UI flow for creating new managed gateways and bot lanes
- Dynamic launcher that reads the WSL gateway manifest instead of hardcoded gateway lists
- Embedded workbench / control center entry points per gateway

## Screenshot

![Manager UI](docs/screenshots/manager-ui.png)

## Notes

- This repo is intended to track the manager project and its helper scripts.
- Local runtime state, generated builds, and unrelated control-center checkouts are excluded from git.
