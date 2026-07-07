import { describe, expect, it } from 'bun:test';
import { parseContributors, buildModuleRecord } from '../scripts/lib/schema.ts';

describe('parseContributors', () => {
  it('returns empty array for null/undefined', () => {
    expect(parseContributors(null)).toEqual([]);
    expect(parseContributors(undefined)).toEqual([]);
  });

  it('parses sc/ prefix (Scratch user)', () => {
    const result = parseContributors(['sc/scratcher']);
    expect(result).toEqual([{ name: 'scratcher', url: 'https://scratch.mit.edu/users/scratcher' }]);
  });

  it('parses plain name (no prefix)', () => {
    const result = parseContributors(['Alice']);
    expect(result).toEqual([{ name: 'Alice' }]);
  });

  it('parses mixed array entries', () => {
    const result = parseContributors(['gh/dev', 'sc/user', 'Plain Name']);
    expect(result.length).toBe(3);
    expect(result[0]!.url).toBe('https://github.com/dev');
    expect(result[1]!.url).toBe('https://scratch.mit.edu/users/user');
    expect(result[2]!.name).toBe('Plain Name');
    expect(result[2]!.url).toBe(undefined);
  });

  it('parses array of strings', () => {
    const result = parseContributors(['gh/a', 'sc/b']);
    expect(result.length).toBe(2);
    expect(result[0]!.url).toBe('https://github.com/a');
  });

  it('parses array of objects', () => {
    const result = parseContributors([{ name: 'Test', url: 'https://example.com' }]);
    expect(result).toEqual([{ name: 'Test', url: 'https://example.com' }]);
  });

  it('filters out empty entries', () => {
    const result = parseContributors(['gh/a', '', '  ', 'gh/b']);
    expect(result.length).toBe(2);
  });

  it('returns empty array for strings and other non-array values', () => {
    expect(parseContributors('gh/a')).toEqual([]);
    expect(parseContributors(42)).toEqual([]);
    expect(parseContributors({})).toEqual([]);
  });
});

describe('buildModuleRecord', () => {
  it('builds a valid record with required fields', () => {
    const meta = {
      id: 'test-mod',
      name: 'Test Module',
      description: 'A test module.',
      tags: ['math'],
    };
    const extra = {
      scripts: [{ id: 'main', content: 'when flag clicked' }],
      demoFile: undefined,
      notesMap: {},
      translations: {},
    };
    const { record, errors } = buildModuleRecord(meta, extra);
    expect(errors.length).toBe(0);
    expect(record.id).toBe('test-mod');
    expect(record.slug).toBe('test-mod');
    expect(record.name).toBe('Test Module');
    expect(record.description).toBe('A test module.');
    expect(record.tags).toEqual(['math']);
    expect(record.scripts.length).toBe(1);
    expect(record.hasDemo).toBe(false);
  });

  it('preserves optional seoDescription without requiring it', () => {
    const meta = {
      id: 'seo-mod',
      name: 'SEO Module',
      description: 'Visible description.',
      seoDescription: 'Search result description.',
      tags: ['seo'],
    };
    const extra = { scripts: [], notesMap: {} };
    const { record, errors } = buildModuleRecord(meta, extra);
    expect(errors.length).toBe(0);
    expect(record.description).toBe('Visible description.');
    expect(record.seoDescription).toBe('Search result description.');
  });

  it('reports errors for missing required fields', () => {
    const meta = {};
    const extra = { scripts: [], notesMap: {} };
    const { errors } = buildModuleRecord(meta, extra);
    expect(errors.includes('missing id')).toBeTruthy();
    expect(errors.includes('missing name')).toBeTruthy();
    expect(errors.includes('missing description')).toBeTruthy();
    expect(errors.some((e) => e.includes('tags'))).toBeTruthy();
  });

  it('rejects i18n maps in meta baseline fields', () => {
    const meta: any = {
      id: 'i18n-mod',
      name: { en: 'English Name', 'zh-cn': '中文名称' },
      description: 'desc',
      tags: ['test'],
    };
    const extra = { scripts: [], notesMap: {} };
    const { errors } = buildModuleRecord(meta, extra);
    expect(errors.includes('missing name')).toBeTruthy();
  });

  it('handles contributors in meta', () => {
    const meta = {
      id: 'c',
      name: 'C',
      description: 'D',
      tags: ['x'],
      contributors: ['gh/dev'],
    };
    const extra = { scripts: [], notesMap: {} };
    const { record } = buildModuleRecord(meta, extra);
    expect(record.contributors.length).toBe(1);
    expect(record.contributors[0]!.name).toBe('dev');
  });

  it('reports an error when contributors is not an array', () => {
    const meta = {
      id: 'bad-contributors',
      name: 'Bad Contributors',
      description: 'D',
      tags: ['x'],
      contributors: 'gh/dev',
    } as any;
    const extra = { scripts: [], notesMap: {} };
    const { record, errors } = buildModuleRecord(meta, extra);
    expect(errors.includes('contributors must be array')).toBeTruthy();
    expect(record.contributors).toEqual([]);
  });

  it('includes variables and references from meta', () => {
    const meta = {
      id: 'v',
      name: 'V',
      description: 'D',
      tags: ['x'],
      variables: [{ name: 'myVar', type: 'variable' }],
      references: [{ title: 'Ref', url: 'https://example.com' }],
    };
    const extra = { scripts: [], notesMap: {} };
    const { record } = buildModuleRecord(meta, extra);
    expect(record.variables.length).toBe(1);
    expect(record.references.length).toBe(1);
  });

  it('sets hasDemo to true when demoFile is provided', () => {
    const meta = { id: 'demo', name: 'D', description: 'D', tags: ['x'] };
    const extra = { scripts: [], demoFile: 'modules/demo/demo.sb3', notesMap: {} };
    const { record } = buildModuleRecord(meta, extra);
    expect(record.hasDemo).toBe(true);
    expect(record.demoFile).toBe('modules/demo/demo.sb3');
  });

  it('handles scriptTitles from meta', () => {
    const meta = {
      id: 'st',
      name: 'ST',
      description: 'D',
      tags: ['x'],
      scriptTitles: { main: 'Main Script' },
    };
    const extra = { scripts: [], notesMap: {} };
    const { record } = buildModuleRecord(meta, extra);
    expect(record.scriptTitles).toEqual({ main: 'Main Script' });
  });
});
