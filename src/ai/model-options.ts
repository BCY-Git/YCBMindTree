import type { AiSettings } from './ai-settings'

const storageKey = 'mindtree.ai-model-connections.v1'
const endpointKey = (endpoint: string) => endpoint.trim().replace(/\/+$/, '')
export const modelOptionKey = (settings: AiSettings) => JSON.stringify([endpointKey(settings.endpoint), settings.model.trim()])

export function loadModelConnections(): AiSettings[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
    return Array.isArray(value) ? value.filter((item): item is AiSettings => Boolean(item && typeof item.endpoint === 'string' && item.endpoint.trim() && typeof item.model === 'string' && item.model.trim() && typeof item.apiKey === 'string')) : []
  } catch {
    return []
  }
}

export function rememberModelConnection(settings: AiSettings) {
  if (!settings.endpoint.trim() || !settings.model.trim()) return
  const connections = loadModelConnections().filter((item) => modelOptionKey(item) !== modelOptionKey(settings))
  // 同一服务更新密钥时，同步所有已保存模型，避免切换后恢复旧密钥。
  localStorage.setItem(storageKey, JSON.stringify([...connections.map((item) => endpointKey(item.endpoint) === endpointKey(settings.endpoint) ? { ...item, apiKey: settings.apiKey } : item), settings]))
}

export function modelServiceLabel(endpoint: string) {
  try { return new URL(endpoint).host } catch { return '自定义服务' }
}

export function getModelOptions(current: AiSettings, connections: AiSettings[]): AiSettings[] {
  const options = new Map<string, AiSettings>()
  connections.forEach((item) => options.set(modelOptionKey(item), item))
  // 只对官方服务给出预设，兼容网关支持的模型由用户自己的配置决定。
  if (/^https:\/\/api\.deepseek\.com(?:\/(?:v1\/?|chat\/completions\/?|v1\/chat\/completions\/?)?)?$/.test(endpointKey(current.endpoint))) {
    for (const model of ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-v4-flash-vision-exp']) {
      const option = { ...current, model }
      options.set(modelOptionKey(option), option)
    }
  }
  if (current.model.trim()) options.set(modelOptionKey(current), current)
  return [...options.values()]
}
