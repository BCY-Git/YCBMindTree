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
import { App } from './app/App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
