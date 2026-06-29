// 简单数据模型 & 工具
import type {
  Contributor,
  I18nStringArrayMap,
  I18nStringArrayOrMap,
  I18nStringMap,
  I18nStringOrMap,
  ModuleMeta,
  ModuleRecord,
  ModuleScript,
  ModuleTranslation,
} from './types.ts'

type NormalizedI18nValue<T> = {
  base: T | undefined
  map: Record<string, T> | undefined
}

export function parseContributors(raw: unknown): Contributor[] {
  if (!raw) return []
  // 允许: "gh/name, sc/other, Alice" 或数组
  if (Array.isArray(raw)) {
    return raw.map(normalizeOne).filter((item): item is Contributor => Boolean(item))
  }
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map(normalizeOne)
      .filter((item): item is Contributor => Boolean(item))
  }
  return []
}

function normalizeOne(entry: unknown): Contributor | null {
  if (!entry) return null
  if (typeof entry === 'string') {
    // 形式: gh/用户名 或 sc/用户名 或 普通名字
    if (entry.startsWith('gh/')) {
      const name = entry.slice(3).trim()
      return { name, url: `https://github.com/${name}` }
    }
    if (entry.startsWith('sc/')) {
      const name = entry.slice(3).trim()
      return { name, url: `https://scratch.mit.edu/users/${name}` }
    }
    return { name: entry }
  }
  if (entry && typeof entry === 'object' && 'name' in entry && typeof entry.name === 'string') {
    const url = 'url' in entry && typeof entry.url === 'string' ? entry.url : undefined
    return { name: entry.name, url }
  }
  return null
}

// 选择多语言映射的默认值（优先 en -> zh-cn -> 第一个）
function pickDefaultFromMap<T>(map: Record<string, T> | undefined): T | undefined {
  if (!map || typeof map !== 'object') return undefined
  if (map['en']) return map['en']
  if (map['zh-cn']) return map['zh-cn']
  const keys = Object.keys(map)
  return keys.length ? map[keys[0]!] : undefined
}

function normalizeI18nStringOrMap(v: I18nStringOrMap | undefined): NormalizedI18nValue<string> {
  if (v == null) return { base: undefined, map: undefined }
  if (typeof v === 'string') return { base: v, map: undefined }

  if (typeof v === 'object') {
    const base = pickDefaultFromMap(v)
    return { base, map: v as I18nStringMap }
  }
  return { base: String(v), map: undefined }
}

function normalizeI18nKeywords(v: I18nStringArrayOrMap | undefined): NormalizedI18nValue<string[]> {
  if (v == null) return { base: [], map: undefined }
  if (Array.isArray(v)) return { base: v, map: undefined }
  if (typeof v === 'object') {
    const base = pickDefaultFromMap(v)
    if (Array.isArray(base)) return { base, map: v }
    return { base: [], map: v as I18nStringArrayMap }
  }
  return { base: [], map: undefined }
}

function normalizeI18nTags(v: I18nStringArrayOrMap | undefined): NormalizedI18nValue<string[]> {
  if (Array.isArray(v)) return { base: v, map: undefined }
  if (v && typeof v === 'object') {
    const base = pickDefaultFromMap(v)
    return { base: Array.isArray(base) ? base : [], map: v }
  }
  return { base: [], map: undefined }
}

export interface BuildModuleRecordExtra {
  scripts?: ModuleScript[]
  demoFile?: string
  notesMap?: Record<string, string>
  translations?: Record<string, ModuleTranslation>
}

export function buildModuleRecord(
  meta: ModuleMeta,
  extra: BuildModuleRecordExtra
): { record: ModuleRecord; errors: string[] } {
  const { id, name, description, tags, keywords, contributors } = meta
  const errors = []
  if (!id) errors.push('missing id')
  if (!name) errors.push('missing name')
  if (!description) errors.push('missing description')
  if (!(Array.isArray(tags) || (tags && typeof tags === 'object'))) errors.push('tags must be array or i18n map')

  const nameNorm = normalizeI18nStringOrMap(name)
  const descNorm = normalizeI18nStringOrMap(description)
  const tagsNorm = normalizeI18nTags(tags)
  const keywordsNorm = normalizeI18nKeywords(keywords)
  // 脚本标题（英文，按脚本 id -> 标题）
  const scriptTitles =
    meta && typeof meta.scriptTitles === 'object' && !Array.isArray(meta.scriptTitles) ? meta.scriptTitles : {}

  const record = {
    id,
    slug: id, // slug 直接使用 id
    name: nameNorm.base,
    description: descNorm.base,
    tags: Array.isArray(tagsNorm.base) ? tagsNorm.base : [],
    keywords: Array.isArray(keywordsNorm.base) ? keywordsNorm.base : [],
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
    // 模板（module.njk）用此字段展示"部分内容未翻译"提示栏。
    hasPartialTranslation: false,
  }
  return { record, errors }
}
