import { useEffect, useId, useState, type FormEvent } from 'react'

import { Threads } from './Threads'
import './auth-page.css'

type AuthMode = 'login' | 'register'

type LoginDialogProps = {
  open: boolean
  onClose: () => void
  onSubmit: (mode: AuthMode, email: string, password: string) => Promise<void>
}

export function LoginDialog({ open, onClose, onSubmit }: LoginDialogProps) {
  const [mode, setMode] = useState<AuthMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const headingId = useId()
  const noticeId = useId()

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [busy, onClose, open])

  if (!open) return null

  const switchMode = () => {
    setMode((current) => current === 'login' ? 'register' : 'login')
    setPassword('')
    setConfirmPassword('')
    setShowPassword(false)
    setNotice(null)
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (mode === 'register' && password !== confirmPassword) {
      setNotice('两次输入的密码不一致，请重新确认。')
      return
    }

    try {
      setBusy(true)
      setNotice(null)
      await onSubmit(mode, email.trim(), password)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : mode === 'login' ? '登录失败，请稍后重试。' : '注册失败，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }

  const isLogin = mode === 'login'

  return (
    <section className="auth-page" role="dialog" aria-modal="true" aria-labelledby={headingId}>
      <header className="auth-page__topbar">
        <div className="auth-page__brand" aria-label="MindTree">
          <span className="brand-mark" aria-hidden="true">M</span>
          <span>MindTree</span>
        </div>
        <button className="auth-page__local-link" type="button" onClick={onClose} disabled={busy}>
          暂不同步，返回本地工作区
        </button>
      </header>

      <div className="auth-page__frame">
        <form className="auth-page__form" onSubmit={(event) => { void submit(event) }} aria-describedby={notice ? noticeId : undefined}>
          <div className="auth-page__form-inner" key={mode}>
            <div className="auth-page__heading">
              <p className="auth-page__eyebrow">MindTree 账号</p>
              <h1 id={headingId}>{isLogin ? '欢迎回来' : '创建你的账号'}</h1>
              <p>{isLogin ? '登录后，在不同设备间继续整理同一棵思维树。' : '注册后即可启用个人服务器同步，数据按账号隔离。'}</p>
            </div>

            <div className="auth-page__fields">
              <label className="auth-page__field">
                <span>邮箱</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@example.com"
                  autoComplete="email"
                  autoFocus
                  required
                />
              </label>

              <label className="auth-page__field">
                <span className="auth-page__field-row">
                  <span>密码</span>
                  {!isLogin && <span className="auth-page__hint">至少 8 位</span>}
                </span>
                <span className="auth-page__password-wrap">
                  <input
                    aria-label="密码"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete={isLogin ? 'current-password' : 'new-password'}
                    minLength={8}
                    required
                  />
                  <button type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? '隐藏密码' : '显示密码'}>
                    {showPassword ? '隐藏' : '显示'}
                  </button>
                </span>
              </label>

              {!isLogin && (
                <label className="auth-page__field">
                  <span>确认密码</span>
                  <input
                    aria-label="确认密码"
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    autoComplete="new-password"
                    minLength={8}
                    required
                  />
                </label>
              )}
            </div>

            <div className="auth-page__notice" id={noticeId} role="status" aria-live="polite">
              {notice ?? '\u00a0'}
            </div>

            <button className="auth-page__submit" type="submit" disabled={busy}>
              {busy ? '处理中…' : isLogin ? '登录并开始同步' : '创建账号'}
            </button>

            <p className="auth-page__switch-copy">
              {isLogin ? '还没有账号？' : '已经有账号？'}{' '}
              <button type="button" onClick={switchMode} disabled={busy}>
                {isLogin ? '创建账号' : '返回登录'}
              </button>
            </p>
          </div>
        </form>

        <aside className="auth-page__visual" aria-label="MindTree 云同步介绍">
          <Threads color={[0.52, 0.82, 0.71]} amplitude={1.05} distance={0.22} enableMouseInteraction />
          <div className="auth-page__visual-topline">
            <span>个人工作区</span>
            <span>安全同步</span>
          </div>
          <div className="auth-page__visual-copy">
            <p>让每一条思路，都回到同一棵树上。</p>
            <span>同步导图、版本与变更，在桌面端和网页端无缝继续。</span>
          </div>
        </aside>
      </div>

      <p className="auth-page__terms">继续即表示你同意使用 MindTree 账号与同步服务。</p>
    </section>
  )
}
