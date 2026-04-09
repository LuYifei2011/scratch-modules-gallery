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
