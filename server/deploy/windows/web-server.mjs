import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(process.env.MINDTREE_WEB_ROOT || join(fileURLToPath(new URL('.', import.meta.url)), 'web'))
const host = process.env.MINDTREE_WEB_HOST || '0.0.0.0'
const port = Number(process.env.MINDTREE_WEB_PORT || 81)
const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.woff2', 'font/woff2'],
])

function resolveRequestPath(rawUrl = '/') {
  const pathname = decodeURIComponent(new URL(rawUrl, 'http://127.0.0.1').pathname)
  const relative = normalize(pathname).replace(/^([/\\])+/, '')
  const candidate = resolve(root, relative || 'index.html')
  if (candidate !== root && !candidate.startsWith(`${root}\\`) && !candidate.startsWith(`${root}/`)) return null
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  return join(root, 'index.html')
}

createServer((request, response) => {
  const filePath = resolveRequestPath(request.url)
  if (!filePath || !existsSync(filePath)) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Not found')
    return
  }
  const immutable = filePath.includes(`${join(root, 'assets')}\\`) || filePath.includes(`${join(root, 'assets')}/`)
  response.writeHead(200, {
    'content-type': mimeTypes.get(extname(filePath).toLowerCase()) || 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin',
    'x-frame-options': 'DENY',
  })
  if (request.method === 'HEAD') return response.end()
  createReadStream(filePath).pipe(response)
}).listen(port, host, () => {
  console.log(`MindTree web listening on http://${host}:${port}, root=${root}`)
})
