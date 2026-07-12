import { useMemo, useState } from 'react'
import type { MindNodeTaskStatus } from '../domain/document.types'
import type { MindTreeTask } from './task-index'

type Filter = 'open' | 'todo' | 'doing' | 'done' | 'all'

const statusName: Record<Exclude<MindNodeTaskStatus, 'none'>, string> = { todo: '待办', doing: '进行中', done: '已完成' }

export function TaskCenterDialog({ tasks, onClose, onOpenTask, onSetStatus }: {
  tasks: MindTreeTask[]
  onClose: () => void
  onOpenTask: (task: MindTreeTask) => void
  onSetStatus: (task: MindTreeTask, status: Exclude<MindNodeTaskStatus, 'none'>) => void
}) {
  const [filter, setFilter] = useState<Filter>('open')
  const visibleTasks = useMemo(() => tasks.filter((task) => filter === 'all' || filter === 'open' ? task.status !== 'done' : task.status === filter), [filter, tasks])

  return <div className="task-center-layer" role="dialog" aria-modal="true" aria-labelledby="task-center-title" onMouseDown={onClose}>
    <section className="task-center" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><p className="eyebrow">任务中心</p><h2 id="task-center-title">所有待办</h2></div><button onClick={onClose} aria-label="关闭任务中心">×</button></header>
      <div className="task-center__filters">{([['open', '未完成'], ['todo', '待办'], ['doing', '进行中'], ['done', '已完成'], ['all', '全部']] as Array<[Filter, string]>).map(([value, label]) => <button key={value} className={filter === value ? 'is-active' : ''} onClick={() => setFilter(value)}>{label}</button>)}</div>
      <div className="task-center__list">{visibleTasks.length ? visibleTasks.map((task) => <article key={`${task.documentId}-${task.nodeId}`}>
        <button className="task-center__open" onClick={() => onOpenTask(task)}><span className={`task-status task-status--${task.status}`}>{task.status === 'done' ? '✓' : task.status === 'doing' ? '◐' : '○'}</span><span><strong>{task.topic}</strong><small>{task.documentTitle}{task.isDraft ? ' · 随手记草稿' : ''}</small></span>{task.priority > 0 && <i>P{task.priority}</i>}</button>
        <select value={task.status} aria-label={`更新 ${task.topic} 的状态`} onChange={(event) => onSetStatus(task, event.target.value as Exclude<MindNodeTaskStatus, 'none'>)}><option value="todo">待办</option><option value="doing">进行中</option><option value="done">已完成</option></select>
      </article>) : <p className="task-center__empty">这里没有符合条件的任务。</p>}</div>
    </section>
  </div>
}
