type PanelToggleButtonProps = {
  side: 'left' | 'right'
  collapsed: boolean
  onToggle: () => void
}

function PanelIcon({ side }: { side: PanelToggleButtonProps['side'] }) {
  const dividerX = side === 'left' ? 10 : 14
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d={`M${dividerX} 4v16`} /></svg>
}

export function PanelToggleButton({ side, collapsed, onToggle }: PanelToggleButtonProps) {
  const panelName = side === 'left' ? '工作区侧栏' : '属性侧栏'
  const label = collapsed ? `显示${panelName}` : `收起${panelName}`
  return <button className={`topbar-utility__button ${collapsed ? '' : 'is-active'}`} onClick={onToggle} title={label} aria-label={label} aria-pressed={!collapsed}><span aria-hidden="true" className="toolbar-icon"><PanelIcon side={side} /></span></button>
}
