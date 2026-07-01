import { afterEach, describe, expect, it } from 'bun:test';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import {
  checkSeoDescriptions,
  countSeoCharacters,
  getSeoDescriptionRange,
  hasBlockingSeoIssues,
  normalizeSeoText,
  seoIssueToBuildIssue,
} from '../scripts/lib/seo-checker.ts';
import type { ModuleRecord } from '../scripts/lib/types.ts';

const tmpRoots: string[] = [];

function moduleRecord(overrides: Partial<ModuleRecord> = {}): ModuleRecord {
  return {
    id: 'sample',
    slug: 'sample',
    name: 'Sample',
    description: 'Visible description.',
    seoDescription:
      'Use this Scratch module to calculate a stable value from the current project state and display the result in a reusable script.',
    tags: ['utility'],
    keywords: [],
    contributors: [],
    scripts: [{ id: 'main', content: 'when flag clicked' }],
    hasDemo: false,
    variables: [],
    notesMap: {},
    references: [],
    translations: {
      'zh-cn': {
        name: '示例',
        description: '可见描述。',
        seoDescription:
          '这个Scratch模块用于根据项目状态计算稳定数值，并通过可复用脚本显示结果，适合整理常见逻辑、减少重复搭建并保持项目结构清晰。',
      },
      'zh-tw': {
        name: '範例',
        description: '可見描述。',
        seoDescription:
          '這個Scratch模組用於根據專案狀態計算穩定數值，並透過可重用腳本顯示結果，適合整理常見邏輯、減少重複搭建並保持專案結構清晰。',
      },
    },
    hasPartialTranslation: false,
    ...overrides,
  };
}

async function createCliFixture(seoDescription: string | undefined): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scratch-seo-check-'));
  tmpRoots.push(root);

  await fs.outputFile(
    path.join(root, 'site.config.ts'),
    [
      'export default {',
      '  baseUrl: "https://example.com",',
      '  contentDir: "content/modules",',
      '  outDir: "dist",',
      '  siteName: "Fixture",',
      '  description: "Fixture site"',
      '};',
      '',
    ].join('\n'),
    'utf8'
  );
  await fs.outputJson(path.join(root, 'src/i18n/en.json'), { meta: { languageTag: 'en' } });
  await fs.outputJson(path.join(root, 'src/i18n/tags.json'), {});
  await fs.outputJson(path.join(root, 'src/i18n/module-defaults.json'), {});
  await fs.outputJson(path.join(root, 'content/modules/sample/meta.json'), {
    id: 'sample',
    name: 'Sample',
    description: 'Visible description.',
    ...(seoDescription === undefined ? {} : { seoDescription }),
    tags: ['utility'],
  });
  await fs.outputFile(path.join(root, 'content/modules/sample/scripts/01-main.txt'), 'when flag clicked', 'utf8');

  return root;
}

afterEach(async () => {
  while (tmpRoots.length) {
    const root = tmpRoots.pop();
    if (root) await fs.remove(root);
  }
});

describe('SEO description checker', () => {
  it('normalizes whitespace and counts Unicode code points', () => {
    expect(normalizeSeoText('  hello\n\nworld  ')).toBe('hello world');
    expect(countSeoCharacters('  帧率  test  ')).toBe(7);
  });

  it('uses locale-specific length ranges', () => {
    expect(getSeoDescriptionRange('en')).toEqual({ min: 120, max: 160 });
    expect(getSeoDescriptionRange('zh-cn')).toEqual({ min: 80, max: 140 });
    expect(getSeoDescriptionRange('ja')).toEqual({ min: 80, max: 140 });
    expect(getSeoDescriptionRange('fr')).toEqual({ min: 80, max: 160 });
  });

  it('reports missing baseline and localized seoDescription as blocking errors', () => {
    const issues = checkSeoDescriptions(
      [
        moduleRecord({
          seoDescription: undefined,
          translations: {
            'zh-cn': { name: '示例', description: '可见描述。' },
          },
        }),
      ],
      { locales: ['en', 'zh-cn'] }
    );

    expect(issues.map((issue) => issue.code)).toEqual(['seo-description-missing', 'seo-description-missing']);
    expect(issues.every((issue) => issue.type === 'error')).toBe(true);
    expect(hasBlockingSeoIssues(issues)).toBe(true);
  });

  it('reports too-short and too-long seoDescription as non-blocking warnings', () => {
    const issues = checkSeoDescriptions(
      [
        moduleRecord({
          seoDescription: 'Too short.',
          translations: {
            'zh-cn': {
              seoDescription:
                '这个Scratch模块用于根据项目状态计算稳定数值，并通过可复用脚本显示结果，适合整理常见逻辑、减少重复搭建并保持项目结构清晰。这个描述故意写得更长一些，用来触发中文SEO描述长度上限检查，确保检查器能够报告过长内容，同时继续补充无关的说明文字，让测试数据稳定超过一百四十个字符并触发警告。',
            },
          },
        }),
      ],
      { locales: ['en', 'zh-cn'] }
    );

    expect(issues.map((issue) => issue.code)).toEqual(['seo-description-too-short', 'seo-description-too-long']);
    expect(issues.every((issue) => issue.type === 'warn')).toBe(true);
    expect(hasBlockingSeoIssues(issues)).toBe(false);
  });

  it('converts SEO issues to build issues with details', () => {
    const [issue] = checkSeoDescriptions([moduleRecord({ seoDescription: undefined })], { locales: ['en'] });
    const buildIssue = seoIssueToBuildIssue(issue!);

    expect(buildIssue.type).toBe('error');
    expect(buildIssue.message).toContain('missing seoDescription');
    expect(buildIssue.details.code).toBe('seo-description-missing');
    expect(buildIssue.details.moduleId).toBe('sample');
  });
});

describe('check-seo CLI', () => {
  const scriptPath = path.resolve('scripts/check-seo.ts');

  it('exits 0 when only length warnings are present', async () => {
    const root = await createCliFixture('Too short.');
    const result = Bun.spawnSync({
      cmd: ['bun', scriptPath, '--format=json'],
      cwd: root,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const output = JSON.parse(result.stdout.toString());

    expect(result.exitCode).toBe(0);
    expect(output.errors).toBe(0);
    expect(output.warnings).toBe(1);
    expect(output.issues[0].code).toBe('seo-description-too-short');
  });

  it('exits 1 when seoDescription is missing', async () => {
    const root = await createCliFixture(undefined);
    const result = Bun.spawnSync({
      cmd: ['bun', scriptPath, '--format=json'],
      cwd: root,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const output = JSON.parse(result.stdout.toString());

    expect(result.exitCode).toBe(1);
    expect(output.errors).toBe(1);
    expect(output.issues[0].code).toBe('seo-description-missing');
  });
});
