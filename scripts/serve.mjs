import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'

/**
 * 零依赖静态服务器：把 dist/ 目录挂到 127.0.0.1 上，浏览器直接访问。
 * 用法：node scripts/serve.mjs [dir] [port]
 */
const root = normalize(process.argv[2] ?? 'dist')
const port = Number(process.argv[3] ?? 4173)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
}

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent((req.url ?? '/').split('?')[0])
    if (path === '/' || path === '') path = '/index.html'
    const file = normalize(join(root, path))
    if (!file.startsWith(root + sep) && file !== root) {
      res.writeHead(403).end('forbidden')
      return
    }
    const data = await readFile(file)
    res.writeHead(200, {
      'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    })
    res.end(data)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found')
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`serving ${root} → http://127.0.0.1:${port}`)
})
