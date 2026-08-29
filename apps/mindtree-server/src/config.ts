import 'dotenv/config'
import { resolve } from 'node:path'

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} 未配置；请复制 .env.example 为 .env 后填写。`)
  return value
}

export const config = {
  host: process.env.HOST?.trim() || '127.0.0.1',
  port: Number(process.env.PORT || 8787),
  databasePath: resolve(process.cwd(), process.env.DATABASE_PATH || './data/mindtree.db'),
  webRoot: process.env.MINDTREE_WEB_ROOT?.trim() ? resolve(process.cwd(), process.env.MINDTREE_WEB_ROOT.trim()) : '',
  devToken: required('MINDTREE_DEV_TOKEN'),
  allowRegistration: process.env.ALLOW_REGISTRATION === 'true',
  sessionLifetimeMs: Math.max(60 * 60 * 1000, Number(process.env.SESSION_LIFETIME_DAYS || 30) * 24 * 60 * 60 * 1000),
  allowedHosts: (process.env.ALLOWED_HOSTS || '127.0.0.1:8787,localhost:8787').split(',').map((host) => host.trim()).filter(Boolean),
  allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://127.0.0.1:5174,http://localhost:5174').split(',').map((origin) => origin.trim()).filter(Boolean),
  aiAllowedHosts: (process.env.AI_ALLOWED_HOSTS || 'api.deepseek.com,api.openai.com').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean),
}
