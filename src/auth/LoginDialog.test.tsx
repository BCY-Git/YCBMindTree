import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { LoginDialog } from './LoginDialog'

vi.mock('./Threads', () => ({ Threads: () => <div data-testid="threads" /> }))

describe('LoginDialog', () => {
  it('does not render while closed', () => {
    render(<LoginDialog open={false} onClose={() => undefined} onSubmit={vi.fn()} />)

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('submits an email and password through the existing login flow', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<LoginDialog open onClose={() => undefined} onSubmit={onSubmit} />)

    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: ' user@example.com ' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: '登录并开始同步' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('login', 'user@example.com', 'password123'))
  })

  it('switches to registration and blocks mismatched passwords', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<LoginDialog open onClose={() => undefined} onSubmit={onSubmit} />)

    fireEvent.click(screen.getByRole('button', { name: '创建账号' }))
    expect(screen.getByRole('heading', { name: '创建你的账号' })).toBeTruthy()

    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'new@example.com' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'password123' } })
    fireEvent.change(screen.getByLabelText('确认密码'), { target: { value: 'password456' } })
    fireEvent.click(screen.getByRole('button', { name: '创建账号' }))

    expect(screen.getByRole('status').textContent).toContain('两次输入的密码不一致')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits matching registration credentials', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<LoginDialog open onClose={() => undefined} onSubmit={onSubmit} />)

    fireEvent.click(screen.getByRole('button', { name: '创建账号' }))
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'new@example.com' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'password123' } })
    fireEvent.change(screen.getByLabelText('确认密码'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: '创建账号' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('register', 'new@example.com', 'password123'))
  })
})
