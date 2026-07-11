# MindTree 服务端与 MCP 设计

## 首期目标

在一台 2G 内存 / 50G 磁盘的单机上，为 MindTree 提供：

1. 文档同步 API：保存导图快照、版本号和变更记录；
2. MCP 服务：让已授权的大模型读取、检索和在用户确认后修改导图；
3. 单一权限边界：REST 与 MCP 使用相同身份、同一份文档访问控制。

首期不做多人协作、实时 CRDT、文件附件和第三方 OAuth；这些会在同步需求稳定后演进。

## 部署形态

```text
MindTree Web / MCP Host
        │ HTTPS + Bearer token
        ▼
Nginx (TLS、限流、访问日志)
        ▼
MindTree Server (Node.js / Express)
   ├── /api/v1/*   同步 REST API
   ├── /mcp        Streamable HTTP MCP
   └── SQLite      文档、版本、变更记录
```

服务只监听 `127.0.0.1`；Nginx 负责公网 TLS。单机 SQLite 足以支撑个人多设备同步，文档快照与变更记录应定期备份到对象存储或另一台机器。

浏览器直连 API 时，`ALLOWED_ORIGINS` 必须明确列出前端来源（开发环境为 `http://127.0.0.1:5174`）；服务端只对名单内来源返回 CORS 响应头，且仅允许 `GET`、`POST`、`PUT` 与 `OPTIONS`，防止任意网站借用本机 Token 调用同步 API。

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

二维码应被视为临时敏感信息：展示设备不应截图或转发，领取后立即失效。后续切换 HTTPS 后，配对兑换同样必须走 TLS。
