import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { tokenizeCJK, CATEGORY_COLORS, analyzeBlockCategories } from '../scripts/lib/scratch-utils.js'

describe('tokenizeCJK', () => {
  it('returns empty array for empty/null input', () => {
    assert.deepStrictEqual(tokenizeCJK(''), [])
    assert.deepStrictEqual(tokenizeCJK(null), [])
    assert.deepStrictEqual(tokenizeCJK(undefined), [])
  })

  it('tokenizes English text into words', () => {
    const tokens = tokenizeCJK('hello world')
    assert.ok(tokens.includes('hello'))
    assert.ok(tokens.includes('world'))
  })

  it('tokenizes CJK characters with single and bigram tokens', () => {
    const tokens = tokenizeCJK('帧率计算')
    // Original full token
    assert.ok(tokens.includes('帧率计算'))
    // Single char tokens
    assert.ok(tokens.includes('帧'))
    assert.ok(tokens.includes('率'))
    assert.ok(tokens.includes('计'))
    assert.ok(tokens.includes('算'))
    // Bigram tokens (sliding window)
    assert.ok(tokens.includes('帧率'))
    assert.ok(tokens.includes('率计'))
    assert.ok(tokens.includes('计算'))
  })

  it('handles mixed CJK and English', () => {
    const tokens = tokenizeCJK('FPS 帧率')
    assert.ok(tokens.includes('FPS'))
    assert.ok(tokens.includes('帧率'))
    assert.ok(tokens.includes('帧'))
    assert.ok(tokens.includes('率'))
  })

  it('produces unique tokens (no duplicates)', () => {
    const tokens = tokenizeCJK('测试测试')
    const unique = new Set(tokens)
    assert.strictEqual(tokens.length, unique.size)
  })

  it('does not generate bigrams for single CJK char', () => {
    const tokens = tokenizeCJK('帧')
    assert.ok(tokens.includes('帧'))
    // Single CJK char should not produce bigrams
    assert.strictEqual(tokens.length, 1)
  })
})

describe('CATEGORY_COLORS', () => {
  it('defines colors for standard Scratch categories', () => {
    assert.ok(CATEGORY_COLORS.motion)
    assert.ok(CATEGORY_COLORS.looks)
    assert.ok(CATEGORY_COLORS.sound)
    assert.ok(CATEGORY_COLORS.control)
    assert.ok(CATEGORY_COLORS.events)
    assert.ok(CATEGORY_COLORS.sensing)
    assert.ok(CATEGORY_COLORS.operators)
    assert.ok(CATEGORY_COLORS.variables)
    assert.ok(CATEGORY_COLORS.list)
    assert.ok(CATEGORY_COLORS.custom)
    assert.ok(CATEGORY_COLORS.extension)
  })

  it('colors are valid hex values', () => {
    for (const color of Object.values(CATEGORY_COLORS)) {
      assert.match(color, /^#[0-9a-f]{6}$/i)
    }
  })
})

describe('analyzeBlockCategories', () => {
  it('returns empty array for empty input', () => {
    const result = analyzeBlockCategories([])
    assert.deepStrictEqual(result, [])
  })

  it('returns empty array for null/undefined scripts', () => {
    const result = analyzeBlockCategories([null, undefined, ''])
    assert.deepStrictEqual(result, [])
  })

  it('counts motion blocks', () => {
    const result = analyzeBlockCategories(['move (10) steps\nturn cw (15) degrees'])
    assert.ok(result.length > 0)
    const motion = result.find((c) => c.category === 'motion')
    assert.ok(motion, 'Should find motion category')
    assert.ok(motion.count >= 2, 'Should count at least 2 motion blocks')
    assert.strictEqual(motion.color, CATEGORY_COLORS.motion)
  })

  it('counts multiple categories', () => {
    const script = 'when flag clicked\nmove (10) steps\nsay [hello]\nwait (1) seconds'
    const result = analyzeBlockCategories([script])
    assert.ok(result.length >= 2, 'Should detect multiple categories')
    // Results should be sorted by count descending
    for (let i = 1; i < result.length; i++) {
      assert.ok(result[i - 1].count >= result[i].count, 'Should be sorted by count descending')
    }
  })

  it('handles multiple script texts', () => {
    const result = analyzeBlockCategories(['move (10) steps', 'say [hello]', 'move (20) steps'])
    const motion = result.find((c) => c.category === 'motion')
    assert.ok(motion, 'Should find motion from multiple scripts')
    assert.ok(motion.count >= 2)
  })

  it('each result has category, count and color', () => {
    const result = analyzeBlockCategories(['when flag clicked\nmove (10) steps'])
    for (const item of result) {
      assert.ok(typeof item.category === 'string')
      assert.ok(typeof item.count === 'number')
      assert.ok(typeof item.color === 'string')
      assert.match(item.color, /^#[0-9a-f]{6}$/i)
    }
  })

  it('excludes categories without defined colors', () => {
    const result = analyzeBlockCategories(['when flag clicked\nmove (10) steps'])
    for (const item of result) {
      assert.ok(item.color, 'Every result should have a color')
    }
  })

  it('skips invalid/unparseable scripts gracefully', () => {
    // 不应抛出异常，无效脚本被跳过
    const result = analyzeBlockCategories(['<<<invalid scratchblocks>>>'])
    assert.ok(Array.isArray(result))
    assert.deepStrictEqual(result, [])
  })
})
