/**
 * i18n 文件加载与配置本地化工具。
 *
 * @module i18n-loader
 */

import fs from 'fs-extra'
import path from 'path'
import fg from 'fast-glob'
import log from './logger.js'

const root = path.resolve('.')

/**
 * 加载 i18n 词典（自动扫描 src/i18n/*.json，排除 tags.json）
 */
export async function loadI18n() {
  const i18nDir = path.join(root, 'src', 'i18n')
  const files = (await fg(['*.json'], { cwd: i18nDir, onlyFiles: true }))
    .filter((f) => f !== 'tags.json') // 排除全局 tags 字典，只加载语言文件
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  const dict = {}
  for (const f of files) {
    const loc = path.basename(f, '.json')
    try {
      dict[loc] = JSON.parse(await fs.readFile(path.join(i18nDir, f), 'utf8'))
    } catch (e) {
      log.warn('i18n', `解析失败，跳过 ${f}: ${e?.message || e}`)
    }
  }
  return dict
}

/**
 * 加载全局 tags 翻译字典（src/i18n/tags.json）
 */
export async function loadGlobalTags() {
  const tagsFile = path.join(root, 'src', 'i18n', 'tags.json')
  try {
    if (await fs.pathExists(tagsFile)) {
      return JSON.parse(await fs.readFile(tagsFile, 'utf8'))
    }
  } catch (e) {
    log.warn('tags', `加载全局 tags 字典失败: ${e?.message || e}`)
  }
  return {}
}

/**
 * 根据语言代码从 i18n 字典中提取配置（siteName, description 等）
 */
export function pickConfigForLocale(baseConfig, locale, dict) {
  const meta = dict[locale]?.meta || {}
  return {
    ...baseConfig,
    siteName: meta.siteName || baseConfig.siteName,
    description: meta.description || baseConfig.description,
    keywords: meta.keywords || baseConfig.keywords,
    language: meta.languageTag || baseConfig.language,
  }
}
