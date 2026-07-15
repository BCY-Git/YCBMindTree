import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createInitialDocument, createNode } from '../domain/document.factory'
import { NodeSearchDialog } from './NodeSearchDialog'

function documentWithNode(title: string, topic: string) {
  const document = createInitialDocument()
  const root = document.nodes[document.rootId]
  const node = createNode(topic, root.id)
  document.title = title
  root.childIds = [node.id]
  document.nodes = { [root.id]: root, [node.id]: node }
  return { document, node }
}

describe('NodeSearchDialog workspace scope', () => {
  it('keeps current-map search by default and can reveal a result from another map', () => {
    const current = documentWithNode('当前导图', '当前内容')
    const related = documentWithNode('Agent 学习', 'Zod 运行时校验')
    const onSelect = vi.fn()
    render(<NodeSearchDialog
      currentDocumentId={current.document.id}
      documents={[current.document, related.document]}
      tags={[]}
      provenance={[]}
      onClose={() => undefined}
      onSelect={onSelect}
      onCreate={() => undefined}
    />)

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Zod' } })
    expect(screen.queryByText('Zod 运行时校验')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '全部导图' }))
    fireEvent.click(screen.getByRole('button', { name: /Zod 运行时校验/ }))

    expect(onSelect).toHaveBeenCalledWith(related.document.id, related.node.id)
  })

  it('can find nodes from semantic filters without requiring text', () => {
    const current = documentWithNode('交付计划', '修改地图路径')
    current.node.taskStatus = 'doing'
    render(<NodeSearchDialog
      currentDocumentId={current.document.id}
      documents={[current.document]}
      tags={[]}
      provenance={[]}
      onClose={() => undefined}
      onSelect={() => undefined}
      onCreate={() => undefined}
    />)

    fireEvent.click(screen.getByRole('button', { name: '筛选' }))
    fireEvent.click(screen.getByRole('button', { name: '进行中' }))

    expect(screen.getByText('修改地图路径')).toBeTruthy()
  })
})
