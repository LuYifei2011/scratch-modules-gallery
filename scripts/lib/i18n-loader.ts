/**
 * i18n 文件加载与配置本地化工具。
 *
 * @module i18n-loader
 */

import fs from 'fs-extra';
import path from 'path';
import log from './logger.ts';
import { globFiles, readJsonFile } from './bun-utils.ts';
import type { LocaleCode, ModuleTranslation, SiteConfig } from './types.ts';

export interface LocaleDictionary {
  meta?: {
    siteName?: string;
    description?: string;
    keywords?: string | string[];
    languageTag?: string;
    languageName?: string;
  };
  issues?: {
    summaryPrefix?: string;
  };
  [key: string]: unknown;
}

export type I18nDictionary = Record<LocaleCode, LocaleDictionary>;
export type ModuleDefaultsDictionary = Record<LocaleCode, ModuleTranslation>;
export type GlobalTagsDictionary = Record<string, Record<LocaleCode, string>>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepMergeMissing<T extends Record<string, unknown>>(base: T, override: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const baseValue = out[key];
    if (isPlainObject(baseValue) && isPlainObject(value)) {
      out[key] = deepMergeMissing(baseValue, value);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}

/**
 * 使用源语言补齐其它全局 UI i18n 字典的缺失字段。
 *
 * 构建端会把补齐后的当前语言字典注入 `window.__I18N`，因此前端不需要再维护
 * 一套硬编码英文 UI fallback。
 */
export function completeI18nDictionary(dict: I18nDictionary, sourceLocale: LocaleCode = 'en'): I18nDictionary {
  const source = dict[sourceLocale];
  if (!source) return dict;

  const completed: I18nDictionary = {};
  for (const [locale, data] of Object.entries(dict)) {
    completed[locale] = locale === sourceLocale ? data : deepMergeMissing(source, data);
  }
  return completed;
}

/**
 * 加载 i18n 词典（自动扫描 src/i18n/*.json，排除 tags.json 和 module-defaults.json）
 */
export async function loadI18n(root = path.resolve('.')): Promise<I18nDictionary> {
  const i18nDir = path.join(root, 'src', 'i18n');
  const EXCLUDED = new Set(['tags.json', 'module-defaults.json']);
  const files = (await globFiles('*.json', i18nDir))
    .filter((f) => !EXCLUDED.has(f)) // 排除全局 tags 字典与模块默认翻译，只加载语言文件
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const dict: I18nDictionary = {};
  for (const f of files) {
    const loc = path.basename(f, '.json');
    try {
      dict[loc] = await readJsonFile(path.join(i18nDir, f));
    } catch (e) {
      log.warn('i18n', `解析失败，跳过 ${f}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return completeI18nDictionary(dict);
}

/**
 * 加载模块默认翻译（src/i18n/module-defaults.json）
 *
 * 结构：{ [locale]: { scriptTitles?, variables?, ... } }
 * 在 translateModulesForLocale 中与模块级翻译深合并，模块的翻译优先级更高。
 */
export async function loadModuleDefaults(root = path.resolve('.')): Promise<ModuleDefaultsDictionary> {
  const defaultsFile = path.join(root, 'src', 'i18n', 'module-defaults.json');
  try {
    if (await fs.pathExists(defaultsFile)) {
      return await readJsonFile<ModuleDefaultsDictionary>(defaultsFile);
    }
  } catch (e) {
    log.warn('module-defaults', `加载模块默认翻译失败: ${e instanceof Error ? e.message : e}`);
  }
  return {};
}

/**
 * 加载全局 tags 翻译字典（src/i18n/tags.json）
 */
export async function loadGlobalTags(root = path.resolve('.')): Promise<GlobalTagsDictionary> {
  const tagsFile = path.join(root, 'src', 'i18n', 'tags.json');
  try {
    if (await fs.pathExists(tagsFile)) {
      return await readJsonFile<GlobalTagsDictionary>(tagsFile);
    }
  } catch (e) {
    log.warn('tags', `加载全局 tags 字典失败: ${e instanceof Error ? e.message : e}`);
  }
  return {};
}

/**
 * 根据语言代码从 i18n 字典中提取配置（siteName, description 等）
 */
export function pickConfigForLocale(baseConfig: SiteConfig, locale: LocaleCode, dict: I18nDictionary): SiteConfig {
  const meta = dict[locale]?.meta || {};
  return {
    ...baseConfig,
    siteName: meta.siteName || baseConfig.siteName,
    description: meta.description || baseConfig.description,
    keywords: meta.keywords || baseConfig.keywords,
    language: meta.languageTag || baseConfig.language,
  };
}
