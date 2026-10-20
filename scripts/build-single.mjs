import { build } from 'vite'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * 打包成单个自包含 HTML（demo.html）：双击即用，不需要 node / 服务器 / 网络。
 * 步骤：关闭代码分割 → 内联 CSS → 清除所有外部脚本标签 → 注入唯一一份 bundle。
 */
const OUT = 'dist-single'

await rm(OUT, { recursive: true, force: true })

await build({
  configFile: false,
  logLevel: 'warn',
  build: {
    outDir: OUT,
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 1_000_000_000,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'app.js',
        assetFileNames: 'app.[ext]',
      },
    },
  },
})

const readOut = (rel) => readFile(join(OUT, rel.replace(/^\//, '')), 'utf8')

let html = await readFile(join(OUT, 'index.html'), 'utf8')

// 1) 内联样式表
for (const m of [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*>/g)]) {
  const href = /href="([^"]+)"/.exec(m[0])?.[1]
  if (!href) continue
  const css = await readOut(href)
  html = html.split(m[0]).join(`<style>\n${css}\n</style>`)
}

// 2) 找到 bundle 路径（所有 script 标签应指向同一个入口）
const scriptTags = [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g)].map((m) => m[0])
const entry = scriptTags.length > 0 ? /src="([^"]+)"/.exec(scriptTags[0])?.[1] : null
if (!entry) throw new Error('未找到入口脚本，构建产物结构异常')

const js = await readOut(entry)
const safeJs = js.replace(/<\/script>/gi, '<\\/script>')

// 3) 清除所有外部脚本标签与 modulepreload（重复标签一并去掉）
for (const tag of new Set(scriptTags)) html = html.split(tag).join('')
html = html.replace(/<link[^>]*rel="modulepreload"[^>]*>/g, '')

// 4) 注入唯一一份内联脚本
const inlineTag = `<script type="module">\n${safeJs}\n</script>`
html = html.includes('</body>')
  ? html.replace('</body>', `${inlineTag}\n</body>`)
  : `${html}\n${inlineTag}`

await writeFile('demo.html', html)

// 5) 自检：挖空内联内容后，HTML 壳里不应残留任何外部引用
const shell = html
  .replace(/<script[\s\S]*?<\/script>/gi, '<script></script>')
  .replace(/<style[\s\S]*?<\/style>/gi, '<style></style>')
const leftovers = [...shell.matchAll(/(?:src|href)="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((u) => !u.startsWith('data:') && !u.startsWith('#'))

console.log(`demo.html: ${(html.length / 1024).toFixed(0)} KB，清除重复脚本标签 ${scriptTags.length - 1} 个`)
console.log(`外部引用: ${leftovers.length === 0 ? '无（完全自包含）' : leftovers.join(' | ')}`)
if (leftovers.length > 0) process.exitCode = 1
