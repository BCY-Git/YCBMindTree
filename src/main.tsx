/**
 * 应用入口 — 挂载 React 根节点。
 *
 * 使用 React 18 createRoot API，以 StrictMode 包裹 <App />。
 * 导入 @xyflow/react 默认样式和全局 CSS，初始化整个应用。
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@xyflow/react/dist/style.css'
import './styles.css'
import './readability.css'
import { App } from './app/App'
import { AppErrorBoundary } from './app/AppErrorBoundary'
import { ClickSpark } from './app/ClickSpark'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClickSpark sparkSize={10} sparkRadius={18} sparkCount={8} duration={400}>
      <AppErrorBoundary><App /></AppErrorBoundary>
    </ClickSpark>
  </StrictMode>,
)

requestAnimationFrame(() => window.dispatchEvent(new Event('mindtree:mounted')))
