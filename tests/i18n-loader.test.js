import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { pickConfigForLocale } from '../scripts/lib/i18n-loader.js'

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
