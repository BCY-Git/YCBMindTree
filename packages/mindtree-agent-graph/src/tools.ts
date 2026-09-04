/**
 * 工具定义。
 *
 * 对应 src/agent/types.ts 里的 AgentTool<A>（name/description/category/schema/run）——
 * 结构几乎同构，tool() 在做的事就是把 zod schema 转成模型能理解的 JSON Schema，
 * 同时保留 TS 端类型推导，你现在手写的那部分不需要重新发明。
 *
 * 分类方式：不用额外的 category 字段，用命名前缀表达——
 * `propose_` 开头的工具只生成候选，绝不接触真实数据源；只读工具随便起名。
 * 这样 requiresApproval() 可以是一个不依赖任何注册表的纯函数，方便单测。
 */
import { tool } from '@langchain/core/tools'
import { z } from 'zod'

export const proposeCreateNodeSchema = z.object({
  parentId: z.string().describe('必须是当前上下文里已存在的节点 id'),
  topic: z.string(),
  taskStatus: z.enum(['none', 'todo', 'doing', 'done']).default('none'),
})

/**
 * 提出"新增子节点"候选。函数体本身完全不接触 domain/commands.ts——
 * 它只返回候选描述，写不写、什么时候写，是宿主图里 review 节点的事。
 * 工具本身没有能力越权，这条边界是设计出来的，不是靠代码审查保证的。
 */
export const proposeCreateNode = tool(
  async ({ parentId, topic, taskStatus }) => {
    return JSON.stringify({ kind: 'create-node', parentId, topic, taskStatus })
  },
  {
    name: 'propose_create_node',
    description: '在指定父节点下提出一个新增子节点的候选，不会直接写入导图。',
    schema: proposeCreateNodeSchema,
  },
)

/**
 * "读子树"这类工具需要真实访问宿主的数据（domain/commands.ts、persistence/database.ts），
 * 但本包不应该直接依赖那些模块——包依赖具体数据源，会让它没法在 Web/桌面两种运行时
 * 之间复用（参考上一轮讨论：图要能在两种宿主里跑，checkpointer 可插拔，工具的数据
 * 访问同理）。所以这里是个工厂函数：宿主 app 注入一个 loadSubtree 实现，包只负责
 * "工具的形状"，不负责"数据从哪来"。
 */
export function createReadFocusSubtreeTool(loadSubtree: (nodeId: string) => Promise<unknown>) {
  return tool(
    async ({ nodeId }) => JSON.stringify(await loadSubtree(nodeId)),
    {
      name: 'read_focus_subtree',
      description: '读取指定节点及其子树，用于生成候选前先确认现状。这是只读工具，不需要用户批准。',
      schema: z.object({ nodeId: z.string() }),
    },
  )
}

/** 审批边界判断：候选类工具（propose_ 前缀）必须先过 interrupt()，只读工具直接放行。 */
export function requiresApproval(toolName: string): boolean {
  return toolName.startsWith('propose_')
}
