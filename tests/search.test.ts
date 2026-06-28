import { describe, it } from 'bun:test'
import assert from 'bun:assert/strict'
import { buildSearchIndex } from '../scripts/lib/search.ts'

describe('buildSearchIndex', () => {
  it('builds a valid search index from modules', () => {
    const modules = [
      {
        id: 'fps',
        name: 'FPS Counter',
        description: 'Calculate FPS in Scratch',
        tags: ['performance'],
        keywords: ['frame rate'],
        slug: 'fps',
        hasDemo: false,
      },
      {
        id: 'math-pow',
        name: 'Exponentiation',
        description: 'Compute power of numbers',
        tags: ['math'],
        keywords: ['power', 'exponent'],
        slug: 'math-pow',
        hasDemo: true,
      },
    ]
    const index = buildSearchIndex(modules)
    // Should return a JSON-serializable object (MiniSearch index)
    assert.ok(index)
    assert.ok(typeof index === 'object')
  })

  it('returns valid JSON-serializable output', () => {
    const modules = [
      {
        id: 'test',
        name: 'Test',
        description: 'A test module',
        tags: ['test'],
        keywords: [],
        slug: 'test',
        hasDemo: false,
      },
    ]
    const index = buildSearchIndex(modules)
    // Should be JSON-serializable
    const json = JSON.stringify(index)
    assert.ok(json.length > 0)
    const parsed = JSON.parse(json)
    assert.ok(typeof parsed === 'object')
  })

  it('handles empty modules array', () => {
    const index = buildSearchIndex([])
    assert.ok(index)
    assert.ok(typeof index === 'object')
  })

  it('handles modules with CJK content', () => {
    const modules = [
      {
        id: 'cjk-test',
        name: '帧率计算器',
        description: '在 Scratch 中计算帧率',
        tags: ['性能'],
        keywords: ['帧率'],
        slug: 'cjk-test',
        hasDemo: false,
      },
    ]
    const index = buildSearchIndex(modules)
    assert.ok(index)
  })
})
