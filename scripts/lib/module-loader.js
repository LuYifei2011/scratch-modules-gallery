/**
 * 扫描 content/modules/ 目录，加载所有模块数据（meta、脚本、翻译、notes）。
 *
 * @module module-loader
 */

import fs from 'fs-extra'
import path from 'path'
import fg from 'fast-glob'
import { buildModuleRecord } from './schema.js'
import log from './logger.js'

/**
 * @param {Object} options
 * @param {string} options.root - 项目根目录绝对路径
 * @param {Object} options.config - site.config.js 配置对象
 * @param {boolean} options.isDev - 是否为开发模式
 * @returns {Promise<{modules: Array, errorsAll: string[], allTags: string}>}
 */
export async function loadModules({ root, config, isDev }) {
  const baseDir = path.join(root, config.contentDir)
  const dirs = await fg(['*'], { cwd: baseDir, onlyDirectories: true, dot: true })
  const modules = []
  const errorsAll = []
  for (const dir of dirs) {
    try {
      // 生产环境下跳过以 . 开头的模块（用于开发/测试）
      if (!isDev && dir.startsWith('.')) continue
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

      // optional notes: notes/<lang-code>.md（按语言国际化）
      const notesMap = {}
      const notesDirPath = path.join(moduleDir, 'notes')
      if (await fs.pathExists(notesDirPath)) {
        const noteFiles = await fg(['*.md'], { cwd: notesDirPath, onlyFiles: true })
        for (const f of noteFiles) {
          const loc = path.basename(f, '.md')
          const raw = await fs.readFile(path.join(notesDirPath, f), 'utf8')
          notesMap[loc] = raw
        }
      }

      // optional per-module translations: i18n/<locale>.json
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
        notesMap,
        translations,
      })
      if (errors.length) errorsAll.push(`${dir}: ${errors.join(', ')}`)
      modules.push(record)
    } catch (e) {
      errorsAll.push(`${dir}: unexpected build error ${(e && e.message) || e}`)
      if (isDev) {
        // 保留堆栈便于调试
        log.error('loader', String(e?.stack || e?.message || e))
      }
    }
  }
  // 统计所有 tags，去重后拼接 keywords
  const allTags = Array.from(new Set(modules.flatMap((m) => m.tags || []))).join(',')
  return { modules, errorsAll, allTags }
}
