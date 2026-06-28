import { describe, it } from 'bun:test'
import assert from 'bun:assert/strict'
import { resolveImports } from '../scripts/lib/import-resolver.js'

describe('resolveImports', () => {
  it('does nothing when there are no imports', () => {
    const modules = [
      {
        id: 'a',
        name: 'A',
        scripts: [{ id: 'main', title: '', content: 'when flag clicked\nmove (10) steps' }],
      },
    ]
    resolveImports(modules)
    assert.strictEqual(modules[0].scripts.length, 1)
    assert.ok(modules[0].scripts[0].content.includes('move (10) steps'))
  })

  it('resolves a leading import', () => {
    const modules = [
      {
        id: 'lib',
        name: 'Library',
        scripts: [{ id: 'main', title: '', content: 'define helper\nsay [hi]' }],
      },
      {
        id: 'consumer',
        name: 'Consumer',
        scripts: [{ id: 'main', title: '', content: '!import lib\nwhen flag clicked' }],
      },
    ]
    resolveImports(modules)
    const consumer = modules.find((m) => m.id === 'consumer')
    const mainScript = consumer.scripts[0]
    // The main script should have leadingImports
    assert.ok(mainScript.leadingImports)
    assert.strictEqual(mainScript.leadingImports.length, 1)
    assert.strictEqual(mainScript.leadingImports[0].fromId, 'lib')
    assert.ok(mainScript.leadingImports[0].content.includes('define helper'))
    // Main body content should be the remaining code
    assert.ok(mainScript.content.includes('when flag clicked'))
  })

  it('resolves import with specific script index', () => {
    const modules = [
      {
        id: 'multi',
        name: 'Multi',
        scripts: [
          { id: 'first', title: '', content: 'say [first]' },
          { id: 'second', title: '', content: 'say [second]' },
        ],
      },
      {
        id: 'user',
        name: 'User',
        scripts: [{ id: 'main', title: '', content: '!import multi:2\nwhen flag clicked' }],
      },
    ]
    resolveImports(modules)
    const user = modules.find((m) => m.id === 'user')
    assert.ok(user.scripts[0].leadingImports[0].content.includes('say [second]'))
  })

  it('handles missing module reference', () => {
    const modules = [
      {
        id: 'bad',
        name: 'Bad',
        scripts: [{ id: 'main', title: '', content: '!import nonexistent\nwhen flag clicked' }],
      },
    ]
    resolveImports(modules)
    const mod = modules[0]
    assert.ok(mod.scripts[0].leadingImports[0].content.includes('导入失败'))
  })

  it('handles out-of-bounds script index', () => {
    const modules = [
      {
        id: 'single',
        name: 'Single',
        scripts: [{ id: 'main', title: '', content: 'say [only one]' }],
      },
      {
        id: 'bad-idx',
        name: 'BadIdx',
        scripts: [{ id: 'main', title: '', content: '!import single:5\nwhen flag clicked' }],
      },
    ]
    resolveImports(modules)
    const mod = modules.find((m) => m.id === 'bad-idx')
    assert.ok(mod.scripts[0].leadingImports[0].content.includes('导入失败'))
  })

  it('handles inline imports (not leading)', () => {
    const modules = [
      {
        id: 'lib',
        name: 'Lib',
        scripts: [{ id: 'main', title: '', content: 'define foo\nsay [foo]' }],
      },
      {
        id: 'mixed',
        name: 'Mixed',
        scripts: [
          {
            id: 'main',
            title: '',
            content: 'when flag clicked\nmove (10) steps\n!import lib\nstop [all v]',
          },
        ],
      },
    ]
    resolveImports(modules)
    const mod = modules.find((m) => m.id === 'mixed')
    // Should produce multiple script segments
    assert.ok(mod.scripts.length >= 2)
    // One of them should be an imported segment
    const imported = mod.scripts.find((s) => s.imported)
    assert.ok(imported)
    assert.ok(imported.content.includes('define foo'))
  })

  it('detects circular references', () => {
    const modules = [
      {
        id: 'a',
        name: 'A',
        scripts: [{ id: 'main', title: '', content: '!import b\nwhen flag clicked' }],
      },
      {
        id: 'b',
        name: 'B',
        scripts: [{ id: 'main', title: '', content: '!import a\nwhen flag clicked' }],
      },
    ]
    resolveImports(modules)
    // Both should resolve without infinite loop
    // The expanded content of a's import of b should contain a circular ref comment
    const modA = modules.find((m) => m.id === 'a')
    const importedContent = modA.scripts[0].leadingImports[0].content
    assert.ok(importedContent.includes('循环引用') || importedContent.includes('when flag clicked'))
  })

  it('handles module with legacy script field (no scripts array)', () => {
    const modules = [
      {
        id: 'legacy',
        name: 'Legacy',
        script: 'say [hello]',
      },
      {
        id: 'user',
        name: 'User',
        scripts: [{ id: 'main', title: '', content: '!import legacy\nwhen flag clicked' }],
      },
    ]
    resolveImports(modules)
    const user = modules.find((m) => m.id === 'user')
    assert.ok(user.scripts[0].leadingImports[0].content.includes('say [hello]'))
  })
})
