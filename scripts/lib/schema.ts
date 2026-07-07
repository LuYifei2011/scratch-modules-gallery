// 简单数据模型 & 工具
import type { Contributor, ModuleMeta, ModuleRecord, ModuleScript, ModuleTranslation } from './types.ts';

export function parseContributors(raw: unknown): Contributor[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map(normalizeOne).filter((item): item is Contributor => Boolean(item));
  }
  return [];
}

function normalizeOne(entry: unknown): Contributor | null {
  if (!entry) return null;
  if (typeof entry === 'string') {
    const value = entry.trim();
    if (!value) return null;
    // 形式: gh/用户名 或 sc/用户名 或 普通名字
    if (value.startsWith('gh/')) {
      const name = value.slice(3).trim();
      if (!name) return null;
      return { name, url: `https://github.com/${name}` };
    }
    if (value.startsWith('sc/')) {
      const name = value.slice(3).trim();
      if (!name) return null;
      return { name, url: `https://scratch.mit.edu/users/${name}` };
    }
    return { name: value };
  }
  if (entry && typeof entry === 'object' && 'name' in entry && typeof entry.name === 'string') {
    const name = entry.name.trim();
    if (!name) return null;
    const url = 'url' in entry && typeof entry.url === 'string' ? entry.url : undefined;
    return { name, url };
  }
  return null;
}

export interface BuildModuleRecordExtra {
  scripts?: ModuleScript[];
  demoFile?: string;
  notesMap?: Record<string, string>;
  translations?: Record<string, ModuleTranslation>;
}

export function buildModuleRecord(
  meta: ModuleMeta,
  extra: BuildModuleRecordExtra
): { record: ModuleRecord; errors: string[] } {
  const { id, name, description, seoDescription, tags, keywords, contributors } = meta;
  const errors = [];
  if (!id) errors.push('missing id');
  if (typeof name !== 'string' || !name.trim()) errors.push('missing name');
  if (typeof description !== 'string' || !description.trim()) errors.push('missing description');
  if (!Array.isArray(tags)) errors.push('tags must be array');
  if (contributors !== undefined && contributors !== null && !Array.isArray(contributors)) {
    errors.push('contributors must be array');
  }
  // 脚本标题（英文，按脚本 id -> 标题）
  const scriptTitles =
    meta && typeof meta.scriptTitles === 'object' && !Array.isArray(meta.scriptTitles) ? meta.scriptTitles : {};

  const record: ModuleRecord = {
    id,
    slug: id, // slug 直接使用 id
    name,
    description,
    seoDescription: typeof seoDescription === 'string' ? seoDescription : undefined,
    tags: Array.isArray(tags) ? tags : [],
    keywords: Array.isArray(keywords) ? keywords : [],
    // 新增：脚本标题（英文）
    scriptTitles,
    contributors: parseContributors(contributors),
    // 统一使用 scripts 数组 [{ id, title, content }]
    scripts: Array.isArray(extra.scripts) ? extra.scripts : [],
    hasDemo: !!extra.demoFile,
    demoFile: extra.demoFile,
    // variables / references 已合并进 meta.json（不再单独文件）
    variables: Array.isArray(meta.variables) ? meta.variables : [],
    notesMap: extra.notesMap || {},
    references: Array.isArray(meta.references) ? meta.references : [],
    translations: extra.translations || {},
    // hasPartialTranslation: 由 i18n-engine 在翻译时按语言设置，
    // 标记当前语言下该模块存在未翻译字段（name/description/scriptTitles 等缺失）。
    // 模板（module.eta）用此字段展示"部分内容未翻译"提示栏。
    hasPartialTranslation: false,
  };
  return { record, errors };
}
