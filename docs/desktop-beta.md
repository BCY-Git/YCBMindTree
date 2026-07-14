# MindTree macOS 桌面试用版

## 当前范围

- 以 Tauri 2 承载现有 React/Vite 编辑器，生成 Apple Silicon（`aarch64`）的 `.app` 与 `.dmg`。
- 导图、版本历史和附件继续保存在应用 WebView 的本地数据库中；桌面端不会把项目根目录 `.env` 中的 AI Key 打入安装包。
- `⌘S` / `Ctrl+S` 会同时写入本地数据库，并调用 macOS 原生“另存为”窗口导出 `.mindtree.json` 文件。
- 同步、登录与 AI 请求在桌面端走 Tauri 原生 HTTP 客户端，避免 WebView 跨域限制；AI 服务仍限定为公开 HTTPS 地址。

## 本地开发

```bash
npm run desktop:dev
```

首次启动会编译 Rust 依赖。桌面端的 AI 功能需要用户在 AI 助手配置中填写自己的 API Key；开发机 `.env` 仅供浏览器开发服务器代理使用。

## 打包

```bash
npm run desktop:build
```

Apple Silicon 产物：

```text
src-tauri/target/release/bundle/dmg/MindTree_0.2.1_aarch64.dmg
```

当前为本机试用包，使用临时 ad-hoc 签名，未进行 Developer ID 签名和公证。首次从 Finder 打开时若被 Gatekeeper 阻止，可在“系统设置 → 隐私与安全性”中确认打开。对外发放前应配置 Apple Developer ID 与 notarization。

## 暂不纳入本版

- 系统钥匙串保存 Token / API Key：当前配置仍沿用 WebView 本地存储，正式发放前改为 Tauri Stronghold 或 macOS Keychain。
- 自动后台同步、菜单栏常驻、自动更新。
- iPhone / iPad 打包：需要独立的 iOS 签名、设备配置与触控交互验收。
