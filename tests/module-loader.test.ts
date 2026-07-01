import { beforeAll, describe, expect, it } from 'bun:test';
import path from 'path';
import fs from 'fs-extra';
import { loadModules } from '../scripts/lib/module-loader.ts';

// 仅复制 .test 和 fps 两个模块到临时目录，避免加载全部模块导致测试过慢
const root = path.resolve('.');
const fixtureRoot = path.join(root, 'tests', '.fixture-modules');
const fixtureModules = path.join(fixtureRoot, 'content', 'modules');
const config = { contentDir: 'content/modules' };

beforeAll(async () => {
  await fs.emptyDir(fixtureModules);
  const srcModules = path.join(root, 'content', 'modules');
  for (const dir of ['.test', 'fps']) {
    const src = path.join(srcModules, dir);
    if (await fs.pathExists(src)) {
      await fs.copy(src, path.join(fixtureModules, dir));
    }
  }
  const fpsMetaFile = path.join(fixtureModules, 'fps', 'meta.json');
  const fpsMeta = await fs.readJson(fpsMetaFile);
  fpsMeta.seoDescription = 'Calculate and display FPS in Scratch.';
  await fs.writeJson(fpsMetaFile, fpsMeta);

  const fpsZhCnFile = path.join(fixtureModules, 'fps', 'i18n', 'zh-cn.json');
  const fpsZhCn = await fs.readJson(fpsZhCnFile);
  fpsZhCn.seoDescription = '在 Scratch 中计算并显示 FPS。';
  await fs.writeJson(fpsZhCnFile, fpsZhCn);
});

describe('loadModules', () => {
  it('loads modules from content directory (dev mode)', async () => {
    const { modules, errorsAll } = await loadModules({
      root: fixtureRoot,
      config,
      isDev: true,
    });
    expect(Array.isArray(modules)).toBeTruthy();
    expect(modules.length).toBe(2);
  });

  it('each module has required fields', async () => {
    const { modules } = await loadModules({ root: fixtureRoot, config, isDev: true });
    for (const m of modules) {
      expect(m.id).toBeTruthy();
      expect(m.slug).toBeTruthy();
      expect(m.name).toBeTruthy();
      expect(m.description).toBeTruthy();
      expect(Array.isArray(m.tags)).toBeTruthy();
      expect(Array.isArray(m.scripts)).toBeTruthy();
      expect(Array.isArray(m.contributors)).toBeTruthy();
    }
  });

  it('loads fps module correctly', async () => {
    const { modules } = await loadModules({ root: fixtureRoot, config, isDev: true });
    const fps = modules.find((m) => m.id === 'fps');
    expect(fps).toBeTruthy();
    expect(fps.name).toBe('FPS Counter');
    expect(fps.scripts.length > 0).toBeTruthy();
    expect(fps.variables.length > 0).toBeTruthy();
    expect(fps.tags).toEqual(['performance']);
  });

  it('loads module translations with all expected fields', async () => {
    const { modules } = await loadModules({ root: fixtureRoot, config, isDev: true });
    const fps = modules.find((m) => m.id === 'fps');
    expect(fps.translations).toBeTruthy();
    expect(fps.translations.en).toBe(undefined);
    expect(fps.translations['zh-cn']).toBeTruthy();
    expect(fps.translations['zh-cn'].name).toBe('帧率计数器');
    expect(fps.translations['zh-cn'].description).toBe('计算帧率（FPS）。');
    expect(fps.translations['zh-cn'].seoDescription).toBe('在 Scratch 中计算并显示 FPS。');
    expect(fps.translations['zh-cn'].variables).toBeTruthy();
    expect(fps.translations['zh-cn'].variables['FPS']).toBe('帧率');
  });

  it('loads baseline seoDescription from meta.json', async () => {
    const { modules } = await loadModules({ root: fixtureRoot, config, isDev: true });
    const fps = modules.find((m) => m.id === 'fps');
    expect(fps.seoDescription).toBe('Calculate and display FPS in Scratch.');
  });

  it('loads module notes', async () => {
    const { modules } = await loadModules({ root: fixtureRoot, config, isDev: true });
    const testMod = modules.find((m) => m.id === '.test');
    expect(testMod).toBeTruthy();
    expect(testMod.notesMap).toBeTruthy();
    expect(testMod.notesMap['en']).toBeTruthy();
    expect(testMod.notesMap['zh-cn']).toBeTruthy();
  });

  it('skips dot-prefixed modules in production mode', async () => {
    const { modules } = await loadModules({ root: fixtureRoot, config, isDev: false });
    const testMod = modules.find((m) => m.id === '.test');
    expect(testMod).toBe(undefined);
  });

  it('parses script file names correctly', async () => {
    const { modules } = await loadModules({ root: fixtureRoot, config, isDev: true });
    const testMod = modules.find((m) => m.id === '.test');
    expect(testMod).toBeTruthy();
    expect(testMod.scripts.length >= 2).toBeTruthy();
    const scriptIds = testMod.scripts.map((s) => s.id);
    expect(scriptIds.includes('main')).toBeTruthy();
    expect(scriptIds.includes('import')).toBeTruthy();
  });

  it('handles missing scripts directory gracefully', async () => {
    const badModDir = path.join(fixtureModules, 'no-scripts');
    await fs.ensureDir(badModDir);
    await fs.writeJson(path.join(badModDir, 'meta.json'), {
      id: 'no-scripts',
      name: 'No Scripts',
      description: 'Missing scripts dir',
      tags: ['test'],
    });
    const { errorsAll } = await loadModules({ root: fixtureRoot, config, isDev: true });
    expect(errorsAll.some((e) => e.includes('no-scripts') && e.includes('missing scripts'))).toBeTruthy();
    await fs.remove(badModDir);
  });

  it('handles invalid meta.json gracefully', async () => {
    const badModDir = path.join(fixtureModules, 'bad-meta');
    await fs.ensureDir(badModDir);
    await fs.writeFile(path.join(badModDir, 'meta.json'), '{ invalid json }');
    const { errorsAll } = await loadModules({ root: fixtureRoot, config, isDev: true });
    expect(errorsAll.some((e) => e.includes('bad-meta') && e.includes('parse error'))).toBeTruthy();
    await fs.remove(badModDir);
  });
});
