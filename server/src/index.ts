import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ExpressAdapter, type NestExpressApplication } from '@nestjs/platform-express'
import compression from 'compression'
import express from 'express'
import { MindTreeAppModule } from './app.module.js'
import { requireAllowedHost, requireAllowedOrigin } from './auth.js'
import type { DocumentRepository } from './document-repository.js'
import type { AppOptions } from './http-options.js'
import { attachMcpRoute } from './mcp-route.js'
import { attachWebHost } from './web-host.js'
import { attachAiProxyRoute } from './ai-proxy.js'

export type { AppOptions } from './http-options.js'

/**
 * 创建 NestJS HTTP 服务，并保留既有 Express 适配器以兼容 MCP SDK 与静态站点。
 * 所有 REST API 均由 Nest 控制器和认证守卫负责。
 */
export async function createApp(repository: DocumentRepository, options: AppOptions, webRoot = ''): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(
    MindTreeAppModule.register(repository, options),
    new ExpressAdapter(),
    { bodyParser: false, logger: ['error', 'warn'] },
  )
  const expressApp = app.getHttpAdapter().getInstance()
  expressApp.disable('x-powered-by')
  expressApp.use(compression())
  expressApp.use(requireAllowedHost(options.allowedHosts))
  expressApp.use(requireAllowedOrigin(options.allowedOrigins))
  expressApp.use(express.json({ limit: '1mb' }))

  attachAiProxyRoute(expressApp, options.aiAllowedHosts)
  attachMcpRoute(expressApp, repository, options)
  if (webRoot) attachWebHost(expressApp, webRoot)
  await app.init()
  return app
}
