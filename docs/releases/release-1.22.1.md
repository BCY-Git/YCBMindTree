# MindTree 1.22.1

## 交互修复

- 修复 macOS 桌面端复制图片后按 `⌘V` 无法粘贴的问题。键盘粘贴与右键粘贴现在共用 WebView 原生剪贴板事件，兼容 Finder 和系统截图。
- 为导图的 `⌘V`、`⌘C` 与 `⌘X` 增加回归覆盖，避免后续键盘交互改动再次破坏剪贴板操作。

## 交付

- GitHub Actions 新增 Apple Silicon macOS 测试包构建流程。发布标签会生成 DMG artifact 与 GitHub Release 草稿，验收后再手动公开发布。
