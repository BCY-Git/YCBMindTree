# MindTree CI/CD

## 工作流

- `CI`：每一次 push、PR 和手动触发均执行 `pnpm check`（全工作区类型检查、测试和构建）。
- `部署 MindTree 生产环境`：创建 `v*` 标签后自动进入生产部署；也可以在 Actions 页面手动运行，且必须勾选“确认部署到生产环境”。构建与部署分为两个 Job，部署 Job 使用 GitHub 的 `production` Environment。

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

若只是紧急修复或需要指定提交，在 GitHub Actions 中手动运行“部署 MindTree 生产环境”，选择目标 ref 并确认生产部署。
