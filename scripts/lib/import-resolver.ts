/**
 * 解析脚本中的 !import 指令并拆分为普通块与导入块。
 * 语法: !import moduleId[:scriptIndex]  (scriptIndex 为 1 基)
 *
 * @module import-resolver
 */

import type { ImportedModuleScript, ModuleOwnScript, ModuleRecord, ResolvedModuleScript } from './types.ts'

const importLineRe = /^\s*!import\s+([a-zA-Z0-9_-]+)(?::(\d+))?\s*$/
const MAX_DEPTH = 20

type ScriptLookupResult =
  | { script: ResolvedModuleScript; index1: number; error?: undefined }
  | { error: string; script?: undefined; index1?: undefined }

function getScriptObj(targetModule: ModuleRecord, index1?: number): ScriptLookupResult {
  const scriptsArr = targetModule.scripts || []
  if (!scriptsArr.length) return { error: '目标模块无脚本' }
  const idx = index1 != null ? index1 - 1 : 0
  if (idx < 0 || idx >= scriptsArr.length)
    return { error: `脚本索引越界 (模块 ${targetModule.id}, 共有 ${scriptsArr.length} 段)` }
  return { script: scriptsArr[idx], index1: idx + 1 }
}

/**
 * 递归展开导入内容（用于导入块内部），不生成折叠，仅替换为纯代码
 */
function fullyExpandContent(idMap: Map<string, ModuleRecord>, rawContent: string, stack: string[]): string {
  if (stack.length > MAX_DEPTH) {
    return '// 导入深度超过限制，可能存在循环\n'
  }
  const lines = rawContent.split(/\r?\n/)
  const out: string[] = []
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
    const nested = fullyExpandContent(idMap, targetScript.content, [...stack, key])
    out.push(nested.trimEnd())
  }
  return out.join('\n')
}

function importedScriptFailure(refId: string, content: string, fromName: string, fromIndex: number): ImportedModuleScript {
  return {
    imported: true,
    content,
    fromId: refId,
    fromName,
    fromIndex,
  }
}

function importedScriptSuccess(
  refId: string,
  content: string,
  fromName: string,
  fromIndex: number,
  fromScriptId?: string
): ImportedModuleScript {
  return {
    imported: true,
    content,
    fromId: refId,
    fromName,
    fromIndex,
    fromTitle: '',
    fromScriptId,
  }
}

export function resolveImports(modules: ModuleRecord[]): void {
  const idMap = new Map<string, ModuleRecord>(
    modules.flatMap((m) => (m.id ? ([[m.id, m]] as const) : []))
  )

  for (const mod of modules) {
    let modChanged = false // 仅用于内部判断（当前未输出日志）
    if (!mod.scripts) continue
    const newScripts: ResolvedModuleScript[] = []
    for (const original of mod.scripts) {
      const content = original.content || ''
      const lines = content.split(/\r?\n/)
      const leadingImports: ImportedModuleScript[] = []
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
          leadingImports.push(importedScriptFailure(refId, `// 导入失败: 未找到模块 ${refId}`, refId, specifiedIndex || 1))
          continue
        }
        const { script: targetScript, error, index1 } = getScriptObj(targetModule, specifiedIndex)
        if (error) {
          leadingImports.push(
            importedScriptFailure(refId, `// 导入失败: ${error}`, targetModule.name || refId, specifiedIndex || 1)
          )
          continue
        }
        const key = refId + ':' + index1
        const expanded = fullyExpandContent(idMap, targetScript.content, [(mod.id || 'unknown') + ':root', key])
        leadingImports.push(
          importedScriptSuccess(refId, expanded, targetModule.name || refId, index1, targetScript.id || undefined)
        )
      }
      let buffer: string[] = []
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
          const ownScript: ModuleOwnScript = {
            id: original.id,
            title: original.title,
            content: buffer.join('\n'),
            leadingImports: leadingImports.length ? leadingImports : undefined,
          }
          newScripts.push(ownScript)
          mainBlockAdded = true
          buffer = []
        }
        const refId = m[1]
        const specifiedIndex = m[2] ? parseInt(m[2], 10) : undefined
        const targetModule = idMap.get(refId)
        if (!targetModule) {
          newScripts.push(importedScriptFailure(refId, `// 导入失败: 未找到模块 ${refId}`, refId, specifiedIndex || 1))
          continue
        }
        const { script: targetScript, error, index1 } = getScriptObj(targetModule, specifiedIndex)
        if (error) {
          newScripts.push(
            importedScriptFailure(refId, `// 导入失败: ${error}`, targetModule.name || refId, specifiedIndex || 1)
          )
          continue
        }
        const key = refId + ':' + index1
        const expanded = fullyExpandContent(idMap, targetScript.content, [(mod.id || 'unknown') + ':root', key])
        newScripts.push(
          importedScriptSuccess(refId, expanded, targetModule.name || refId, index1, targetScript.id || undefined)
        )
      }
      // 收尾: 若正文块尚未添加，则现在添加（包含可能的 leadingImports）
      if (!mainBlockAdded) {
        const ownScript: ModuleOwnScript = {
          id: original.id,
          title: original.title,
          content: buffer.join('\n'),
          leadingImports: leadingImports.length ? leadingImports : undefined,
        }
        newScripts.push(ownScript)
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
