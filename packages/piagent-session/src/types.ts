import type { Message } from "@ts-piagent/agent";

/**
 * 会话树中的一个节点。
 *
 * 设计要点：Agent 的唯一状态是 messages 数组，但“数组”无法表达
 * “从历史某个点分叉重来”这种需求。因此我们把线性数组升级成一棵树：
 * 每个节点通过 parentId 指向上一条消息，形成一条或多条从根到叶的链。
 * - 线性对话 = 树退化成一条链。
 * - time-travel / 分支 = 从任意非叶节点再长出一个新的子节点。
 */
export interface SessionNode {
  /** 节点唯一 id（消息 id）。 */
  id: string;
  /** 父节点 id；根节点为 null。 */
  parentId: string | null;
  /** 该节点承载的消息。 */
  message: Message;
  /** 创建时间戳（毫秒），用于排序与审计。 */
  createdAt: number;
}

/**
 * 落盘到 JSONL 的一行记录。
 *
 * 采用“事件溯源”风格：文件里存的是一条条 append-only 的记录，
 * 而不是某个时刻的全量快照。重放全部记录即可在内存中重建整棵树。
 * v 字段预留 schema 版本，方便未来演进时做兼容处理。
 */
export interface SessionRecord {
  v: 1;
  node: SessionNode;
}

export interface SessionMeta {
  /** 会话 id。 */
  id: string;
  /** 会话创建时间。 */
  createdAt: number;
}
