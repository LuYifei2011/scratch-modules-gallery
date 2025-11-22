import fs from 'fs-extra'
import path from 'path'
import fg from 'fast-glob'
import nunjucks from 'nunjucks'
import MiniSearch from 'minisearch'
import { buildModuleRecord } from './lib/schema.js'
import { pathToFileURL } from 'url'
import { minify } from 'html-minifier-next'
import * as scratchblocks from 'scratchblocks/syntax/index.js'
import simpleGit from 'simple-git'

const root = path.resolve('.')
// 动态 ESM 导入配置
const configModule = await import(pathToFileURL(path.join(root, 'site.config.js')).href)
const config = configModule.default || configModule
// 覆盖 baseUrl 与开发模式标记
const isDev =
  String(process.env.IS_DEV || '').toLowerCase() === 'true' || process.env.IS_DEV === '1'
if (process.env.BASE_URL) {
  try {
    // 只替换 baseUrl 字段，不引入额外复杂度
    config.baseUrl = process.env.BASE_URL
  } catch {}
}

// 同步加载所有 scratchblocks 语言
const localesDir = path.join(root, 'node_modules', 'scratchblocks', 'locales')
try {
  const files = fs.readdirSync(localesDir)
  files.forEach((file) => {
    if (file.endsWith('.json')) {
      const fullPath = path.join(localesDir, file)
      const langKey = path.basename(file, '.json').replace('-', '_').toLowerCase()
      try {
        const data = fs.readFileSync(fullPath, 'utf8')
        const obj = JSON.parse(data)
        scratchblocks.loadLanguages({ [langKey]: obj })
      } catch (e) {
        console.warn(`[scratchblocks] 载入语言文件失败，跳过 ${file}:`, e?.message || e)
      }
    }
  })
} catch (e) {
  console.warn('[scratchblocks] 读取 locales 目录失败:', e?.message || e)
}

// 构建所有可用的 scratchblocks 语言列表
const scratchblocksLanguages = Object.entries(scratchblocks.allLanguages)
  .map(([code, info]) => ({
    code,
    name: info.name || code,
  }))
  .sort((a, b) => a.code.localeCompare(b.code))

const templatesPath = path.join(root, 'src', 'templates')
nunjucks.configure(templatesPath, { autoescape: true })

async function loadModules() {
  const baseDir = path.join(root, config.contentDir)
  const dirs = await fg(['*'], { cwd: baseDir, onlyDirectories: true })
  const modules = []
  const errorsAll = []
  for (const dir of dirs) {
    try {
      const moduleDir = path.join(baseDir, dir)
      const metaFile = path.join(moduleDir, 'meta.json')
      if (!(await fs.pathExists(metaFile))) continue // skip
      let meta
      try {
        meta = JSON.parse(await fs.readFile(metaFile, 'utf8'))
      } catch (e) {
        errorsAll.push(`${dir}: meta.json parse error ${e.message}`)
        continue
      }

      const scriptPath = path.join(moduleDir, 'script.txt')
      let script = ''
      let scripts = []
      // scripts/ 目录下若存在 *.txt，按文件名自然排序
      const scriptsDir = path.join(moduleDir, 'scripts')
      if (await fs.pathExists(scriptsDir)) {
        const files = (await fg(['*.txt'], { cwd: scriptsDir, onlyFiles: true })).sort((a, b) =>
          a.localeCompare(b, 'en', { numeric: true })
        )
        for (const f of files) {
          const full = path.join(scriptsDir, f)
          const content = await fs.readFile(full, 'utf8')
          const base = path.basename(f, '.txt')
          // 新标准：序号+id，例如 01-main.txt；无序号时，整个 base 为 id
          const m = base.match(/^(\d+)[ _-](.+)$/)
          const id = (m ? m[2] : base).trim()
          scripts.push({ id, content })
        }
        // 若目录存在但为空，视为错误
        if (!scripts.length) {
          errorsAll.push(`${dir}: scripts/ is empty (expecting *.txt)`)
        }
      } else {
        // 不再兼容旧格式（script.txt 或 script-*.txt）；严格要求 scripts/*.txt
        errorsAll.push(`${dir}: missing scripts/ directory`)
      }

      const demoPath = path.join(moduleDir, 'demo.sb3')
      const demoFile = (await fs.pathExists(demoPath)) ? `modules/${dir}/demo.sb3` : undefined

      // optional variables.json
      // variables.json 已废弃：变量应直接写入 meta.json 的 variables 字段

      // optional notes (md or txt)
      let notesHtml = ''
      const notesFiles = await fg(['notes.{md,txt}'], { cwd: moduleDir, onlyFiles: true })
      if (notesFiles.length > 0) {
        const raw = await fs.readFile(path.join(moduleDir, notesFiles[0]), 'utf8')
        // 极简 markdown 转换（仅支持换行->段落、**粗体**、`行内代码`）
        notesHtml = raw
          .split(/\n{2,}/)
          .map(
            (block) =>
              `<p>${escapeHtml(block)
                .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                .replace(/`([^`]+)`/g, '<code>$1</code>')}</p>`
          )
          .join('\n')
      }

      // references.json 已废弃：引用应直接写入 meta.json 的 references 字段

      // optional per-module translations: i18n/<locale>.json
      // 文件结构：{ name?: string, description?: string, tags?: string[], variables?: Record<origName,string>, lists?: Record<origName,string> }
      let translations = {}
      const i18nDir = path.join(moduleDir, 'i18n')
      if (await fs.pathExists(i18nDir)) {
        const files = (await fg(['*.json'], { cwd: i18nDir, onlyFiles: true })).sort((a, b) =>
          a.localeCompare(b, 'en', { numeric: true })
        )
        for (const f of files) {
          const loc = path.basename(f, '.json')
          try {
            const obj = JSON.parse(await fs.readFile(path.join(i18nDir, f), 'utf8'))
            if (obj && typeof obj === 'object') {
              const one = {}
              // 字段验证并拷贝的通用逻辑
              const copyField = (key, validator = (v) => v !== null && v !== undefined) => {
                if (validator(obj[key])) one[key] = obj[key]
              }
              const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v)

              copyField('name', (v) => typeof v === 'string')
              copyField('description', (v) => typeof v === 'string')
              copyField('tags', (v) => Array.isArray(v))
              copyField('variables', isPlainObject)
              copyField('lists', isPlainObject)
              copyField('events', isPlainObject)
              copyField('scriptTitles', isPlainObject)
              copyField('procedures', isPlainObject)
              copyField('procedureParams', isPlainObject)

              translations[loc] = one
            }
          } catch (e) {
            errorsAll.push(`${dir}: i18n/${f} parse error`)
          }
        }
      }

      const { record, errors } = buildModuleRecord(meta, {
        script,
        scripts,
        demoFile,
        notesHtml,
        translations,
      })
      if (errors.length) errorsAll.push(`${dir}: ${errors.join(', ')}`)
      modules.push(record)
    } catch (e) {
      errorsAll.push(`${dir}: unexpected build error ${(e && e.message) || e}`)
      if (isDev) {
        // 保留堆栈便于调试
        console.error(e)
      }
    }
  }
  // 统计所有 tags，去重后拼接 keywords
  const allTags = Array.from(new Set(modules.flatMap((m) => m.tags || []))).join(',')
  return { modules, errorsAll, allTags }
}

function escapeHtml(str = '') {
  return str.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  )
}

async function maybeMinify(html) {
  if (!html) return html
  try {
    return minify(html, {
      collapseWhitespace: true,
      removeComments: true,
      removeRedundantAttributes: true,
      removeEmptyAttributes: true,
      collapseBooleanAttributes: true,
      removeAttributeQuotes: false,
      keepClosingSlash: true,
      minifyCSS: true,
      minifyJS: true,
    })
  } catch (e) {
    console.warn('[minify] html-minifier-next 压缩失败，返回原始 HTML:', e?.message || e)
    return html
  }
}

// 自定义分词：为纯中文连续片段额外生成 单字 + 双字 词，用于支持中文子串搜索 ("排序" 命中 "排序角色")
function tokenizeCJK(text) {
  if (!text) return []
  const baseTokens = text.match(/[\p{L}\p{N}\p{M}\p{Pc}\-']+/gu) || []
  const out = []
  for (const tok of baseTokens) {
    out.push(tok)
    if (/^[\u4e00-\u9fff]+$/.test(tok) && tok.length > 1) {
      const chars = Array.from(tok)
      // 单字
      for (const c of chars) out.push(c)
      // 双字滑窗
      for (let i = 0; i < chars.length - 1; i++) {
        out.push(chars[i] + chars[i + 1])
      }
    }
  }
  // 去重
  return Array.from(new Set(out))
}

function buildSearchIndex(modules) {
  const mini = new MiniSearch({
    fields: ['name', 'id', 'description', 'tags'],
    storeFields: ['id', 'name', 'description', 'tags', 'slug', 'hasDemo'],
    idField: 'id',
    searchOptions: { boost: { name: 5, id: 4, tags: 3, description: 2 } },
    tokenize: tokenizeCJK,
  })
  mini.addAll(modules)
  return mini.toJSON()
}

// 解析脚本中的 !import 指令并拆分为普通块与导入块
// 语法: !import moduleId[:scriptIndex]  (scriptIndex 为 1 基)
function resolveImports(modules) {
  const idMap = new Map(modules.map((m) => [m.id, m]))
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

  // 递归展开导入内容（用于导入块内部），不生成折叠，仅替换为纯代码
  function fullyExpandContent(moduleId, rawContent, stack) {
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
      const nested = fullyExpandContent(targetModule.id, targetScript.content, [...stack, key])
      out.push(nested.trimEnd())
    }
    return out.join('\n')
  }

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
        const expanded = fullyExpandContent(targetModule.id, targetScript.content, [
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
        const expanded = fullyExpandContent(targetModule.id, targetScript.content, [
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

// 加载 i18n 词典（自动扫描 src/i18n/*.json）
async function loadI18n() {
  const i18nDir = path.join(root, 'src', 'i18n')
  const files = (await fg(['*.json'], { cwd: i18nDir, onlyFiles: true })).sort((a, b) =>
    a.localeCompare(b, 'en', { numeric: true })
  )
  const dict = {}
  for (const f of files) {
    const loc = path.basename(f, '.json')
    try {
      dict[loc] = JSON.parse(await fs.readFile(path.join(i18nDir, f), 'utf8'))
    } catch (e) {
      console.warn(`[i18n] 解析失败，跳过 ${f}:`, e?.message || e)
    }
  }
  return dict
}

function pickConfigForLocale(baseConfig, locale, dict) {
  const meta = dict[locale]?.meta || {}
  return {
    ...baseConfig,
    siteName: meta.siteName || baseConfig.siteName,
    description: meta.description || baseConfig.description,
    keywords: meta.keywords || baseConfig.keywords,
    language: meta.languageTag || baseConfig.language,
  }
}

// 将 scratchblocks 文本翻译为指定语言（构建期），并可替换变量/列表名称
function translateScriptFields(blocks, nameMaps) {
  if (!blocks || !nameMaps) return
  blocks.forEach((block) => {
    if (block instanceof scratchblocks.Comment) return
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

function translateScriptText(raw, targetLangKey, nameMaps) {
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

// 针对某语言，返回带有已翻译脚本内容与元信息本地化的 modules 副本
async function translateModulesForLocale(modules, dict, locale, options = {}) {
  const languageTag = (dict[locale]?.meta?.languageTag || locale || 'en')
    .replace('-', '_')
    .toLowerCase()
  const isEnglishLocale = locale === 'en' || languageTag.startsWith('en')

  // 生成语言优先级顺序（避免重复判断）
  const getLocalePriority = () => {
    if (locale === 'zh-tw') return [locale, 'zh-tw', 'zh-cn', 'en']
    if (locale === 'zh-cn') return [locale, 'zh-cn', 'zh-tw', 'en']
    return [locale, 'en', 'zh-cn', 'zh-tw']
  }
  const localePriority = getLocalePriority()

  const out = []

  // 构造当前语言下的变量/列表名称映射（原名 -> 本地化名）
  function buildNameMapsForModule(mod) {
    const per = mod.translations || {}
    const maps = { vars: {}, lists: {}, events: {} }

    // 统一的优先级查询函数
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

  // 构造当前语言的自定义块与其参数映射（方案A：以英文源为 key，_ 占位参数）
  function buildProcedureMaps(mod) {
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

  function escapeProcReg(str = '') {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  // 进行文本层本地化：替换 define 行与调用行；然后替换参数槽名称
  function localizeProcedures(raw, procMaps) {
    if (!raw || !procMaps) return raw
    let out = raw
    const { procMap, paramMap } = procMaps
    if (procMap && typeof procMap === 'object') {
      // 先按 key 长度降序，避免前缀冲突
      const entries = Object.entries(procMap).sort((a, b) => b[0].length - a[0].length)
      for (const [englishPattern, localizedPattern] of entries) {
        // 拆分英文 pattern 获取占位符数量（_ 表示一个参数括号）
        const parts = englishPattern.split('_')
        const slotCount = parts.length - 1
        if (slotCount <= 0) continue
        const localizedSlots = (localizedPattern.match(/_/g) || []).length
        if (localizedSlots !== slotCount) {
          console.warn(
            `[procedures] 本地化占位符数量不匹配: pattern="${englishPattern}" slots=${slotCount} localizedSlots=${localizedSlots}`
          )
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
          console.warn('[procedures] 构造正则失败:', englishPattern, e?.message || e)
          continue
        }

        function rebuildLocalized(captures) {
          let idx = 0
          // 依次把 '_' 替换为对应 capture
          return localizedPattern.replace(/_/g, () => {
            const rep = captures[idx++]
            if (!rep) {
              console.warn(
                `[procedures] 捕获参数不足: pattern="${englishPattern}" need=${slotCount} have=${captures.length}`
              )
            }
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
    if (m.tags_i18n || per[locale] || per['en'] || per['zh-cn'] || per['zh-tw']) {
      const tv = pickArr('tags', m.tags_i18n)
      if (Array.isArray(tv)) nm.tags = tv
    }

    const ownNameMaps = buildNameMapsForModule(m)
    // 为“变量 / 列表”表格计算本地化显示名称（模块级，始终执行）
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
              if (targetForProc) mapsForThis = buildNameMapsForModule(targetForProc) || mapsForThis
            }
            const procMaps = buildProcedureMaps(targetForProc || m)
            if (procMaps && procMaps.paramMap) {
              mapsForThis = mapsForThis || {}
              mapsForThis.params = procMaps.paramMap
            }
            // 先做过程标题文本替换（基于英文模式），避免后续 scratchblocks 翻译改变关键字导致匹配失败
            const preLocalized = localizeProcedures(s.content, procMaps)
            // 再进行 AST 翻译与参数本地化（参数由 translateScriptFields 处理）
            ns.content = translateScriptText(preLocalized, languageTag, mapsForThis)
          }
        } catch (e) {
          console.warn(`[translate] error ${m.id} "${s.title}":`, e?.message || e)
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
                ? buildNameMapsForModule(target)
                : undefined
            arr.push({
              ...imp,
              content: isEnglishLocale
                ? imp.content
                : (function () {
                    const procMaps = buildProcedureMaps(target || m)
                    let mf = mapsImported
                    if (procMaps && procMaps.paramMap) {
                      mf = mf || {}
                      mf.params = procMaps.paramMap
                    }
                    const preLocalized = localizeProcedures(imp.content, procMaps)
                    const translated = translateScriptText(preLocalized, languageTag, mf)
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
        if (!('tags' in locTrans)) missingFields.push('tags')
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
        // --- 自定义块 / 参数缺失检测 ---
        // 如果没有提供英文基准的 procedures / procedureParams，则尝试从原始脚本源码中自动提取
        // 规则：匹配 "define xxx" 行；用 '_' 代替每个括号参数；括号内内容（去掉外层括号）视为参数英文名
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
          console.warn(`[i18n-missing][${locale}] ${m.id}: ` + missingFields.join(', '))
        }
      } catch (e) {
        console.warn('[i18n-missing] 检测失败', m.id, e?.message || e)
      }
    }
    out.push(nm)
  }
  return out
}

async function render(modules, allTags) {
  const outDir = path.join(root, config.outDir)
  await fs.emptyDir(outDir)
  // 计算 basePath (用于相对资源路径) —— 例如 https://user.github.io/repo => /repo
  let basePath = ''
  try {
    const u = new URL(config.baseUrl)
    basePath = u.pathname.replace(/\/$/, '') // '' 或 '/subdir'
  } catch (e) {
    basePath = ''
  }

  // 从 git 历史获取文件的最后修改时间（ISO8601 日期字符串）
  // 如果获取失败或不在 git 仓库中，回退到当前时间
  async function getFileLastModDate(relativeFilePath) {
    try {
      const git = simpleGit(root)
      const isRepo = await git.checkIsRepo()
      if (!isRepo) {
        return new Date().toISOString().split('T')[0]
      }

      // 检测是否为浅层克隆（GitHub Actions 默认行为）
      const isDeeplyCloned = await git.revparse(['--is-shallow-repository']).catch(() => 'true')
      if (isDeeplyCloned === 'true' && isDev) {
        console.warn('[git] ⚠️  检测到浅层克隆（fetch-depth < 完整历史），git 提交时间可能不准确。')
        console.warn('[git] 对于 GitHub Actions，请在 workflow 中添加：with: { fetch-depth: 0 }')
      }

      // 获取该文件的最后一次提交时间
      const log = await git.log({
        file: relativeFilePath,
        '--diff-filter': 'M',
        '--max-count': '1',
      })
      if (log.latest) {
        const commitDate = new Date(log.latest.date).toISOString().split('T')[0]
        return commitDate
      }
      return new Date().toISOString().split('T')[0]
    } catch (e) {
      if (isDev) console.warn(`[git] 获取 ${relativeFilePath} 的提交时间失败:`, e?.message || e)
      return new Date().toISOString().split('T')[0]
    }
  }

  // 批量获取模块文件的最后修改时间，缓存结果以避免重复查询
  // 考虑：scripts/ 目录 + 模块级 i18n 目录 + 全局 i18n 目录
  const lastModCache = new Map()
  async function getModuleLastMod(moduleSlug) {
    if (lastModCache.has(moduleSlug)) {
      return lastModCache.get(moduleSlug)
    }

    try {
      const git = simpleGit(root)
      const isRepo = await git.checkIsRepo()
      if (!isRepo) {
        const date = new Date().toISOString().split('T')[0]
        lastModCache.set(moduleSlug, date)
        return date
      }

      // 收集该模块的所有相关文件路径
      const filePaths = [
        `${config.contentDir}/${moduleSlug}/scripts`, // 脚本目录（递归）
        `${config.contentDir}/${moduleSlug}/i18n`, // 模块级翻译目录（递归）
        'src/i18n', // 全局翻译目录（影响所有页面）
      ]

      let latestDate = null

      // 对每个路径获取最后修改时间
      for (const filePath of filePaths) {
        try {
          // 使用 git log 查询指定路径的最后一次修改
          const log = await git.log({
            file: filePath,
            '--diff-filter': 'M',
            '--max-count': '1',
          })
          if (log.latest) {
            const commitDate = new Date(log.latest.date)
            if (!latestDate || commitDate > latestDate) {
              latestDate = commitDate
            }
          }
        } catch (e) {
          // 某个路径可能不存在或出错，继续处理其他路径
          if (isDev) {
            console.warn(`[git] 获取 ${moduleSlug}/${filePath} 的提交时间失败:`, e?.message || e)
          }
        }
      }

      const dateStr = latestDate
        ? latestDate.toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0]
      lastModCache.set(moduleSlug, dateStr)
      return dateStr
    } catch (e) {
      if (isDev) console.warn(`[git] 获取模块 ${moduleSlug} 的提交时间失败:`, e?.message || e)
      const date = new Date().toISOString().split('T')[0]
      lastModCache.set(moduleSlug, date)
      return date
    }
  }
  // copy public
  const publicDir = path.join(root, 'public')
  if (await fs.pathExists(publicDir)) await fs.copy(publicDir, outDir)
  // copy client resources (app.js, style.css) - 使用 glob 一次性选择
  const clientFiles = await fg(['*.{js,css}'], {
    cwd: path.join(root, 'src', 'client'),
    onlyFiles: true,
  })
  for (const file of clientFiles) {
    await fs.copy(path.join(root, 'src', 'client', file), path.join(outDir, file))
  }

  // vendor: minisearch, scratchblocks
  const vendorDir = path.join(outDir, 'vendor')
  await fs.ensureDir(vendorDir)

  // 复制 minisearch ES 模块（标准化路径，无需动态解析）
  try {
    const miniEs = path.join(root, 'node_modules', 'minisearch', 'dist', 'es', 'index.js')
    if (await fs.pathExists(miniEs)) {
      await fs.copy(miniEs, path.join(vendorDir, 'minisearch.js'))
    } else {
      console.warn('minisearch ES 文件未找到:', miniEs)
    }
  } catch (e) {
    console.error('Error copying minisearch:', e)
  }

  // 复制 scratchblocks 核心库
  try {
    const sbMinEs = path.join(
      root,
      'node_modules',
      'scratchblocks',
      'build',
      'scratchblocks.min.es.js'
    )
    if (await fs.pathExists(sbMinEs)) {
      await fs.copy(sbMinEs, path.join(vendorDir, 'scratchblocks.min.es.js'))
    }
  } catch (e) {
    console.warn('[scratchblocks] 复制核心库文件失败:', e?.message || e)
  }

  // 复制 scratchblocks 语言文件到 vendor/sb-langs/
  try {
    const localesSourceDir = path.join(root, 'node_modules', 'scratchblocks', 'locales')
    const langVendorDir = path.join(vendorDir, 'sb-langs')
    const localeFiles = await fg(['*.json'], { cwd: localesSourceDir, onlyFiles: true })
    if (localeFiles.length > 0) {
      await fs.ensureDir(langVendorDir)
      for (const file of localeFiles) {
        await fs.copy(path.join(localesSourceDir, file), path.join(langVendorDir, file))
      }
    }
  } catch (e) {
    console.warn('[scratchblocks] 复制语言文件失败:', e?.message || e)
  }

  // copy demo & assets
  for (const m of modules) {
    const srcDir = path.join(root, config.contentDir, m.slug)
    const targetDir = path.join(outDir, 'modules', m.slug)
    await fs.ensureDir(targetDir)
    // demo.sb3 存在时复制
    if (m.hasDemo) {
      const demoSrc = path.join(srcDir, 'demo.sb3')
      await fs.copy(demoSrc, path.join(targetDir, 'demo.sb3')).catch(() => {})
    }
    // assets 文件夹存在时复制整个目录
    const assetsDir = path.join(srcDir, 'assets')
    try {
      const stat = await fs.stat(assetsDir)
      if (stat.isDirectory()) {
        await fs.copy(assetsDir, path.join(targetDir, 'assets'))
      }
    } catch (e) {
      // assets 文件夹不存在时忽略
    }
  }

  // 搜索与文档列表将按语言分别生成

  // render pages per locale
  const dict = await loadI18n()
  const locales = Object.keys(dict)
  // 每种语言的 hreflang 标记（优先使用 i18n.meta.languageTag）
  const langTags = Object.fromEntries(
    locales.map((loc) => [loc, (dict[loc]?.meta && dict[loc].meta.languageTag) || loc])
  )
  // 预先一次性收集所有语言的缺失翻译警告，确保之后所有页面的 buildIssuesSummary 一致
  if (isDev) {
    for (const loc of locales) {
      if (loc === 'en') continue
      try {
        await translateModulesForLocale(modules, dict, loc, { skipMissingCheck: false })
      } catch {}
    }
  }

  for (const loc of locales) {
    const locOut = path.join(outDir, loc)
    await fs.ensureDir(locOut)
    const locConfig = pickConfigForLocale(config, loc, dict)
    const assetBase = basePath || ''
    const pageBase = (basePath ? basePath : '') + '/' + loc
    const $t = dict[loc]
    // 针对当前语言，生成脚本文本与元信息已翻译的模块数据（不影响其他语言）
    const modulesForLoc = await translateModulesForLocale(modules, dict, loc, {
      skipMissingCheck: true,
    })

    // 每种语言目录写入搜索数据（使用本地化后的模块）
    const searchIndex = buildSearchIndex(modulesForLoc)
    const docs = modulesForLoc.map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
      tags: m.tags,
      slug: m.slug,
      hasDemo: m.hasDemo,
    }))
    await fs.writeJson(path.join(locOut, 'search-index.json'), searchIndex)
    await fs.writeJson(path.join(locOut, 'search-docs.json'), docs)

    const indexHtml = nunjucks.render('layouts/home.njk', {
      modules: modulesForLoc,
      config: locConfig,
      basePath,
      assetBase,
      pageBase,
      pagePath: '/',
      IS_DEV: isDev,
      t: $t,
      locale: loc,
      canonical: '/' + loc + '/',
      locales,
      langTags,
      i18n: dict,
    })
    await fs.outputFile(path.join(locOut, 'index.html'), await maybeMinify(indexHtml), 'utf8')

    for (const m of modules) {
      const html = nunjucks.render('layouts/module.njk', {
        module: modulesForLoc.find((x) => x.id === m.id) || m,
        config: locConfig,
        basePath,
        assetBase,
        pageBase,
        pagePath: '/modules/' + m.slug + '/',
        IS_DEV: isDev,
        t: $t,
        locale: loc,
        locales,
        langTags,
        i18n: dict,
        scratchblocksLanguages,
      })
      const moduleDir = path.join(locOut, 'modules', m.slug)
      await fs.ensureDir(moduleDir)
      await fs.writeFile(path.join(moduleDir, 'index.html'), await maybeMinify(html), 'utf8')
    }
  }

  // 生成根路径自动语言跳转页（已抽离为 nunjucks 模板，使用本作用域的 basePath）
  const redirectLocales = JSON.stringify(locales)
  // 默认语言优先：若存在 en 则用之，否则第一个
  const defaultLocale = locales.includes('en') ? 'en' : locales[0] || 'en'
  const redirectHtml = nunjucks.render('layouts/redirect.njk', {
    basePath,
    redirectLocales: redirectLocales,
    defaultLocale,
    // 提前规范化 baseUrl 供模板使用
    configBaseUrl: config.baseUrl.replace(/\/$/, ''),
    config,
    lang: langTags[defaultLocale] || defaultLocale,
  })
  await fs.outputFile(path.join(outDir, 'index.html'), await maybeMinify(redirectHtml), 'utf8')

  // sitemap
  const urls = locales.flatMap((loc) => [
    `/${loc}/`,
    ...modules.map((m) => `/${loc}/modules/${m.slug}/`),
  ])

  // 生成 sitemap 时为每个 URL 获取对应的最后修改时间
  // 开发模式下跳过生成以节省时间
  if (!isDev) {
    const sitemapUrls = []

    // 首页：使用配置文件 + 全局 i18n 文件的最后修改时间
    // 两者中较晚的时间
    const configLastMod = await getFileLastModDate('site.config.js')
    const globalI18nLastMod = await getFileLastModDate('src/i18n')
    const indexLastMod = configLastMod >= globalI18nLastMod ? configLastMod : globalI18nLastMod
    for (const loc of locales) {
      sitemapUrls.push({
        loc: `/${loc}/`,
        lastmod: indexLastMod,
      })
    }

    // 模块页面：使用每个模块脚本目录 + 模块级 i18n + 全局 i18n 的最后修改时间
    for (const m of modules) {
      const moduleLastMod = await getModuleLastMod(m.slug)
      for (const loc of locales) {
        sitemapUrls.push({
          loc: `/${loc}/modules/${m.slug}/`,
          lastmod: moduleLastMod,
        })
      }
    }

    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapUrls.map((u) => `  <url><loc>${config.baseUrl.replace(/\/$/, '')}${u.loc}</loc><lastmod>${u.lastmod}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`).join('\n')}\n</urlset>`
    await fs.writeFile(path.join(outDir, 'sitemap.xml'), sitemap, 'utf8')
    await fs.writeFile(
      path.join(outDir, 'robots.txt'),
      `User-agent: *\nAllow: /\nSitemap: ${config.baseUrl.replace(/\/$/, '')}/sitemap.xml\n`,
      'utf8'
    )
  } else {
    // 开发模式：跳过 sitemap 和 robots.txt 生成，使用占位符或简单版本
    if (isDev) {
      console.log('[dev] 跳过 sitemap 和 robots.txt 生成以节省时间')
    }
  }

  // 在所有语言与模块页面渲染完成后，再统一生成 issues 页面，确保每个语言目录看到的是全集合
  if (isDev) {
    // 统一使用最终 collectedIssues（通过 nunjucks.render monkey patch 注入到模板）
    const dict = await loadI18n()
    const locales = Object.keys(dict)
    const langTags = Object.fromEntries(
      locales.map((loc) => [loc, (dict[loc]?.meta && dict[loc].meta.languageTag) || loc])
    )
    for (const loc of locales) {
      const locConfig = pickConfigForLocale(config, loc, dict)
      const pageBase = (basePath ? basePath : '') + '/' + loc
      const assetBase = basePath || ''
      // 由于我们在统一生成阶段调用 render，此时 monkey patch 仍会注入 buildIssues & summary。
      // 但为稳妥（避免某些运行路径失效），这里显式计算一次并覆盖（模板优先使用传入值）。
      const summary = collectedIssues.reduce(
        (acc, i) => {
          if (i.type === 'error') acc.errors++
          else if (i.type === 'warn') acc.warnings++
          acc.total++
          return acc
        },
        { errors: 0, warnings: 0, total: 0 }
      )
      const dictIssues = dict[loc]?.issues
      const summaryText = dictIssues?.summaryPrefix
        ? dictIssues.summaryPrefix
            .replace('{total}', String(summary.total))
            .replace('{errors}', String(summary.errors))
            .replace('{warnings}', String(summary.warnings))
        : ''
      const issuesHtml = nunjucks.render('layouts/issues.njk', {
        modules: [],
        config: locConfig,
        basePath,
        assetBase,
        pageBase,
        pagePath: '/issues/',
        IS_DEV: isDev,
        t: dict[loc],
        locale: loc,
        locales,
        langTags,
        i18n: dict,
        buildIssues: collectedIssues,
        buildIssuesSummary: summary,
        buildIssuesSummaryText: summaryText,
      })
      const locOut = path.join(outDir, loc)
      const issuesDir = path.join(locOut, 'issues')
      await fs.ensureDir(issuesDir)
      await fs.writeFile(path.join(issuesDir, 'index.html'), await maybeMinify(issuesHtml), 'utf8')
    }
  }
}

// --- 开发模式下的构建问题聚合 ---
// 收集的结构：{ type: 'error'|'warn', message: string }
const collectedIssues = []
if (isDev) {
  const origWarn = console.warn
  const origError = console.error
  const push = (type, args) => {
    try {
      const msg = args
        .map((a) =>
          a instanceof Error
            ? a.stack || a.message
            : typeof a === 'object'
              ? JSON.stringify(a)
              : String(a)
        )
        .join(' ')
      collectedIssues.push({ type, message: msg })
    } catch {}
  }
  console.warn = (...args) => {
    push('warn', args)
    origWarn.apply(console, args)
  }
  console.error = (...args) => {
    push('error', args)
    origError.apply(console, args)
  }
}

;(async () => {
  console.time('build')
  const { modules, errorsAll, allTags } = await loadModules()
  // 将 loadModules 的结构化错误加入 collectedIssues
  for (const msg of errorsAll) collectedIssues.push({ type: 'error', message: msg })
  // 解析 !import 指令
  resolveImports(modules)
  // 在渲染前把 issues 注入 nunjucks 全局或通过参数传递
  // 这里采用环境变量对象传递：扩展 nunjucks.render 上下文
  // 修改 render 调用：封装一层以包含 buildIssues
  const origRender = nunjucks.render
  nunjucks.render = function (...args) {
    if (typeof args[1] === 'object' && args[1] !== null) {
      args[1].buildIssues = collectedIssues
      const summary = collectedIssues.reduce(
        (acc, i) => {
          if (i.type === 'error') acc.errors++
          else if (i.type === 'warn') acc.warnings++
          acc.total++
          return acc
        },
        { errors: 0, warnings: 0, total: 0 }
      )
      args[1].buildIssuesSummary = summary
      // 预计算本地化 summary 文本，避免在模板中链式 replace 引发解析问题
      try {
        const dictIssues = args[1].t && args[1].t.issues
        if (dictIssues && typeof dictIssues.summaryPrefix === 'string') {
          args[1].buildIssuesSummaryText = dictIssues.summaryPrefix
            .replace('{total}', String(summary.total))
            .replace('{errors}', String(summary.errors))
            .replace('{warnings}', String(summary.warnings))
        }
      } catch (e) {
        // 静默失败，不影响主流程
      }
    }
    return origRender.apply(this, args)
  }
  await render(modules, allTags)
  console.log(`Built ${modules.length} modules.`)
  if (collectedIssues.length) {
    const summary = collectedIssues.reduce(
      (acc, i) => {
        if (i.type === 'error') acc.errors++
        else if (i.type === 'warn') acc.warnings++
        return acc
      },
      { errors: 0, warnings: 0 }
    )
    console.log(`[build] Issues collected: ${summary.errors} errors, ${summary.warnings} warnings`)
  }
  console.timeEnd('build')
  // 开发模式：即使有错误也不以非零码退出
  if (!isDev && collectedIssues.some((x) => x.type === 'error')) {
    process.exitCode = 1
  }
})()
