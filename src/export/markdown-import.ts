import { createDocumentFromOutline, fileStem, type ImportedDocument, type ImportedOutlineNode } from './import-document'

type StackEntry = { depth: number; node: ImportedOutlineNode }

function appendAtDepth(forest: ImportedOutlineNode[], stack: StackEntry[], node: ImportedOutlineNode, depth: number) {
  while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop()
  const parent = stack[stack.length - 1]
  if (parent) (parent.node.children ??= []).push(node)
  else forest.push(node)
  stack.push({ depth, node })
}

export function parseMarkdownOutline(content: string, fileName: string): ImportedDocument {
  const lines = content.replace(/\r\n?/g, '\n').split('\n')
  const forest: ImportedOutlineNode[] = []
  const stack: StackEntry[] = []
  let documentTitle = fileStem(fileName)
  let firstH1UsedAsRoot = false
  let currentHeadingDepth: number | null = null
  let lastNode: ImportedOutlineNode | null = null

  lines.forEach((rawLine) => {
    const heading = rawLine.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (heading) {
      const level = heading[1].length
      const topic = heading[2].trim()
      if (!firstH1UsedAsRoot && level === 1 && !forest.length) {
        documentTitle = topic
        const root = { topic, children: [] }
        appendAtDepth(forest, stack, root, 0)
        firstH1UsedAsRoot = true
        currentHeadingDepth = 0
        lastNode = root
        return
      }
      const depth = firstH1UsedAsRoot ? Math.max(1, level - 1) : Math.max(0, level - 1)
      const node = { topic, children: [] }
      appendAtDepth(forest, stack, node, depth)
      currentHeadingDepth = depth
      lastNode = node
      return
    }

    const list = rawLine.match(/^(\s*)(?:[-+*]|\d+[.)])\s+(.+)$/)
    if (list) {
      const indent = list[1].replace(/\t/g, '  ').length
      let topic = list[2].trim()
      let taskStatus: ImportedOutlineNode['taskStatus'] = 'none'
      const task = topic.match(/^\[([ xX])\]\s*(.*)$/)
      if (task) {
        taskStatus = task[1].toLowerCase() === 'x' ? 'done' : 'todo'
        topic = task[2].trim()
      }
      const indentDepth = Math.floor(indent / 2)
      const depth = currentHeadingDepth === null ? indentDepth : currentHeadingDepth + 1 + indentDepth
      const node = { topic, taskStatus, children: [] }
      appendAtDepth(forest, stack, node, depth)
      lastNode = node
      return
    }

    const paragraph = rawLine.trim().replace(/^>\s?/, '')
    if (paragraph && lastNode) lastNode.note = [lastNode.note, paragraph].filter(Boolean).join('\n')
  })

  if (!forest.length) throw new Error('Markdown 中没有可导入的标题或列表')
  const root = forest.length === 1 ? forest[0] : { topic: documentTitle, children: forest }
  return createDocumentFromOutline(documentTitle, root)
}
