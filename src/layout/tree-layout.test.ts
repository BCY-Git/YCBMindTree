import { describe, expect, it } from 'vitest'
import { createInitialDocument } from '../domain/document.factory'
import { executeCommand } from '../domain/commands'
import { layoutTree } from './tree-layout'

describe('tree layout', () => {
  it('keeps children to the right and preserves sibling order', () => {
    const document = createInitialDocument()
    const nodes = layoutTree(document)
    const byId = Object.fromEntries(nodes.map((node) => [node.id, node]))
    const branchId = document.nodes[document.rootId].childIds[0]
    const [firstChild, secondChild] = document.nodes[branchId].childIds

    expect(byId[branchId].x).toBeGreaterThan(byId[document.rootId].x)
    expect(byId[firstChild].y).toBeLessThan(byId[secondChild].y)
  })

  it('does not render descendants of a collapsed node', () => {
    const document = createInitialDocument()
    const branchId = document.nodes[document.rootId].childIds[0]
    document.nodes[branchId].collapsed = true

    const ids = layoutTree(document).map((node) => node.id)
    expect(ids).toContain(branchId)
    document.nodes[branchId].childIds.forEach((id) => expect(ids).not.toContain(id))
  })

  it('packs root leaf branches tightly around a single expanded branch', () => {
    const document = createInitialDocument()
    const firstLeaf = executeCommand(document, { type: 'ADD_CHILD', parentId: document.rootId, topic: '叶子一' }).document
    const nextLeaf = executeCommand(firstLeaf, { type: 'ADD_CHILD', parentId: document.rootId, topic: '叶子二' }).document
    const nodes = layoutTree(nextLeaf)
    const byId = Object.fromEntries(nodes.map((node) => [node.id, node]))
    const rootChildren = nextLeaf.nodes[nextLeaf.rootId].childIds
    const positions = rootChildren.map((id) => byId[id].y)

    expect(positions[1] - positions[0]).toBe(66) // 44px 卡片 + 默认 22px 同级间距
    expect(positions[2] - positions[1]).toBe(66)
  })

  it('places a free topic without adding it to the root tree layout', () => {
    const document = createInitialDocument()
    const freeId = 'free-topic'
    document.nodes[freeId] = { ...document.nodes[document.rootId], id: freeId, parentId: null, isFreeTopic: true, childIds: [], topic: '自由主题', offsetX: 511, offsetY: 233 }

    const free = layoutTree(document).find((node) => node.id === freeId)

    expect(free).toMatchObject({ x: 511, y: 233 })
  })

  it('uses the persisted node size while keeping enough height for its text', () => {
    const document = createInitialDocument()
    const nodeId = document.nodes[document.rootId].childIds[0]
    document.nodes[nodeId].width = 310
    document.nodes[nodeId].height = 92

    const placed = layoutTree(document).find((node) => node.id === nodeId)!
    expect(placed).toMatchObject({ width: 310, height: 92 })
  })

  it('temporarily makes room for an editing node without persisting its size', () => {
    const document = createInitialDocument()
    const withFirstLeaf = executeCommand(document, { type: 'ADD_CHILD', parentId: document.rootId, topic: '叶子一' }).document
    const withSecondLeaf = executeCommand(withFirstLeaf, { type: 'ADD_CHILD', parentId: withFirstLeaf.rootId, topic: '叶子二' }).document
    const [, firstLeafId, secondLeafId] = withSecondLeaf.nodes[withSecondLeaf.rootId].childIds
    const baseline = Object.fromEntries(layoutTree(withSecondLeaf).map((node) => [node.id, node]))
    const editing = Object.fromEntries(layoutTree(withSecondLeaf, new Map([[firstLeafId, 180]])).map((node) => [node.id, node]))

    expect(editing[firstLeafId].height).toBe(180)
    expect(editing[secondLeafId].y - editing[firstLeafId].y).toBeGreaterThan(baseline[secondLeafId].y - baseline[firstLeafId].y)
    expect(withSecondLeaf.nodes[firstLeafId].height).toBeNull()
  })

  it('reserves every explicit line in a multi-line CJK title', () => {
    const document = createInitialDocument()
    document.nodes[document.rootId].topic = '第一行\n第二行\n第三行\n第四行\n第五行'

    const root = layoutTree(document).find((node) => node.id === document.rootId)!
    expect(root.height).toBe(138) // 58px 根主题 + 4 行 × 20px
  })
})
