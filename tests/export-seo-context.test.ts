import { describe, expect, it } from 'bun:test';
import { renderSeoContextMarkdown } from '../scripts/export-seo-context.ts';

describe('renderSeoContextMarkdown', () => {
  const module = {
    id: 'sample',
    slug: 'sample',
    name: '示例模块',
    description: '用于测试 SEO 上下文导出。',
    tags: ['数学', '工具'],
    keywords: ['scratch', 'seo'],
    keywordsFinal: ['scratch', 'seo', '数学', '工具'],
    keywordsFinalStr: 'scratch,seo,数学,工具',
    keywordsStr: 'scratch,seo',
    contributors: [{ name: 'dev', url: 'https://example.com/dev' }],
    scripts: [
      {
        id: 'main',
        title: '主脚本',
        content: 'when flag clicked\nsay [hello]',
        leadingImports: [
          {
            imported: true as true,
            content: 'define helper\nsay [helper]',
            fromId: 'helper-module',
            fromName: 'Helper Module',
            fromIndex: 1,
            fromScriptId: 'main',
            fromTitle: 'Helper Script',
          },
        ],
      },
    ],
    hasDemo: true,
    demoFile: 'modules/sample/demo.sb3',
    variables: [{ name: 'result', displayName: '结果', type: 'variable', scope: 'sprite' }],
    notesHtml: '<p>Use this module when testing.</p>',
    references: [{ title: 'Reference', url: 'https://example.com/ref', type: 'docs' }],
    scriptTitles: {},
    translations: {},
    notesMap: {},
    hasPartialTranslation: false,
  };

  it('renders metadata, optional sections, scripts, and system prompt', () => {
    const markdown = renderSeoContextMarkdown({
      module,
      locale: 'zh-cn',
      systemPrompt: 'You are an SEO assistant.',
    });

    expect(markdown.includes('# System Prompt')).toBeTruthy();
    expect(markdown.includes('You are an SEO assistant.')).toBeTruthy();
    expect(markdown.includes('# Module SEO Context')).toBeTruthy();
    expect(markdown.includes('- id: sample')).toBeTruthy();
    expect(markdown.includes('- name: 示例模块')).toBeTruthy();
    expect(markdown.includes('- tags: 数学, 工具')).toBeTruthy();
    expect(markdown.includes('- contributors: dev (https://example.com/dev)')).toBeTruthy();
    expect(markdown.includes('## Variables')).toBeTruthy();
    expect(markdown.includes('name=result, displayName=结果, type=variable, scope=sprite')).toBeTruthy();
    expect(markdown.includes('## References')).toBeTruthy();
    expect(markdown.includes('Reference [docs]: https://example.com/ref')).toBeTruthy();
    expect(markdown.includes('## Notes')).toBeTruthy();
    expect(markdown.includes('<p>Use this module when testing.</p>')).toBeTruthy();
    expect(markdown.includes('### Script 1: 主脚本')).toBeTruthy();
    expect(markdown.includes('#### Imported Script 1: Helper Module / Helper Script')).toBeTruthy();
    expect(markdown.includes('```scratchblocks\nwhen flag clicked\nsay [hello]\n```')).toBeTruthy();
    expect(markdown.includes('## Generation Task')).toBeTruthy();
  });

  it('omits empty optional sections and system prompt', () => {
    const markdown = renderSeoContextMarkdown({
      module: {
        ...module,
        contributors: [],
        variables: [],
        references: [],
        notesHtml: '',
        scripts: [],
        hasDemo: false,
        demoFile: undefined,
      },
      locale: 'en',
    });

    expect(markdown.includes('# System Prompt')).toBe(false);
    expect(markdown.includes('## Variables')).toBe(false);
    expect(markdown.includes('## References')).toBe(false);
    expect(markdown.includes('## Notes')).toBe(false);
    expect(markdown.includes('- contributors: None')).toBeTruthy();
    expect(markdown.includes('- has demo: no')).toBeTruthy();
    expect(markdown.includes('No scripts available.')).toBeTruthy();
  });

  it('renders an English generation task for en locale', () => {
    const markdown = renderSeoContextMarkdown({ module, locale: 'en' });

    expect(markdown.includes('- Write in English.')).toBe(true);
    expect(markdown.includes('between 120 and 160 characters')).toBe(true);
    expect(markdown.includes('使用简体中文')).toBe(false);
    expect(markdown.includes('长度控制在100-140字')).toBe(false);
  });

  it('renders a Simplified Chinese generation task for zh-cn locale', () => {
    const markdown = renderSeoContextMarkdown({ module, locale: 'zh-cn' });

    expect(markdown.includes('- 使用简体中文。')).toBe(true);
    expect(markdown.includes('长度控制在80-140字')).toBe(true);
  });
});

describe('export-seo-context CLI', () => {
  it('exports an existing module for zh-cn', () => {
    const result = Bun.spawnSync({
      cmd: ['bun', './scripts/export-seo-context.ts', 'exponentiation', '--locale', 'zh-cn'],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const stdout = result.stdout.toString();

    expect(result.exitCode).toBe(0);
    expect(stdout.includes('# Module SEO Context')).toBeTruthy();
    expect(stdout.includes('- id: exponentiation')).toBeTruthy();
    expect(stdout.includes('幂')).toBeTruthy();
    expect(stdout.includes('```scratchblocks')).toBeTruthy();
  });

  it('fails for an unknown module', () => {
    const result = Bun.spawnSync({
      cmd: ['bun', './scripts/export-seo-context.ts', 'not-a-real-module'],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const stderr = result.stderr.toString();

    expect(result.exitCode).toBe(1);
    expect(stderr.includes('Module not found: not-a-real-module')).toBeTruthy();
  });

  it('fails when the system prompt file is missing', () => {
    const result = Bun.spawnSync({
      cmd: [
        'bun',
        './scripts/export-seo-context.ts',
        'exponentiation',
        '--system-prompt-file',
        'tests/does-not-exist.prompt.txt',
      ],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const stderr = result.stderr.toString();

    expect(result.exitCode).toBe(1);
    expect(stderr.includes('Unable to read --system-prompt-file')).toBeTruthy();
  });
});
