// 简单数据模型 & 工具
export function parseContributors(raw) {
  if (!raw) return []
  // 允许: "gh/name, sc/other, Alice" 或数组
  if (Array.isArray(raw)) {
    return raw.map(normalizeOne).filter(Boolean)
  }
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map(normalizeOne)
      .filter(Boolean)
  }
  return []
}

function normalizeOne(entry) {
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
  if (typeof entry === 'object' && entry.name) return { name: entry.name, url: entry.url }
  return null
}

// 选择多语言映射的默认值（优先 en -> zh-cn -> 第一个）
function pickDefaultFromMap(map) {
  if (!map || typeof map !== 'object') return undefined
  if (map['en']) return map['en']
  if (map['zh-cn']) return map['zh-cn']
  const keys = Object.keys(map)
  return keys.length ? map[keys[0]] : undefined
}

function normalizeI18nStringOrMap(v) {
  if (v == null) return { base: undefined, map: undefined }
  if (typeof v === 'string') return { base: v, map: undefined }
  if (typeof v === 'object') {
    const base = pickDefaultFromMap(v)
    return { base, map: v }
  }
  return { base: String(v), map: undefined }
}

function normalizeI18nTags(v) {
  if (Array.isArray(v)) return { base: v, map: undefined }
  if (v && typeof v === 'object') {
    const base = pickDefaultFromMap(v)
    return { base: Array.isArray(base) ? base : [], map: v }
  }
  return { base: [], map: undefined }
}

export function buildModuleRecord(meta, extra) {
  const { id, name, description, tags, contributors } = meta
  const errors = []
  if (!id) errors.push('missing id')
  if (!name) errors.push('missing name')
  if (!description) errors.push('missing description')
  if (!(Array.isArray(tags) || (tags && typeof tags === 'object')))
    errors.push('tags must be array or i18n map')

  const nameNorm = normalizeI18nStringOrMap(name)
  const descNorm = normalizeI18nStringOrMap(description)
  const tagsNorm = normalizeI18nTags(tags)
  // 脚本标题（英文，按脚本 id -> 标题）
  const scriptTitles =
    meta && typeof meta.scriptTitles === 'object' && !Array.isArray(meta.scriptTitles)
      ? meta.scriptTitles
      : {}

  const record = {
    id,
    slug: id, // slug 直接使用 id
    name: nameNorm.base,
    description: descNorm.base,
    tags: Array.isArray(tagsNorm.base) ? tagsNorm.base : [],
    // 新增：脚本标题（英文）
    scriptTitles,
    contributors: parseContributors(contributors),
    // keywords field removed - rely on tags for searchability
    // 统一使用 scripts 数组 [{ id, title, content }]
    scripts: Array.isArray(extra.scripts) ? extra.scripts : [],
    hasDemo: !!extra.demoFile,
    demoFile: extra.demoFile,
    // variables / references 已合并进 meta.json（不再单独文件）
    variables: Array.isArray(meta.variables) ? meta.variables : [],
    notesHtml: extra.notesHtml || '',
    references: Array.isArray(meta.references) ? meta.references : [],
    translations: extra.translations || {},
  }
  return { record, errors }
}
