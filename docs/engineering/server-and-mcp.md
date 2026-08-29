# MindTree 服务端与 MCP 设计

## 首期目标

在一台 2G 内存 / 50G 磁盘的单机上，为 MindTree 提供：

1. 文档同步 API：保存导图快照、版本号和变更记录；
2. MCP 服务：让已授权的大模型读取、检索和在用户确认后修改导图；
3. 单一权限边界：REST 与 MCP 使用相同身份、同一份文档访问控制。

首期不做多人协作、实时 CRDT、文件附件和第三方 OAuth；这些会在同步需求稳定后演进。

## 自托管账号登录

服务端提供邮箱/密码注册与登录：`POST /api/v1/auth/register`、`POST /api/v1/auth/login`，返回一个随机不透明的 Bearer 会话 Token。密码使用 Node `scrypt` 加盐哈希；SQLite 只保存密码哈希和 Token 的 SHA-256 哈希，默认会话有效期为 30 天。

个人服务器默认不开放注册，部署时需显式设置 `ALLOW_REGISTRATION=true` 才能创建首个账号。首个账号沿用 `local-user` 身份，以便接管现有单用户同步数据；后续账号使用独立 ownerId，文档天然隔离。既有 `MINDTREE_DEV_TOKEN` 继续可用，以保证旧设备不被立即登出。

## 部署形态

```text
MindTree Web / MCP Host
        │ HTTPS + Bearer token
        ▼
Caddy (自动 TLS、压缩、安全响应头)
        ▼
MindTree Server (Node.js / Express)
   ├── /api/v1/*   同步 REST API
   ├── /mcp        Streamable HTTP MCP
   └── SQLite      文档、版本、变更记录
```

服务只监听 `127.0.0.1`；Caddy 负责公网 TLS。单机 SQLite 足以支撑个人多设备同步，文档快照与变更记录应定期备份到对象存储或另一台机器。Windows 部署模板见 [Caddyfile](../../apps/mindtree-server/deploy/windows/Caddyfile)：域名 A 记录生效后，设置 `MINDTREE_DOMAIN`、`CADDY_EMAIL`，并让 Caddy 反代到本机 `127.0.0.1:18789`。公网只需开放 80/443，不应继续暴露 Node 端口。

浏览器直连 API 时，`ALLOWED_ORIGINS` 必须明确列出前端来源（开发环境为 `http://127.0.0.1:5174`）；服务端只对名单内来源返回 CORS 响应头，且仅允许 `GET`、`POST`、`PUT` 与 `OPTIONS`，防止任意网站借用本机 Token 调用同步 API。

Windows 上暂时没有反向代理时，优先设置服务端 `MINDTREE_WEB_ROOT` 指向前端 `dist` 目录，使网页、`/api/v1` 与 `/mcp` 共用同步服务端口，避免新增安全组规则与跨端口 CORS。也可用 [web-server.mjs](../../apps/mindtree-server/deploy/windows/web-server.mjs) 将前端作为独立静态站点运行；默认监听 `81` 端口，此时必须同时放行 Windows 防火墙和云厂商安全组，并把完整网页来源加入 `ALLOWED_ORIGINS`。HTTP 形态只适合短期联调；账号密码与会话 Token 跨公网使用前应迁移到 HTTPS。

## 同步数据模型

`documents` 保存当前快照和 `version`；每一次写入要求客户端携带 `baseVersion`。版本一致才提交，并生成新的 `version` 与一条 `document_changes` 记录；不一致时返回 `409 VERSION_CONFLICT`，客户端先拉取最新快照后再决定合并策略。

```text
documents(id, owner_id, title, category_id, version, payload_json, created_at, updated_at)
document_changes(id, document_id, version, kind, payload_json, created_at)
```

首期采用“全量快照 + 乐观版本”；前端已有命令模型，后续可将命令增量作为 `document_changes` 写入，再升级为自动合并。

## MCP 设计

采用官方稳定 v1 TypeScript SDK 与 Streamable HTTP。MCP 客户端连接 `POST /mcp`，使用 Bearer token；服务端建立有状态会话并验证 `Mcp-Session-Id`。本地开发可另提供 stdio 入口，部署环境只暴露 HTTPS `/mcp`。

### 工具

| 工具 | 权限 | 用途 |
|---|---|---|
| `mindtree_list_documents` | read | 列出当前用户可访问的导图摘要 |
| `mindtree_get_document` | read | 读取导图结构、版本与主题 |
| `mindtree_search_nodes` | read | 按关键词查找节点 |
| `mindtree_append_branch` | write | 向指定节点添加子树；默认 `dryRun: true`，仅预览变更 |

`mindtree_append_branch` 在 `dryRun: false` 时必须携带预期 `version`。版本不一致返回冲突信息，避免模型覆盖用户刚做的编辑。MCP Host 本身也应对写工具显示确认提示。

## 安全基线

- 文档归属由服务端 token 的 `sub` 决定，绝不接受客户端传入的 ownerId；
- `/mcp`、REST API 均需要认证，且按用户/文档授权；
- 写工具采用最小权限、版本校验和审计记录；
- Nginx 限制请求体、请求频率与来源；
- SQLite 与环境变量（JWT/开发令牌）不提交仓库；
- 对公网 MCP 使用正式 OAuth/JWT；开发 Bearer token 仅限本机。

## 迭代顺序

1. 本地 server scaffold、健康检查、SQLite、REST 文档 CRUD；
2. MCP 只读工具与 Inspector 联调；
3. 带 dry-run 与版本校验的 MCP 写工具；
4. Web 前端接入 token 与 push/pull；
5. 阿里云 Docker + Nginx + 备份 + 正式认证。

## 前端受控同步 MVP

前端通过本地设置保存服务根地址和单用户 Bearer Token；Token 不会进入导图 JSON 或上传到除目标服务外的任何位置。每份导图在 IndexedDB 的独立 `syncMetadata` 表记录远端 `version`。用户手动点击上传时携带该版本作为 `baseVersion`；发生 `409 VERSION_CONFLICT` 时停止上传并展示远端摘要。

服务端会在写入 SQLite 前用与客户端一致的导图快照结构校验 `nodes`、`relations`、布局和主题，并验证路径中的文档 ID 必须与快照 ID 一致；Bearer Token 不再能写入任意 JSON。

拉取操作先获取远端摘要，用户确认后才写入本地；写入前创建一份新的“同步前备份”导图，避免远端内容覆盖未同步的本地工作。首期不提供静默后台同步、自动覆盖或自动合并。

## 设备扫码配对

已配置设备可以请求 `POST /api/v1/pairings`，服务端生成一个随机配对 secret，并仅保存它的 SHA-256 哈希。二维码只包含服务地址、配对 ID、随机 secret 与过期时间；它不包含长期 Bearer Token。新设备扫码后调用不需要 Bearer Token 的 `POST /api/v1/pairings/:pairingId/exchange` 兑换一次，服务端仅在 secret 匹配、未被领取且仍在五分钟有效期内时返回 Token，并立刻把该配对记录标记为已领取。

二维码应被视为临时敏感信息：展示设备不应截图或转发，领取后立即失效。配对码由已登录设备创建，服务端从一次性 challenge 中读取原设备的 ownerId，并给新设备签发独立的账号会话；二维码不再兑换共享开发 Token。配对兑换必须走 HTTPS。
