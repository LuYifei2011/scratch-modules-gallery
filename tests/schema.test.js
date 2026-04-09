import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseContributors, buildModuleRecord } from '../scripts/lib/schema.js'

describe('parseContributors', () => {
  it('returns empty array for null/undefined', () => {
    assert.deepStrictEqual(parseContributors(null), [])
    assert.deepStrictEqual(parseContributors(undefined), [])
  })

  it('parses comma-separated string with gh/ prefix', () => {
    const result = parseContributors('gh/alice, gh/bob')
    assert.deepStrictEqual(result, [
      { name: 'alice', url: 'https://github.com/alice' },
      { name: 'bob', url: 'https://github.com/bob' },
    ])
  })

  it('parses sc/ prefix (Scratch user)', () => {
    const result = parseContributors('sc/scratcher')
    assert.deepStrictEqual(result, [
      { name: 'scratcher', url: 'https://scratch.mit.edu/users/scratcher' },
    ])
  })

  it('parses plain name (no prefix)', () => {
    const result = parseContributors('Alice')
    assert.deepStrictEqual(result, [{ name: 'Alice' }])
  })

  it('parses mixed string', () => {
    const result = parseContributors('gh/dev, sc/user, Plain Name')
    assert.strictEqual(result.length, 3)
    assert.strictEqual(result[0].url, 'https://github.com/dev')
    assert.strictEqual(result[1].url, 'https://scratch.mit.edu/users/user')
    assert.strictEqual(result[2].name, 'Plain Name')
    assert.strictEqual(result[2].url, undefined)
  })

  it('parses array of strings', () => {
    const result = parseContributors(['gh/a', 'sc/b'])
    assert.strictEqual(result.length, 2)
    assert.strictEqual(result[0].url, 'https://github.com/a')
  })

  it('parses array of objects', () => {
    const result = parseContributors([{ name: 'Test', url: 'https://example.com' }])
    assert.deepStrictEqual(result, [{ name: 'Test', url: 'https://example.com' }])
  })

  it('filters out empty entries', () => {
    const result = parseContributors('gh/a, , gh/b')
    assert.strictEqual(result.length, 2)
  })

  it('returns empty array for non-string/non-array', () => {
    assert.deepStrictEqual(parseContributors(42), [])
    assert.deepStrictEqual(parseContributors({}), [])
  })
})

describe('buildModuleRecord', () => {
  it('builds a valid record with required fields', () => {
    const meta = {
      id: 'test-mod',
      name: 'Test Module',
      description: 'A test module.',
      tags: ['math'],
    }
    const extra = {
      scripts: [{ id: 'main', content: 'when flag clicked' }],
      demoFile: undefined,
      notesMap: {},
      translations: {},
    }
    const { record, errors } = buildModuleRecord(meta, extra)
    assert.strictEqual(errors.length, 0)
    assert.strictEqual(record.id, 'test-mod')
    assert.strictEqual(record.slug, 'test-mod')
    assert.strictEqual(record.name, 'Test Module')
    assert.strictEqual(record.description, 'A test module.')
    assert.deepStrictEqual(record.tags, ['math'])
    assert.strictEqual(record.scripts.length, 1)
    assert.strictEqual(record.hasDemo, false)
  })

  it('reports errors for missing required fields', () => {
    const meta = {}
    const extra = { scripts: [], notesMap: {} }
    const { errors } = buildModuleRecord(meta, extra)
    assert.ok(errors.includes('missing id'))
    assert.ok(errors.includes('missing name'))
    assert.ok(errors.includes('missing description'))
    assert.ok(errors.some((e) => e.includes('tags')))
  })

  it('handles i18n map for name field', () => {
    const meta = {
      id: 'i18n-mod',
      name: { en: 'English Name', 'zh-cn': '中文名称' },
      description: 'desc',
      tags: ['test'],
    }
    const extra = { scripts: [], notesMap: {} }
    const { record } = buildModuleRecord(meta, extra)
    // pickDefaultFromMap picks 'en' first
    assert.strictEqual(record.name, 'English Name')
  })

  it('handles contributors in meta', () => {
    const meta = {
      id: 'c',
      name: 'C',
      description: 'D',
      tags: ['x'],
      contributors: 'gh/dev',
    }
    const extra = { scripts: [], notesMap: {} }
    const { record } = buildModuleRecord(meta, extra)
    assert.strictEqual(record.contributors.length, 1)
    assert.strictEqual(record.contributors[0].name, 'dev')
  })

  it('includes variables and references from meta', () => {
    const meta = {
      id: 'v',
      name: 'V',
      description: 'D',
      tags: ['x'],
      variables: [{ name: 'myVar', type: 'variable' }],
      references: [{ title: 'Ref', url: 'https://example.com' }],
    }
    const extra = { scripts: [], notesMap: {} }
    const { record } = buildModuleRecord(meta, extra)
    assert.strictEqual(record.variables.length, 1)
    assert.strictEqual(record.references.length, 1)
  })

  it('sets hasDemo to true when demoFile is provided', () => {
    const meta = { id: 'demo', name: 'D', description: 'D', tags: ['x'] }
    const extra = { scripts: [], demoFile: 'modules/demo/demo.sb3', notesMap: {} }
    const { record } = buildModuleRecord(meta, extra)
    assert.strictEqual(record.hasDemo, true)
    assert.strictEqual(record.demoFile, 'modules/demo/demo.sb3')
  })

  it('handles scriptTitles from meta', () => {
    const meta = {
      id: 'st',
      name: 'ST',
      description: 'D',
      tags: ['x'],
      scriptTitles: { main: 'Main Script' },
    }
    const extra = { scripts: [], notesMap: {} }
    const { record } = buildModuleRecord(meta, extra)
    assert.deepStrictEqual(record.scriptTitles, { main: 'Main Script' })
  })
})
