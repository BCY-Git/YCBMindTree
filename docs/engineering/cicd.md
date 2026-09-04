# MindTree CI/CD

## 工作流

- `CI`：每一次 push、PR 和手动触发均执行 `pnpm check`（全工作区类型检查、测试和构建）。
- `部署 MindTree 生产环境`：创建 `v*` 标签后自动进入生产部署；也可以在 Actions 页面手动运行，且必须勾选“确认部署到生产环境”。构建与部署分为两个 Job，部署 Job 使用 GitHub 的 `production` Environment。
- `构建 MindTree macOS 测试包`：对 `v*` 标签在 Apple Silicon `macos-14` runner 构建 Tauri DMG。产物同时作为 Actions artifact（保留 30 天）和对应 GitHub Release 的草稿附件。它不会自动发布 Release，以便先在真机安装验收。

由于网站生产部署与桌面包面向不同受众，两条 CD 链路相互独立：单独失败时不会互相回滚。

## 首次配置

在 GitHub 仓库 `Settings → Environments` 新建 `production`：

1. 将部署来源限制为受信任分支和 `v*` 标签；如套餐支持，为它设置 Required reviewers。
2. 在 `production` 的 Variables 新建 `MINDTREE_PRODUCTION_URL`，值为生产站点根地址（不带末尾 `/`）。
3. 在 `production` 的 Secrets 新建：
   - `MINDTREE_DEPLOY_KEY`：仅用于 CI 部署的 ED25519 私钥；
   - `MINDTREE_KNOWN_HOSTS`：服务器 SSH host key 的 known-hosts 行；
   - `MINDTREE_SSH_HOST`：服务器地址；
   - `MINDTREE_SSH_USER`：部署账户名。

不要将密码、私钥、`.env` 或数据库提交到仓库。部署脚本保留服务器上的 `.env` 与 `data/`，并在替换 `web/`、`server/dist/` 和 `server/package.json` 前备份当前版本。部署后会执行本机与外网健康检查；本机检查失败时脚本会自动恢复备份。当前服务器先使用一把专用部署密钥；后续可再迁移到权限更窄的 Windows 服务账户。

## 发版

推荐以标签发版：

```bash
git tag -a v1.22.1 -m '发布 1.22.1'
git push origin v1.22.1
```

标签必须与 `package.json`、`src-tauri/tauri.conf.json` 和 `src-tauri/Cargo.toml` 的版本一致。上面的标签会同时触发网站生产部署和桌面 DMG 构建；前者继续受 `production` Environment 保护，后者生成一个 GitHub Release 草稿。验收 DMG 后，在 GitHub Release 页面手动发布该草稿。
若只是紧急修复或需要指定提交，在 GitHub Actions 中手动运行“部署 MindTree 生产环境”，选择目标 ref 并确认生产部署。若要重新构建桌面包，手动运行“构建 MindTree macOS 测试包”，填入已存在的 `vX.Y.Z` 标签。

## 桌面签名与公证

当前 CI 产出与本地试用包一致，使用 ad-hoc 签名，没有 Apple notarization。对外正式发布前，再为该工作流增加一个受保护的 `desktop-release` Environment，并配置 Apple Developer ID 证书、证书密码、App Store Connect API key 与 notarization 凭据。在此之前，请只把草稿中的 DMG 当作测试包分发。
