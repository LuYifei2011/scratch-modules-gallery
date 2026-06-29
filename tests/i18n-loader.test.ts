import { describe, expect, it } from 'bun:test'
import { pickConfigForLocale, loadI18n, loadModuleDefaults, loadGlobalTags } from '../scripts/lib/i18n-loader.ts'

describe('pickConfigForLocale', () => {
  const baseConfig = {
    siteName: 'Default Site',
    description: 'Default description',
    keywords: 'default,keywords',
    language: 'en',
  }

  it('returns base config when locale not in dict', () => {
    const result = pickConfigForLocale(baseConfig, 'fr', {})
    expect(result.siteName).toBe('Default Site')
    expect(result.description).toBe('Default description')
    expect(result.keywords).toBe('default,keywords')
    expect(result.language).toBe('en')
  })

  it('overrides with locale meta when available', () => {
    const dict = {
      'zh-cn': {
        meta: {
          siteName: '中文站点',
          description: '中文描述',
          keywords: '中文,关键词',
          languageTag: 'zh-CN',
        },
      },
    }
    const result = pickConfigForLocale(baseConfig, 'zh-cn', dict)
    expect(result.siteName).toBe('中文站点')
    expect(result.description).toBe('中文描述')
    expect(result.keywords).toBe('中文,关键词')
    expect(result.language).toBe('zh-CN')
  })

  it('falls back to base config for missing meta fields', () => {
    const dict = {
      'zh-cn': {
        meta: {
          siteName: '中文站点',
          // description and keywords not provided
        },
      },
    }
    const result = pickConfigForLocale(baseConfig, 'zh-cn', dict)
    expect(result.siteName).toBe('中文站点')
    expect(result.description).toBe('Default description')
    expect(result.keywords).toBe('default,keywords')
  })

  it('preserves extra fields from base config', () => {
    const extendedConfig = { ...baseConfig, repoUrl: 'https://github.com/test' }
    const result = pickConfigForLocale(extendedConfig, 'en', {})
    expect(result.repoUrl).toBe('https://github.com/test')
  })
})

describe('loadI18n', () => {
  it('loads i18n dictionaries from src/i18n/', async () => {
    const dict = await loadI18n()
    expect(typeof dict === 'object').toBeTruthy()
    expect(dict['en']).toBeTruthy()
    expect(dict['zh-cn']).toBeTruthy()
    // Should exclude tags.json and module-defaults.json
    expect(dict['tags']).toBe(undefined)
    expect(dict['module-defaults']).toBe(undefined)
  })

  it('each locale dict has meta section', async () => {
    const dict = await loadI18n()
    for (const [locale, data] of Object.entries(dict)) {
      expect(data.meta).toBeTruthy()
    }
  })
})

describe('loadGlobalTags', () => {
  it('loads global tags translation dictionary', async () => {
    const tags = await loadGlobalTags()
    expect(typeof tags === 'object').toBeTruthy()
    // Should have at least some tags defined
    expect(Object.keys(tags).length > 0).toBeTruthy()
  })
})

describe('loadModuleDefaults', () => {
  it('loads module defaults (may be empty object)', async () => {
    const defaults = await loadModuleDefaults()
    expect(typeof defaults === 'object').toBeTruthy()
  })
})
