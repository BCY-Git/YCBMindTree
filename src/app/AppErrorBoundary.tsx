import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { error: Error | null }

/** 避免单个渲染错误把编辑器变成无法解释的空白页。 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('MindTree render error', error, info)
  }

  render() {
    if (this.state.error) {
      return <main className="app-error-boundary" role="alert">
        <h1>MindTree 暂时无法打开</h1>
        <p>编辑内容仍保留在本机。请刷新页面后重试。</p>
        <code>{this.state.error.message}</code>
      </main>
    }
    return this.props.children
  }
}
