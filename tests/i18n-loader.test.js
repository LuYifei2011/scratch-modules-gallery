import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { pickConfigForLocale, loadI18n, loadModuleDefaults, loadGlobalTags } from '../scripts/lib/i18n-loader.js'

describe('pickConfigForLocale', () => {
  const baseConfig = {
    siteName: 'Default Site',
    description: 'Default description',
    keywords: 'default,keywords',
    language: 'en',
  }

  it('returns base config when locale not in dict', () => {
    const result = pickConfigForLocale(baseConfig, 'fr', {})
    assert.strictEqual(result.siteName, 'Default Site')
    assert.strictEqual(result.description, 'Default description')
    assert.strictEqual(result.keywords, 'default,keywords')
    assert.strictEqual(result.language, 'en')
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
    assert.strictEqual(result.siteName, '中文站点')
    assert.strictEqual(result.description, '中文描述')
    assert.strictEqual(result.keywords, '中文,关键词')
    assert.strictEqual(result.language, 'zh-CN')
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
    assert.strictEqual(result.siteName, '中文站点')
    assert.strictEqual(result.description, 'Default description')
    assert.strictEqual(result.keywords, 'default,keywords')
  })

  it('preserves extra fields from base config', () => {
    const extendedConfig = { ...baseConfig, repoUrl: 'https://github.com/test' }
    const result = pickConfigForLocale(extendedConfig, 'en', {})
    assert.strictEqual(result.repoUrl, 'https://github.com/test')
  })
})

describe('loadI18n', () => {
  it('loads i18n dictionaries from src/i18n/', async () => {
    const dict = await loadI18n()
    assert.ok(typeof dict === 'object')
    assert.ok(dict['en'], 'Should load en locale')
    assert.ok(dict['zh-cn'], 'Should load zh-cn locale')
    // Should exclude tags.json and module-defaults.json
    assert.strictEqual(dict['tags'], undefined, 'Should not include tags.json as locale')
    assert.strictEqual(dict['module-defaults'], undefined, 'Should not include module-defaults.json as locale')
  })

  it('each locale dict has meta section', async () => {
    const dict = await loadI18n()
    for (const [locale, data] of Object.entries(dict)) {
      assert.ok(data.meta, `Locale ${locale} should have meta section`)
    }
  })
})

describe('loadGlobalTags', () => {
  it('loads global tags translation dictionary', async () => {
    const tags = await loadGlobalTags()
    assert.ok(typeof tags === 'object')
    // Should have at least some tags defined
    assert.ok(Object.keys(tags).length > 0, 'Should have at least one tag')
  })
})

describe('loadModuleDefaults', () => {
  it('loads module defaults (may be empty object)', async () => {
    const defaults = await loadModuleDefaults()
    assert.ok(typeof defaults === 'object')
  })
})
