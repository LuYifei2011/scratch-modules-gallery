import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'path'
import { loadModules } from '../scripts/lib/module-loader.js'

const root = path.resolve('.')
const config = {
  contentDir: 'content/modules',
}

describe('loadModules', () => {
  it('loads modules from content directory (dev mode)', async () => {
    const { modules, errorsAll, allTags } = await loadModules({ root, config, isDev: true })
    assert.ok(Array.isArray(modules))
    assert.ok(modules.length > 0, 'Should load at least one module')
    assert.ok(typeof allTags === 'string')
  })

  it('each module has required fields', async () => {
    const { modules } = await loadModules({ root, config, isDev: true })
    for (const m of modules) {
      assert.ok(m.id, `Module should have id: ${JSON.stringify(m)}`)
      assert.ok(m.slug, `Module should have slug`)
      assert.ok(m.name, `Module ${m.id} should have name`)
      assert.ok(m.description, `Module ${m.id} should have description`)
      assert.ok(Array.isArray(m.tags), `Module ${m.id} should have tags array`)
      assert.ok(Array.isArray(m.scripts), `Module ${m.id} should have scripts array`)
      assert.ok(Array.isArray(m.contributors), `Module ${m.id} should have contributors array`)
    }
  })

  it('loads fps module correctly', async () => {
    const { modules } = await loadModules({ root, config, isDev: true })
    const fps = modules.find((m) => m.id === 'fps')
    assert.ok(fps, 'fps module should be loaded')
    assert.strictEqual(fps.name, 'FPS')
    assert.ok(fps.scripts.length > 0, 'fps should have scripts')
    assert.ok(fps.variables.length > 0, 'fps should have variables')
    assert.deepStrictEqual(fps.tags, ['performance'])
  })

  it('loads module translations', async () => {
    const { modules } = await loadModules({ root, config, isDev: true })
    const fps = modules.find((m) => m.id === 'fps')
    assert.ok(fps.translations, 'fps should have translations')
    assert.ok(fps.translations['zh-cn'], 'fps should have zh-cn translation')
    assert.strictEqual(fps.translations['zh-cn'].name, 'FPS')
  })

  it('loads module notes', async () => {
    const { modules } = await loadModules({ root, config, isDev: true })
    const testMod = modules.find((m) => m.id === '.test')
    assert.ok(testMod, '.test module should be loaded in dev mode')
    assert.ok(testMod.notesMap, '.test should have notesMap')
    assert.ok(testMod.notesMap['en'], '.test should have English notes')
    assert.ok(testMod.notesMap['zh-cn'], '.test should have zh-cn notes')
  })

  it('skips dot-prefixed modules in production mode', async () => {
    const { modules } = await loadModules({ root, config, isDev: false })
    const testMod = modules.find((m) => m.id === '.test')
    assert.strictEqual(testMod, undefined, '.test should be skipped in production mode')
  })

  it('parses script file names correctly', async () => {
    const { modules } = await loadModules({ root, config, isDev: true })
    const testMod = modules.find((m) => m.id === '.test')
    if (testMod) {
      // .test has 01-main.txt and 02-import.txt
      assert.ok(testMod.scripts.length >= 2, '.test should have at least 2 scripts')
      const scriptIds = testMod.scripts.map((s) => s.id)
      assert.ok(scriptIds.includes('main'), 'Should parse 01-main.txt to id "main"')
      assert.ok(scriptIds.includes('import'), 'Should parse 02-import.txt to id "import"')
    }
  })

  it('collects allTags across modules', async () => {
    const { allTags } = await loadModules({ root, config, isDev: true })
    assert.ok(allTags.length > 0, 'allTags should not be empty')
    // fps has "performance" tag
    assert.ok(allTags.includes('performance'))
  })
})
