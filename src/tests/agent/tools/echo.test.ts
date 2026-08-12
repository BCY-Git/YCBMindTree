import { echoSchema, echoTool } from '@/agent/echo'

describe('echoTool', () => {
  it('回显输入文本', async () => {
    await expect(echoTool.run({ text: '你好' }, {})).resolves.toEqual({ echo: '你好' })
  })

  it('schema 拒绝空文本与超长文本', () => {
    expect(echoSchema.safeParse({ text: '' }).success).toBe(false)
    expect(echoSchema.safeParse({ text: 'x'.repeat(1001) }).success).toBe(false)
    expect(echoSchema.safeParse({ text: 'x'.repeat(1000) }).success).toBe(true)
  })
})
