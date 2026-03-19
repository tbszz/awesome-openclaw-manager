# Awesome OpenClaw Manager App

这个目录是 Awesome OpenClaw Manager 的桌面应用源码，技术栈包括：

- Tauri 2
- React
- TypeScript
- Rust

如果你想看项目介绍、两个发布版本说明和下载方式，优先阅读根目录文档：

- [../../README.md](../../README.md)
- [../../docs/releases/README.md](../../docs/releases/README.md)

## 目录说明

- `src/`：React 前端界面
- `src-tauri/`：Rust / Tauri 后端命令与系统集成
- `package.json`：前端和 Tauri 相关命令

## 常用命令

```powershell
npm install
npm run dev
npm run tauri:dev
npm run build
```

## 当前重点能力

- OpenClaw 多 gateway 状态总览
- gateway 启停与日志查看
- gateway 配置摘要
- Workbench / Control Center 入口
- UI 创建新 gateway / bot
