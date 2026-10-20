import { readFile } from 'node:fs/promises'

/**
 * 校验 demo.html 是否真正自包含：
 * 先把内联的 <script>/<style> 内容挖空，只看 HTML 壳里还剩哪些外部引用。
 */
const html = await readFile('demo.html', 'utf8')

const shell = html
  .replace(/<script[\s\S]*?<\/script>/gi, '<script></script>')
  .replace(/<style[\s\S]*?<\/style>/gi, '<style></style>')

const refs = [...shell.matchAll(/(?:src|href)="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((u) => !u.startsWith('data:') && !u.startsWith('#'))

const kb = (html.length / 1024).toFixed(0)
console.log(`文件大小: ${kb} KB`)
console.log(`HTML 壳外部引用: ${refs.length === 0 ? '无（完全自包含）' : refs.join(' | ')}`)
console.log(`内联 module 脚本: ${/<script type="module">/.test(html) ? '有' : '无'}`)
console.log(`<script> 标签数: ${(html.match(/<script/gi) ?? []).length}`)
console.log(`<style> 标签数: ${(html.match(/<style/gi) ?? []).length}`)
console.log(`残留 modulepreload: ${/modulepreload/.test(shell) ? '有' : '无'}`)
