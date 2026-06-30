import path from 'path'
import { pathToFileURL } from 'url'
import { loadScratchblocksLanguages } from './scratch-utils.ts'
import { translateModulesForLocale } from './i18n-engine.ts'
import { loadModules } from './module-loader.ts'
import { translateScriptText } from './script-translator.ts'
import { loadGlobalTags, loadI18n, loadModuleDefaults } from './i18n-loader.ts'
import { resolveImports } from './import-resolver.ts'
import type {
  BuildIssueType,
  LocalizedModuleRecord,
  ModuleRecord,
  SiteConfig,
  TranslateScriptText,
} from './types.ts'
import type { I18nDictionary } from './i18n-loader.ts'

export interface LoadSiteConfigOptions {
  applyEnvironment?: boolean
}

export interface SiteData {
  config: SiteConfig
  modules: ModuleRecord[]
  errorsAll: string[]
  allTags: string
  dict: I18nDictionary
  globalTags: Record<string, Record<string, string>>
  moduleDefaults: Record<string, unknown>
}

export interface LoadSiteDataOptions {
  root: string
  config: SiteConfig
  isDev: boolean
}

export interface LoadLocalizedModulesOptions {
  skipMissingCheck?: boolean
  reportIssue?: (type: BuildIssueType, message: string, details?: Record<string, unknown>) => void
  translateScriptText?: TranslateScriptText
}

export async function loadSiteConfig(
  root: string,
  options: LoadSiteConfigOptions = {}
): Promise<SiteConfig> {
  const configModule = await import(pathToFileURL(path.join(root, 'site.config.ts')).href)
  const config = (configModule.default || configModule) as SiteConfig

  if (options.applyEnvironment !== false) {
    applySiteConfigEnvironment(config)
  }

  return config
}

export function applySiteConfigEnvironment(config: SiteConfig): SiteConfig {
  if (process.env.BASE_URL) {
    try {
      config.baseUrl = process.env.BASE_URL
    } catch {
      // 保持配置文件中的原始 baseUrl。
    }
  } else if (process.env.CF_PAGES_URL) {
    config.baseUrl = process.env.CF_PAGES_URL
  }

  if (Array.isArray(config.mirrors)) {
    const currentUrl = (config.baseUrl || '').replace(/\/$/, '').toLowerCase()
    for (const mirror of config.mirrors) {
      mirror.isCurrent = (mirror.url || '').replace(/\/$/, '').toLowerCase() === currentUrl
    }
  }

  return config
}

export async function loadSiteData({ root, config, isDev }: LoadSiteDataOptions): Promise<SiteData> {
  loadScratchblocksLanguages()

  const [i18nData, modulesData] = await Promise.all([
    Promise.all([loadI18n(), loadGlobalTags(), loadModuleDefaults()]),
    loadModules({ root, config, isDev }),
  ])
  const [dict, globalTags, moduleDefaults] = i18nData
  const { modules, errorsAll, allTags } = modulesData

  resolveImports(modules)

  return {
    config,
    modules,
    errorsAll,
    allTags,
    dict,
    globalTags,
    moduleDefaults,
  }
}

export async function loadLocalizedModules(
  siteData: SiteData,
  locale: string,
  options: LoadLocalizedModulesOptions = {}
): Promise<LocalizedModuleRecord[]> {
  return translateModulesForLocale(
    siteData.modules,
    siteData.dict,
    locale,
    siteData.globalTags,
    {
      skipMissingCheck: options.skipMissingCheck ?? true,
      moduleDefaults: siteData.moduleDefaults,
    },
    {
      translateScriptText: options.translateScriptText || translateScriptText,
      reportIssue: options.reportIssue,
    }
  )
}
