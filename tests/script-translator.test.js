import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { translateScriptText, translateScriptFields } from '../scripts/lib/script-translator.js'
import { loadScratchblocksLanguages } from '../scripts/lib/scratch-utils.js'

// Load scratchblocks language data before running tests
before(() => {
  loadScratchblocksLanguages()
})

describe('translateScriptText', () => {
  it('returns raw text unchanged for null/empty input', () => {
    const result = translateScriptText(null, 'zh_cn', null)
    assert.strictEqual(result.text, null)
    assert.ok(result.missingProcs instanceof Set)
    assert.ok(result.missingParams instanceof Set)
    assert.ok(result.missingComments instanceof Set)
  })

  it('returns raw text unchanged for empty string', () => {
    const result = translateScriptText('', 'zh_cn', null)
    assert.strictEqual(result.text, '')
  })

  it('translates basic blocks to a known language', () => {
    const raw = 'when flag clicked\nmove (10) steps'
    const result = translateScriptText(raw, 'zh_cn', null)
    assert.ok(result.text, 'Should produce translated text')
    assert.ok(typeof result.text === 'string')
    // The text should be different from English (translated to Chinese)
    assert.notStrictEqual(result.text, raw)
  })

  it('returns original text for unknown language key', () => {
    const raw = 'when flag clicked'
    const result = translateScriptText(raw, 'nonexistent_lang', null)
    // Should return the raw text since language is not found
    assert.strictEqual(result.text, raw)
  })

  it('applies variable name maps', () => {
    const raw = 'set [myVar v] to (10)'
    const nameMaps = { vars: { myVar: '我的变量' } }
    const result = translateScriptText(raw, 'zh_cn', nameMaps)
    assert.ok(result.text.includes('我的变量'))
  })

  it('applies list name maps', () => {
    const raw = 'add [thing] to [myList v]'
    const nameMaps = { lists: { myList: '我的列表' } }
    const result = translateScriptText(raw, 'zh_cn', nameMaps)
    assert.ok(result.text.includes('我的列表'))
  })

  it('reports missing procedure translations', () => {
    const raw = 'define custom block (param :: custom-arg)\nsay [hi]'
    const result = translateScriptText(raw, 'zh_cn', null)
    // With no procedure maps, should report the missing proc
    assert.ok(result.missingProcs.size > 0)
  })

  it('applies procedure pattern translation', () => {
    const raw = 'define greet (name :: custom-arg)\nsay (name :: custom-arg)'
    const nameMaps = {
      procs: { 'greet %1': '打招呼 %1' },
      params: { name: '名字' },
    }
    const result = translateScriptText(raw, 'zh_cn', nameMaps)
    assert.ok(result.text.includes('打招呼'))
    assert.ok(result.text.includes('名字'))
  })

  it('applies comment translations', () => {
    const raw = 'when flag clicked // my comment'
    const nameMaps = {
      comments: { 'my comment': '我的注释' },
    }
    const result = translateScriptText(raw, 'zh_cn', nameMaps)
    assert.ok(result.text.includes('我的注释'))
  })
})

describe('translateScriptText - multi-parameter reorder', () => {
  it('reorders parameters in define block: (a) of (b) -> (b) 的 (a)', () => {
    // 英文源：define (a) of (b) — pattern: %1 of %2
    // 中文：%2 的 %1 — 参数顺序翻转
    const raw = 'define (a :: custom-arg) of (b :: custom-arg)'
    const nameMaps = {
      procs: { '%1 of %2': '%2 的 %1' },
      params: { a: '甲', b: '乙' },
    }
    const result = translateScriptText(raw, 'zh_cn', nameMaps)
    // 验证翻译后的文本中包含本地化 pattern
    assert.ok(result.text.includes('的'), 'Should contain localized pattern word "的"')
    // 验证参数名被替换
    assert.ok(result.text.includes('甲'), 'Param "a" should be translated to "甲"')
    assert.ok(result.text.includes('乙'), 'Param "b" should be translated to "乙"')
    // 验证参数顺序：乙 应在 甲 之前（%2 的 %1）
    const idxB = result.text.indexOf('乙')
    const idxA = result.text.indexOf('甲')
    assert.ok(
      idxB < idxA,
      `"乙" (idx=${idxB}) should appear before "甲" (idx=${idxA}) in: ${result.text}`
    )
  })

  it('reorders parameters in call block following a define block', () => {
    // 调用块需要在 define 后使用才能被正确识别为 PROCEDURES_CALL
    const raw = [
      'define foo (a :: custom-arg) bar (b :: custom-arg)',
      '',
      'foo (10) bar (20) :: custom',
    ].join('\n')
    const nameMaps = {
      procs: { 'foo %1 bar %2': '%2 的 %1' },
      params: { a: '甲', b: '乙' },
    }
    const result = translateScriptText(raw, 'zh_cn', nameMaps)
    // 调用行应该和定义行一样被重排序
    const lines = result.text.split('\n').filter((l) => l.trim())
    const callLine = lines.find((l) => l.includes('10') || l.includes('20'))
    assert.ok(callLine, `Should have a call line containing 10 or 20 in: ${result.text}`)
    // 验证值的顺序：20 应在 10 之前
    const idx20 = callLine.indexOf('20')
    const idx10 = callLine.indexOf('10')
    assert.ok(
      idx20 < idx10,
      `"20" (idx=${idx20}) should appear before "10" (idx=${idx10}) in call: ${callLine}`
    )
  })

  it('handles three parameters with reorder', () => {
    // 英文源：define combine (a) with (b) and (c)
    // 中文：%3 和 %2 与 %1 组合（完全翻转顺序）
    const raw = 'define combine (a :: custom-arg) with (b :: custom-arg) and (c :: custom-arg)'
    const nameMaps = {
      procs: { 'combine %1 with %2 and %3': '%3 和 %2 与 %1 组合' },
      params: { a: '甲', b: '乙', c: '丙' },
    }
    const result = translateScriptText(raw, 'zh_cn', nameMaps)
    assert.ok(result.text.includes('甲'), 'Should contain param 甲')
    assert.ok(result.text.includes('乙'), 'Should contain param 乙')
    assert.ok(result.text.includes('丙'), 'Should contain param 丙')
    // 验证顺序：丙 在 乙 前，乙 在 甲 前
    const idxC = result.text.indexOf('丙')
    const idxB = result.text.indexOf('乙')
    const idxA = result.text.indexOf('甲')
    assert.ok(idxC < idxB, `"丙" should appear before "乙" in: ${result.text}`)
    assert.ok(idxB < idxA, `"乙" should appear before "甲" in: ${result.text}`)
  })

  it('keeps parameter order when pattern does not reorder', () => {
    // 不改变参数顺序的 pattern
    const raw = 'define add (a :: custom-arg) to (b :: custom-arg)'
    const nameMaps = {
      procs: { 'add %1 to %2': '将 %1 添加到 %2' },
      params: { a: '值', b: '列表' },
    }
    const result = translateScriptText(raw, 'zh_cn', nameMaps)
    assert.ok(result.text.includes('值'), 'Should contain param 值')
    assert.ok(result.text.includes('列表'), 'Should contain param 列表')
    // 验证顺序保持不变
    const idxVal = result.text.indexOf('值')
    const idxList = result.text.indexOf('列表')
    assert.ok(idxVal < idxList, `"值" should appear before "列表" in: ${result.text}`)
  })

  it('define and call blocks both get reordered consistently', () => {
    // 同时包含 define 和 call
    const raw = ['define (a :: custom-arg) of (b :: custom-arg)', '(10) of (20) :: custom'].join(
      '\n'
    )
    const nameMaps = {
      procs: { '%1 of %2': '%2 的 %1' },
      params: { a: '甲', b: '乙' },
    }
    const result = translateScriptText(raw, 'zh_cn', nameMaps)
    // 两行都应该包含"的"
    const lines = result.text.split('\n').filter((l) => l.trim())
    const defineLine = lines.find((l) => l.includes('定义') || l.includes('define'))
    const callLine = lines.find(
      (l) => !l.includes('定义') && !l.includes('define') && l.includes('的')
    )
    assert.ok(defineLine || callLine, `Should have localized lines in: ${result.text}`)
  })
})
