/**
 * Zod 运行时校验模式 — 对应 document.types.ts 中的类型定义。
 *
 * 作用：在从 IndexedDB 读取文档时，用这些 schema 对原始 JSON 做结构验证，
 * 确保数据符合预期类型（防止本地存储被意外篡改或格式错误导致崩溃）。
 *
 * - `mindNodeSchema`：校验单个节点的每个字段（id 非空、childIds 为数组等）。
 * - `mindMapDocumentSchema`：校验整张导图，包含 schemaVersion 必须为 1、
 *   theme.id 必须在允许的六个主题 ID 之中等约束。
 *
 * 若数据不符合 schema，Zod 会抛出结构化错误，方便定位问题。
 */
import { z } from 'zod'

export const mindNodeSchema = z.object({
  id: z.string().min(1),
  parentId: z.string().nullable(),
  childIds: z.array(z.string()),
  topic: z.string(),
  collapsed: z.boolean(),
  offsetX: z.number(),
  offsetY: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

export const mindMapDocumentSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(1),
  title: z.string().min(1),
  categoryId: z.string().min(1).default('uncategorized'),
  rootId: z.string().min(1),
  nodes: z.record(z.string(), mindNodeSchema),
  layout: z.object({
    levelGap: z.number().min(20),
    siblingGap: z.number().min(8),
    freeformOffsets: z.record(z.string(), z.object({ x: z.number(), y: z.number() })).nullable().default(null),
  }),
  theme: z.object({ id: z.enum(['calm', 'vanilla', 'coast', 'iris', 'cyber', 'midnight']) }).default({ id: 'calm' }),
  createdAt: z.number(),
  updatedAt: z.number(),
})
