# Awesome OpenClaw Manager Windows 本地桌面版

[English](windows-local.en.md) | [中文](windows-local.md)

Windows 本地桌面版适合“先把 OpenClaw Manager 桌面程序装到 Windows 本机上”的场景。这个版本强调的是本地桌面安装和轻量交付，不额外附带整套 WSL2 部署脚本。

关键词：OpenClaw Windows 管理器、OpenClaw 桌面版、OpenClaw 本地部署、OpenClaw bot 面板。

## 适合谁

- 已经有 OpenClaw 运行环境，只缺一个可视化管理器
- 想先体验 OpenClaw Manager 的桌面界面和操作流
- 只想交付最小安装包给同事或测试环境

## 包内包含什么

- `openclaw-manager.exe`
- `WebView2Loader.dll`
- `README.md`
- `manager-ui.png`
- `manager-ui-en.png`

## 安装方式

1. 下载 `Awesome-OpenClaw-Manager-Windows-Local-v0.0.7.zip`。
2. 解压到 Windows 本地目录。
3. 双击 `openclaw-manager.exe` 启动程序。

## 这个版本更适合什么场景

- 先在 Windows 本机部署 OpenClaw Manager
- 做本地演示、界面测试和产品预览
- 已经有现成 OpenClaw 运行环境，不需要完整的 WSL2 自动部署

## 需要注意什么

- 当前项目的 gateway 编排和自动化扩容能力，最成熟的路线仍然是 `Windows + WSL2`。
- 如果你希望自动创建多 gateway、自动桥接端口、自动维护 manifest 和 service，请使用 [Windows + WSL2 完整部署版](windows-wsl2.md)。
