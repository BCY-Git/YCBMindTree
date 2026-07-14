import type { NodeMark } from './document.types'

export const nodeMarkOrder: NodeMark[] = ['flag', 'star', 'risk', 'idea']

export const nodeMarkMeta: Record<NodeMark, { icon: string; label: string }> = {
  flag: { icon: '⚑', label: '旗标' },
  star: { icon: '★', label: '星标' },
  risk: { icon: '⚠', label: '风险' },
  idea: { icon: '✦', label: '灵感' },
}
