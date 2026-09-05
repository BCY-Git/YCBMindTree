import { rememberModelConnection } from './model-options'

export type AiSettings = {
  endpoint: string
  model: string
  apiKey: string
}

const storageKey = 'mindtree.ai-settings.v1'
const ghostCompletionKey = 'mindtree.ai-ghost-completion.v1'
export const defaultAiSettings: AiSettings = { endpoint: 'https://api.deepseek.com', model: 'deepseek-v4-flash', apiKey: '' }

export function loadAiSettings(): AiSettings {
  try {
    const value = localStorage.getItem(storageKey)
    if (!value) return defaultAiSettings
    const parsed = JSON.parse(value) as Partial<AiSettings>
    return {
      endpoint: typeof parsed.endpoint === 'string' && parsed.endpoint.trim() ? parsed.endpoint : defaultAiSettings.endpoint,
      model: typeof parsed.model === 'string' && parsed.model.trim() ? parsed.model : defaultAiSettings.model,
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
    }
  } catch {
    return defaultAiSettings
  }
}

export function saveAiSettings(settings: AiSettings) {
  rememberModelConnection(loadAiSettings())
  rememberModelConnection(settings)
  localStorage.setItem(storageKey, JSON.stringify(settings))
}

export function chatUrl(endpoint: string) {
  const base = endpoint.trim().replace(/\/$/, '')
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`
}

/** DeepSeek 前缀续写是 Beta 接口；其它兼容服务则按其普通 Chat 地址尝试。 */
export function completionUrl(endpoint: string) {
  const url = new URL(chatUrl(endpoint))
  if (url.hostname === 'api.deepseek.com') url.pathname = '/beta/chat/completions'
  return url.toString()
}

export function isGhostCompletionEnabled() {
  return localStorage.getItem(ghostCompletionKey) === 'true'
}

export function saveGhostCompletionEnabled(enabled: boolean) {
  localStorage.setItem(ghostCompletionKey, String(enabled))
}
