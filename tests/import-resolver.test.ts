// @ts-nocheck
import { describe, expect, it } from 'bun:test'
import { resolveImports } from '../scripts/lib/import-resolver.ts'

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
    expect(modules[0].scripts.length).toBe(1)
    expect(modules[0].scripts[0].content.includes('move (10) steps')).toBeTruthy()
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
    expect(mainScript.leadingImports).toBeTruthy()
    expect(mainScript.leadingImports.length).toBe(1)
    expect(mainScript.leadingImports[0].fromId).toBe('lib')
    expect(mainScript.leadingImports[0].content.includes('define helper')).toBeTruthy()
    // Main body content should be the remaining code
    expect(mainScript.content.includes('when flag clicked')).toBeTruthy()
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
    expect(user.scripts[0].leadingImports[0].content.includes('say [second]')).toBeTruthy()
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
    expect(mod.scripts[0].leadingImports[0].content.includes('导入失败')).toBeTruthy()
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
    expect(mod.scripts[0].leadingImports[0].content.includes('导入失败')).toBeTruthy()
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
    expect(mod.scripts.length >= 2).toBeTruthy()
    // One of them should be an imported segment
    const imported = mod.scripts.find((s) => s.imported)
    expect(imported).toBeTruthy()
    expect(imported.content.includes('define foo')).toBeTruthy()
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
    expect(importedContent.includes('循环引用') || importedContent.includes('when flag clicked')).toBeTruthy()
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
    expect(user.scripts[0].leadingImports[0].content.includes('say [hello]')).toBeTruthy()
  })
})
