/**
 * 「知识库」scope 专用：只有 contextScope === 'workspace' 才考虑用这个。
 * 单节点/单文档场景（现在 90% 的使用场景）用 graph.ts 那张小图就够，
 * 硬套 DeepAgents 只会让一次简单请求多绕好几圈模型调用。
 *
 * 这是一个独立的子路径导出（package.json 的 "./workspace-agent"），
 * 不在 index.ts 的主入口里——只有真的用到工作区调研的宿主才需要安装
 * deepagents（以及它自己要求的 peer：langchain），其余场景不用为这个
 * 依赖付费。对应 package.json 里 deepagents / langchain 走
 * peerDependenciesMeta.optional，而不是普通 dependencies——这是
 * "子路径导出的可选依赖"在 npm/pnpm 里的标准写法。model 本身不在这里
 * import 任何具体 provider（不依赖 @langchain/openai 或其他任何厂商包），
 * 由宿主注入——用 OpenAI、DeepSeek 兼容接口还是别的，是宿主的选择，
 * 不该被这个包锁死。
 */
import { createDeepAgent, StateBackend } from 'deepagents'
import type { BaseLanguageModel } from '@langchain/core/language_models/base'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'

export type WorkspaceSearchFn = (query: string) => Promise<Array<{ documentId: string; documentTitle: string; topic: string; snippet: string }>>

/**
 * 单独导出工具集合，跟 createWorkspaceResearchAgent 分开——这样"这个 agent
 * 到底能调用哪些工具"是一个可以脱离 DeepAgents 运行时单独断言的纯函数，
 * 不需要构造一整个 agent、也不需要真实模型才能测这条边界。
 */
export function buildWorkspaceTools(search: WorkspaceSearchFn) {
  const searchWorkspaceDocuments = tool(
    async ({ query }) => JSON.stringify(await search(query)),
    {
      name: 'search_workspace_documents',
      description: '在整个知识库范围内做检索，只读，不修改任何数据。',
      schema: z.object({ query: z.string() }),
    },
  )

  const proposeCrossDocumentLink = tool(
    async ({ sourceDocumentId, sourceNodeId, targetDocumentId, targetNodeId, reason }) => {
      // 跟 graph.ts 里的 propose_* 工具同一个原则：只返回候选描述，
      // 真正建立关联要走 graph.ts 那条"批量 interrupt 审批"的链路，
      // 这个 agent 自己没有能力，也不应该有能力直接建立关联。
      return JSON.stringify({ kind: 'cross-link-proposal', sourceDocumentId, sourceNodeId, targetDocumentId, targetNodeId, reason })
    },
    {
      name: 'propose_cross_document_link',
      description: '提出"这两处内容可能相关，建议关联"的候选，不会直接建立链接。',
      schema: z.object({
        sourceDocumentId: z.string(),//源文档ID
        sourceNodeId: z.string(),//源节点ID
        targetDocumentId: z.string(),//目标文档ID
        targetNodeId: z.string(),//目标节点ID
        reason: z.string(),//原因
      }),
    },
  )

  return [searchWorkspaceDocuments, proposeCrossDocumentLink]
}

export function createWorkspaceResearchAgent({ model, search }: { model: BaseLanguageModel; search: WorkspaceSearchFn }) {
  return createDeepAgent({
    model,
    tools: buildWorkspaceTools(search),
    // StateBackend：虚拟文件系统只存在于这次 agent 运行的 state 里，进程/线程
    // 结束就没有了，天然不可能变成持久数据——不要把 backend 指向真实的
    // FilesystemBackend 或指向你的导图存储，那等于把"候选制"边界从工具层
        // 挖了个洞（agent 默认拿到的 write_file 工具会以为自己在写"真实文件"）。
    backend: new StateBackend(),
    systemPrompt: [
      '你是 MindTree 知识库调研助手。',
      '你只能读取工作区内容、生成"建议关联"候选；候选不会自动生效，必须等待用户确认。',
      '不要声称你已经完成了写入、关联或修改——你只能提出建议。',
      '你的文件系统只是草稿纸，用来记调研笔记和中间结果，不是用户的真实文档。',
    ].join('\n'),
  })
}
