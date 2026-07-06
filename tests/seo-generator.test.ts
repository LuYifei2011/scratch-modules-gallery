import { afterEach, describe, expect, it } from 'bun:test';
import fs from 'fs-extra';
import path from 'path';
import { cleanGeneratedSeoText, generateMissingSeoDescriptions } from '../scripts/lib/seo-generator.ts';
import { makeTestTempDir, removeTestTempDir } from './helpers/temp.ts';

const tmpRoots: string[] = [];

async function createFixture(): Promise<string> {
  const root = await makeTestTempDir('scratch-seo-generate');
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
  await fs.outputJson(path.join(root, 'src/i18n/zh-cn.json'), { meta: { languageTag: 'zh-CN' } });
  await fs.outputJson(path.join(root, 'src/i18n/tags.json'), {
    utility: { en: 'Utility', 'zh-cn': '工具' },
  });
  await fs.outputJson(path.join(root, 'src/i18n/module-defaults.json'), {});
  await fs.outputJson(path.join(root, 'content/modules/sample/meta.json'), {
    id: 'sample',
    name: 'Sample Module',
    description: 'Calculate and show a reusable project value.',
    tags: ['utility'],
    keywords: ['scratch', 'value'],
  });
  await fs.outputJson(path.join(root, 'content/modules/sample/i18n/zh-cn.json'), {
    name: '示例模块',
    description: '计算并显示可复用的项目数值。',
  });
  await fs.outputFile(
    path.join(root, 'content/modules/sample/scripts/01-main.txt'),
    'when green flag clicked\nset [result v] to (timer)\nsay (result)',
    'utf8'
  );

  return root;
}

afterEach(async () => {
  while (tmpRoots.length) {
    await removeTestTempDir(tmpRoots.pop());
  }
});

describe('seo-generator', () => {
  const validZhText =
    '这个Scratch模块会读取项目运行状态并把结果保存到变量中，再通过脚本显示出来，适合整理常见计算流程、复用基础逻辑，并帮助学习变量更新和结果展示的实现方式示例。';

  it('cleans common LLM wrappers from generated text', () => {
    expect(cleanGeneratedSeoText('```text\nSEO 描述： “hello   world”\n```')).toBe('hello world');
  });

  it('generates only matching missing descriptions without writing by default', async () => {
    const root = await createFixture();
    const calls: string[] = [];
    const results = await generateMissingSeoDescriptions({
      root,
      moduleId: 'sample',
      locale: 'zh-cn',
      complete: async (request) => {
        calls.push(request.prompt);
        return validZhText;
      },
    });

    expect(results).toHaveLength(1);
    expect(results[0].target).toMatchObject({
      moduleId: 'sample',
      locale: 'zh-cn',
      file: 'content/modules/sample/i18n/zh-cn.json',
    });
    expect(results[0].valid).toBe(true);
    expect(results[0].applied).toBe(false);
    expect(calls[0].includes('# Module SEO Context')).toBe(true);

    const i18n = await fs.readJson(path.join(root, 'content/modules/sample/i18n/zh-cn.json'));
    expect(i18n.seoDescription).toBeUndefined();
  });

  it('applies valid generated descriptions when requested', async () => {
    const root = await createFixture();
    const results = await generateMissingSeoDescriptions({
      root,
      moduleId: 'sample',
      locale: 'zh-cn',
      apply: true,
      complete: async () => validZhText,
    });

    expect(results[0].applied).toBe(true);
    const i18n = await fs.readJson(path.join(root, 'content/modules/sample/i18n/zh-cn.json'));
    expect(i18n.seoDescription).toBe(validZhText);
  });

  it('retries short output and skips invalid final output in apply mode', async () => {
    const root = await createFixture();
    let calls = 0;
    const results = await generateMissingSeoDescriptions({
      root,
      moduleId: 'sample',
      locale: 'zh-cn',
      apply: true,
      complete: async () => {
        calls += 1;
        return '太短。';
      },
    });

    expect(calls).toBe(2);
    expect(results[0].valid).toBe(false);
    expect(results[0].applied).toBe(false);
    expect(results[0].skipped).toBe(true);
    expect(results[0].warnings.join('\n')).toContain('Not applied');

    const i18n = await fs.readJson(path.join(root, 'content/modules/sample/i18n/zh-cn.json'));
    expect(i18n.seoDescription).toBeUndefined();
  });
});
