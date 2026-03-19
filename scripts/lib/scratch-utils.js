import fs from 'fs-extra'
import path from 'path'
import * as scratchblocks from 'scratchblocks-plus/syntax/index.js'

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

/**
 * Scratch 3.0 标准积木类别颜色（取自 scratchblocks-plus/scratch3/style.css.js）
 */
export const CATEGORY_COLORS = {
  motion: '#4c97ff',
  looks: '#9966ff',
  sound: '#cf63cf',
  control: '#ffab19',
  events: '#ffbf00',
  sensing: '#5cb1d6',
  operators: '#59c059',
  variables: '#ff8c1a',
  list: '#ff661a',
  custom: '#ff6680',
  extension: '#0fbd8c',
}

/**
 * 统计 scratchblocks 脚本文本中各积木类别的出现次数。
 * 解析所有脚本并递归遍历 AST，统计 block.info.category。
 *
 * @param {string[]} scriptTexts 所有脚本文本数组
 * @returns {{ category: string, count: number, color: string }[]} 按数量降序排列
 */
export function analyzeBlockCategories(scriptTexts) {
  const allKeys = Object.keys(scratchblocks.allLanguages || {})
  const counts = {}

  function walkBlocks(blocks) {
    if (!blocks) return
    for (const block of blocks) {
      if (block.isComment) continue
      const cat = block.info?.category
      counts[cat] = (counts[cat] || 0) + 1
      if (block.info?.id === 'PROCEDURES_DEFINITION') continue // 定义积木内的块（outline 和 custom-arg）不计入类别统计
      if (block.children) {
        for (const child of block.children) {
          if (child.isScript) {
            walkBlocks(child.blocks)
          } else if (child.isBlock) {
            walkBlocks([child])
          }
        }
      }
    }
  }

  for (const text of scriptTexts) {
    if (!text) continue
    try {
      const doc = scratchblocks.parse(text, { languages: allKeys })
      for (const script of doc.scripts) {
        walkBlocks(script.blocks)
      }
    } catch {
      // 解析失败时跳过该脚本
    }
  }

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => ({
      category,
      count,
      color: CATEGORY_COLORS[category],
    }))
    .filter((c) => c.color) // 排除没有定义颜色的类别
}

export function loadScratchblocksLanguages() {
  const localesDir = path.join(root, 'node_modules', 'scratchblocks-plus', 'locales')
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
