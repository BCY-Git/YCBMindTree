import { z } from 'zod'

const nodeSchema = z.object({
  id: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  childIds: z.array(z.string().uuid()),
  topic: z.string(),
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

/** 服务端接收的完整导图快照；拒绝任意 JSON 写入 SQLite。 */
export const mindMapDocumentSchema = z.object({
  id: z.string().uuid(),
  schemaVersion: z.literal(1),
  title: z.string().min(1),
  categoryId: z.string().min(1),
  rootId: z.string().uuid(),
  nodes: z.record(z.string().uuid(), nodeSchema),
  relations: z.array(relationSchema).default([]),
  layout: z.object({
    levelGap: z.number().min(20),
    siblingGap: z.number().min(8),
    freeformOffsets: z.record(z.string().uuid(), z.object({ x: z.number(), y: z.number() })).nullable(),
  }),
  theme: z.object({ id: z.enum(['calm', 'vanilla', 'coast', 'iris', 'cyber', 'midnight']) }),
  createdAt: z.number(),
  updatedAt: z.number(),
})
