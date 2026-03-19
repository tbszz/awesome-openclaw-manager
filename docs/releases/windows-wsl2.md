# Awesome OpenClaw Manager Windows + WSL2 完整部署版

[English](windows-wsl2.en.md) | [中文](windows-wsl2.md)

Windows + WSL2 完整部署版适合“在 Windows 桌面上使用 Manager，同时把 OpenClaw gateway 和 bot 运行在 Ubuntu 子系统里”的场景。这是当前仓库最完整、最实用、最贴近真实生产环境的版本。

关键词：OpenClaw WSL2 部署、OpenClaw Windows Ubuntu 子系统、OpenClaw 多 Gateway 管理、Telegram Bot Gateway、Discord Bot Gateway。

## 适合谁

- 你要在 Windows + WSL2 上运行多个 OpenClaw gateway
- 你要管理多个 Telegram bot 或 Discord bot
- 你需要 service、manifest、端口桥接和桌面控制台一体化

## 包内包含什么

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

## 环境要求

- Windows 10 或 Windows 11
- WSL2
- Ubuntu
- Node.js
- 可用的 OpenClaw 运行环境

## 部署步骤

1. 下载 `Awesome-OpenClaw-Manager-Windows-WSL2-v0.0.7.zip`。
2. 解压到 Windows 本地目录。
3. 准备 WSL2 和 Ubuntu，并确认 OpenClaw 可在子系统中运行。
4. 根据你的环境需要，使用 `scripts/` 目录中的脚本完成同步、桥接或 gateway 初始化。
5. 运行 `openclaw-manager-wsl-launch.ps1`，由它统一拉起 manager、WSL service 和本地桥接。
6. 进入 UI 后直接新增 gateway / bot，后续扩容将由 manifest 和脚本协同处理。

## 这个版本解决什么问题

- OpenClaw 多 gateway 没有统一控制台
- Windows 和 WSL2 之间端口桥接麻烦
- 新增 bot / gateway 要手工改配置和 service
- 多个 OpenClaw gateway 不方便统一查看日志、配置和工作台入口

## 为什么推荐这个版本

- 这是当前功能最完整的 Awesome OpenClaw Manager 发布方式
- 已经支持 UI 新建 gateway / bot
- 已经支持动态 manifest 启动器
- 已经修复 UTF-8 BOM 导致的状态同步失败
