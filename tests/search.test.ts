// @ts-nocheck
import { describe, expect, it } from 'bun:test'
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
    expect(index).toBeTruthy()
    expect(typeof index === 'object').toBeTruthy()
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
    expect(json.length > 0).toBeTruthy()
    const parsed = JSON.parse(json)
    expect(typeof parsed === 'object').toBeTruthy()
  })

  it('handles empty modules array', () => {
    const index = buildSearchIndex([])
    expect(index).toBeTruthy()
    expect(typeof index === 'object').toBeTruthy()
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
    expect(index).toBeTruthy()
  })
})
