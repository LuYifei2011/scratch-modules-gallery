import { afterEach, describe, expect, it } from 'bun:test';
import fs from 'fs-extra';
import path from 'path';
import {
  cleanGeneratedSeoText,
  generateMissingSeoDescriptions,
  type SeoGenerationProgressEvent,
} from '../scripts/lib/seo-generator.ts';
import { makeTestTempDir, removeTestTempDir } from './helpers/temp.ts';

const tmpRoots: string[] = [];

interface FixtureOptions {
  zhCnSeoDescription?: string;
  zhTwSeoDescription?: string;
}

async function createFixture(options: FixtureOptions = {}): Promise<string> {
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
  await fs.outputJson(path.join(root, 'src/i18n/zh-tw.json'), { meta: { languageTag: 'zh-TW' } });
  await fs.outputJson(path.join(root, 'src/i18n/tags.json'), {
    utility: { en: 'Utility', 'zh-cn': '工具', 'zh-tw': '工具' },
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
    ...(options.zhCnSeoDescription ? { seoDescription: options.zhCnSeoDescription } : {}),
  });
  await fs.outputJson(path.join(root, 'content/modules/sample/i18n/zh-tw.json'), {
    name: '範例模組',
    description: '計算並顯示可重用的專案數值。',
    ...(options.zhTwSeoDescription ? { seoDescription: options.zhTwSeoDescription } : {}),
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
  const validZhTwText =
    '這個Scratch模組會讀取專案執行狀態並把結果儲存到變數中，再透過腳本顯示出來，適合整理常見計算流程、重用基礎邏輯，並幫助學習變數更新和結果展示的實作方式範例。';
  const validEnText =
    'Use this Scratch module to read a project value, store it in a variable, and display the result through a reusable script for learning state updates.';

  it('cleans common LLM wrappers from generated text', () => {
    expect(cleanGeneratedSeoText('```text\nSEO 描述： “hello   world”\n```')).toBe('hello world');
  });

  it('generates only matching missing descriptions without writing by default', async () => {
    const root = await createFixture();
    const calls: string[] = [];
    const progress: SeoGenerationProgressEvent[] = [];
    const results = await generateMissingSeoDescriptions({
      root,
      moduleId: 'sample',
      locale: 'zh-cn',
      onProgress: (event) => progress.push(event),
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
    expect(progress.map((event) => event.type)).toEqual(['start', 'target-start', 'target-complete']);
    expect(progress[0]).toMatchObject({ type: 'start', total: 1 });
    expect(progress[1]).toMatchObject({ type: 'target-start', index: 1, total: 1 });
    expect(progress[2]).toMatchObject({ type: 'target-complete', index: 1, total: 1 });

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

  it('generates zh-cn first and derives zh-tw from it when both are missing', async () => {
    const root = await createFixture();
    const calls: { locale: string; mode: string | undefined; sourceLocale: string | undefined }[] = [];
    const results = await generateMissingSeoDescriptions({
      root,
      moduleId: 'sample',
      complete: async (request) => {
        calls.push({
          locale: request.target.locale,
          mode: request.generationMode,
          sourceLocale: request.sourceLocale,
        });
        if (request.target.locale === 'en') return validEnText;
        if (request.target.locale === 'zh-cn') return validZhText;
        return validZhTwText;
      },
    });

    expect(results.map((result) => result.target.locale)).toEqual(['en', 'zh-cn', 'zh-tw']);
    expect(calls).toEqual([
      { locale: 'en', mode: 'context', sourceLocale: undefined },
      { locale: 'zh-cn', mode: 'context', sourceLocale: undefined },
      { locale: 'zh-tw', mode: 'sibling-locale', sourceLocale: 'zh-cn' },
    ]);
    expect(results[2]).toMatchObject({
      generationMode: 'sibling-locale',
      sourceLocale: 'zh-cn',
      valid: true,
    });
  });

  it('derives missing zh-tw from an existing zh-cn description', async () => {
    const root = await createFixture({ zhCnSeoDescription: validZhText });
    const calls: string[] = [];
    const results = await generateMissingSeoDescriptions({
      root,
      moduleId: 'sample',
      locale: 'zh-tw',
      complete: async (request) => {
        calls.push(request.prompt);
        expect(request.generationMode).toBe('sibling-locale');
        expect(request.sourceLocale).toBe('zh-cn');
        expect(request.sourceText).toBe(validZhText);
        return validZhTwText;
      },
    });

    expect(results).toHaveLength(1);
    expect(results[0].generationMode).toBe('sibling-locale');
    expect(results[0].sourceLocale).toBe('zh-cn');
    expect(calls[0].includes('SEO Description Locale Derivation')).toBe(true);
  });

  it('derives missing zh-cn from an existing zh-tw description', async () => {
    const root = await createFixture({ zhTwSeoDescription: validZhTwText });
    const results = await generateMissingSeoDescriptions({
      root,
      moduleId: 'sample',
      locale: 'zh-cn',
      complete: async (request) => {
        expect(request.generationMode).toBe('sibling-locale');
        expect(request.sourceLocale).toBe('zh-tw');
        expect(request.sourceText).toBe(validZhTwText);
        return validZhText;
      },
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      generationMode: 'sibling-locale',
      sourceLocale: 'zh-tw',
      valid: true,
    });
  });
});
