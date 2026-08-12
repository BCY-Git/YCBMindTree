# MindTree 文档中心

MindTree 是一个本地优先、键盘优先的个人树形工作空间。文档按长期职责分类，新增文档时优先放入对应目录，不再把普通 Markdown 文件直接堆在 `docs/` 根目录。

## 分类导航

- [产品与规划](./product/README.md)：产品需求、实施路线、节点语义规划和操作模型对齐。
- [工程与架构](./engineering/README.md)：技术架构、AI 代理、桌面端以及服务端/MCP 设计。
- [AI Harness](./ai-harness/README.md)：材料整理 Agent 方案、手写指南和逐文件课程。
- [发布记录](./releases/README.md)：客户端各版本发布说明，统一按版本归档。
- [智能沉淀与协作设计包](./mindtree-agent-design-v0.3/README.md)：0.3 起的产品定位、协议、交互、里程碑计划与状态记录。

## 目录约定

```text
docs/
├── README.md
├── product/                       产品需求与功能规划
├── engineering/                   架构、运行环境与服务设计
├── ai-harness/                    Agent Harness 方案与课程
│   └── lessons/                   逐文件手写课程
├── releases/                      对外版本发布说明
└── mindtree-agent-design-v0.3/    智能沉淀与协作设计包
```

设计包内的 `milestone-*-plan/status` 属于该设计包的实施历史，不与对外 `release-*` 发布说明混放。
