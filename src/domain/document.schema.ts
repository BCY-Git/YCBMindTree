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
  isFreeTopic: z.boolean().default(false),
  childIds: z.array(z.string()),
  topic: z.string(),
  note: z.string().default(''),
  links: z.array(z.object({ id: z.string().min(1), url: z.string().url(), label: z.string() })).default([]),
  attachments: z.array(z.object({ id: z.string().min(1), name: z.string().min(1), type: z.string(), size: z.number().nonnegative(), createdAt: z.number(), image: z.object({ width: z.number().positive(), height: z.number().positive(), displayWidth: z.number().positive() }).optional() })).default([]),
  taskStatus: z.enum(['none', 'todo', 'doing', 'done']).default('none'),
  priority: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).default(0),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  marks: z.array(z.enum(['flag', 'star', 'risk', 'idea'])).default([]),
  tagIds: z.array(z.string().min(1)).default([]),
  collapsed: z.boolean(),
  width: z.number().min(118).max(560).nullable().default(null),
  height: z.number().min(44).max(420).nullable().default(null),
  offsetX: z.number(),
  offsetY: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

export const mindMapRelationSchema = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  targetId: z.string().min(1),
  label: z.string(),
  lineStyle: z.enum(['solid', 'dashed', 'dotted']).default('dashed'),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).nullable().default(null),
  controlOffsetX: z.number().finite().min(-2000).max(2000).default(0),
  controlOffsetY: z.number().finite().min(-2000).max(2000).default(0),
  createdAt: z.number(),
  updatedAt: z.number(),
})

export const mindMapBoundarySchema = z.object({
  id: z.string().min(1),
  parentId: z.string().min(1),
  nodeIds: z.array(z.string().min(1)).min(2),
  label: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

export const mindMapSummarySchema = z.object({
  id: z.string().min(1),
  parentId: z.string().min(1),
  nodeIds: z.array(z.string().min(1)).min(2),
  topic: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

export const mindMapDocumentSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(1),
  title: z.string().min(1),
  categoryId: z.string().min(1).default('uncategorized'),
  projectId: z.string().min(1).nullable().default(null),
  pinned: z.boolean().default(false),
  kind: z.enum(['map', 'record', 'source', 'output', 'knowledge']).default('map'),
  isDraft: z.boolean().default(false),
  origin: z.enum(['standard', 'quick-note']).default('standard'),
  rootId: z.string().min(1),
  nodes: z.record(z.string(), mindNodeSchema),
  // 旧文档尚未包含关系数据，读取时以空数组平滑兼容。
  relations: z.array(mindMapRelationSchema).default([]),
  boundaries: z.array(mindMapBoundarySchema).default([]),
  summaries: z.array(mindMapSummarySchema).default([]),
  layout: z.object({
    levelGap: z.number().min(20),
    siblingGap: z.number().min(8),
    freeformOffsets: z.record(z.string(), z.object({ x: z.number(), y: z.number() })).nullable().default(null),
  }),
  theme: z.object({ id: z.enum(['calm', 'vanilla', 'coast', 'iris', 'cyber', 'midnight']) }).default({ id: 'calm' }),
  createdAt: z.number(),
  updatedAt: z.number(),
})
