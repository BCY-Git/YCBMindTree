import { useState, type FormEvent } from 'react'

type LoginDialogProps = {
  open: boolean
  onClose: () => void
  onSubmit: (mode: 'login' | 'register', email: string, password: string) => Promise<void>
}

export function LoginDialog({ open, onClose, onSubmit }: LoginDialogProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!open) return null
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    try { setBusy(true); setNotice(null); await onSubmit(mode, email, password) } catch (error) { setNotice(error instanceof Error ? error.message : '登录失败') } finally { setBusy(false) }
  }
  return <div className="login-dialog-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <form className="login-dialog" onSubmit={(event) => { void submit(event) }} aria-label="账号登录">
      <button type="button" className="login-dialog__close" onClick={onClose} aria-label="关闭">×</button>
      <p className="eyebrow">MindTree 账号</p><h2>{mode === 'login' ? '登录你的工作区' : '创建工作区账号'}</h2>
      <p>{mode === 'login' ? '登录后，同步数据会按账号隔离。' : '个人服务器默认关闭注册；如提示未开放，请在服务器启用注册。'}</p>
      <label>邮箱<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
      <label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={8} required /></label>
      {notice && <small role="status">{notice}</small>}
      <button type="submit" disabled={busy}>{busy ? '处理中…' : mode === 'login' ? '登录' : '创建账号'}</button>
      <button type="button" className="login-dialog__switch" onClick={() => { setMode((current) => current === 'login' ? 'register' : 'login'); setNotice(null) }}>{mode === 'login' ? '没有账号？创建账号' : '已有账号？去登录'}</button>
    </form>
  </div>
}
