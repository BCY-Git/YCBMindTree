import { retrieveWorkspaceContext } from '../ai/workspace-retrieval'
import { createInitialDocument, createNode } from '../domain/document.factory'
import type { MindMapDocument } from '../domain/document.types'
import { evaluateSearchSuite, type SearchQualityCase, type SearchQualityCategory, type SearchQualityReport } from './search-quality'

type FixtureNode = { id: string; topic: string; note?: string }

function fixtureDocument(id: string, title: string, nodes: FixtureNode[]): MindMapDocument {
  const document = createInitialDocument()
  const root = document.nodes[document.rootId]
  root.id = `${id}-root`
  root.topic = title
  root.childIds = nodes.map((node) => node.id)
  document.id = id
  document.rootId = root.id
  document.title = title
  document.nodes = { [root.id]: root }
  for (const item of nodes) {
    const node = createNode(item.topic, root.id)
    node.id = item.id
    node.note = item.note ?? ''
    document.nodes[node.id] = node
  }
  return document
}

const current = fixtureDocument('current', '当前工作', [{ id: 'current-focus', topic: '继续整理历史记录' }])
const documents = [
  current,
  fixtureDocument('project', '无人项目', [
    { id: 'tile-task', topic: '地图瓦片', note: '出差前修改路径，这是项目下一步。' },
    { id: 'tile-noise', topic: '地图瓦片缓存原理' },
  ]),
  fixtureDocument('learning', 'Agent 学习', [
    { id: 'zod-boundary', topic: 'Zod', note: '运行时校验未知数据；与 TypeScript 编译时检查的边界不同。' },
    { id: 'zod-noise', topic: 'Zod 表单教程' },
  ]),
  fixtureDocument('decision', '地图技术决策', [
    { id: 'three-decision', topic: 'Three.js', note: '第一阶段选择 Three.js，不选 Cesium；需要真实 GIS 地形时重新评估。' },
    { id: 'three-noise', topic: 'Three.js 材质实验' },
  ]),
  fixtureDocument('ideas', '想法收件箱', [
    { id: 'keyframe-idea', topic: '关键帧', note: '让 AI 根据视频整理关键帧，并回流到相关项目。' },
    { id: 'keyframe-noise', topic: '关键帧播放性能' },
  ]),
]

const definitions: Array<{
  id: string
  category: SearchQualityCategory
  query: string
  expectedNodeKey: string
  forbiddenNodeKey: string
}> = [
  { id: 'daily-project-flow', category: 'daily', query: '地图瓦片 无人项目 下一步 出差前', expectedNodeKey: 'project\u0000tile-task', forbiddenNodeKey: 'project\u0000tile-noise' },
  { id: 'learning-transfer', category: 'learning', query: 'Zod 运行时 编译时 边界', expectedNodeKey: 'learning\u0000zod-boundary', forbiddenNodeKey: 'learning\u0000zod-noise' },
  { id: 'project-decision', category: 'decision', query: 'Three.js Cesium 选择原因 重新评估', expectedNodeKey: 'decision\u0000three-decision', forbiddenNodeKey: 'decision\u0000three-noise' },
  { id: 'temporary-idea', category: 'idea', query: '关键帧 AI 视频 回流项目', expectedNodeKey: 'ideas\u0000keyframe-idea', forbiddenNodeKey: 'ideas\u0000keyframe-noise' },
]

/** 运行不含个人原文、无需联网或模型的四类固定检索样本。 */
export function runFixedSearchQualitySuite(): SearchQualityReport {
  const cases: SearchQualityCase[] = definitions.map((definition) => ({
    id: definition.id,
    category: definition.category,
    rankedNodeKeys: retrieveWorkspaceContext({
      documents,
      currentDocumentId: current.id,
      text: definition.query,
    }).map((item) => `${item.documentId}\u0000${item.nodeId}`),
    expectedNodeKeys: [definition.expectedNodeKey],
    forbiddenNodeKeys: [definition.forbiddenNodeKey],
  }))
  return evaluateSearchSuite(cases, (nodeKey) => {
    const [documentId, nodeId] = nodeKey.split('\u0000')
    return Boolean(documents.find((document) => document.id === documentId)?.nodes[nodeId])
  })
}
