import { existsSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import express, { type Express, type Request, type Response, type NextFunction } from 'express'

const immutableExtensions = new Set(['.css', '.js', '.woff2'])

/** 将已构建的 MindTree 网页挂在同步服务同一端口，避免额外安全组与跨端口 CORS。 */
export function attachWebHost(app: Express, configuredRoot: string): string {
  const webRoot = resolve(configuredRoot)
  const indexPath = join(webRoot, 'index.html')
  if (!existsSync(indexPath)) throw new Error(`MindTree 网页入口不存在：${indexPath}`)

  app.use(express.static(webRoot, {
    index: 'index.html',
    setHeaders(response, filePath) {
      const immutable = filePath.includes(`${join(webRoot, 'assets')}`) && immutableExtensions.has(extname(filePath).toLowerCase())
      response.setHeader('cache-control', immutable ? 'public, max-age=31536000, immutable' : 'no-store, must-revalidate')
      response.setHeader('x-content-type-options', 'nosniff')
      response.setHeader('referrer-policy', 'same-origin')
      response.setHeader('x-frame-options', 'DENY')
    },
  }))

  app.use((request: Request, response: Response, next: NextFunction) => {
    if (request.method !== 'GET'
      || request.path === '/healthz'
      || request.path.startsWith('/assets/')
      || request.path.startsWith('/api/')
      || request.path === '/mcp'
      || request.path.startsWith('/mcp/')) return next()
    return response.sendFile(indexPath)
  })
  return webRoot
}
