/**
 * 解析脚本中的 !import 指令并拆分为普通块与导入块。
 * 语法: !import moduleId[:scriptIndex]  (scriptIndex 为 1 基)
 *
 * @module import-resolver
 */

const importLineRe = /^\s*!import\s+([a-zA-Z0-9_-]+)(?::(\d+))?\s*$/
const MAX_DEPTH = 20

function getScriptObj(targetModule, index1) {
  let scriptsArr = []
  if (targetModule.scripts && targetModule.scripts.length) {
    scriptsArr = targetModule.scripts
  } else if (targetModule.script) {
    scriptsArr = [{ id: 'main', title: '', content: targetModule.script }]
  }
  if (!scriptsArr.length) return { error: '目标模块无脚本' }
  const idx = index1 != null ? index1 - 1 : 0
  if (idx < 0 || idx >= scriptsArr.length)
    return { error: `脚本索引越界 (模块 ${targetModule.id}, 共有 ${scriptsArr.length} 段)` }
  return { script: scriptsArr[idx], index1: idx + 1 }
}

/**
 * 递归展开导入内容（用于导入块内部），不生成折叠，仅替换为纯代码
 */
function fullyExpandContent(idMap, moduleId, rawContent, stack) {
  if (stack.length > MAX_DEPTH) {
    return '// 导入深度超过限制，可能存在循环\n'
  }
  const lines = rawContent.split(/\r?\n/)
  const out = []
  for (const line of lines) {
    const m = line.match(importLineRe)
    if (!m) {
      out.push(line)
      continue
    }
    const refId = m[1]
    const specifiedIndex = m[2] ? parseInt(m[2], 10) : undefined
    const key = refId + ':' + (specifiedIndex || 1)
    if (stack.includes(key)) {
      out.push(`// 循环引用: ${[...stack, key].join(' -> ')}`)
      continue
    }
    const targetModule = idMap.get(refId)
    if (!targetModule) {
      out.push(`// 导入失败: 未找到模块 ${refId}`)
      continue
    }
    const { script: targetScript, error } = getScriptObj(targetModule, specifiedIndex)
    if (error) {
      out.push(`// 导入失败: ${error}`)
      continue
    }
    const nested = fullyExpandContent(idMap, targetModule.id, targetScript.content, [
      ...stack,
      key,
    ])
    out.push(nested.trimEnd())
  }
  return out.join('\n')
}

export function resolveImports(modules) {
  const idMap = new Map(modules.map((m) => [m.id, m]))

  for (const mod of modules) {
    let modChanged = false // 仅用于内部判断（当前未输出日志）
    // 标准化为 scripts 数组
    if ((!mod.scripts || !mod.scripts.length) && mod.script) {
      mod.scripts = [{ id: 'main', title: '', content: mod.script }]
    }
    if (!mod.scripts) continue
    const newScripts = []
    let seq = 0
    for (const original of mod.scripts) {
      const content = original.content || ''
      const lines = content.split(/\r?\n/)
      const leadingImports = []
      let i = 0
      // 收集顶部连续 import
      for (; i < lines.length; i++) {
        const mTop = lines[i].match(importLineRe)
        if (!mTop) break
        modChanged = true
        const refId = mTop[1]
        const specifiedIndex = mTop[2] ? parseInt(mTop[2], 10) : undefined
        const targetModule = idMap.get(refId)
        if (!targetModule) {
          leadingImports.push({
            imported: true,
            content: `// 导入失败: 未找到模块 ${refId}`,
            fromId: refId,
            fromName: refId,
            fromIndex: specifiedIndex || 1,
          })
          continue
        }
        const { script: targetScript, error, index1 } = getScriptObj(targetModule, specifiedIndex)
        if (error) {
          leadingImports.push({
            imported: true,
            content: `// 导入失败: ${error}`,
            fromId: refId,
            fromName: targetModule.name || refId,
            fromIndex: specifiedIndex || 1,
          })
          continue
        }
        const key = refId + ':' + index1
        const expanded = fullyExpandContent(idMap, targetModule.id, targetScript.content, [
          mod.id + ':root',
          key,
        ])
        leadingImports.push({
          imported: true,
          content: expanded,
          fromId: refId,
          fromName: targetModule.name || refId,
          fromIndex: index1,
          fromTitle: '',
          fromScriptId: targetScript.id || undefined,
        })
      }
      let buffer = []
      let mainBlockAdded = false
      for (; i < lines.length; i++) {
        const line = lines[i]
        const m = line.match(importLineRe)
        if (!m) {
          buffer.push(line)
          continue
        }
        modChanged = true
        // 遇到正文中的 import
        if (!mainBlockAdded) {
          newScripts.push({
            id: original.id,
            title: original.title,
            content: buffer.join('\n'),
            leadingImports: leadingImports.length ? leadingImports : undefined,
          })
          mainBlockAdded = true
          buffer = []
        }
        const refId = m[1]
        const specifiedIndex = m[2] ? parseInt(m[2], 10) : undefined
        const targetModule = idMap.get(refId)
        if (!targetModule) {
          newScripts.push({
            imported: true,
            content: `// 导入失败: 未找到模块 ${refId}`,
            fromId: refId,
            fromName: refId,
            fromIndex: specifiedIndex || 1,
          })
          continue
        }
        const { script: targetScript, error, index1 } = getScriptObj(targetModule, specifiedIndex)
        if (error) {
          newScripts.push({
            imported: true,
            content: `// 导入失败: ${error}`,
            fromId: refId,
            fromName: targetModule.name || refId,
            fromIndex: specifiedIndex || 1,
          })
          continue
        }
        const key = refId + ':' + index1
        const expanded = fullyExpandContent(idMap, targetModule.id, targetScript.content, [
          mod.id + ':root',
          key,
        ])
        newScripts.push({
          imported: true,
          content: expanded,
          fromId: refId,
          fromName: targetModule.name || refId,
          fromIndex: index1,
          fromTitle: '',
          fromScriptId: targetScript.id || undefined,
        })
      }
      // 收尾: 若正文块尚未添加，则现在添加（包含可能的 leadingImports）
      if (!mainBlockAdded) {
        newScripts.push({
          id: original.id,
          title: original.title,
          content: buffer.join('\n'),
          leadingImports: leadingImports.length ? leadingImports : undefined,
        })
      } else if (buffer.length) {
        // mainBlock 已添加，还有尾部代码
        newScripts.push({ id: undefined, title: '', content: buffer.join('\n') })
      }
      if (!modChanged) {
        // 没有任何 import，保持原对象
        if (
          newScripts.length &&
          newScripts[newScripts.length - 1].content === original.content &&
          !newScripts[newScripts.length - 1].leadingImports
        ) {
          // nothing
        }
      }
    }
    mod.scripts = newScripts
    // modChanged 目前不做输出
  }
}
