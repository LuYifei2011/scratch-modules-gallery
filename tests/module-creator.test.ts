import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import path from 'path';
import fs from 'fs-extra';
import {
  createModuleScaffold,
  DEFAULT_MODULE_SCRIPT,
  ModuleCreatorError,
  normalizeScriptContent,
  validateModuleId,
} from '../scripts/lib/module-creator.ts';
import { makeTestTempDir, removeTestTempDir } from './helpers/temp.ts';

let fixtureRoot = '';
let modulesDir = '';

beforeEach(async () => {
  fixtureRoot = await makeTestTempDir('scratch-module-creator');
  modulesDir = path.join(fixtureRoot, 'modules');
  await fs.ensureDir(modulesDir);
});

afterEach(async () => {
  await removeTestTempDir(fixtureRoot);
  fixtureRoot = '';
  modulesDir = '';
});

describe('module creator', () => {
  it('creates the minimal editor-compatible module scaffold', async () => {
    const result = await createModuleScaffold({
      modulesDir,
      id: 'new-module',
      meta: {
        name: 'New Module',
        description: 'A module created from tests',
        tags: ['utility', ' demo '],
        keywords: ['scratch'],
        contributors: 'gh/example',
      },
    });

    expect(result.moduleDir).toBe(path.join(modulesDir, 'new-module'));
    expect(await fs.readJson(path.join(result.moduleDir, 'meta.json'))).toEqual({
      id: 'new-module',
      name: 'New Module',
      description: 'A module created from tests',
      tags: ['utility', 'demo'],
      keywords: ['scratch'],
      contributors: 'gh/example',
    });
    expect(await fs.readFile(path.join(result.moduleDir, 'scripts', '01-main.txt'), 'utf8')).toBe(
      DEFAULT_MODULE_SCRIPT
    );
  });

  it('normalizes custom script content to LF with one trailing newline', async () => {
    const result = await createModuleScaffold({
      modulesDir,
      id: 'custom-script',
      meta: { name: 'Custom Script', description: 'Has custom script' },
      scriptContent: 'say [hi]\r\n\n',
    });

    expect(await fs.readFile(result.scriptPath, 'utf8')).toBe('say [hi]\n');
    expect(normalizeScriptContent('say [hi]\r\n')).toBe('say [hi]\n');
  });

  it('rejects invalid module ids and traversal attempts', () => {
    for (const id of ['', '.', '..', '../x', 'a/b', 'a\\b', 'UPPER']) {
      expect(() => validateModuleId(id, modulesDir)).toThrow(ModuleCreatorError);
    }
  });

  it('rejects missing required metadata', async () => {
    await expect(
      createModuleScaffold({ modulesDir, id: 'missing-name', meta: { description: 'Only desc' } })
    ).rejects.toThrow('Missing required fields: name, description');
  });

  it('rejects duplicate modules', async () => {
    await createModuleScaffold({
      modulesDir,
      id: 'dupe',
      meta: { name: 'Dupe', description: 'First' },
    });

    await expect(
      createModuleScaffold({
        modulesDir,
        id: 'dupe',
        meta: { name: 'Dupe', description: 'Second' },
      })
    ).rejects.toMatchObject({ status: 409 });
  });

  it('keeps editor-compatible tag defaults and requires keywords to be an array when provided', async () => {
    const result = await createModuleScaffold({
      modulesDir,
      id: 'loose-tags',
      meta: { name: 'Loose Tags', description: 'Loose tags', tags: 'utility' },
    });

    expect(await fs.readJson(result.metaPath)).toMatchObject({ tags: [] });
    await expect(
      createModuleScaffold({
        modulesDir,
        id: 'bad-keywords',
        meta: { name: 'Bad Keywords', description: 'Bad keywords', keywords: 'scratch' },
      })
    ).rejects.toThrow('keywords must be an array');
  });
});
