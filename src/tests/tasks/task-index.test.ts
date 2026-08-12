import { describe, expect, it } from 'vitest'
import { createInitialDocument } from '@/domain/document.factory'
import { collectTasks, subtreeTaskProgress } from '@/tasks/task-index'

describe('task index', () => {
  it('collects tasks across documents and puts unfinished high priorities first', () => {
    const first = createInitialDocument()
    const second = createInitialDocument()
    const firstTask = first.nodes[first.rootId].childIds[0]
    const secondTask = second.nodes[second.rootId].childIds[0]
    first.nodes[firstTask].taskStatus = 'doing'
    first.nodes[firstTask].priority = 2
    first.nodes[firstTask].dueDate = '2030-01-02'
    second.nodes[secondTask].taskStatus = 'todo'
    second.nodes[secondTask].priority = 1
    second.nodes[secondTask].dueDate = '2030-01-01'

    const tasks = collectTasks([first, second])

    expect(tasks.map((task) => task.nodeId)).toEqual([secondTask, firstTask])
    expect(tasks[0].dueDate).toBe('2030-01-01')
    expect(tasks[0].path.at(-1)).toBe(tasks[0].topic)
  })

  it('derives a parent progress summary from every task in its subtree', () => {
    const document = createInitialDocument()
    const branchId = document.nodes[document.rootId].childIds[0]
    const [first, second] = document.nodes[branchId].childIds
    document.nodes[first].taskStatus = 'done'
    document.nodes[second].taskStatus = 'todo'

    expect(subtreeTaskProgress(document, branchId)).toEqual({ done: 1, total: 2 })
  })
})
