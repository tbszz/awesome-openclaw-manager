# OpenClaw Manager App

这个目录是桌面端 manager 应用本体，技术栈为：

- Tauri 2
- React
- TypeScript
- Rust

如果你是从仓库首页进入，请优先阅读根目录的文档：

- [../../README.md](../../README.md)

## 目录说明

- `src/`: React 前端界面
- `src-tauri/`: Rust / Tauri 后端命令与系统集成
- `package.json`: 前端与 Tauri 相关命令

## 常用命令

```powershell
npm install
npm run dev
npm run tauri:dev
npm run build
```

## 当前重点能力

- 多 gateway 状态总览
- gateway 启停与日志查看
- gateway 配置摘要
- workbench / control center 入口
- UI 创建新 gateway
