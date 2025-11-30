import fs from 'fs-extra'
import path from 'path'
import * as scratchblocks from 'scratchblocks/syntax/index.js'

const root = path.resolve('.')

export function tokenizeCJK(text) {
  if (!text) return []
  const baseTokens = text.match(/[\p{L}\p{N}\p{M}\p{Pc}\-']+/gu) || []
  const out = []
  for (const tok of baseTokens) {
    out.push(tok)
    if (/^[\u4e00-\u9fff]+$/.test(tok) && tok.length > 1) {
      const chars = Array.from(tok)
      for (const c of chars) out.push(c)
      for (let i = 0; i < chars.length - 1; i++) {
        out.push(chars[i] + chars[i + 1])
      }
    }
  }
  return Array.from(new Set(out))
}

export function loadScratchblocksLanguages() {
  const localesDir = path.join(root, 'node_modules', 'scratchblocks', 'locales')
  try {
    const files = fs.readdirSync(localesDir)
    files.forEach((file) => {
      if (!file.endsWith('.json')) return
      const fullPath = path.join(localesDir, file)
      const langKey = path.basename(file, '.json').replace('-', '_').toLowerCase()
      try {
        const data = fs.readFileSync(fullPath, 'utf8')
        const obj = JSON.parse(data)
        scratchblocks.loadLanguages({ [langKey]: obj })
      } catch (e) {
        // 在构建脚本中再决定是否记录 warning
      }
    })
  } catch (e) {
    // 在调用方中处理错误/告警
  }
}
