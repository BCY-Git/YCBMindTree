import { z } from 'zod'

const nodeSchema = z.object({
  id: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  isFreeTopic: z.boolean().default(false),
  childIds: z.array(z.string().uuid()),
  topic: z.string(),
  note: z.string().default(''),
  links: z.array(z.object({ id: z.string().uuid(), url: z.string().url(), label: z.string() })).default([]),
  attachments: z.array(z.object({ id: z.string().uuid(), name: z.string().min(1), type: z.string(), size: z.number().nonnegative(), createdAt: z.number() })).default([]),
  taskStatus: z.enum(['none', 'todo', 'doing', 'done']).default('none'),
  priority: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).default(0),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  collapsed: z.boolean(),
  offsetX: z.number(),
  offsetY: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

const relationSchema = z.object({
  id: z.string().uuid(),
  sourceId: z.string().uuid(),
  targetId: z.string().uuid(),
  label: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

const boundarySchema = z.object({
  id: z.string().uuid(),
  parentId: z.string().uuid(),
  nodeIds: z.array(z.string().uuid()).min(2),
  label: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

/** 服务端接收的完整导图快照；拒绝任意 JSON 写入 SQLite。 */
export const mindMapDocumentSchema = z.object({
  id: z.string().uuid(),
  schemaVersion: z.literal(1),
  title: z.string().min(1),
  categoryId: z.string().min(1),
  isDraft: z.boolean().default(false),
  origin: z.enum(['standard', 'quick-note']).default('standard'),
  rootId: z.string().uuid(),
  nodes: z.record(z.string().uuid(), nodeSchema),
  relations: z.array(relationSchema).default([]),
  boundaries: z.array(boundarySchema).default([]),
  layout: z.object({
    levelGap: z.number().min(20),
    siblingGap: z.number().min(8),
    freeformOffsets: z.record(z.string().uuid(), z.object({ x: z.number(), y: z.number() })).nullable(),
  }),
  theme: z.object({ id: z.enum(['calm', 'vanilla', 'coast', 'iris', 'cyber', 'midnight']) }),
  createdAt: z.number(),
  updatedAt: z.number(),
})
