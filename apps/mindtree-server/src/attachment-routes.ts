/**
 * attachment-routes — 附件字节的上传与下载（Express 层，与 MCP 路由同级）。
 *
 * - PUT：raw body 即字节；附件 id 必须已存在于文档 payload 的元数据中（先存结构、后传字节）
 * - GET：返回字节，Content-Type 以文档元数据为准
 * - 归属由 Bearer token 决定，不接受客户端传入的 ownerId
 */
import type { Express } from 'express'
import express from 'express'
import { requireAccountBearer, type AuthenticatedRequest } from './auth.js'
import type { DocumentRepository } from './document-repository.js'
import { allowedAttachmentTypes, AttachmentStore, collectAttachmentMeta, isSafeAttachmentId, maxAttachmentBytes } from './attachment-store.js'
import type { AppOptions } from './http-options.js'

type AttachmentMeta = { id: string; name: string; type: string; size: number }

function badRequest(response: express.Response, code: string, message: string) {
  return response.status(400).json({ error: { code, message } })
}

export function attachAttachmentRoutes(app: Express, repository: DocumentRepository, store: AttachmentStore, options: AppOptions): void {
  const rawBody = express.raw({ type: () => true, limit: maxAttachmentBytes })

  app.put('/api/v1/documents/:documentId/attachments/:attachmentId', requireAccountBearer(repository, options.devToken), rawBody, (request: AuthenticatedRequest, response) => {
    const documentId = String(request.params.documentId)
    const attachmentId = String(request.params.attachmentId)
    if (!isSafeAttachmentId(documentId) || !isSafeAttachmentId(attachmentId)) return badRequest(response, 'INVALID_ATTACHMENT', '附件或导图 ID 无效')
    const document = repository.get(request.ownerId!, documentId)
    if (!document) return response.status(404).json({ error: { code: 'NOT_FOUND', message: '导图不存在或无权访问' } })
    const meta = collectAttachmentMeta(document.payload).find((item) => item.id === attachmentId)
    if (!meta) return badRequest(response, 'ATTACHMENT_NOT_IN_DOCUMENT', '附件元数据不在当前导图版本中；请先保存导图结构再上传字节')
    if (!allowedAttachmentTypes.has(meta.type)) return badRequest(response, 'UNSUPPORTED_TYPE', `不支持的附件类型：${meta.type}`)
    const bytes = request.body as Buffer
    if (!Buffer.isBuffer(bytes) || !bytes.byteLength) return badRequest(response, 'EMPTY_BODY', '附件内容为空')
    try {
      const saved = store.save(request.ownerId!, documentId, attachmentId, bytes)
      return response.status(201).json({ ok: true, attachmentId, size: saved.size, sha256: saved.sha256 })
    } catch (error) {
      return badRequest(response, 'ATTACHMENT_TOO_LARGE', error instanceof Error ? error.message : '附件写入失败')
    }
  })

  app.get('/api/v1/documents/:documentId/attachments/:attachmentId', requireAccountBearer(repository, options.devToken), (request: AuthenticatedRequest, response) => {
    const documentId = String(request.params.documentId)
    const attachmentId = String(request.params.attachmentId)
    if (!isSafeAttachmentId(documentId) || !isSafeAttachmentId(attachmentId)) return badRequest(response, 'INVALID_ATTACHMENT', '附件或导图 ID 无效')
    const document = repository.get(request.ownerId!, documentId)
    if (!document) return response.status(404).json({ error: { code: 'NOT_FOUND', message: '导图不存在或无权访问' } })
    const meta = collectAttachmentMeta(document.payload).find((item) => item.id === attachmentId)
    const bytes = store.get(request.ownerId!, documentId, attachmentId)
    if (!meta || !bytes) return response.status(404).json({ error: { code: 'ATTACHMENT_NOT_FOUND', message: '附件字节不存在' } })
    response.setHeader('content-type', meta.type)
    response.setHeader('cache-control', 'private, max-age=3600')
    response.setHeader('content-length', String(bytes.byteLength))
    return response.end(bytes)
  })
}
