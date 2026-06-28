import { describe, it, beforeAll } from 'bun:test'
import assert from 'bun:assert/strict'
import path from 'path'
import fs from 'fs-extra'
import { loadModules } from '../scripts/lib/module-loader.js'

// 仅复制 .test 和 fps 两个模块到临时目录，避免加载全部模块导致测试过慢
const root = path.resolve('.')
const fixtureRoot = path.join(root, 'tests', '.fixture-modules')
const fixtureModules = path.join(fixtureRoot, 'content', 'modules')
const config = { contentDir: 'content/modules' }

beforeAll(async () => {
  await fs.emptyDir(fixtureModules)
  const srcModules = path.join(root, 'content', 'modules')
  for (const dir of ['.test', 'fps']) {
    const src = path.join(srcModules, dir)
    if (await fs.pathExists(src)) {
      await fs.copy(src, path.join(fixtureModules, dir))
    }
  }
})

describe('loadModules', () => {
  it('loads modules from content directory (dev mode)', async () => {
    const { modules, errorsAll, allTags } = await loadModules({
      root: fixtureRoot,
      config,
      isDev: true,
    })
    assert.ok(Array.isArray(modules))
    assert.strictEqual(modules.length, 2, 'Should load exactly .test and fps modules')
    assert.ok(typeof allTags === 'string')
  })

  it('each module has required fields', async () => {
    const { modules } = await loadModules({ root: fixtureRoot, config, isDev: true })
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
    const { modules } = await loadModules({ root: fixtureRoot, config, isDev: true })
    const fps = modules.find((m) => m.id === 'fps')
    assert.ok(fps, 'fps module should be loaded')
    assert.strictEqual(fps.name, 'FPS')
    assert.ok(fps.scripts.length > 0, 'fps should have scripts')
    assert.ok(fps.variables.length > 0, 'fps should have variables')
    assert.deepStrictEqual(fps.tags, ['performance'])
  })

  it('loads module translations with all expected fields', async () => {
    const { modules } = await loadModules({ root: fixtureRoot, config, isDev: true })
    const fps = modules.find((m) => m.id === 'fps')
    assert.ok(fps.translations, 'fps should have translations')
    assert.ok(fps.translations['zh-cn'], 'fps should have zh-cn translation')
    assert.strictEqual(fps.translations['zh-cn'].name, 'FPS')
    assert.strictEqual(fps.translations['zh-cn'].description, '计算FPS。')
    assert.ok(fps.translations['zh-cn'].variables, 'fps zh-cn should have variables map')
    assert.strictEqual(fps.translations['zh-cn'].variables['FPS'], '帧率')
  })

  it('loads module notes', async () => {
    const { modules } = await loadModules({ root: fixtureRoot, config, isDev: true })
    const testMod = modules.find((m) => m.id === '.test')
    assert.ok(testMod, '.test module should be loaded in dev mode')
    assert.ok(testMod.notesMap, '.test should have notesMap')
    assert.ok(testMod.notesMap['en'], '.test should have English notes')
    assert.ok(testMod.notesMap['zh-cn'], '.test should have zh-cn notes')
  })

  it('skips dot-prefixed modules in production mode', async () => {
    const { modules } = await loadModules({ root: fixtureRoot, config, isDev: false })
    const testMod = modules.find((m) => m.id === '.test')
    assert.strictEqual(testMod, undefined, '.test should be skipped in production mode')
  })

  it('parses script file names correctly', async () => {
    const { modules } = await loadModules({ root: fixtureRoot, config, isDev: true })
    const testMod = modules.find((m) => m.id === '.test')
    assert.ok(testMod, '.test module should exist')
    assert.ok(testMod.scripts.length >= 2, '.test should have at least 2 scripts')
    const scriptIds = testMod.scripts.map((s) => s.id)
    assert.ok(scriptIds.includes('main'), 'Should parse 01-main.txt to id "main"')
    assert.ok(scriptIds.includes('import'), 'Should parse 02-import.txt to id "import"')
  })

  it('collects allTags across modules', async () => {
    const { allTags } = await loadModules({ root: fixtureRoot, config, isDev: true })
    assert.ok(allTags.length > 0, 'allTags should not be empty')
    // fps has "performance" tag
    assert.ok(allTags.includes('performance'))
  })

  it('handles missing scripts directory gracefully', async () => {
    const badModDir = path.join(fixtureModules, 'no-scripts')
    await fs.ensureDir(badModDir)
    await fs.writeJson(path.join(badModDir, 'meta.json'), {
      id: 'no-scripts',
      name: 'No Scripts',
      description: 'Missing scripts dir',
      tags: ['test'],
    })
    const { errorsAll } = await loadModules({ root: fixtureRoot, config, isDev: true })
    assert.ok(
      errorsAll.some((e) => e.includes('no-scripts') && e.includes('missing scripts')),
      'Should report missing scripts/ directory'
    )
    await fs.remove(badModDir)
  })

  it('handles invalid meta.json gracefully', async () => {
    const badModDir = path.join(fixtureModules, 'bad-meta')
    await fs.ensureDir(badModDir)
    await fs.writeFile(path.join(badModDir, 'meta.json'), '{ invalid json }')
    const { errorsAll } = await loadModules({ root: fixtureRoot, config, isDev: true })
    assert.ok(
      errorsAll.some((e) => e.includes('bad-meta') && e.includes('parse error')),
      'Should report meta.json parse error'
    )
    await fs.remove(badModDir)
  })
})
