/**
 * 构建期 scratchblocks 脚本翻译：将英文源脚本翻译为指定语言，
 * 并替换变量/列表/事件/自定义块参数名称。
 *
 * @module script-translator
 */

import * as scratchblocks from 'scratchblocks-plus/syntax/index.js'

/**
 * 将 scratchblocks AST 中的变量/列表/事件/自定义块参数名称替换为目标语言
 */
export function translateScriptFields(blocks, nameMaps) {
  if (!blocks || !nameMaps) return
  blocks.forEach((block) => {
    if (block.isComment) return
    if (block.info.selector === 'readVariable' && nameMaps.vars) {
      block.children[0].value = nameMaps.vars[block.children[0].value] || block.children[0].value
      return
    }
    if (block.info.category === 'custom-arg' && nameMaps.params) {
      block.children[0].value = nameMaps.params[block.children[0].value] || block.children[0].value
      return
    }
    block.children.forEach((child) => {
      if (child instanceof scratchblocks.Script) {
        translateScriptFields(child.blocks, nameMaps)
        return
      } else if (child.isBlock) {
        translateScriptFields([child], nameMaps)
      }
      if (child.shape === 'dropdown' && !child.menu) {
        if (block.info.category === 'variables' && nameMaps.vars) {
          child.value = nameMaps.vars[child.value] || child.value
        } else if (block.info.category === 'lists' && nameMaps.lists) {
          child.value = nameMaps.lists[child.value] || child.value
        } else if (block.info.category === 'events' && nameMaps.events) {
          child.value = nameMaps.events[child.value] || child.value
        }
      }
    })
  })
}

/**
 * 将 scratchblocks 文本翻译为指定语言（构建期），并可替换变量/列表名称
 */
export function translateScriptText(raw, targetLangKey, nameMaps) {
  if (!raw) return raw
  const allKeys = Object.keys(scratchblocks.allLanguages || {})
  if (!allKeys.length) return raw
  const doc = scratchblocks.parse(raw, { languages: allKeys })
  const targetLang = scratchblocks.allLanguages[targetLangKey]
  if (!targetLang) return raw
  doc.translate(targetLang)
  doc.scripts.forEach((script) => {
    translateScriptFields(script.blocks, nameMaps)
  })
  const translated = doc.stringify()
  return translated
}
