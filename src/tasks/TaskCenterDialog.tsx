import { useMemo, useState } from 'react'
import type { MindNodeTaskStatus } from '../domain/document.types'
import type { MindTreeTask } from './task-index'
import type { Tag } from '../domain/tag-library'
import { nodeMarkMeta, nodeMarkOrder } from '../domain/node-semantics'

type Filter = 'open' | 'todo' | 'doing' | 'done' | 'overdue' | 'all'

const statusName: Record<Exclude<MindNodeTaskStatus, 'none'>, string> = { todo: '待办', doing: '进行中', done: '已完成' }

function today() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function dueLabel(dueDate: string | null) {
  if (!dueDate) return null
  const current = today()
  if (dueDate < current) return `逾期 · ${dueDate}`
  if (dueDate === current) return '今天截止'
  return dueDate
}

export function TaskCenterDialog({ tasks, tags, onClose, onOpenTask, onSetStatus, onSetPriority, onSetDueDate }: {
  tasks: MindTreeTask[]
  tags: Tag[]
  onClose: () => void
  onOpenTask: (task: MindTreeTask) => void
  onSetStatus: (task: MindTreeTask, status: Exclude<MindNodeTaskStatus, 'none'>) => void
  onSetPriority: (task: MindTreeTask, priority: 0 | 1 | 2 | 3) => void
  onSetDueDate: (task: MindTreeTask, dueDate: string | null) => void
}) {
  const [filter, setFilter] = useState<Filter>('open')
  const [tagIds, setTagIds] = useState<string[]>([])
  const [marks, setMarks] = useState<MindTreeTask['marks'][number][]>([])
  const [priorities, setPriorities] = useState<number[]>([])
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const visibleTasks = useMemo(() => tasks.filter((task) => {
    const statusMatches = filter === 'all' || (filter === 'open' ? task.status !== 'done' : filter === 'overdue' ? task.status !== 'done' && Boolean(task.dueDate && task.dueDate < today()) : task.status === filter)
    const tagMatches = tagIds.length === 0 || tagIds.some((tagId) => task.tagIds.includes(tagId))
    const markMatches = marks.length === 0 || marks.some((mark) => task.marks.includes(mark))
    const priorityMatches = priorities.length === 0 || priorities.includes(task.priority)
    return statusMatches && tagMatches && markMatches && priorityMatches
  }), [filter, marks, priorities, tagIds, tasks])

  const toggle = <T,>(values: T[], value: T) => values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
  const taskKey = (task: MindTreeTask) => `${task.documentId}:${task.nodeId}`

  return <div className="task-center-layer" role="dialog" aria-modal="true" aria-labelledby="task-center-title" onMouseDown={onClose}>
    <section className="task-center" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><p className="eyebrow">任务中心</p><h2 id="task-center-title">所有待办</h2></div><button onClick={onClose} aria-label="关闭任务中心">×</button></header>
      <div className="task-center__filters">{([['open', '未完成'], ['todo', '待办'], ['doing', '进行中'], ['overdue', '已逾期'], ['done', '已完成'], ['all', '全部']] as Array<[Filter, string]>).map(([value, label]) => <button key={value} className={filter === value ? 'is-active' : ''} onClick={() => setFilter(value)}>{label}</button>)}</div>
      <div className="task-center__semantic-filters">{tags.map((tag) => <button key={tag.id} className={tagIds.includes(tag.id) ? 'is-active' : ''} onClick={() => setTagIds(toggle(tagIds, tag.id))}><i style={{ background: tag.color }} />{tag.name}</button>)}{nodeMarkOrder.map((mark) => <button key={mark} className={marks.includes(mark) ? 'is-active' : ''} onClick={() => setMarks(toggle(marks, mark))}>{nodeMarkMeta[mark].icon}</button>)}{[1, 2, 3].map((priority) => <button key={priority} className={priorities.includes(priority) ? 'is-active' : ''} onClick={() => setPriorities(toggle(priorities, priority))}>P{priority}</button>)}</div>
      {selectedKeys.length > 0 && <div className="task-center__bulk"><strong>已选 {selectedKeys.length} 项</strong><button onClick={() => visibleTasks.filter((task) => selectedKeys.includes(taskKey(task))).forEach((task) => onSetStatus(task, 'done'))}>标记完成</button><button onClick={() => visibleTasks.filter((task) => selectedKeys.includes(taskKey(task))).forEach((task) => onSetPriority(task, 1))}>设为 P1</button><label>截止<input type="date" onChange={(event) => { if (event.target.value) visibleTasks.filter((task) => selectedKeys.includes(taskKey(task))).forEach((task) => onSetDueDate(task, event.target.value)) }} /></label><button onClick={() => setSelectedKeys([])}>取消选择</button></div>}
      <div className="task-center__list">{visibleTasks.length ? visibleTasks.map((task) => <article key={`${task.documentId}-${task.nodeId}`}>
        <input type="checkbox" aria-label={`选择 ${task.topic}`} checked={selectedKeys.includes(taskKey(task))} onChange={() => setSelectedKeys((keys) => toggle(keys, taskKey(task)))} />
        <button className="task-center__open" onClick={() => onOpenTask(task)}><span className={`task-status task-status--${task.status}`}>{task.status === 'done' ? '✓' : task.status === 'doing' ? '◐' : '○'}</span><span><strong>{task.topic}</strong><small>{task.documentTitle}{task.isDraft ? ' · 随手记草稿' : ''}{dueLabel(task.dueDate) ? ` · ${dueLabel(task.dueDate)}` : ''}</small><small className="task-center__path">{task.path.join(' › ')}{task.parentProgress && task.parentProgress.total > 0 ? ` · 父分支 ${task.parentProgress.done}/${task.parentProgress.total}` : ''}</small></span>{task.priority > 0 && <i>P{task.priority}</i>}</button>
        <select value={task.status} aria-label={`更新 ${task.topic} 的状态`} onChange={(event) => onSetStatus(task, event.target.value as Exclude<MindNodeTaskStatus, 'none'>)}><option value="todo">待办</option><option value="doing">进行中</option><option value="done">已完成</option></select>
      </article>) : <p className="task-center__empty">这里没有符合条件的任务。</p>}</div>
    </section>
  </div>
}
