export type TreeDropIntent = { parentId: string; index: number; kind: 'child' | 'sibling' }

/**
 * 常规节点默认维持树形自动布局：拖向同级只调整顺序；跨分支改结构必须显式
 * 按住 Shift，防止用户只是想整理位置时误把节点变成子节点。
 */
export function resolveRegularTreeDragIntent({
  shiftKey,
  siblingIntent,
  structuralIntent,
}: {
  shiftKey: boolean
  siblingIntent: TreeDropIntent | null
  structuralIntent: TreeDropIntent | null
}): TreeDropIntent | null {
  return shiftKey ? (structuralIntent ?? siblingIntent) : siblingIntent
}
