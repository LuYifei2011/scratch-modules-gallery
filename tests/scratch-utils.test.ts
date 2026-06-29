import { describe, expect, it } from 'bun:test'
import { tokenizeCJK, CATEGORY_COLORS, analyzeBlockCategories } from '../scripts/lib/scratch-utils.ts'

describe('tokenizeCJK', () => {
  it('returns empty array for empty/null input', () => {
    expect(tokenizeCJK('')).toEqual([])
    expect(tokenizeCJK(null)).toEqual([])
    expect(tokenizeCJK(undefined)).toEqual([])
  })

  it('tokenizes English text into words', () => {
    const tokens = tokenizeCJK('hello world')
    expect(tokens.includes('hello')).toBeTruthy()
    expect(tokens.includes('world')).toBeTruthy()
  })

  it('tokenizes CJK characters with single and bigram tokens', () => {
    const tokens = tokenizeCJK('帧率计算')
    // Original full token
    expect(tokens.includes('帧率计算')).toBeTruthy()
    // Single char tokens
    expect(tokens.includes('帧')).toBeTruthy()
    expect(tokens.includes('率')).toBeTruthy()
    expect(tokens.includes('计')).toBeTruthy()
    expect(tokens.includes('算')).toBeTruthy()
    // Bigram tokens (sliding window)
    expect(tokens.includes('帧率')).toBeTruthy()
    expect(tokens.includes('率计')).toBeTruthy()
    expect(tokens.includes('计算')).toBeTruthy()
  })

  it('handles mixed CJK and English', () => {
    const tokens = tokenizeCJK('FPS 帧率')
    expect(tokens.includes('FPS')).toBeTruthy()
    expect(tokens.includes('帧率')).toBeTruthy()
    expect(tokens.includes('帧')).toBeTruthy()
    expect(tokens.includes('率')).toBeTruthy()
  })

  it('produces unique tokens (no duplicates)', () => {
    const tokens = tokenizeCJK('测试测试')
    const unique = new Set(tokens)
    expect(tokens.length).toBe(unique.size)
  })

  it('does not generate bigrams for single CJK char', () => {
    const tokens = tokenizeCJK('帧')
    expect(tokens.includes('帧')).toBeTruthy()
    // Single CJK char should not produce bigrams
    expect(tokens.length).toBe(1)
  })
})

describe('CATEGORY_COLORS', () => {
  it('defines colors for standard Scratch categories', () => {
    expect(CATEGORY_COLORS.motion).toBeTruthy()
    expect(CATEGORY_COLORS.looks).toBeTruthy()
    expect(CATEGORY_COLORS.sound).toBeTruthy()
    expect(CATEGORY_COLORS.control).toBeTruthy()
    expect(CATEGORY_COLORS.events).toBeTruthy()
    expect(CATEGORY_COLORS.sensing).toBeTruthy()
    expect(CATEGORY_COLORS.operators).toBeTruthy()
    expect(CATEGORY_COLORS.variables).toBeTruthy()
    expect(CATEGORY_COLORS.list).toBeTruthy()
    expect(CATEGORY_COLORS.custom).toBeTruthy()
    expect(CATEGORY_COLORS.extension).toBeTruthy()
  })

  it('colors are valid hex values', () => {
    for (const color of Object.values(CATEGORY_COLORS)) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })
})

describe('analyzeBlockCategories', () => {
  it('returns empty array for empty input', () => {
    const result = analyzeBlockCategories([])
    expect(result).toEqual([])
  })

  it('returns empty array for null/undefined scripts', () => {
    const result = analyzeBlockCategories([null, undefined, ''])
    expect(result).toEqual([])
  })

  it('counts motion blocks', () => {
    const result = analyzeBlockCategories(['move (10) steps\nturn cw (15) degrees'])
    expect(result.length > 0).toBeTruthy()
    const motion = result.find((c) => c.category === 'motion')
    expect(motion).toBeTruthy()
    expect(motion!.count >= 2).toBeTruthy()
    expect(motion!.color).toBe(CATEGORY_COLORS.motion!)
  })

  it('counts multiple categories', () => {
    const script = 'when flag clicked\nmove (10) steps\nsay [hello]\nwait (1) seconds'
    const result = analyzeBlockCategories([script])
    expect(result.length >= 2).toBeTruthy()
    // Results should be sorted by count descending
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1]!.count >= result[i]!.count).toBeTruthy()
    }
  })

  it('handles multiple script texts', () => {
    const result = analyzeBlockCategories(['move (10) steps', 'say [hello]', 'move (20) steps'])
    const motion = result.find((c) => c.category === 'motion')
    expect(motion).toBeTruthy()
    expect(motion!.count >= 2).toBeTruthy()
  })

  it('each result has category, count and color', () => {
    const result = analyzeBlockCategories(['when flag clicked\nmove (10) steps'])
    for (const item of result) {
      expect(typeof item.category === 'string').toBeTruthy()
      expect(typeof item.count === 'number').toBeTruthy()
      expect(typeof item.color === 'string').toBeTruthy()
      expect(item.color).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('excludes categories without defined colors', () => {
    const result = analyzeBlockCategories(['when flag clicked\nmove (10) steps'])
    for (const item of result) {
      expect(item.color).toBeTruthy()
    }
  })

  it('skips invalid/unparseable scripts gracefully', () => {
    // 不应抛出异常，无效脚本被跳过
    const result = analyzeBlockCategories(['<<<invalid scratchblocks>>>'])
    expect(Array.isArray(result)).toBeTruthy()
    expect(result).toEqual([])
  })
})
