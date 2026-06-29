// @ts-nocheck
import { describe, expect, it } from 'bun:test'
import { translateModulesForLocale } from '../scripts/lib/i18n-engine.ts'

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
    expect(result.length).toBe(1)
    expect(result[0].name).toBe('测试模块')
    expect(result[0].description).toBe('一个测试模块')
  })

  it('preserves original values for en locale', async () => {
    const result = await translateModulesForLocale([baseModule], dict, 'en')
    expect(result[0].name).toBe('Test Module')
    expect(result[0].description).toBe('A test module')
  })

  it('localizes variable displayName', async () => {
    const result = await translateModulesForLocale([baseModule], dict, 'zh-cn')
    const vars = result[0].variables
    const myVar = vars.find((v) => v.name === 'myVar')
    expect(myVar.displayName).toBe('我的变量')
    const myList = vars.find((v) => v.name === 'myList')
    expect(myList.displayName).toBe('我的列表')
  })

  it('localizes script titles', async () => {
    const result = await translateModulesForLocale([baseModule], dict, 'zh-cn')
    expect(result[0].scripts[0].title).toBe('主脚本')
  })

  it('applies global tags translations', async () => {
    const globalTags = {
      performance: { 'zh-cn': '性能', 'zh-tw': '效能' },
    }
    const result = await translateModulesForLocale([baseModule], dict, 'zh-cn', globalTags)
    expect(result[0].tags.includes('性能')).toBeTruthy()
  })

  it('selects correct notes by locale priority', async () => {
    const result = await translateModulesForLocale([baseModule], dict, 'zh-cn')
    // zh-cn notes should be selected, rendered as HTML
    expect(result[0].notesHtml.includes('中文备注')).toBeTruthy()
  })

  it('falls back to en notes when locale not available', async () => {
    const modNoZh = {
      ...baseModule,
      notesMap: { en: '# English only' },
      translations: {},
    }
    const result = await translateModulesForLocale([modNoZh], dict, 'zh-cn')
    expect(result[0].notesHtml.includes('English only')).toBeTruthy()
  })

  it('produces empty notesHtml when no notes exist', async () => {
    const modNoNotes = { ...baseModule, notesMap: {}, translations: {} }
    const result = await translateModulesForLocale([modNoNotes], dict, 'en')
    expect(result[0].notesHtml).toBe('')
  })

  it('computes keywordsFinal (merged keywords + tags, deduplicated)', async () => {
    const result = await translateModulesForLocale([baseModule], dict, 'en')
    expect(Array.isArray(result[0].keywordsFinal)).toBeTruthy()
    expect(result[0].keywordsFinalStr.length > 0).toBeTruthy()
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
    expect(result.length).toBe(1)
    expect(result[0].name).toBe('Simple') // falls back to original
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
    const result = await translateModulesForLocale([modNoTitles], dict, 'zh-cn', {}, { moduleDefaults })
    // Should pick up scriptTitles from moduleDefaults
    expect(result[0].scripts[0].title).toBe('默认主脚本')
  })

  it('module translations override moduleDefaults', async () => {
    const moduleDefaults = {
      'zh-cn': {
        scriptTitles: { main: '默认主脚本' },
      },
    }
    const result = await translateModulesForLocale([baseModule], dict, 'zh-cn', {}, { moduleDefaults })
    // Module's own 'main' title should override the default
    expect(result[0].scripts[0].title).toBe('主脚本')
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
    await translateModulesForLocale([baseModule], dict, 'zh-cn', {}, {}, { translateScriptText: mockTranslate })
    expect(callArgs.length > 0).toBeTruthy()
    // Verify the language key passed matches the expected value (zh-CN → zh_cn)
    expect(callArgs[0].langKey).toBe('zh_cn')
    // Verify raw script content is passed
    expect(typeof callArgs[0].raw === 'string').toBeTruthy()
  })

  it('handles zh-tw fallback to zh-cn', async () => {
    const dictWithTw = {
      ...dict,
      'zh-tw': { meta: { languageTag: 'zh-TW' } },
    }
    // No zh-tw translation; should fall back to zh-cn
    const result = await translateModulesForLocale([baseModule], dictWithTw, 'zh-tw')
    expect(result[0].name).toBe('测试模块') // Falls back to zh-cn
  })

  it('fills in name from translation when meta name is empty', async () => {
    const mod = {
      ...baseModule,
      name: '', // 空的 metadata name
      translations: {
        'zh-cn': {
          name: '翻译补全的名称',
          description: '翻译补全的描述',
        },
      },
    }
    const result = await translateModulesForLocale([mod], dict, 'zh-cn')
    expect(result[0].name).toBe('翻译补全的名称')
  })

  it('fills in description from translation when meta description is empty', async () => {
    const mod = {
      ...baseModule,
      description: '', // 空的 metadata description
      translations: {
        'zh-cn': {
          name: '名称',
          description: '翻译补全的描述',
        },
      },
    }
    const result = await translateModulesForLocale([mod], dict, 'zh-cn')
    expect(result[0].description).toBe('翻译补全的描述')
  })

  it('fills in variable displayName from translation even when meta has no name value', async () => {
    const mod = {
      ...baseModule,
      variables: [{ name: 'emptyDisplay', scope: 'global', type: 'variable' }],
      translations: {
        'zh-cn': {
          variables: { emptyDisplay: '翻译变量名' },
        },
      },
    }
    const result = await translateModulesForLocale([mod], dict, 'zh-cn')
    const v = result[0].variables.find((x) => x.name === 'emptyDisplay')
    expect(v.displayName).toBe('翻译变量名')
  })

  it('fills in script title from translation when meta has no scriptTitles', async () => {
    const mod = {
      ...baseModule,
      scriptTitles: {}, // 空的 scriptTitles
      translations: {
        'zh-cn': {
          scriptTitles: { main: '翻译标题' },
        },
      },
    }
    const result = await translateModulesForLocale([mod], dict, 'zh-cn')
    expect(result[0].scripts[0].title).toBe('翻译标题')
  })

  it('uses en translation to fill missing meta fields when no locale translation', async () => {
    const mod = {
      ...baseModule,
      name: '',
      description: '',
      translations: {
        en: {
          name: 'English Fallback Name',
          description: 'English Fallback Desc',
        },
        // no zh-cn translation
      },
    }
    const result = await translateModulesForLocale([mod], dict, 'zh-cn')
    // Should fall back to en translation
    expect(result[0].name).toBe('English Fallback Name')
    expect(result[0].description).toBe('English Fallback Desc')
  })

  it('localizes fromName for inline imported scripts (top-level s.imported)', async () => {
    const sourceModule = {
      id: 'lib',
      name: 'Library',
      description: 'lib',
      tags: [],
      keywords: [],
      scripts: [{ id: 'main', content: 'say [hello]' }],
      variables: [],
      notesMap: {},
      scriptTitles: {},
      translations: {
        'zh-cn': { name: '库模块' },
      },
    }
    // Consumer has an inline import (import in the middle of the script)
    const consumerModule = {
      id: 'consumer',
      name: 'Consumer',
      description: 'uses lib',
      tags: [],
      keywords: [],
      scripts: [
        { id: 'main', content: 'when flag clicked\nmove (10) steps' },
        {
          imported: true,
          content: 'say [hello]',
          fromId: 'lib',
          fromName: 'Library',
          fromIndex: 1,
          fromTitle: '',
          fromScriptId: 'main',
        },
        { id: undefined, content: 'stop [all v]' },
      ],
      variables: [],
      notesMap: {},
      scriptTitles: {},
      translations: { 'zh-cn': { name: '使用者' } },
    }
    const result = await translateModulesForLocale([sourceModule, consumerModule], dict, 'zh-cn')
    const consumer = result.find((m) => m.id === 'consumer')
    const importedScript = consumer.scripts.find((s) => s.imported)
    // fromName should be localized using source module's zh-cn translation
    expect(importedScript.fromName).toBe('库模块')
  })

  it('applies moduleDefaults when translating imported block content', async () => {
    const sourceModule = {
      id: 'source',
      name: 'Source',
      description: 'source',
      tags: [],
      keywords: [],
      scripts: [{ id: 'main', content: 'set [result v] to (0)' }],
      variables: [{ name: 'result', type: 'variable' }],
      notesMap: {},
      scriptTitles: {},
      translations: {}, // no own translations; relies on moduleDefaults
    }
    const consumerModule = {
      id: 'consumer',
      name: 'Consumer',
      description: 'uses source',
      tags: [],
      keywords: [],
      scripts: [
        {
          id: 'main',
          content: 'when flag clicked',
          leadingImports: [
            {
              imported: true,
              content: 'set [result v] to (0)',
              fromId: 'source',
              fromName: 'Source',
              fromIndex: 1,
              fromTitle: '',
              fromScriptId: 'main',
            },
          ],
        },
      ],
      variables: [],
      notesMap: {},
      scriptTitles: {},
      translations: { 'zh-cn': { name: '使用者' } },
    }
    const moduleDefaults = {
      'zh-cn': { variables: { result: '结果' } },
    }
    const capturedCalls = []
    const mockTranslate = (raw, langKey, nameMaps) => {
      capturedCalls.push({ raw, vars: nameMaps?.vars })
      return {
        text: raw,
        missingProcs: new Set(),
        missingParams: new Set(),
        missingComments: new Set(),
      }
    }
    await translateModulesForLocale(
      [sourceModule, consumerModule],
      dict,
      'zh-cn',
      {},
      { moduleDefaults },
      { translateScriptText: mockTranslate }
    )
    // The leading import translation call should have the moduleDefaults variable map applied
    const importCall = capturedCalls.find((c) => c.raw.includes('result'))
    expect(importCall).toBeTruthy()
    expect(importCall.vars).toEqual({ result: '结果' })
  })

  it('applies moduleDefaults scriptTitles as fromTitle for imported scripts', async () => {
    const sourceModule = {
      id: 'source',
      name: 'Source',
      description: 'source',
      tags: [],
      keywords: [],
      scripts: [{ id: 'main', content: 'say [hi]' }],
      variables: [],
      notesMap: {},
      scriptTitles: {},
      translations: {}, // no own scriptTitles translation
    }
    const consumerModule = {
      id: 'consumer',
      name: 'Consumer',
      description: 'uses source',
      tags: [],
      keywords: [],
      scripts: [
        {
          imported: true,
          content: 'say [hi]',
          fromId: 'source',
          fromName: 'Source',
          fromIndex: 1,
          fromTitle: '',
          fromScriptId: 'main',
        },
      ],
      variables: [],
      notesMap: {},
      scriptTitles: {},
      translations: { 'zh-cn': { name: '使用者' } },
    }
    const moduleDefaults = {
      'zh-cn': { scriptTitles: { main: '主脚本' } },
    }
    const result = await translateModulesForLocale(
      [sourceModule, consumerModule],
      dict,
      'zh-cn',
      {},
      { moduleDefaults }
    )
    const consumer = result.find((m) => m.id === 'consumer')
    const importedScript = consumer.scripts.find((s) => s.imported)
    // fromTitle should be resolved from moduleDefaults when module has no own scriptTitle translation
    expect(importedScript.fromTitle).toBe('主脚本')
  })

  it('translates scratchblocks in notes markdown when notes come from a fallback locale', async () => {
    const translatedTexts = []
    const mockTranslate = (raw, langKey, nameMaps) => {
      translatedTexts.push(raw)
      // Simulate translation: prefix with translated marker
      return {
        text: `[translated:${langKey}] ${raw}`,
        missingProcs: new Set(),
        missingParams: new Set(),
        missingComments: new Set(),
      }
    }
    // Module only has English notes - zh-cn page should translate its scratchblocks
    const modWithEnOnlyNotes = {
      ...baseModule,
      notesMap: {
        en: '# Notes\n\n<scratchblocks>\nwhen green flag clicked\n</scratchblocks>\n\nInline: <sb>move (10) steps</sb>',
      },
      translations: { 'zh-cn': { name: '测试' } },
    }
    const result = await translateModulesForLocale(
      [modWithEnOnlyNotes],
      dict,
      'zh-cn',
      {},
      {},
      { translateScriptText: mockTranslate }
    )
    // scratchblocks block and inline sb should have been translated (fallback from en to zh-cn)
    const html = result[0].notesHtml
    expect(html.includes('[translated:zh_cn]')).toBeTruthy()
    expect(html.includes('when green flag clicked')).toBeTruthy()
  })

  it('does not translate scratchblocks in notes when notes are already in target locale', async () => {
    const mockTranslate = (raw, langKey, nameMaps) => {
      return {
        text: `[translated] ${raw}`,
        missingProcs: new Set(),
        missingParams: new Set(),
        missingComments: new Set(),
      }
    }
    // Module has zh-cn notes - zh-cn page should NOT re-translate its scratchblocks
    const modWithZhCnNotes = {
      ...baseModule,
      notesMap: {
        en: '# English Notes\n\n<scratchblocks>\nwhen green flag clicked\n</scratchblocks>',
        'zh-cn': '# 中文备注\n\n<scratchblocks>\n当绿旗被点击\n</scratchblocks>',
      },
      translations: { 'zh-cn': { name: '测试' } },
    }
    const result = await translateModulesForLocale(
      [modWithZhCnNotes],
      dict,
      'zh-cn',
      {},
      {},
      { translateScriptText: mockTranslate }
    )
    const html = result[0].notesHtml
    // zh-cn notes should be used as-is (no re-translation)
    expect(!html.includes('[translated]')).toBeTruthy()
    expect(html.includes('当绿旗被点击')).toBeTruthy()
  })

  it('does not translate scratchblocks in notes for English locale', async () => {
    const mockTranslate = (raw, langKey, nameMaps) => {
      return {
        text: `[translated] ${raw}`,
        missingProcs: new Set(),
        missingParams: new Set(),
        missingComments: new Set(),
      }
    }
    const modWithNotes = {
      ...baseModule,
      notesMap: {
        en: '# Notes\n\n<scratchblocks>\nwhen green flag clicked\n</scratchblocks>',
      },
    }
    const result = await translateModulesForLocale(
      [modWithNotes],
      dict,
      'en',
      {},
      {},
      { translateScriptText: mockTranslate }
    )
    const html = result[0].notesHtml
    // English locale should NOT translate notes scratchblocks
    expect(!html.includes('[translated]')).toBeTruthy()
    expect(html.includes('when green flag clicked')).toBeTruthy()
  })
})
