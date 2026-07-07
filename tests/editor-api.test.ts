import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { Readable } from 'stream';
import path from 'path';
import fs from 'fs-extra';
import {
  configureEditorApi,
  createModule,
  createScript,
  deleteAsset,
  deleteI18n,
  getModule,
  resetEditorApiConfig,
  getScripts,
  updateModuleMeta,
  updateScript,
} from '../scripts/lib/editor-api.ts';
import { makeTestTempDir, removeTestTempDir } from './helpers/temp.ts';

const testModuleId = '.editor-api-test';
let fixtureRoot = '';
let modulesDir = '';
let testModuleDir = '';

function jsonReq(body?: unknown) {
  if (body === undefined) {
    return Readable.from([]);
  }
  return Readable.from([JSON.stringify(body)]);
}

function rawReq(body: string) {
  return Readable.from([body]);
}

function resMock() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: '',
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    end(chunk?: string) {
      this.body = chunk || '';
    },
    json() {
      return JSON.parse(this.body);
    },
  };
}

async function writeModule(files: Record<string, string> = {}) {
  await fs.emptyDir(testModuleDir);
  await fs.writeJson(
    path.join(testModuleDir, 'meta.json'),
    {
      id: testModuleId,
      name: 'Editor API Test',
      description: 'Temporary module for editor API tests',
      tags: [],
      keywords: [],
    },
    { spaces: 2, EOL: '\n' }
  );
  await fs.ensureDir(path.join(testModuleDir, 'scripts'));
  for (const [file, content] of Object.entries(files)) {
    await fs.writeFile(path.join(testModuleDir, 'scripts', file), content, 'utf8');
  }
}

async function writeHiddenFixtureModule() {
  const moduleDir = path.join(modulesDir, '.test');
  await fs.outputJson(
    path.join(moduleDir, 'meta.json'),
    {
      id: '.test',
      name: 'Hidden Test Module',
      description: 'Fixture module for editor API tests',
      tags: [],
      keywords: [],
    },
    { spaces: 2, EOL: '\n' }
  );
  await fs.outputFile(path.join(moduleDir, 'scripts', '01-main.txt'), 'say [test]\n', 'utf8');
}

async function call(handler: (...args: any[]) => Promise<void>, ...args: any[]) {
  const res = resMock();
  await handler(jsonReq(), res, ...args);
  return res;
}

async function callWithBody(handler: (...args: any[]) => Promise<void>, body: unknown, ...args: any[]) {
  const res = resMock();
  await handler(jsonReq(body), res, ...args);
  return res;
}

async function callWithRawBody(handler: (...args: any[]) => Promise<void>, body: string, ...args: any[]) {
  const res = resMock();
  await handler(rawReq(body), res, ...args);
  return res;
}

beforeAll(async () => {
  fixtureRoot = await makeTestTempDir('scratch-editor-api');
  modulesDir = path.join(fixtureRoot, 'content', 'modules');
  testModuleDir = path.join(modulesDir, testModuleId);
  configureEditorApi({ modulesDir });
  await writeHiddenFixtureModule();
});

beforeEach(async () => {
  await fs.remove(testModuleDir);
});

afterEach(async () => {
  await fs.remove(testModuleDir);
});

afterAll(async () => {
  resetEditorApiConfig();
  await removeTestTempDir(fixtureRoot);
});

describe('editor-api module id validation', () => {
  it('accepts safe dotted module IDs', async () => {
    const hidden = await call(getModule, '.test');
    expect(hidden.statusCode).toBe(200);

    const dotted = await call(getModule, 'a.b');
    expect(dotted.statusCode).toBe(404);

    const doubleDotted = await call(getModule, 'a..b');
    expect(doubleDotted.statusCode).toBe(404);
  });

  it('rejects unsafe module IDs', async () => {
    for (const id of ['', '.', '..', '../x', 'a/b', 'a\\b', 'UPPER']) {
      const res = await call(getModule, id);
      expect(res.statusCode).toBe(400);
    }
  });
});

describe('editor-api error handling', () => {
  it('returns 400 for invalid JSON through the shared error wrapper', async () => {
    await writeModule({ '01-main.txt': 'say [main]\n' });

    const res = await callWithRawBody(updateModuleMeta, '{bad json', testModuleId);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid JSON' });
  });
});

describe('editor-api module creation', () => {
  it('creates modules through the shared scaffold helper', async () => {
    const res = await callWithBody(createModule, {
      id: testModuleId,
      meta: {
        name: 'Editor API Test',
        description: 'Created through the editor API',
        tags: ['utility'],
        contributors: ['gh/example'],
        keywords: [],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ id: testModuleId, message: 'Module created successfully' });
    expect(await fs.readJson(path.join(testModuleDir, 'meta.json'))).toMatchObject({
      id: testModuleId,
      name: 'Editor API Test',
      description: 'Created through the editor API',
      tags: ['utility'],
      contributors: ['gh/example'],
      keywords: [],
    });
    expect(await fs.readFile(path.join(testModuleDir, 'scripts', '01-main.txt'), 'utf8')).toBe(
      'when green flag clicked\nsay [Hello!] for (2) secs\n'
    );
  });

  it('rejects string contributors during module creation', async () => {
    const res = await callWithBody(createModule, {
      id: testModuleId,
      meta: {
        name: 'Editor API Test',
        description: 'Created through the editor API',
        tags: ['utility'],
        contributors: 'gh/example',
        keywords: [],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'contributors must be an array' });
  });
});

describe('editor-api metadata updates', () => {
  it('rejects string contributors during meta updates', async () => {
    await writeModule({ '01-main.txt': 'say [main]\n' });

    const res = await callWithBody(updateModuleMeta, { contributors: 'gh/example' }, testModuleId);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'contributors must be an array' });
  });
});

describe('editor-api scripts', () => {
  it('returns scripts in natural numeric order with loader-compatible IDs', async () => {
    await writeModule({
      '10 清理.txt': 'say [cleanup]\n',
      '1-a.txt': 'say [a]\n',
      '02_主循环.txt': 'say [loop]\n',
      'main.txt': 'say [main]\n',
    });

    const res = await call(getScripts, testModuleId);
    expect(res.statusCode).toBe(200);
    expect(res.json().scripts.map((script) => [script.id, script.order])).toEqual([
      ['a', 1],
      ['主循环', 2],
      ['清理', 10],
      ['main', 0],
    ]);
  });

  it('creates scripts with filename-safe IDs', async () => {
    await writeModule();

    const accepted = await callWithBody(
      createScript,
      { id: '初始化 版本_1.a', content: 'when green flag clicked\n' },
      testModuleId
    );
    expect(accepted.statusCode).toBe(201);
    expect(accepted.json().id).toBe('初始化 版本_1.a');
    expect(await fs.pathExists(path.join(testModuleDir, 'scripts', '01-初始化 版本_1.a.txt'))).toBe(true);

    for (const id of ['', '.', '..', 'bad/name', 'bad\\name', 'with.txt']) {
      const res = await callWithBody(createScript, { id }, testModuleId);
      expect(res.statusCode).toBe(400);
    }
  });

  it('renames scripts to filename-safe IDs and preserves conflict checks', async () => {
    await writeModule({
      '01-main.txt': 'say [main]\n',
      '02-other.txt': 'say [other]\n',
    });

    const renamed = await callWithBody(updateScript, { newId: '主 循环.v1', newOrder: 3 }, testModuleId, 'main');
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json()).toMatchObject({ id: '主 循环.v1', order: 3 });
    expect(await fs.pathExists(path.join(testModuleDir, 'scripts', '03-主 循环.v1.txt'))).toBe(true);

    const conflict = await callWithBody(updateScript, { newId: 'other', newOrder: 2 }, testModuleId, '主 循环.v1');
    expect(conflict.statusCode).toBe(409);
  });
});

describe('editor-api i18n deletion', () => {
  it('validates locale before deleting translation files', async () => {
    await writeModule({ '01-main.txt': 'say [main]\n' });

    const invalid = await call(deleteI18n, testModuleId, '../zh-cn');
    expect(invalid.statusCode).toBe(400);

    const missing = await call(deleteI18n, testModuleId, 'zh-cn');
    expect(missing.statusCode).toBe(404);
  });
});

describe('editor-api asset deletion', () => {
  it('deletes assets with upload-compatible filenames', async () => {
    await writeModule({ '01-main.txt': 'say [main]\n' });
    const assetsDir = path.join(testModuleDir, 'assets');
    const assetPath = path.join(assetsDir, 'preview.png');
    await fs.ensureDir(assetsDir);
    await fs.writeFile(assetPath, 'image');

    const res = await call(deleteAsset, testModuleId, 'preview.png');
    expect(res.statusCode).toBe(200);
    expect(await fs.pathExists(assetPath)).toBe(false);
  });

  it('rejects asset filenames that uploads would not accept', async () => {
    await writeModule({ '01-main.txt': 'say [main]\n' });

    for (const filename of ['', '.', '..', '../x.png', 'nested/x.png', 'nested\\x.png', 'bad name.png', 'bad.exe']) {
      const res = await call(deleteAsset, testModuleId, filename);
      expect(res.statusCode).toBe(400);
    }
  });

  it('returns 404 for missing assets with valid filenames', async () => {
    await writeModule({ '01-main.txt': 'say [main]\n' });

    const res = await call(deleteAsset, testModuleId, 'missing.svg');
    expect(res.statusCode).toBe(404);
  });
});
