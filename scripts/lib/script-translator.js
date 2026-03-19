/**
 * 构建期 scratchblocks 脚本翻译：将英文源脚本翻译为指定语言，
 * 并替换变量/列表/事件/自定义块参数名称。
 *
 * @module script-translator
 */

import * as scratchblocks from 'scratchblocks-plus/syntax/index.js'
import { blockName } from 'scratchblocks-plus/syntax/blocks.js'

/**
 * 从自定义块 children 构造英文 pattern。
 * Label 子节点贡献文字，非 label/icon/script 子节点（自定义参数块或参数值）贡献 %n 占位符。
 * @returns {{ pattern: string, argBlocks: Array }}
 */
function buildCustomBlockPattern(block) {
  const argBlocks = []
  const patternTokens = []
  for (const child of block.children) {
    if (child.isIcon) continue
    if (child.isLabel) {
      const text = (child.value || '').trim()
      if (text) patternTokens.push(text)
    } else if (!child.isScript) {
      argBlocks.push(child)
      patternTokens.push(`%${argBlocks.length}`)
    }
  }
  return {
    pattern: patternTokens.join(' ').replace(/\s+/g, ' ').trim(),
    argBlocks,
  }
}

/**
 * 根据本地化 pattern 重建块的 children，支持参数重排序。
 * pattern 格式：文字中以 %n（n≥1）标记参数占位，其余部分按空格拆分为 Label。
 */
function applyLocalizedPattern(block, localizedPattern, argBlocks) {
  const parts = localizedPattern.split(/(%\d+)/)
  const newChildren = []
  for (const part of parts) {
    const m = part.match(/^%(\d+)$/)
    if (m) {
      const idx = parseInt(m[1], 10) - 1
      if (idx >= 0 && argBlocks[idx]) newChildren.push(argBlocks[idx])
    } else {
      const words = part.trim().split(/\s+/).filter(Boolean)
      for (const word of words) newChildren.push(new scratchblocks.Label(word))
    }
  }
  if (newChildren.length > 0) block.children = newChildren
}

/**
 * 将 scratchblocks AST 中的变量/列表/事件/自定义块参数名称替换为目标语言
 */
export function translateScriptFields(blocks, nameMaps) {
  const missing = { missingProcs: new Set(), missingParams: new Set() }
  if (!blocks) return missing
  const mergeMissing = (m) => {
    m.missingProcs.forEach((p) => missing.missingProcs.add(p))
    m.missingParams.forEach((p) => missing.missingParams.add(p))
  }
  blocks.forEach((block) => {
    if (block.isComment) return
    if (block.info.selector === 'readVariable' && nameMaps?.vars) {
      const name = blockName(block)
      const translatedName = nameMaps.vars[name]
      if (translatedName) {
        block.children = [new scratchblocks.Label(translatedName)]
      }
      return
    }
    if (block.info.category === 'custom-arg') {
      const name = blockName(block)
      const translatedName = nameMaps?.params?.[name]
      if (translatedName) {
        block.children = [new scratchblocks.Label(translatedName)]
      } else if (name) {
        missing.missingParams.add(name)
      }
      return
    }
    if (block.isOutline) {
      // 过程定义块（prototype）：用 procs 映射重建 children，支持参数重排序
      const { pattern, argBlocks } = buildCustomBlockPattern(block)
      if (nameMaps?.procs) {
        const localized = nameMaps.procs[pattern]
        if (localized) {
          applyLocalizedPattern(block, localized, argBlocks)
        } else if (pattern) {
          missing.missingProcs.add(pattern)
        }
      } else if (pattern) {
        missing.missingProcs.add(pattern)
      }
      // 不 return：继续遍历 children 以翻译其中 custom-arg 块的参数名
    }
    if (block.info.id === 'PROCEDURES_CALL' && nameMaps?.procs) {
      // 自定义块调用：重建 children 标签，支持参数重排序
      const { pattern, argBlocks } = buildCustomBlockPattern(block)
      const localized = nameMaps.procs[pattern]
      if (localized) applyLocalizedPattern(block, localized, argBlocks)
      // 不 return：继续遍历 children 以翻译参数内部的变量名
    }
    block.children.forEach((child) => {
      if (child.isScript) {
        mergeMissing(translateScriptFields(child.blocks, nameMaps))
        return
      } else if (child.isBlock) {
        mergeMissing(translateScriptFields([child], nameMaps))
      }
      if (child.shape === 'dropdown' && !child.menu) {
        if (block.info.category === 'variables' && nameMaps?.vars) {
          child.value = nameMaps.vars[child.value] || child.value
        } else if (block.info.category === 'list' && nameMaps?.lists) {
          child.value = nameMaps.lists[child.value] || child.value
        } else if (block.info.category === 'events' && nameMaps?.events) {
          child.value = nameMaps.events[child.value] || child.value
        }
      }
    })
  })
  return missing
}

/**
 * 将 scratchblocks 文本翻译为指定语言（构建期），并可替换变量/列表名称
 */
export function translateScriptText(raw, targetLangKey, nameMaps) {
  if (!raw) return { text: raw, missingProcs: new Set(), missingParams: new Set() }
  const allKeys = Object.keys(scratchblocks.allLanguages || {})
  if (!allKeys.length) return { text: raw, missingProcs: new Set(), missingParams: new Set() }
  const doc = scratchblocks.parse(raw, { languages: allKeys })
  const targetLang = scratchblocks.allLanguages[targetLangKey]
  if (!targetLang) return { text: raw, missingProcs: new Set(), missingParams: new Set() }
  doc.translate(targetLang)
  const missingProcs = new Set()
  const missingParams = new Set()
  doc.scripts.forEach((script) => {
    const m = translateScriptFields(script.blocks, nameMaps)
    m.missingProcs.forEach((p) => missingProcs.add(p))
    m.missingParams.forEach((p) => missingParams.add(p))
  })
  return { text: doc.stringify(), missingProcs, missingParams }
}
