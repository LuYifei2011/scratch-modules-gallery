/**
 * 多语言翻译引擎：将模块数据翻译为指定语言的本地化副本。
 *
 * 职责：
 * - 元信息本地化（name, description, tags, keywords, notes）
 * - 变量/列表/事件名称映射
 * - 自定义块 pattern 与参数本地化（方案A：英文源 → 本地化 pattern）
 * - scratchblocks 脚本内容翻译（通过回调注入）
 * - 缺失翻译检测（开发模式）
 *
 * @module i18n-engine
 */

import { markdownToHtml } from './markdown.js'
import log from './logger.js'

// ── 内部辅助函数 ──────────────────────────────────────────

function escapeProcReg(str = '') {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 构造当前语言下的变量/列表/事件名称映射（原名 -> 本地化名）
 */
function buildNameMapsForModule(mod, localePriority) {
  const per = mod.translations || {}
  const maps = { vars: {}, lists: {}, events: {} }

  function pickByPriority(fieldName, key) {
    for (const loc of localePriority) {
      const map = per[loc]?.[fieldName]
      if (map && map[key]) return map[key]
    }
    return null
  }

  const varsArr = Array.isArray(mod.variables) ? mod.variables : []
  for (const v of varsArr) {
    if (!v || !v.name) continue
    const fieldName = v.type === 'list' ? 'lists' : 'variables'
    const mapped = pickByPriority(fieldName, v.name)
    if (mapped) {
      if (v.type === 'list') {
        maps.lists[v.name] = mapped
      } else {
        maps.vars[v.name] = mapped
      }
    }
  }

  // 事件名称映射：直接按优先顺序合并（不做键过滤）
  for (const loc of localePriority) {
    const eventMap = per[loc]?.events
    if (eventMap && typeof eventMap === 'object') {
      for (const k of Object.keys(eventMap)) {
        if (!(k in maps.events)) {
          maps.events[k] = eventMap[k]
        }
      }
    }
  }
  if (
    !Object.keys(maps.vars).length &&
    !Object.keys(maps.lists).length &&
    !Object.keys(maps.events).length
  )
    return undefined
  return maps
}

/**
 * 构造当前语言的自定义块与其参数映射（方案A：以英文源为 key，_ 占位参数）
 */
function buildProcedureMaps(mod, localePriority) {
  const per = mod.translations || {}
  const procMap = (() => {
    for (const loc of localePriority) {
      const map = per[loc]?.procedures
      if (map && typeof map === 'object') return map
    }
    return null
  })()
  const paramMap = (() => {
    for (const loc of localePriority) {
      const map = per[loc]?.procedureParams
      if (map && typeof map === 'object') return map
    }
    return null
  })()
  if (!procMap && !paramMap) return undefined
  return { procMap, paramMap }
}

/**
 * 进行文本层本地化：替换 define 行与调用行；然后替换参数槽名称
 */
function localizeProcedures(raw, procMaps) {
  if (!raw || !procMaps) return raw
  let out = raw
  const { procMap, paramMap } = procMaps
  if (procMap && typeof procMap === 'object') {
    // 先按 key 长度降序，避免前缀冲突
    const entries = Object.entries(procMap).sort((a, b) => b[0].length - a[0].length)
    for (const [englishPattern, localizedPattern] of entries) {
      // 本地化文案缺失时，保留原始英文 pattern
      if (typeof localizedPattern !== 'string' || !localizedPattern.trim()) {
        continue
      }
      // 拆分英文 pattern 获取占位符数量（_ 表示一个参数括号）
      const parts = englishPattern.split('_')
      const slotCount = parts.length - 1
      if (slotCount <= 0) continue
      const localizedSlots = (localizedPattern.match(/_/g) || []).length
      if (localizedSlots !== slotCount) {
        log.warn(
          'procedures',
          `本地化占位符数量不匹配: pattern="${englishPattern}" slots=${slotCount} localizedSlots=${localizedSlots}`
        )
        // 占位符数量不匹配会破坏脚本结构，回退到原始内容
        continue
      }
      // placeholder 捕获一个 custom-arg 括号，允许内部出现 :: custom-arg 及任意非换行内容
      const placeholder = '\\s*(\\([^\n]*?\\))\\s*'
      // 构造 core 正则主体：各静态片段之间用捕获组
      const core = parts.map((p) => escapeProcReg(p)).join(placeholder)
      let reDef, reCall
      try {
        reDef = new RegExp('^define\\s+' + core + '$', 'gm')
        reCall = new RegExp('(^|\n)' + core + '(?=\n|$)', 'g')
      } catch (e) {
        log.warn('procedures', `构造正则失败: ${englishPattern} ${e?.message || e}`)
        continue
      }

      function rebuildLocalized(captures) {
        let idx = 0
        // 依次把 '_' 替换为对应 capture
        return localizedPattern.replace(/_/g, () => {
          const rep = captures[idx++]
          return rep || '_'
        })
      }

      // 处理 define 行
      out = out.replace(reDef, (full, ...groups) => {
        // groups = capturedSlots + (last two are offset & input per JS replace spec)
        const pure = groups.slice(0, slotCount)
        return 'define ' + rebuildLocalized(pure)
      })
      // 处理调用行
      out = out.replace(reCall, (full, prefix, ...rest) => {
        const captures = rest.slice(0, slotCount)
        return prefix + rebuildLocalized(captures)
      })
    }
  }
  return out
}

/**
 * 从原始脚本源码中自动提取 procedures / procedureParams 基准
 * 规则：匹配 "define xxx" 行；用 '_' 代替每个括号参数；括号内内容视为参数英文名
 */
function extractProceduresFromScripts(originalMod) {
  const patterns = new Set(),
    params = new Set()
  const scriptsArr = Array.isArray(originalMod.scripts) ? originalMod.scripts : []
  for (const sc of scriptsArr) {
    if (!sc || !sc.content) continue
    const lines = sc.content.split(/\r?\n/)
    for (const line of lines) {
      const mDef = line.match(/^define\s+(.+)$/)
      if (!mDef) continue
      const body = mDef[1].trim()
      // 抽取参数：() 内的内容（非贪婪）
      const paramParts = [...body.matchAll(/\(([^)]*)\)/g)]
      for (const p of paramParts) {
        const name = (p[1] || '').trim()
        if (name) params.add(name)
      }
      let pattern = body
        .replace(/\([^)]*\)/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
      if (pattern) patterns.add(pattern)
    }
  }
  return { patterns, params }
}

// ── 主导出函数 ────────────────────────────────────────────

/**
 * 针对某语言，返回带有已翻译脚本内容与元信息本地化的 modules 副本。
 *
 * @param {Array} modules - 原始模块数组
 * @param {Object} dict - 全局 i18n 字典（locale → translations）
 * @param {string} locale - 目标语言代码
 * @param {Object} [globalTags={}] - 全局 tags 翻译字典
 * @param {Object} [options={}] - 选项（skipMissingCheck 等）
 * @param {Object} [callbacks={}] - 回调函数
 * @param {Function} [callbacks.translateScriptText] - scratchblocks 文本翻译函数 (raw, langKey, nameMaps) => string
 * @param {Function} [callbacks.reportIssue] - 构建问题上报函数 (type, message, details) => void
 * @returns {Promise<Array>} 本地化后的模块副本数组
 */
export async function translateModulesForLocale(
  modules,
  dict,
  locale,
  globalTags = {},
  options = {},
  callbacks = {}
) {
  const { translateScriptText, reportIssue } = callbacks

  const languageTag = (dict[locale]?.meta?.languageTag || locale || 'en')
    .replace('-', '_')
    .toLowerCase()
  const isEnglishLocale = locale === 'en' || languageTag.startsWith('en')

  // 生成语言优先级顺序：CJK 语言之间互相回退；非 CJK 语言只查自身（+ en），
  // 最终兜底永远是 meta.json 原始值（pickStr / pickArr 末尾的 nm[base]）。
  const getLocalePriority = () => {
    if (locale === 'zh-tw') return ['zh-tw', 'zh-cn', 'en']
    if (locale === 'zh-cn') return ['zh-cn', 'zh-tw', 'en']
    if (locale === 'en') return ['en']
    return [locale, 'en']
  }
  const localePriority = getLocalePriority()

  const out = []

  for (const m of modules) {
    const nm = { ...m }
    const per = m.translations || {}
    const enScriptTitles = m.scriptTitles || {}
    function pickStr(base, map) {
      for (const loc of localePriority) {
        const val = per[loc]?.[base] ?? (map && map[loc])
        if (val) return val
      }
      return nm[base]
    }
    function pickArr(base, map) {
      for (const loc of localePriority) {
        const val = per[loc]?.[base] ?? (map && map[loc])
        if (val) return val
      }
      return nm[base]
    }
    function pickKeywords(base, map) {
      const val = pickArr(base, map)
      return Array.isArray(val) ? val : []
    }
    function pickTitleForScript(scriptId, index1) {
      // 按优先级查找脚本标题
      for (const loc of localePriority) {
        const titles = per[loc]?.scriptTitles
        if (titles && titles[scriptId]) return titles[scriptId]
      }
      // 回退到元信息中的英文权威标题
      if (enScriptTitles[scriptId]) return enScriptTitles[scriptId]
      // 最后的默认值
      return scriptId || (index1 != null ? '#' + index1 : '')
    }
    if (m.name_i18n || per[locale] || per['en'] || per['zh-cn'] || per['zh-tw']) {
      nm.name = pickStr('name', m.name_i18n)
    }
    if (m.description_i18n || per[locale] || per['en'] || per['zh-cn'] || per['zh-tw']) {
      nm.description = pickStr('description', m.description_i18n)
    }
    const tv = pickArr('tags', m.tags_i18n)
    if (Array.isArray(tv)) {
      // 使用全局 tags 字典翻译 tags
      nm.tags = tv.map((tag) => {
        if (globalTags[tag] && globalTags[tag][locale]) {
          return globalTags[tag][locale]
        }
        return tag
      })
    }
    const kw = pickKeywords('keywords', m.keywords_i18n)
    if (Array.isArray(kw)) nm.keywords = kw

    // notes: 按语言优先级从 notesMap 中选取，实时转换为 HTML
    if (m.notesMap && typeof m.notesMap === 'object' && Object.keys(m.notesMap).length) {
      let rawNotes = null
      for (const loc of localePriority) {
        if (m.notesMap[loc]) {
          rawNotes = m.notesMap[loc]
          break
        }
      }
      nm.notesHtml = rawNotes ? markdownToHtml(rawNotes) : ''
    } else {
      nm.notesHtml = ''
    }

    const ownNameMaps = buildNameMapsForModule(m, localePriority)
    // 为"变量 / 列表"表格计算本地化显示名称（模块级，始终执行）
    if (Array.isArray(nm.variables) && nm.variables.length) {
      const maps = ownNameMaps || { vars: {}, lists: {} }
      nm.variables = nm.variables.map((v) => {
        try {
          const isList = String(v?.type) === 'list'
          const origName = v?.name || ''
          const mapped = isList ? maps.lists?.[origName] : maps.vars?.[origName]
          // displayName 仅用于展示，不改变原始 name
          return { ...v, displayName: mapped || origName }
        } catch {
          return { ...v }
        }
      })
    }
    if (Array.isArray(m.scripts) && m.scripts.length) {
      const newScripts = []
      for (let si = 0; si < m.scripts.length; si++) {
        const s = m.scripts[si]
        const ns = { ...s }
        try {
          if (isEnglishLocale) {
            // 英文环境：不做翻译（要求脚本源为英文）
            ns.content = s.content
          } else {
            let mapsForThis = ownNameMaps
            let targetForProc
            if (s.imported && s.fromId) {
              targetForProc = modules.find((x) => x.id === s.fromId)
              if (targetForProc)
                mapsForThis = buildNameMapsForModule(targetForProc, localePriority) || mapsForThis
            }
            const procMaps = buildProcedureMaps(targetForProc || m, localePriority)
            if (procMaps && procMaps.paramMap) {
              mapsForThis = mapsForThis || {}
              mapsForThis.params = procMaps.paramMap
            }
            // 先做过程标题文本替换（基于英文模式），避免后续 scratchblocks 翻译改变关键字导致匹配失败
            const preLocalized = localizeProcedures(s.content, procMaps)
            // 再进行 AST 翻译与参数本地化（参数由 translateScriptFields 处理）
            if (translateScriptText) {
              const translated = translateScriptText(preLocalized, languageTag, mapsForThis)
              // 若翻译阶段未匹配到有效结果，回退到预处理后的原文
              ns.content =
                typeof translated === 'string' && translated.trim() ? translated : preLocalized
            } else {
              ns.content = preLocalized
            }
          }
        } catch (e) {
          log.warn('translate', `翻译失败 ${m.id} "${s.title}": ${e?.message || e}`)
        }
        // 标题本地化（自身脚本）
        if (!s.imported) {
          ns.title = pickTitleForScript(s.id, si + 1)
        }
        if (Array.isArray(s.leadingImports) && s.leadingImports.length) {
          const arr = []
          for (const imp of s.leadingImports) {
            let localizedFromName = imp.fromName
            const target = modules.find((x) => x.id === imp.fromId)
            if (target) {
              const perT = target.translations || {}
              const nameMap = target.name_i18n || {}
              for (const loc of localePriority) {
                const name = perT[loc]?.name ?? nameMap[loc]
                if (name) {
                  localizedFromName = name
                  break
                }
              }
              if (!localizedFromName) {
                localizedFromName = target.name
              }
            }
            const mapsImported = isEnglishLocale
              ? undefined
              : target
                ? buildNameMapsForModule(target, localePriority)
                : undefined
            arr.push({
              ...imp,
              content: isEnglishLocale
                ? imp.content
                : (function () {
                    const procMaps = buildProcedureMaps(target || m, localePriority)
                    let mf = mapsImported
                    if (procMaps && procMaps.paramMap) {
                      mf = mf || {}
                      mf.params = procMaps.paramMap
                    }
                    const preLocalized = localizeProcedures(imp.content, procMaps)
                    const translated = translateScriptText
                      ? translateScriptText(preLocalized, languageTag, mf)
                      : preLocalized
                    if (typeof translated !== 'string' || !translated.trim()) {
                      return preLocalized
                    }
                    return translated
                  })(),
              fromName: localizedFromName,
              fromTitle:
                imp.fromScriptId && target
                  ? (function () {
                      const enTitles = target.scriptTitles || {}
                      const perT = target.translations || {}
                      for (const loc of localePriority) {
                        const titles = perT[loc]?.scriptTitles
                        if (titles && titles[imp.fromScriptId]) return titles[imp.fromScriptId]
                      }
                      return enTitles[imp.fromScriptId] || imp.fromScriptId
                    })()
                  : imp.fromTitle,
            })
          }
          ns.leadingImports = arr
        }
        // 被导入块（非 leadingImports）
        if (s.imported && s.fromId && s.fromScriptId) {
          const target = modules.find((x) => x.id === s.fromId)
          if (target) {
            const enTitles = target.scriptTitles || {}
            const perT = target.translations || {}
            for (const loc of localePriority) {
              const titles = perT[loc]?.scriptTitles
              if (titles && titles[s.fromScriptId]) {
                ns.fromTitle = titles[s.fromScriptId]
                break
              }
            }
            if (!ns.fromTitle) {
              ns.fromTitle = enTitles[s.fromScriptId] || s.fromScriptId
            }
          }
        }
        newScripts.push(ns)
      }
      nm.scripts = newScripts
    }
    // --- 缺失翻译检测（仅非英文 locale，且未跳过） ---
    if (!isEnglishLocale && !options.skipMissingCheck) {
      try {
        const missingFields = []
        const locTrans = per[locale] || {}
        if (!('name' in locTrans)) missingFields.push('name')
        if (!('description' in locTrans)) missingFields.push('description')
        // tags 由全局 tags.json 管理，不需检查模块级翻译
        // 脚本标题
        const scriptIds = Array.isArray(m.scripts) ? m.scripts.map((x) => x.id).filter(Boolean) : []
        if (scriptIds.length) {
          const locTitles = locTrans.scriptTitles || {}
          const missingTitleIds = scriptIds.filter((id) => !(id in locTitles))
          if (missingTitleIds.length)
            missingFields.push(
              'scriptTitles(' +
                missingTitleIds.slice(0, 5).join(',') +
                (missingTitleIds.length > 5 ? '…' : '') +
                ')'
            )
        }
        // 变量/列表
        if (Array.isArray(m.variables) && m.variables.length) {
          const varsNames = m.variables
            .filter((v) => v && v.name && v.type !== 'list')
            .map((v) => v.name)
          const listNames = m.variables
            .filter((v) => v && v.name && v.type === 'list')
            .map((v) => v.name)
          const locVarMap = locTrans.variables || {}
          const locListMap = locTrans.lists || {}
          const missVars = varsNames.filter((n) => !(n in locVarMap))
          const missLists = listNames.filter((n) => !(n in locListMap))
          if (missVars.length)
            missingFields.push(
              'variables(' + missVars.slice(0, 5).join(',') + (missVars.length > 5 ? '…' : '') + ')'
            )
          if (missLists.length)
            missingFields.push(
              'lists(' + missLists.slice(0, 5).join(',') + (missLists.length > 5 ? '…' : '') + ')'
            )
        }
        // 自定义块 pattern 与参数
        let enProc = (per['en'] && per['en'].procedures) || undefined
        let enParams = (per['en'] && per['en'].procedureParams) || undefined
        if (!enProc || typeof enProc !== 'object') {
          const extracted = extractProceduresFromScripts(m)
          if (extracted.patterns.size) {
            enProc = {}
            extracted.patterns.forEach((p) => (enProc[p] = p))
          }
          if (!enParams || typeof enParams !== 'object') {
            if (extracted.params.size) {
              enParams = {}
              extracted.params.forEach((p) => (enParams[p] = p))
            }
          }
        }
        if (enProc && typeof enProc === 'object') {
          const locProc = locTrans.procedures || {}
          const missProc = Object.keys(enProc).filter((k) => !(k in locProc))
          if (missProc.length) {
            missingFields.push(
              'procedures(' +
                missProc.slice(0, 3).join(',') +
                (missProc.length > 3 ? '…' : '') +
                ')'
            )
          }
        }
        if (enParams && typeof enParams === 'object') {
          const locParams = locTrans.procedureParams || {},
            missParam = Object.keys(enParams).filter((k) => !(k in locParams))
          if (missParam.length) {
            missingFields.push(
              'procedureParams(' +
                missParam.slice(0, 3).join(',') +
                (missParam.length > 3 ? '…' : '') +
                ')'
            )
          }
        }
        if (missingFields.length) {
          const msg = `模块 ${m.id} 在 ${locale} 语言下缺失翻译字段`
          log.warn('i18n-missing', `[${locale}] ${m.id}: ` + missingFields.join(', '))
          if (reportIssue) {
            reportIssue('warn', msg, {
              moduleId: m.id,
              locale,
              code: 'i18n-missing',
              fields: missingFields,
            })
          }
        }
      } catch (e) {
        log.warn('i18n-missing', `检测失败 ${m.id}: ${e?.message || e}`)
      }
    }
    // 计算去重后的 keywords 和 tags 合并
    {
      const seen = new Set()
      const final = []
      const kws = Array.isArray(nm.keywords) ? nm.keywords : []
      const tgs = Array.isArray(nm.tags) ? nm.tags : []
      for (const item of kws.concat(tgs)) {
        if (item && !seen.has(item)) {
          seen.add(item)
          final.push(item)
        }
      }
      nm.keywordsFinal = final
      // 计算最终的 keywords 字符串（用于模板，避免模板逻辑重复）
      nm.keywordsFinalStr = final.join(',')
      // 仅 keywords 字符串（不含 tags）
      nm.keywordsStr = kws.join(',')
    }
    out.push(nm)
  }
  return out
}
