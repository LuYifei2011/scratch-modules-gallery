import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { translateModulesForLocale } from '../scripts/lib/i18n-engine.js'

describe('translateModulesForLocale', () => {
  const baseModule = {
    id: 'test-mod',
    name: 'Test Module',
    description: 'A test module',
    tags: ['performance'],
    keywords: ['test'],
    scripts: [{ id: 'main', title: 'Main', content: 'when flag clicked\nsay [hello]' }],
    variables: [
      { name: 'myVar', scope: 'global', type: 'variable' },
      { name: 'myList', scope: 'global', type: 'list' },
    ],
    notesMap: {
      en: '# English notes',
      'zh-cn': '# 中文备注',
    },
    translations: {
      'zh-cn': {
        name: '测试模块',
        description: '一个测试模块',
        variables: { myVar: '我的变量' },
        lists: { myList: '我的列表' },
        scriptTitles: { main: '主脚本' },
      },
    },
    scriptTitles: { main: 'Main' },
  }

  const dict = {
    en: { meta: { languageTag: 'en' } },
    'zh-cn': { meta: { languageTag: 'zh-CN' } },
  }

  it('returns localized name and description for zh-cn', async () => {
    const result = await translateModulesForLocale([baseModule], dict, 'zh-cn')
    assert.strictEqual(result.length, 1)
    assert.strictEqual(result[0].name, '测试模块')
    assert.strictEqual(result[0].description, '一个测试模块')
  })

  it('preserves original values for en locale', async () => {
    const result = await translateModulesForLocale([baseModule], dict, 'en')
    assert.strictEqual(result[0].name, 'Test Module')
    assert.strictEqual(result[0].description, 'A test module')
  })

  it('localizes variable displayName', async () => {
    const result = await translateModulesForLocale([baseModule], dict, 'zh-cn')
    const vars = result[0].variables
    const myVar = vars.find((v) => v.name === 'myVar')
    assert.strictEqual(myVar.displayName, '我的变量')
    const myList = vars.find((v) => v.name === 'myList')
    assert.strictEqual(myList.displayName, '我的列表')
  })

  it('localizes script titles', async () => {
    const result = await translateModulesForLocale([baseModule], dict, 'zh-cn')
    assert.strictEqual(result[0].scripts[0].title, '主脚本')
  })

  it('applies global tags translations', async () => {
    const globalTags = {
      performance: { 'zh-cn': '性能', 'zh-tw': '效能' },
    }
    const result = await translateModulesForLocale([baseModule], dict, 'zh-cn', globalTags)
    assert.ok(result[0].tags.includes('性能'))
  })

  it('selects correct notes by locale priority', async () => {
    const result = await translateModulesForLocale([baseModule], dict, 'zh-cn')
    // zh-cn notes should be selected, rendered as HTML
    assert.ok(result[0].notesHtml.includes('中文备注'))
  })

  it('falls back to en notes when locale not available', async () => {
    const modNoZh = {
      ...baseModule,
      notesMap: { en: '# English only' },
      translations: {},
    }
    const result = await translateModulesForLocale([modNoZh], dict, 'zh-cn')
    assert.ok(result[0].notesHtml.includes('English only'))
  })

  it('produces empty notesHtml when no notes exist', async () => {
    const modNoNotes = { ...baseModule, notesMap: {}, translations: {} }
    const result = await translateModulesForLocale([modNoNotes], dict, 'en')
    assert.strictEqual(result[0].notesHtml, '')
  })

  it('computes keywordsFinal (merged keywords + tags, deduplicated)', async () => {
    const result = await translateModulesForLocale([baseModule], dict, 'en')
    assert.ok(Array.isArray(result[0].keywordsFinal))
    assert.ok(result[0].keywordsFinalStr.length > 0)
  })

  it('handles module with no translations', async () => {
    const simpleModule = {
      id: 'simple',
      name: 'Simple',
      description: 'Desc',
      tags: ['test'],
      keywords: [],
      scripts: [],
      variables: [],
      notesMap: {},
      translations: {},
    }
    const result = await translateModulesForLocale([simpleModule], dict, 'zh-cn')
    assert.strictEqual(result.length, 1)
    assert.strictEqual(result[0].name, 'Simple') // falls back to original
  })

  it('merges moduleDefaults with module translations', async () => {
    const moduleDefaults = {
      'zh-cn': {
        scriptTitles: { main: '默认主脚本' },
      },
    }
    const modNoTitles = {
      ...baseModule,
      translations: {
        'zh-cn': {
          name: '测试',
          description: '描述',
          // no scriptTitles - should fall back to moduleDefaults
        },
      },
    }
    const result = await translateModulesForLocale(
      [modNoTitles],
      dict,
      'zh-cn',
      {},
      { moduleDefaults }
    )
    // Should pick up scriptTitles from moduleDefaults
    assert.strictEqual(result[0].scripts[0].title, '默认主脚本')
  })

  it('module translations override moduleDefaults', async () => {
    const moduleDefaults = {
      'zh-cn': {
        scriptTitles: { main: '默认主脚本' },
      },
    }
    const result = await translateModulesForLocale(
      [baseModule],
      dict,
      'zh-cn',
      {},
      { moduleDefaults }
    )
    // Module's own 'main' title should override the default
    assert.strictEqual(result[0].scripts[0].title, '主脚本')
  })

  it('calls translateScriptText callback with correct arguments', async () => {
    const callArgs = []
    const mockTranslate = (raw, langKey, nameMaps) => {
      callArgs.push({ raw, langKey, nameMaps })
      return {
        text: raw,
        missingProcs: new Set(),
        missingParams: new Set(),
        missingComments: new Set(),
      }
    }
    await translateModulesForLocale(
      [baseModule],
      dict,
      'zh-cn',
      {},
      {},
      { translateScriptText: mockTranslate }
    )
    assert.ok(callArgs.length > 0, 'translateScriptText should be called at least once')
    // Verify the language key passed matches the expected value (zh-CN → zh_cn)
    assert.strictEqual(callArgs[0].langKey, 'zh_cn')
    // Verify raw script content is passed
    assert.ok(typeof callArgs[0].raw === 'string')
  })

  it('handles zh-tw fallback to zh-cn', async () => {
    const dictWithTw = {
      ...dict,
      'zh-tw': { meta: { languageTag: 'zh-TW' } },
    }
    // No zh-tw translation; should fall back to zh-cn
    const result = await translateModulesForLocale([baseModule], dictWithTw, 'zh-tw')
    assert.strictEqual(result[0].name, '测试模块') // Falls back to zh-cn
  })
})
