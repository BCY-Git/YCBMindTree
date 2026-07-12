import { describe, expect, it } from 'vitest'
import { createInitialDocument } from '../domain/document.factory'
import { collectTasks } from './task-index'

describe('task index', () => {
  it('collects tasks across documents and puts unfinished high priorities first', () => {
    const first = createInitialDocument()
    const second = createInitialDocument()
    const firstTask = first.nodes[first.rootId].childIds[0]
    const secondTask = second.nodes[second.rootId].childIds[0]
    first.nodes[firstTask].taskStatus = 'doing'
    first.nodes[firstTask].priority = 2
    second.nodes[secondTask].taskStatus = 'todo'
    second.nodes[secondTask].priority = 1

    const tasks = collectTasks([first, second])

    expect(tasks.map((task) => task.nodeId)).toEqual([secondTask, firstTask])
  })
})
