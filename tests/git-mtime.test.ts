import { describe, expect, it } from 'bun:test';
import { createGitMtimeResolver, parseGitLogMtimes } from '../scripts/lib/git-mtime.ts';

const fallbackDate = '2026-07-01';

describe('parseGitLogMtimes', () => {
  it('keeps the newest commit date for each query path', () => {
    const output = ['1782890061', '', 'site.config.ts', '', '1770000000', '', 'site.config.ts'].join('\n');

    const mtimes = parseGitLogMtimes(output, ['site.config.ts'], fallbackDate);

    expect(mtimes.get('site.config.ts')).toBe('2026-07-01');
  });

  it('matches files under directory queries', () => {
    const output = ['1775990084', '', 'src/i18n/en.json', 'src/i18n/zh-cn.json'].join('\n');

    const mtimes = parseGitLogMtimes(output, ['src/i18n'], fallbackDate);

    expect(mtimes.get('src/i18n')).toBe('2026-04-12');
  });

  it('resolves multiple query paths from one log output', () => {
    const output = [
      '1775990084',
      '',
      'src/i18n/en.json',
      '',
      '1774010980',
      '',
      'content/modules/fps/scripts/01-main.txt',
    ].join('\n');

    const mtimes = parseGitLogMtimes(output, ['src/i18n', 'content/modules/fps/scripts'], fallbackDate);

    expect(mtimes.get('src/i18n')).toBe('2026-04-12');
    expect(mtimes.get('content/modules/fps/scripts')).toBe('2026-03-20');
  });

  it('uses fallback date for unmatched query paths', () => {
    const mtimes = parseGitLogMtimes('1775990084\n\nsrc/i18n/en.json', ['site.config.ts'], fallbackDate);

    expect(mtimes.get('site.config.ts')).toBe(fallbackDate);
  });
});

describe('createGitMtimeResolver', () => {
  it('returns parsed mtimes from one git log call', async () => {
    const calls: string[][] = [];
    const resolver = await createGitMtimeResolver({
      root: '/repo',
      paths: ['site.config.ts', 'src/i18n'],
      now: () => new Date('2026-07-01T00:00:00.000Z'),
      runGit: async (args) => {
        calls.push(args);
        if (args.includes('--is-inside-work-tree')) return 'true\n';
        if (args.includes('--is-shallow-repository')) return 'false\n';
        return ['1782890061', '', 'site.config.ts', '', '1775990084', '', 'src/i18n/en.json'].join('\n');
      },
    });

    expect(resolver.getLastMod('site.config.ts')).toBe('2026-07-01');
    expect(resolver.getLastMod('src/i18n')).toBe('2026-04-12');
    expect(resolver.getLatestLastMod(['site.config.ts', 'src/i18n'])).toBe('2026-07-01');
    expect(calls.filter((args) => args[0] === 'log')).toHaveLength(1);
  });

  it('falls back when the working directory is not a git repo', async () => {
    const resolver = await createGitMtimeResolver({
      root: '/repo',
      paths: ['site.config.ts'],
      now: () => new Date('2026-07-01T00:00:00.000Z'),
      runGit: async () => 'false\n',
    });

    expect(resolver.getLastMod('site.config.ts')).toBe(fallbackDate);
  });

  it('warns about shallow repositories in dev mode', async () => {
    const warnings: string[] = [];

    await createGitMtimeResolver({
      root: '/repo',
      paths: ['site.config.ts'],
      isDev: true,
      warn: (message) => warnings.push(message),
      now: () => new Date('2026-07-01T00:00:00.000Z'),
      runGit: async (args) => {
        if (args.includes('--is-inside-work-tree')) return 'true\n';
        if (args.includes('--is-shallow-repository')) return 'true\n';
        return '';
      },
    });

    expect(warnings.some((message) => message.includes('浅层克隆'))).toBe(true);
  });
});
