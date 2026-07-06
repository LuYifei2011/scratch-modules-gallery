import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'fs-extra';
import path from 'path';
import { createMtimePathHelpers } from '../scripts/lib/mtime-paths.ts';
import type { ModuleRecord } from '../scripts/lib/types.ts';
import { makeTestTempDir, removeTestTempDir } from './helpers/temp.ts';

let fixtureRoot = '';

async function touch(relativePath: string) {
  const fullPath = path.join(fixtureRoot, relativePath);
  await fs.ensureDir(path.dirname(fullPath));
  await fs.writeFile(fullPath, '');
}

describe('mtime path helpers', () => {
  beforeEach(async () => {
    fixtureRoot = await makeTestTempDir('scratch-mtime-paths');
  });

  afterEach(async () => {
    await removeTestTempDir(fixtureRoot);
    fixtureRoot = '';
  });

  it('keeps module lastmod paths scoped to shared content and the target locale', async () => {
    await Promise.all([
      touch('content/modules/fps/meta.json'),
      touch('content/modules/fps/scripts/01-main.txt'),
      touch('content/modules/fps/i18n/zh-cn.json'),
      touch('content/modules/fps/i18n/zh-tw.json'),
      touch('content/modules/fps/notes/zh-cn.md'),
      touch('content/modules/fps/notes/en.md'),
      touch('src/templates/layouts/base.eta'),
      touch('src/templates/layouts/module.eta'),
      touch('src/i18n/zh-cn.json'),
      touch('src/i18n/tags.json'),
    ]);
    const helpers = createMtimePathHelpers({ root: fixtureRoot, contentDir: 'content/modules' });
    const module: ModuleRecord = {
      id: 'fps',
      slug: 'fps',
      tags: [],
      keywords: [],
      scripts: [],
    };

    await expect(helpers.moduleMtimePaths(module, 'zh-cn')).resolves.toEqual([
      'content/modules/fps/meta.json',
      'content/modules/fps/scripts',
      'content/modules/fps/i18n/zh-cn.json',
      'content/modules/fps/notes/zh-cn.md',
    ]);
  });

  it('does not include missing target locale module files', async () => {
    await Promise.all([touch('content/modules/fps/meta.json'), touch('content/modules/fps/scripts/01-main.txt')]);
    const helpers = createMtimePathHelpers({ root: fixtureRoot, contentDir: 'content/modules' });
    const module: ModuleRecord = {
      id: 'fps',
      slug: 'fps',
      tags: [],
      keywords: [],
      scripts: [],
    };

    await expect(helpers.moduleMtimePaths(module, 'en')).resolves.toEqual([
      'content/modules/fps/meta.json',
      'content/modules/fps/scripts',
    ]);
  });

  it('keeps home and about paths language-specific', async () => {
    await Promise.all([
      touch('src/templates/layouts/base.eta'),
      touch('src/templates/layouts/home.eta'),
      touch('src/templates/layouts/about.eta'),
      touch('src/i18n/en.json'),
      touch('src/i18n/zh-cn.json'),
    ]);
    const helpers = createMtimePathHelpers({ root: fixtureRoot, contentDir: 'content/modules' });

    await expect(helpers.homeMtimePaths('zh-cn')).resolves.toEqual([
      'src/templates/layouts/base.eta',
      'src/templates/layouts/home.eta',
      'src/i18n/zh-cn.json',
    ]);
    await expect(helpers.aboutMtimePaths('en')).resolves.toEqual([
      'src/templates/layouts/base.eta',
      'src/templates/layouts/about.eta',
      'src/i18n/en.json',
    ]);
  });
});
