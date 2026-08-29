# MindTree Agent Harness 方案（材料 → 思维树）

状态：待评审草案
关联文档：`src/ai/README.md`、`docs/engineering/ai-proxy.md`、`docs/engineering/architecture.md`

## 1. 目标

右侧 AI 助手升级为「材料整理 Agent」：用户给一个网页 URL 或一个本地文件夹，Agent 自主读取内容，按用户要求整理成一棵思维树候选，经预览确认后写入导图。

用户（本项目 owner）要求：

- 这部分是 **Harness 工程**：tools、工具调用、ReAct 思考循环由我们显式实现和控制，不依赖框架黑盒。
- 每一行代码可 review：小文件、纯函数、确定性测试，适合在 Cursor 中逐文件审查。
- 单独目录隔离，与既有 AI 功能边界清晰。

## 2. 现状分析

### 已有基础（可复用）

| 能力 | 位置 | 说明 |
|---|---|---|
| 模型请求 | `src/platform/tauri.ts` `requestAiChat` | OpenAI Chat Completions 兼容；浏览器走 Vite 代理，桌面端走 Tauri 原生 HTTP（无 CORS）；含 SSRF 防护 |
| 分支候选协议 | `src/ai/generated-branch.ts` | 模型 JSON → `MindNodeClipboard` 校验（深度 ≤6、节点 ≤60、topic ≤160 字） |
| 写入边界 | `src/domain/commands.ts` + 编辑器 store | `insertGeneratedBranch` 已是可撤销命令 |
| 确认纪律 | `src/ai/README.md` 维护规则 3 | 模型输出永远是候选，写入必须用户确认——Harness 必须继承此约束 |
| 文件能力 | `@tauri-apps/plugin-fs` + `plugin-dialog` | 已在 dependencies，桌面端读文件夹的底座已具备 |
| 本地服务端 | `apps/mindtree-server/`（Express + MCP SDK） | 可选的远端工具宿主，一期不用 |

### 缺口

1. **单轮请求-响应**：没有多轮循环，模型无法"先读文件再决定下一步"。
2. **没有工具抽象**：模型不能主动调用 fetch/读文件等能力。
3. **没有过程可视化**：只有最终回复，没有思考/行动/观察的中间轨迹。
4. **网页正文提取**：`platformFetch` 能拿 HTML，但没有 HTML → 正文的清洗层。
5. **浏览器端读文件夹受限**：只能用 `webkitdirectory` 选择器或 File System Access API，能力弱于桌面端，需要降级路径。

## 3. 架构设计

### 目录划分（已确认：方案一，Harness 与功能分离）

新建 **`src/agent/`** 作为 Harness 层（与 `src/platform/`、`src/domain/` 同级的基础设施），业务功能收在 `src/ai/ingest/`：

```text
src/agent/                    ← Harness：模型无关的 Agent 运行时
├── types.ts                  ← Tool/ToolCall/AgentEvent/AgentStep 等基础类型
├── tool-registry.ts          ← 工具注册表：zod schema → function calling 参数
├── model-client.ts           ← 包装 requestAiChat：带 tools 请求、解析 tool_calls、文本协议降级
├── loop.ts                   ← ReAct 循环驱动：迭代上限、AbortSignal、事件流
├── permissions.ts            ← 工具审批策略：只读自动放行 / 候选类进预览 / 写入禁止自动
├── context.ts                ← 消息窗口与 token 预算、超长截断策略
├── trace.ts                  ← 步骤轨迹记录（thought/action/observation/耗时），供 UI 与调试
├── tests/                    ← 测试统一收在这里，按源结构镜像（不再与源文件同名混排）
│   ├── scripted-model.ts     ← ScriptedModelClient 假模型测试底座
│   ├── loop.test.ts 等       ← 每个内核文件一个对应测试
│   └── tools/echo.test.ts    ← 工具测试镜像 tools/ 结构
└── tools/                    ← 具体工具，一个文件一个工具（测试在 tests/tools/ 下）
    ├── echo.ts               ← 里程碑 A 联通性验证工具
    ├── web-fetch.ts          ← URL → 正文文本（含 HTML 清洗与长度截断）〔里程碑 B〕
    ├── fs-list.ts            ← 列目录（桌面: plugin-fs；浏览器: 目录选择器降级）〔里程碑 B〕
    ├── fs-read.ts            ← 读文件文本（大小/类型白名单）〔里程碑 B〕
    ├── map-read.ts           ← 读当前导图结构〔里程碑 B〕
    └── branch-propose.ts     ← 产出分支候选（走 generated-branch 协议，进预览而非直写）〔里程碑 C〕

src/ai/ingest/                ← 功能层：「材料 → 思维树」业务协议〔里程碑 C〕
├── ingest-prompt.ts          ← 系统提示词与任务模板
├── ingest-schema.ts          ← 输出校验（复用 generated-branch 约束）
├── ingest-service.ts         ← 组装工具集、启动 loop、解释轨迹
├── IngestPanel.tsx           ← Dock 内 UI：输入 URL/文件夹、轨迹展示、候选预览确认
└── tests/                    ← 测试统一收在 tests/ 子目录（与 src/agent/tests/ 同一约定）
```

理由：

- Harness 是基础设施，不含任何提示词和业务协议，地位与 `src/platform/`、`src/domain/` 同级——放顶层让"地基"与"功能"的变更频率和审查严格度自然分层；
- 依赖方向显性：`src/ai/ingest/` import `src/agent/loop`，一眼可见功能层依赖运行时；
- 未来幽灵续写、沉淀等功能迁到 ReAct 循环时，复用顶层运行时不会产生目录内部的模糊依赖；
- `src/ai/ingest/` 遵守 `src/ai/README.md` 的既有维护规则（提示词/类型/解析/测试同目录）；README 审查入口表加一行指向 `src/agent/`，索引仍是一份；
- `src/ai/` 现有功能（deposit、workflow）不动，零回归风险。

### 依赖方向（与 architecture.md 分层一致）

```text
IngestPanel (UI)
   → ai/ingest/ingest-service（组装本次任务）
      → agent/loop（ReAct 驱动）
         → agent/model-client → platform/tauri（唯一网络出口）
         → agent/tools/* → platform/tauri / domain 只读接口
   → 候选 → generated-branch 校验 → 预览确认 → commands 写入
```

不变量：**Agent 没有任何直写导图的通道**。`branch-propose` 工具只是"产出候选"的结构化途径，写入仍走既有预览确认链路。

### ReAct 循环

```text
loop(task, tools, budget):
  messages = [system, user]
  for step in 1..maxSteps (默认 8):
    emit(trace: thought-request)
    response = modelClient.chat(messages, tools.schemas)
    if response.toolCalls:
      for call in toolCalls:
        permit = permissions.check(call)      // 只读放行；propose 类记录候选
        result = permit.allowed ? tool.run(call.args) : deniedResult
        emit(trace: action + observation)
        messages.push(toolResult)
    else:
      emit(trace: final-answer); return
  return budgetExceeded
```

- **双协议**：优先原生 function calling（DeepSeek 等支持）；检测到不支持时降级为文本 ReAct 协议（模型在 content 中输出 `{"action": "tool", "input": ...}`，由 `model-client` 解析）。用户可配任意 OpenAI 兼容端点，不能假设一定有 tool_calls。
- **每一步都是事件**：UI 实时渲染「思考 → 调用 web-fetch → 观察到 3.2k 字正文 → …」，用户可随时 Abort。
- **预算控制**：最大步数、单工具输出截断（如 8k 字）、总 token 预算、单任务超时。

### 审批策略（permissions.ts）

| 工具类别 | 例子 | 策略 |
|---|---|---|
| 只读取材 | web-fetch, fs-list, fs-read, map-read | 自动放行，但全部进轨迹可见 |
| 候选产出 | branch-propose | 不进导图，写入 pending 候选，UI 预览确认 |
| 写入/删除 | — | **不提供给模型**，保持现有纪律 |

### 网页与文件夹取材

- **web-fetch**：`platformFetch` 取 HTML → 清洗（去 script/style/nav、提取 title/正文，纯 TS 实现，不引重型依赖）→ 截断。浏览器 dev 环境需给 Vite 代理加 `/api/fetch` 路由（与 `/api/ai/chat` 同款 SSRF 防护：仅公网 http/https）。
- **fs 工具**：桌面端用 plugin-fs + plugin-dialog（用户显式选目录 = 天然授权）；浏览器降级为 `<input webkitdirectory>`，只读所选文件。文件白名单：`.md/.txt/.markdown/.json/.csv` 等文本类，单文件大小上限，二进制拒绝。

## 4. 测试策略（可 review 的关键）

- **ScriptedModelClient**：测试用假模型，按脚本返回预定 tool_calls/文本，整个 loop 确定性可测，不碰网络。
- 每个工具：正常输出、缺失字段、超限、非法输入四类用例（沿用维护规则 4）。
- loop：覆盖「一轮收工」「多轮工具调用」「预算耗尽」「用户中断」「模型不支持 function calling 的降级路径」。
- permissions：确认任何路径下都不存在跳过预览的写入。

## 5. 里程碑建议

| 阶段 | 内容 | 验收 |
|---|---|---|
| A. Harness 内核 | types / registry / model-client(双协议) / loop / trace + 一个 echo 工具 | ScriptedModel 下 loop 全测试通过 |
| B. 取材工具 | web-fetch(+代理路由)、fs-list、fs-read、map-read | 桌面与浏览器两端取材冒烟通过 |
| C. Ingest 功能 | ingest 协议 + IngestPanel + 轨迹 UI + 候选预览确认 | 给一个 URL 完整走通「读取→整理→预览→插入」 |
| D. 打磨 | token 预算、取消、指标、README 索引更新 | 全量回归 + build 通过 |

服务端 MCP 工具化（把 tools 暴露给其它 MCP 客户端）作为后续可选阶段，一期不做，避免引入部署变量。

## 6. 待你拍板的开放问题

1. **目录**：✅ 已确认——方案一：`src/agent/`（Harness，顶层基础设施）+ `src/ai/ingest/`（业务功能），`src/ai/README.md` 审查入口加索引行。
2. **降级协议**：文本 ReAct 降级是必需品（兼容任意端点），还是一期只做原生 function calling、不支持的端点直接报错？
3. **浏览器端文件夹**：接受「桌面端完整体验、浏览器端仅支持手动选目录」的差异吗？
4. **轨迹持久化**：ReAct 轨迹只存在会话内存，还是要落 IndexedDB 供事后审查？
