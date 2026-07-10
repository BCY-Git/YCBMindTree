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
  devToken: required('MINDTREE_DEV_TOKEN'),
  allowedHosts: (process.env.ALLOWED_HOSTS || '127.0.0.1:8787,localhost:8787').split(',').map((host) => host.trim()).filter(Boolean),
}
